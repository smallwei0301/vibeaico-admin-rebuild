/**
 * #746 端到端：旅客不可預約／申請「今天已過開始時間」的團次（真 HTTP＋真 TEST Supabase）。
 *
 * 驗收：預約頁不列出；直接呼叫建單 API 也被拒絕（409 REQ_003＝ERR.CONFLICT）；
 * 被拒絕時 DB 沒有新訂單、名額不變。涵蓋：今天已過、今天未到、start_time 為 null、明天。
 *
 * 「今天已過／未到」為了不受執行時刻影響，用可確定的邊界造：
 *   - 已過：今天（店家時區）start_time = 00:00（任何時刻都 <= 現在）。
 *   - 未到：今天 start_time = 23:59；若執行時已 >= 23:30 則跳過依賴它的案例（見 NOT_YET_POSSIBLE，留 29 分鐘餘裕給跨午夜）。
 * 店家時區由本檔明確寫成 Asia/Taipei（afterAll 還原 basic 快照），不依賴種子。
 *
 * ⚠️ 若 shared TEST 疊著 #41 overlay，其 deadline trigger 可能阻擋「已過」團次的寫入；
 * 那時 beforeAll 會在 mustWrite 明確失敗（而非讓斷言指向錯方向）。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A } from '../../fixtures';
import { tenantNowParts } from '@/lib/public-time-zone';

const BASE = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';
const TAG = 'I746';
/** ERR.CONFLICT（src/server/http.ts）；直接寫字面值，錯碼被改動時這裡要跟著紅。 */
const CONFLICT_CODE = 'REQ_003';
/** 本檔專用的來源 IP：匿名端點節流是 ip+shopCode，避免與其他檔共用額度。 */
const TEST_IP = '203.0.113.74';

const TRIP_FIXED = '74600001-0000-4000-8000-000000000001';
const TRIP_REQUEST = '74600001-0000-4000-8000-000000000002';
const PLAN_FIXED = '74600001-0000-4000-8000-000000000011';
const PLAN_REQUEST = '74600001-0000-4000-8000-000000000012';
const F = {
  started: '74600001-0000-4000-8000-000000000021',
  notYet: '74600001-0000-4000-8000-000000000022',
  nullTime: '74600001-0000-4000-8000-000000000023',
  tomorrow: '74600001-0000-4000-8000-000000000024',
};
const R = {
  started: '74600001-0000-4000-8000-000000000031',
  notYet: '74600001-0000-4000-8000-000000000032',
  tomorrow: '74600001-0000-4000-8000-000000000033',
};
const ALL_DEPARTURES = [...Object.values(F), ...Object.values(R)];

const tenantNow = tenantNowParts('Asia/Taipei');
const TODAY = tenantNow.today;
const TOMORROW = new Date(Date.parse(`${TODAY}T00:00:00Z`) + 24 * 3600 * 1000).toISOString().slice(0, 10);
/**
 * 現在 < 23:30 才造得出穩定的「今天未到」（start_time 23:59）；否則相關案例跳過（不是通過）。
 * 留 29 分鐘餘裕：模組載入到 HTTP 請求之間的耗時、或接近午夜時跨日，都不會讓 23:59 變成已開始。
 */
const NOT_YET_POSSIBLE = tenantNow.hm < '23:30';

let admin: SupabaseClient;
/** 以旗標判斷是否需要還原：basic 原值可能就是 JSON null，不能用 `!== null` 當「有快照」。 */
let basicCaptured = false;
let basicSnapshot: unknown = null;
/** TOUR_MODULE 列的快照：null＝原本沒有這列（afterAll 刪除）；有值＝逐字還原（含 inactive 的情形）。 */
let tourModuleCaptured = false;
let tourModuleSnapshot: Record<string, unknown> | null = null;

function mustWrite(label: string, result: { error: unknown }): void {
  if (result.error) throw new Error(`前置寫入失敗（${label}）：${JSON.stringify(result.error)}`);
}

async function seatsBooked(id: string): Promise<number> {
  const { data, error } = await admin.from('trip_departures').select('seats_booked').eq('id', id).single();
  expect(error).toBeNull();
  return Number(data!.seats_booked);
}

async function orderCount(departureId: string): Promise<number> {
  const { count, error } = await admin.from('tour_orders')
    .select('id', { count: 'exact', head: true }).eq('departure_id', departureId);
  expect(error).toBeNull();
  return count ?? 0;
}

async function post(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': TEST_IP },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as { success?: boolean; code?: string; data?: { orderId?: string } } };
}

const contact = { contactName: `${TAG} 旅客`, contactPhone: '0912000746', partySize: 1 };
const bookingBody = (departureId: string) => ({ shopCode: SHOP_A.shopCode, planId: PLAN_FIXED, departureId, ...contact });
const requestBody = (departureId: string) => ({ shopCode: SHOP_A.shopCode, planId: PLAN_REQUEST, departureId, ...contact });

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 店家時區固定為台北（快照 basic，afterAll 還原）。
  const settings = await admin.from('tenant_settings').select('basic').eq('tenant_id', SHOP_A.id).single();
  mustWrite('tenant_settings 快照', settings);
  basicSnapshot = settings.data!.basic;
  basicCaptured = true;
  mustWrite('tenant_settings.basic.timezone', await admin.from('tenant_settings')
    .update({ basic: { ...((basicSnapshot as Record<string, unknown>) ?? {}), timezone: 'Asia/Taipei' } })
    .eq('tenant_id', SHOP_A.id));

  // 公開寫入端點有 TOUR_MODULE 閘門：列不存在或 inactive 都要處理。先快照整列，afterAll 逐字還原。
  const feat = await admin.from('feature_subscriptions').select('*')
    .eq('tenant_id', SHOP_A.id).eq('code', 'TOUR_MODULE').maybeSingle();
  mustWrite('TOUR_MODULE 快照', feat);
  tourModuleSnapshot = (feat.data as Record<string, unknown> | null) ?? null;
  tourModuleCaptured = true;
  const needsGrant = !tourModuleSnapshot || tourModuleSnapshot.active !== true;
  if (needsGrant) {
    mustWrite('開通 TOUR_MODULE', await admin.from('feature_subscriptions').upsert({
      tenant_id: SHOP_A.id, code: 'TOUR_MODULE', active: true, expires_at: null, source: 'GRANTED', cancelled_at: null,
    }, { onConflict: 'tenant_id,code' }));
  }

  // 重跑一致：前次中斷可能留下訂單；先清掉這批團次的訂單（FK 在團次上），
  // 團次／方案／行程用下方 upsert 以固定 ID 覆寫（seats_booked 重設為 0）。
  mustWrite('清除前次殘留 tour_orders', await admin.from('tour_orders').delete().in('departure_id', ALL_DEPARTURES));

  // 每個 trip 只放一個方案：歷史相容 overlay 有 trip_plans_tenant_trip_slug_key (tenant_id, trip_id, slug)，
  // 同一 trip 兩個未指定 slug（default ''）的方案會撞約束（見 public-trip-details.11.test.ts 的說明）。
  mustWrite('trips', await admin.from('trips').upsert([
    { id: TRIP_FIXED, tenant_id: SHOP_A.id, title: `${TAG} 已開始團次測試行程（固定團）`, slug: `itest-746-fixed-${Date.now()}`, status: 'PUBLISHED', duration_hours: 3, summary: `${TAG}` },
    { id: TRIP_REQUEST, tenant_id: SHOP_A.id, title: `${TAG} 已開始團次測試行程（申請）`, slug: `itest-746-request-${Date.now()}`, status: 'PUBLISHED', duration_hours: 3, summary: `${TAG}` },
  ]));
  mustWrite('trip_plans', await admin.from('trip_plans').upsert([
    { id: PLAN_FIXED, tenant_id: SHOP_A.id, trip_id: TRIP_FIXED, name: `${TAG} 固定團方案`, price_per_person: 1800, min_party: 1, max_party: 8, active: true, sales_mode: 'FIXED_DEPARTURE' },
    { id: PLAN_REQUEST, tenant_id: SHOP_A.id, trip_id: TRIP_REQUEST, name: `${TAG} 申請方案`, price_per_person: 1800, min_party: 1, max_party: 8, active: true, sales_mode: 'REQUEST' },
  ]));

  const dep = (id: string, planId: string, departs_on: string, start_time: string | null) => ({
    id, tenant_id: SHOP_A.id, trip_id: planId === PLAN_FIXED ? TRIP_FIXED : TRIP_REQUEST, plan_id: planId, departs_on, start_time,
    capacity: 8, seats_booked: 0, status: 'OPEN',
  });
  mustWrite('trip_departures', await admin.from('trip_departures').upsert([
    dep(F.started, PLAN_FIXED, TODAY, '00:00'),
    dep(F.notYet, PLAN_FIXED, TODAY, '23:59'),
    dep(F.nullTime, PLAN_FIXED, TODAY, null),
    dep(F.tomorrow, PLAN_FIXED, TOMORROW, '00:00'),
    dep(R.started, PLAN_REQUEST, TODAY, '00:00'),
    dep(R.notYet, PLAN_REQUEST, TODAY, '23:59'),
    dep(R.tomorrow, PLAN_REQUEST, TOMORROW, '00:00'),
  ]));
  const seeded = await admin.from('trip_departures').select('id').in('id', ALL_DEPARTURES);
  mustWrite('trip_departures 讀回核實', seeded);
  expect((seeded.data ?? []).length, '前置的團次沒有全部寫進去').toBe(ALL_DEPARTURES.length);
});

afterAll(async () => {
  if (!admin) return;
  const cleanupFailures: string[] = [];
  const runCleanup = async (label: string, action: () => PromiseLike<{ error: unknown }>) => {
    try {
      const { error } = await action();
      if (error) cleanupFailures.push(`${label} 失敗：${JSON.stringify(error)}`);
    } catch (error) {
      cleanupFailures.push(`${label} 拋錯：${String(error)}`);
    }
  };

  // 只刪自己造的；訂單先於團次（FK）。
  await runCleanup('tour_orders delete', () => admin.from('tour_orders').delete().in('departure_id', ALL_DEPARTURES));
  await runCleanup('trip_departures delete', () => admin.from('trip_departures').delete().in('id', ALL_DEPARTURES));
  await runCleanup('trip_plans delete', () => admin.from('trip_plans').delete().in('id', [PLAN_FIXED, PLAN_REQUEST]));
  await runCleanup('trips delete', () => admin.from('trips').delete().in('id', [TRIP_FIXED, TRIP_REQUEST]));
  if (basicCaptured) {
    await runCleanup('tenant_settings.basic 還原', () => admin.from('tenant_settings')
      .update({ basic: basicSnapshot }).eq('tenant_id', SHOP_A.id));
  }
  if (tourModuleCaptured) {
    if (tourModuleSnapshot) {
      await runCleanup('feature_subscriptions 還原', () => admin.from('feature_subscriptions')
        .upsert(tourModuleSnapshot!, { onConflict: 'tenant_id,code' }));
    } else {
      await runCleanup('feature_subscriptions delete', () => admin.from('feature_subscriptions')
        .delete().eq('tenant_id', SHOP_A.id).eq('code', 'TOUR_MODULE'));
    }
  }

  // 讀回確認：沒有「回報成功但其實沒刪／沒還原」。
  const readbacks = await Promise.all([
    admin.from('tour_orders').select('id').in('departure_id', ALL_DEPARTURES),
    admin.from('trip_departures').select('id').in('id', ALL_DEPARTURES),
    admin.from('trip_plans').select('id').in('id', [PLAN_FIXED, PLAN_REQUEST]),
    admin.from('trips').select('id').in('id', [TRIP_FIXED, TRIP_REQUEST]),
  ]);
  for (const [label, result] of [
    ['tour_orders', readbacks[0]], ['trip_departures', readbacks[1]], ['trip_plans', readbacks[2]], ['trips', readbacks[3]],
  ] as const) {
    if (result.error) cleanupFailures.push(`${label} 讀回失敗：${JSON.stringify(result.error)}`);
    else if ((result.data ?? []).length > 0) cleanupFailures.push(`${label} 殘留 ${(result.data ?? []).length} 筆`);
  }
  if (basicCaptured) {
    const back = await admin.from('tenant_settings').select('basic').eq('tenant_id', SHOP_A.id).single();
    if (back.error) cleanupFailures.push(`tenant_settings 讀回失敗：${JSON.stringify(back.error)}`);
    else if (JSON.stringify(back.data!.basic) !== JSON.stringify(basicSnapshot)) cleanupFailures.push('tenant_settings.basic 未還原成快照');
  }
  if (tourModuleCaptured) {
    const back = await admin.from('feature_subscriptions').select('*')
      .eq('tenant_id', SHOP_A.id).eq('code', 'TOUR_MODULE').maybeSingle();
    if (back.error) cleanupFailures.push(`feature_subscriptions 讀回失敗：${JSON.stringify(back.error)}`);
    else if (!tourModuleSnapshot && back.data) cleanupFailures.push('TOUR_MODULE 列應已刪除卻仍存在');
    else if (tourModuleSnapshot && back.data?.active !== tourModuleSnapshot.active) cleanupFailures.push('TOUR_MODULE.active 未還原成快照');
  }
  if (cleanupFailures.length) throw new Error(`#746 fixture 清理失敗：\n${cleanupFailures.join('\n')}`);
});

describe('#746 FIXED_DEPARTURE：POST /api/public/tour-bookings', () => {
  it('今天已過開始時間 → 409 REQ_003，沒有新訂單、名額不變', async () => {
    const before = await seatsBooked(F.started);
    const res = await post('/api/public/tour-bookings', bookingBody(F.started));
    expect(res.status).toBe(409);
    expect(res.json.success).toBe(false);
    expect(res.json.code).toBe(CONFLICT_CODE);
    expect(await seatsBooked(F.started)).toBe(before);
    expect(await orderCount(F.started)).toBe(0);
  });

  it.skipIf(!NOT_YET_POSSIBLE)('今天未到開始時間（23:59）→ 201，名額 +1（對照組：不是整個端點都在拒絕）', async () => {
    const res = await post('/api/public/tour-bookings', bookingBody(F.notYet));
    expect(res.status).toBe(201);
    expect(res.json.data?.orderId).toBeTruthy();
    expect(await seatsBooked(F.notYet)).toBe(1);
    expect(await orderCount(F.notYet)).toBe(1);
  });

  it('今天 start_time 為 null → 201（無法判定是否已開始，維持可訂）', async () => {
    const res = await post('/api/public/tour-bookings', bookingBody(F.nullTime));
    expect(res.status).toBe(201);
    expect(await seatsBooked(F.nullTime)).toBe(1);
  });

  it('明天（start_time 00:00）→ 201', async () => {
    const res = await post('/api/public/tour-bookings', bookingBody(F.tomorrow));
    expect(res.status).toBe(201);
    expect(await seatsBooked(F.tomorrow)).toBe(1);
  });
});

describe('#746 REQUEST：POST /api/public/tour-requests', () => {
  it('今天已過開始時間 → 409 REQ_003，沒有新訂單', async () => {
    const res = await post('/api/public/tour-requests', requestBody(R.started));
    expect(res.status).toBe(409);
    expect(res.json.code).toBe(CONFLICT_CODE);
    expect(await orderCount(R.started)).toBe(0);
    expect(await seatsBooked(R.started)).toBe(0);
  });

  it.skipIf(!NOT_YET_POSSIBLE)('今天未到開始時間 → 201（REQUEST 不鎖位，但會有一筆訂單）', async () => {
    const res = await post('/api/public/tour-requests', requestBody(R.notYet));
    expect(res.status).toBe(201);
    expect(await orderCount(R.notYet)).toBe(1);
  });
});

describe('#746 預約頁不列出已開始團次', () => {
  it('/s/{shop}/plans/{plan}/book 的 HTML 含未到／null／明天團次，不含已開始團次', async () => {
    const res = await fetch(`${BASE}/s/${SHOP_A.shopCode}/plans/${PLAN_FIXED}/book`);
    const body = await res.text();
    expect(res.status).toBe(200);
    // 對照組：頁面真的渲染出來、且團次 id 會被序列化進頁面（否則下面的 not.toContain 恆真）。
    expect(body).toContain(F.nullTime);
    expect(body).toContain(F.tomorrow);
    if (NOT_YET_POSSIBLE) expect(body).toContain(F.notYet);
    expect(body, '已開始的團次出現在預約頁').not.toContain(F.started);
  });

  it('/s/{shop}/plans/{plan}/request 的 HTML 不含已開始團次', async () => {
    const res = await fetch(`${BASE}/s/${SHOP_A.shopCode}/plans/${PLAN_REQUEST}/request`);
    const body = await res.text();
    expect(res.status).toBe(200);
    // 對照組（無條件）：明天的團次一定存在，頁面真的渲染且 id 會序列化進去，下面的 not.toContain 才不是恆真。
    expect(body).toContain(R.tomorrow);
    if (NOT_YET_POSSIBLE) expect(body).toContain(R.notYet);
    expect(body, '已開始的團次出現在申請頁').not.toContain(R.started);
  });
});
