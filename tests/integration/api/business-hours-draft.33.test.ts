/**
 * 逐日營業時間的乾跑與自動封鎖鏈 — GitHub issue #33 第 ② 筆。
 *   POST /api/settings/weekly-business-hours/draft（**乾跑**，一列都不寫）
 *   PUT  /api/settings（business 群組）→ 重建 auto 封鎖並回報實際筆數
 *
 * ⚠️ 「乾跑」是**我方選定**的語意，不是原站考據結果——原站只給了路徑與四句
 * 文案，沒有 request/response 形狀。依據與反面證據見
 * `src/server/business-hours-blocks.ts` 檔頭與 04 分冊 §A-1.2。
 *
 * 本檔驗證：
 *   ① draft 真的一列都不寫（前後 block_times 筆數相同）
 *   ② PUT 之後 auto 封鎖被建立，筆數等於端點回報數（直查 DB 對照）
 *   ③ **手動建立的封鎖一律不被刪除**（前後直查同一列仍在）
 *   ④ 衝突預約筆數與直查 DB 的結果一致；**零衝突時回 0**
 *   ⑤ 再次修改逐日時間 → 全刪重建，auto 筆數不累積膨脹
 *   ⑥ RLS 跨租戶擋
 *   ⑦ GET /api/block-times 帶回新欄位；auto 列不可編輯／刪除（409）
 *
 * ⚠️ 比對型斷言的非零那一支必須真的走到（15 分冊「坑 3」）：本檔**自己塞**
 * 一筆會落在非營業時段的預約，讓 conflictBookingCount 的非零分支被執行，
 * 收尾刪掉並驗證殘留為 0。
 *
 * 清理紀律：本檔改的是 A 店的 tenant_settings.business 與 block_times。
 * afterAll 把 business 還原成進場時的值、刪掉本檔建立的封鎖與預約，
 * 並把 auto 封鎖清空（最後一次 PUT 用「全天營業」讓它自然歸零）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { SHOP_A, SHOP_B } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };

async function readJson<T = unknown>(res: Response): Promise<Envelope<T>> {
  return (await res.json()) as Envelope<T>;
}

type Impact = {
  perDayMode: boolean;
  autoBlockCreated: number;
  conflictBookingCount: number;
  manualWeeklyBlockCount: number;
};
type Draft = {
  perDayMode: boolean;
  autoBlockCount: number;
  conflictBookingCount: number;
  manualWeeklyBlockCount: number;
};

let admin: SupabaseClient;
let ownerA: AuthedApi;
let ownerB: AuthedApi;

/** 進場時 A 店的 business 群組，afterAll 還原用 */
let originalBusiness: Record<string, unknown> | null = null;

const createdBlockIds: string[] = [];
const createdBookingIds: string[] = [];

const EMPTY_WEEK = [[], [], [], [], [], [], []] as Array<Array<{ start: string; end: string }>>;

/** 一份完整的 business 群組（欄位補齊，端點用 businessSettingsSchema 解析） */
function business(patch: Record<string, unknown>): Record<string, unknown> {
  return {
    perDayMode: false,
    businessStart: '09:00',
    businessEnd: '18:00',
    breakStart: '',
    breakEnd: '',
    perDayHours: EMPTY_WEEK,
    closedDays: [0],
    ...patch,
  };
}

/**
 * 「每天 09:00–12:00 與 13:00–18:00 營業」——每天各有三個空隙
 * （00:00–09:00 / 12:00–13:00 / 18:00–24:00），共 7 × 3 = 21 筆 auto 封鎖。
 */
const SPLIT_WEEK = Array.from({ length: 7 }, () => ([
  { start: '09:00', end: '12:00' },
  { start: '13:00', end: '18:00' },
]));
const SPLIT_WEEK_EXPECTED = 21;

/** 「週日整天不營業、其餘 09:00–18:00」——週日 1 筆整天 + 其餘 6 天各 2 筆 = 13 筆 */
const SUNDAY_CLOSED_WEEK = Array.from({ length: 7 }, (_, d) => (
  d === 0 ? [] : [{ start: '09:00', end: '18:00' }]
));
const SUNDAY_CLOSED_EXPECTED = 13;

async function autoBlockRows() {
  const { data, error } = await admin.from('block_times')
    .select('id, start_at, end_at, title, recurrence, day_of_week, full_day, auto')
    .eq('tenant_id', SHOP_A.id).eq('auto', true);
  expect(error).toBeNull();
  return (data ?? []) as unknown as Array<{
    id: string; start_at: string; end_at: string; title: string;
    recurrence: string; day_of_week: number | null; full_day: boolean; auto: boolean;
  }>;
}

async function allBlockCount(): Promise<number> {
  const { count, error } = await admin.from('block_times')
    .select('id', { count: 'exact', head: true }).eq('tenant_id', SHOP_A.id);
  expect(error).toBeNull();
  return count ?? 0;
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
  ownerB = await loginAs(SHOP_B.owner.email, SHOP_B.owner.password);

  const { data } = await admin.from('tenant_settings')
    .select('business').eq('tenant_id', SHOP_A.id).maybeSingle();
  originalBusiness = ((data as any)?.business ?? null) as Record<string, unknown> | null;
});

afterAll(async () => {
  // 先把 auto 封鎖清掉：改回「不使用逐日模式」，重建流程會刪光且不再產生。
  await ownerA.put('/api/settings', { business: business({ perDayMode: false }) });
  if (createdBlockIds.length) await admin.from('block_times').delete().in('id', createdBlockIds);
  if (createdBookingIds.length) await admin.from('bookings').delete().in('id', createdBookingIds);

  // business 群組還原成進場時的值（沒有列就不動）
  if (originalBusiness) {
    await admin.from('tenant_settings')
      .update({ business: originalBusiness }).eq('tenant_id', SHOP_A.id);
  }

  // 殘留驗證：不吞掉清理失敗（15 分冊「坑 2」）
  const leftoverAuto = (await autoBlockRows()).length;
  const { count: leftoverBookings } = await admin.from('bookings')
    .select('id', { count: 'exact', head: true }).in('id', createdBookingIds.length ? createdBookingIds : ['00000000-0000-4000-8000-000000000000']);
  // eslint-disable-next-line no-console
  console.log(`[cleanup] auto blocks left = ${leftoverAuto}, test bookings left = ${leftoverBookings ?? 0}`);
  expect(leftoverAuto).toBe(0);
  expect(leftoverBookings ?? 0).toBe(0);
});

describe('POST /api/settings/weekly-business-hours/draft：乾跑，一列都不寫（issue #33 ②）', () => {
  it('回報會建立的 auto 封鎖筆數，但 block_times 前後筆數完全相同', async () => {
    const before = await allBlockCount();

    const res = await ownerA.post('/api/settings/weekly-business-hours/draft',
      business({ perDayMode: true, perDayHours: SPLIT_WEEK }));
    expect(res.status).toBe(200);
    const d = (await readJson<Draft>(res)).data!;
    expect(d.perDayMode).toBe(true);
    expect(d.autoBlockCount).toBe(SPLIT_WEEK_EXPECTED);

    expect(await allBlockCount()).toBe(before);
    expect((await autoBlockRows()).length).toBe(0);
  });

  it('週日整天公休的算法：整天封鎖 1 筆 + 其餘 6 天各 2 筆 = 13 筆', async () => {
    const res = await ownerA.post('/api/settings/weekly-business-hours/draft',
      business({ perDayMode: true, perDayHours: SUNDAY_CLOSED_WEEK }));
    expect(res.status).toBe(200);
    expect((await readJson<Draft>(res)).data!.autoBlockCount).toBe(SUNDAY_CLOSED_EXPECTED);
  });

  it('perDayMode 關閉 → 不產生任何 auto 封鎖（autoBlockCount = 0）', async () => {
    const res = await ownerA.post('/api/settings/weekly-business-hours/draft',
      business({ perDayMode: false }));
    expect(res.status).toBe(200);
    expect((await readJson<Draft>(res)).data!.autoBlockCount).toBe(0);
  });

  it('格式錯誤（perDayHours 不是 7 天）→ 400 REQ_001（「解析逐日營業時間失敗」的那一道）', async () => {
    const res = await ownerA.post('/api/settings/weekly-business-hours/draft',
      business({ perDayMode: true, perDayHours: [[], []] }));
    expect(res.status).toBe(400);
    expect((await readJson(res)).code).toBe('REQ_001');
  });

  it('未登入 → 401 AUTH_001', async () => {
    const base = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';
    const res = await fetch(`${base}/api/settings/weekly-business-hours/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(business({})),
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as Envelope).code).toBe('AUTH_001');
  });
});

describe('PUT /api/settings（business）：auto 封鎖真的被建立，筆數等於回報數', () => {
  it('存逐日營業時間 → DB 的 auto 列筆數 === 回報的 autoBlockCreated，且欄位齊全', async () => {
    const res = await ownerA.put('/api/settings',
      { business: business({ perDayMode: true, perDayHours: SPLIT_WEEK }) });
    expect(res.status).toBe(200);
    const impact = (await readJson<Impact>(res)).data!;
    expect(impact.autoBlockCreated).toBe(SPLIT_WEEK_EXPECTED);

    const rows = await autoBlockRows();
    expect(rows.length).toBe(impact.autoBlockCreated);
    for (const r of rows) {
      expect(r.recurrence).toBe('WEEKLY');
      expect(r.day_of_week).not.toBeNull();
      expect(r.auto).toBe(true);
      expect(r.title).not.toBe('');
    }
    // 每一天各 3 個空隙
    for (let d = 0; d < 7; d += 1) {
      expect(rows.filter((r) => r.day_of_week === d).length, `day ${d}`).toBe(3);
    }
    // 整天封鎖只會出現在完全沒開放的日子，這份設定每天都有營業
    expect(rows.filter((r) => r.full_day).length).toBe(0);
  });

  it('再次修改逐日時間 → 全刪重建，auto 筆數不累積膨脹', async () => {
    // 第一次已在上一個案例存過 SPLIT_WEEK（21 筆）
    expect((await autoBlockRows()).length).toBe(SPLIT_WEEK_EXPECTED);

    const res = await ownerA.put('/api/settings',
      { business: business({ perDayMode: true, perDayHours: SUNDAY_CLOSED_WEEK }) });
    expect(res.status).toBe(200);
    expect((await readJson<Impact>(res)).data!.autoBlockCreated).toBe(SUNDAY_CLOSED_EXPECTED);

    const rows = await autoBlockRows();
    expect(rows.length).toBe(SUNDAY_CLOSED_EXPECTED); // 不是 21 + 13
    // 週日那一筆是整天封鎖
    const sunday = rows.filter((r) => r.day_of_week === 0);
    expect(sunday).toHaveLength(1);
    expect(sunday[0].full_day).toBe(true);
  });

  it('關閉逐日模式 → auto 列全部清掉（回報 0）', async () => {
    const res = await ownerA.put('/api/settings', { business: business({ perDayMode: false }) });
    expect(res.status).toBe(200);
    expect((await readJson<Impact>(res)).data!.autoBlockCreated).toBe(0);
    expect((await autoBlockRows()).length).toBe(0);
  });

  it('不含 business 群組的 PUT 不會動到 auto 封鎖，也不回報數字', async () => {
    // 先建起來
    await ownerA.put('/api/settings',
      { business: business({ perDayMode: true, perDayHours: SUNDAY_CLOSED_WEEK }) });
    const before = (await autoBlockRows()).length;
    expect(before).toBe(SUNDAY_CLOSED_EXPECTED);

    const res = await ownerA.put('/api/settings', { notify: {} });
    expect(res.status).toBe(200);
    const body = await readJson<Impact | undefined>(res);
    expect(body.success).toBe(true);
    expect(body.data ?? null).toBeNull();
    expect((await autoBlockRows()).length).toBe(before);
  });
});

describe('手動建立的封鎖一律不被刪除', () => {
  let manualSingleId = '';
  let manualWeeklyId = '';

  it('建立一筆手動單次與一筆手動每週封鎖', async () => {
    const single = await ownerA.post('/api/block-times', {
      startAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      endAt: new Date(Date.now() + 7 * 86_400_000 + 3_600_000).toISOString(),
      title: '#33 手動單次封鎖', reason: '#33 手動單次封鎖',
    });
    expect(single.status).toBe(200);
    manualSingleId = (await readJson<{ id: string }>(single)).data!.id;
    createdBlockIds.push(manualSingleId);

    const weekly = await ownerA.post('/api/block-times', {
      startAt: '1970-01-05T06:00:00.000Z', // 參考週的週一 14:00 台北
      endAt: '1970-01-05T07:00:00.000Z',
      title: '#33 手動每週封鎖', reason: '#33 手動每週封鎖',
      recurrence: 'WEEKLY', dayOfWeek: 1,
    });
    expect(weekly.status).toBe(200);
    manualWeeklyId = (await readJson<{ id: string }>(weekly)).data!.id;
    createdBlockIds.push(manualWeeklyId);

    const { data } = await admin.from('block_times')
      .select('auto, recurrence, day_of_week, title').eq('id', manualWeeklyId).single();
    expect((data as any).auto).toBe(false); // 呼叫端不能把自己標成 auto
    expect((data as any).recurrence).toBe('WEEKLY');
    expect((data as any).day_of_week).toBe(1);
  });

  it('重建 auto 封鎖之後，兩筆手動封鎖都還在（前後直查同一列）', async () => {
    await ownerA.put('/api/settings',
      { business: business({ perDayMode: true, perDayHours: SPLIT_WEEK }) });

    for (const id of [manualSingleId, manualWeeklyId]) {
      const { data } = await admin.from('block_times').select('id, auto').eq('id', id).maybeSingle();
      expect(data, `手動封鎖 ${id} 被刪掉了`).toBeTruthy();
      expect((data as any).auto).toBe(false);
    }
  });

  it('端點回報的 manualWeeklyBlockCount 與直查 DB 一致（且此刻非零）', async () => {
    const { count } = await admin.from('block_times')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', SHOP_A.id).eq('auto', false).eq('recurrence', 'WEEKLY');
    expect(count).toBeGreaterThan(0); // 非零分支真的被驗到

    const res = await ownerA.post('/api/settings/weekly-business-hours/draft',
      business({ perDayMode: true, perDayHours: SPLIT_WEEK }));
    expect((await readJson<Draft>(res)).data!.manualWeeklyBlockCount).toBe(count);
  });

  it('auto 列不可編輯／刪除：PUT 與 DELETE 都回 409 REQ_003，且列還在', async () => {
    const rows = await autoBlockRows();
    expect(rows.length).toBeGreaterThan(0);
    const target = rows[0].id;

    const put = await ownerA.put(`/api/block-times/${target}`, { title: '想改改看' });
    expect(put.status).toBe(409);
    expect((await readJson(put)).code).toBe('REQ_003');

    const del = await ownerA.delete(`/api/block-times/${target}`);
    expect(del.status).toBe(409);
    expect((await readJson(del)).code).toBe('REQ_003');

    const { data } = await admin.from('block_times').select('id, title').eq('id', target).maybeSingle();
    expect(data).toBeTruthy();
    expect((data as any).title).not.toBe('想改改看');
  });

  it('GET /api/block-times 帶回 0027 的新欄位，且 WEEKLY 列不會被區間過濾掉', async () => {
    // 用一個「未來一週」的區間：手動的每週封鎖存的是 1970 年的參考週，
    // 若端點還在用 start_at 比對區間，這一筆就會消失。
    const from = new Date(Date.now() + 86_400_000).toISOString();
    const to = new Date(Date.now() + 8 * 86_400_000).toISOString();
    const res = await ownerA.get(`/api/block-times?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    expect(res.status).toBe(200);
    const list = (await readJson<Array<{
      id: string; title: string; recurrence: string; dayOfWeek: number | null;
      fullDay: boolean; auto: boolean;
    }>>(res)).data!;

    const weekly = list.find((b) => b.id === manualWeeklyId);
    expect(weekly, '每週封鎖被區間過濾掉了').toBeTruthy();
    expect(weekly!.recurrence).toBe('WEEKLY');
    expect(weekly!.dayOfWeek).toBe(1);
    expect(weekly!.auto).toBe(false);
    expect(weekly!.title).toBe('#33 手動每週封鎖');

    expect(list.some((b) => b.auto)).toBe(true); // auto 列也在清單裡
  });
});

describe('衝突預約筆數：非零那一支真的被執行到', () => {
  /**
   * ⚠️ 15 分冊「坑 3」：`expected === 0 ? … : …` 這種比對在資料全是 0 的環境
   * 下永遠只走前半段。這裡自己塞一筆**必定落在非營業時段**的預約，逼出非零
   * 分支，收尾刪掉。
   */
  let conflictBookingId = '';
  /** 塞入測試預約之後端點回報的衝突筆數（下一個案例拿來比 delta） */
  let conflictWithBooking = -1;

  it('B 店在查證同一時窗沒有活躍未來預約後，零衝突時回 0', async () => {
    // A 店 seed 用「現在 +1h」建立預約；台北晚間跑 CI 時那筆會跨過午夜，
    // 即使每天 00:00–24:00 也會依既定規則正確算成跨日衝突。不能把執行
    // 時刻剛好在白天當成「零資料」證據。改用沒有 booking seed 的 B 店，
    // 並先直查端點使用的同一個狀態／時間範圍確實為 0，讓零分支有障壁。
    const now = new Date();
    const horizon = new Date(now.getTime() + 365 * 86_400_000);
    const { count, error } = await admin.from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', SHOP_B.id)
      .in('status', ['PENDING', 'CONFIRMED'])
      .gte('start_at', now.toISOString())
      .lt('start_at', horizon.toISOString());
    expect(error).toBeNull();
    expect(count ?? 0).toBe(0);

    const allDay = Array.from({ length: 7 }, () => ([{ start: '00:00', end: '24:00' }]));
    const res = await ownerB.post('/api/settings/weekly-business-hours/draft',
      business({ perDayMode: true, perDayHours: allDay }));
    expect(res.status).toBe(200);
    const d = (await readJson<Draft>(res)).data!;
    expect(d.conflictBookingCount).toBe(0);
    expect(d.autoBlockCount).toBe(0); // 全開就沒有空隙要補
  });

  it('塞一筆落在非營業時段的未來預約 → 回報數與直查 DB 一致（非零）', async () => {
    // 明天的 03:00–04:00（UTC 19:00–20:00 前一天）——營業時間 09:00–18:00
    // 之外，必定衝突。
    const start = new Date(Date.now() + 86_400_000);
    start.setUTCHours(19, 0, 0, 0); // 台北 03:00（隔天）
    const end = new Date(start.getTime() + 3_600_000);

    conflictBookingId = randomUUID();
    const { error } = await admin.from('bookings').insert({
      id: conflictBookingId, tenant_id: SHOP_A.id,
      booking_no: `B33${Date.now().toString(36).slice(-6).toUpperCase()}`,
      customer_id: SHOP_A.customerA1, service_id: SHOP_A.serviceA1, staff_id: SHOP_A.staffA1,
      start_at: start.toISOString(), end_at: end.toISOString(),
      duration_minutes: 60, status: 'PENDING', price: 0, final_price: 0,
    });
    expect(error).toBeNull();
    createdBookingIds.push(conflictBookingId);

    const res = await ownerA.post('/api/settings/weekly-business-hours/draft',
      business({ perDayMode: true, perDayHours: SPLIT_WEEK }));
    expect(res.status).toBe(200);
    const d = (await readJson<Draft>(res)).data!;

    // 直查：A 店所有未來的 PENDING/CONFIRMED 預約中，落在 09-12 / 13-18 之外的筆數
    const { data: rows } = await admin.from('bookings')
      .select('start_at, end_at').eq('tenant_id', SHOP_A.id)
      .in('status', ['PENDING', 'CONFIRMED']).gte('start_at', new Date().toISOString());
    const TAIPEI = 8 * 3600_000;
    const expected = ((rows ?? []) as any[]).filter((r) => {
      const s = Date.parse(r.start_at);
      const sMin = new Date(s + TAIPEI).getUTCHours() * 60 + new Date(s + TAIPEI).getUTCMinutes();
      const eMin = sMin + Math.round((Date.parse(r.end_at) - s) / 60_000);
      const fits = [[540, 720], [780, 1080]].some(([a, b]) => sMin >= a && eMin <= b);
      return !fits;
    }).length;

    expect(expected).toBeGreaterThan(0); // 非零分支確定被執行到
    expect(d.conflictBookingCount).toBe(expected);
    conflictWithBooking = d.conflictBookingCount;
  });

  it('PUT 也回報同一個衝突筆數（頁面的兩句警告文案有真數字可印）', async () => {
    const res = await ownerA.put('/api/settings',
      { business: business({ perDayMode: true, perDayHours: SPLIT_WEEK }) });
    expect(res.status).toBe(200);
    expect((await readJson<Impact>(res)).data!.conflictBookingCount).toBeGreaterThan(0);
  });

  /**
   * ⚠️ 這裡**不能**斷言「刪掉之後回 0」——第一版這樣寫，實跑得到
   * `expected 1 to be +0`：種子的四筆 A 店預約裡本來就有落在
   * 09:00-12:00 / 13:00-18:00 之外的。那不是端點的錯，是斷言的口徑錯了。
   * 改成比 **delta**：刪掉一筆衝突預約，回報數必須剛好少 1。
   * 這比「回 0」更能證明「數字真的跟著資料動」——一個永遠回 0 的壞實作
   * 會通過「回 0」，但通不過 delta。
   */
  it('刪掉那筆預約 → 回報數剛好少 1（證明數字真的跟著資料動，不是常數）', async () => {
    expect(conflictWithBooking).toBeGreaterThan(0); // 上一個案例真的跑過了
    expect((await admin.from('bookings').delete().eq('id', conflictBookingId)).error).toBeNull();
    createdBookingIds.splice(createdBookingIds.indexOf(conflictBookingId), 1);

    const res = await ownerA.post('/api/settings/weekly-business-hours/draft',
      business({ perDayMode: true, perDayHours: SPLIT_WEEK }));
    expect((await readJson<Draft>(res)).data!.conflictBookingCount).toBe(conflictWithBooking - 1);
  });
});

describe('RLS：跨租戶擋', () => {
  it('B 店的 draft 只看得到自己的資料（A 店的手動每週封鎖不算進 B 店）', async () => {
    const res = await ownerB.post('/api/settings/weekly-business-hours/draft',
      business({ perDayMode: true, perDayHours: SPLIT_WEEK }));
    expect(res.status).toBe(200);
    expect((await readJson<Draft>(res)).data!.manualWeeklyBlockCount).toBe(0);
  });

  it('B 店存營業設定，不會刪掉 A 店的 auto 封鎖', async () => {
    const beforeA = (await autoBlockRows()).length;
    expect(beforeA).toBeGreaterThan(0);

    const res = await ownerB.put('/api/settings', { business: business({ perDayMode: false }) });
    expect(res.status).toBe(200);
    expect((await autoBlockRows()).length).toBe(beforeA);
  });

  it('B 店動不了 A 店的 auto 封鎖（PUT/DELETE 回 404，不是 409）', async () => {
    const target = (await autoBlockRows())[0].id;
    expect((await ownerB.put(`/api/block-times/${target}`, { title: 'x' })).status).toBe(404);
    expect((await ownerB.delete(`/api/block-times/${target}`)).status).toBe(404);
  });
});
