/**
 * GUIDE action inbox API — #43-A 待確認預約 + #43-B 今日／明日出發團次 + #43-C 待收款預約
 * + #43 類別 3／4：REVIEW_REQUIRED（成團截止不足）／AT_RISK（已成團後人數跌破門檻）。
 * #43-B／類別 3／4 透過 TEST service role 建立短命測試資料，測畢清理並驗證
 * 不跨租戶；不新增 schema、狀態機或其他外部副作用。
 *
 * 這支一般 Product integration 不得把 #41 的 TEST-only overlay 當成 main 前提。
 * `readTourSeedFields()` 只在觀察到完整 #41 相容欄位時補上合法 snapshot；
 * canonical core 則送空物件，讓同一套讀取斷言真的能在 main schema 上執行。
 *
 * 類別 3／4 併進既有單一聚合端點 `GET /api/guide/action-inbox`（#43 §4：不可把不同
 * 資料表全抓到前端後自行拼湊，建議單一聚合端點由 server 端彙整）——不是獨立端點。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A, SHOP_B, TRIP_A } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';
import { getGuideActionInboxDateWindow, type GuideActionInboxItem } from '@/lib/guide-action-inbox';
import { readTourSeedFields } from '../../../scripts/test/tour-seed-profile.mjs';

const BASE = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };

async function readJson<T = unknown>(res: Response): Promise<Envelope<T>> {
  return (await res.json()) as Envelope<T>;
}

/**
 * #41 相容 schema 要求 formation_deadline_at > now() 且 <= 出發時刻。
 * 因此不能把「今日 23:58」永久寫死：CI 若在台北 23:58 後執行，任何今日團次都
 * 已沒有合法的未來截止時間。能建立今日團次時，固定挑現在至少 3 分鐘後的分鐘；
 * 已進入一天最後兩分鐘時只驗明日團次，TODAY 分類仍由既有 unit contract 鎖住。
 */
function futureTaipeiStartTime(now = new Date()): string | null {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value);
  const target = hour * 60 + minute + 3;
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || target >= 24 * 60) return null;
  return `${String(Math.floor(target / 60)).padStart(2, '0')}:${String(target % 60).padStart(2, '0')}`;
}

let admin: SupabaseClient;
let ownerA: AuthedApi;
const temporaryDepartureIds: string[] = [];

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
});

afterAll(async () => {
  for (const id of temporaryDepartureIds) {
    const { error } = await admin.from('trip_departures').delete()
      .eq('tenant_id', SHOP_A.id).eq('id', id);
    if (error) throw error;
  }
});

describe('GET /api/guide/action-inbox（#43-A / #43-B / #43-C）', () => {
  it('登入租戶回傳待確認預約的可操作欄位與優先級', async () => {
    const res = await ownerA.get('/api/guide/action-inbox');
    expect(res.status).toBe(200);
    const body = await readJson<GuideActionInboxItem[]>(res);
    expect(body.success).toBe(true);

    const pending = body.data?.find((item) => item.id === SHOP_A.bookingPending);
    if (!pending || pending.kind !== 'BOOKING_REQUEST') {
      throw new Error('待確認預約 action inbox item 缺少或種類錯誤');
    }
    expect(pending).toMatchObject({
      id: SHOP_A.bookingPending,
      kind: 'BOOKING_REQUEST',
      bookingNo: 'BSEED0001',
      href: `/tenant/bookings?status=PENDING&bookingId=${SHOP_A.bookingPending}`,
    });
    expect(['IMMEDIATE', 'TODAY', 'UPCOMING']).toContain(pending?.priority);
    expect(pending?.customerName).toBe('顧客 A1（測試）');
    expect(pending?.serviceName).toBe('基礎剪髮（測試）');

    const payment = body.data?.find((item) => item.id === SHOP_A.bookingConfirmed);
    if (!payment || payment.kind !== 'BOOKING_PAYMENT') {
      throw new Error('已確認未付款預約 action inbox item 缺少或種類錯誤');
    }
    expect(payment).toMatchObject({
      id: SHOP_A.bookingConfirmed,
      kind: 'BOOKING_PAYMENT',
      bookingNo: 'BSEED0002',
      amount: 800,
      href: `/tenant/bookings?status=CONFIRMED&paymentStatus=UNPAID&bookingId=${SHOP_A.bookingConfirmed}`,
    });
    expect(['IMMEDIATE', 'TODAY', 'UPCOMING']).toContain(payment.priority);
  });

  it('未登入回 401 AUTH_001', async () => {
    const res = await fetch(`${BASE}/api/guide/action-inbox`);
    expect(res.status).toBe(401);
    expect((await readJson(res)).code).toBe('AUTH_001');
  });

  it('bookingId deep link 可從分頁列表精確取回同租戶預約', async () => {
    const res = await ownerA.get(
      `/api/bookings?bookingId=${SHOP_A.bookingPending}&status=PENDING&size=1&page=0`,
    );
    expect(res.status).toBe(200);
    const body = await readJson<{ totalElements: number; content: Array<{ id: string; status: string }> }>(res);
    expect(body.success).toBe(true);
    expect(body.data?.totalElements).toBe(1);
    expect(body.data?.content).toHaveLength(1);
    expect(body.data?.content[0]).toMatchObject({ id: SHOP_A.bookingPending, status: 'PENDING' });

    const ownerB = await loginAs(SHOP_B.owner.email, SHOP_B.owner.password);
    const crossTenant = await ownerB.get(`/api/bookings?bookingId=${SHOP_A.bookingPending}`);
    expect(crossTenant.status).toBe(200);
    const crossTenantBody = await readJson<{ totalElements: number; content: unknown[] }>(crossTenant);
    expect(crossTenantBody.success).toBe(true);
    expect(crossTenantBody.data?.totalElements).toBe(0);
    expect(crossTenantBody.data?.content).toEqual([]);
  });

  it('SHOP_B 不會看到 SHOP_A 的待確認預約', async () => {
    const ownerB = await loginAs(SHOP_B.owner.email, SHOP_B.owner.password);
    const res = await ownerB.get('/api/guide/action-inbox');
    expect(res.status).toBe(200);
    const body = await readJson<GuideActionInboxItem[]>(res);
    expect(body.success).toBe(true);
    expect(body.data ?? []).toEqual([]);
    expect(body.data?.some((item) => item.id === SHOP_A.bookingPending)).toBe(false);
  });

  it('回傳今日仍可建立的團次與明日團次，並給正確 deep link', async () => {
    const now = new Date();
    const { today, tomorrow } = getGuideActionInboxDateWindow(now, 'Asia/Taipei');
    const createDeparture = async (departsOn: string, startTime: string) => {
      const deadline = new Date(Date.now() + 60_000).toISOString();
      const tourFields = await readTourSeedFields(admin, deadline, 'OBSERVE');
      const { data, error } = await admin.from('trip_departures').insert({
        tenant_id: SHOP_A.id,
        trip_id: TRIP_A.id,
        plan_id: TRIP_A.planA1,
        departs_on: departsOn,
        start_time: startTime,
        capacity: 10,
        status: 'OPEN',
        ...tourFields.departure,
      }).select('id').single();
      expect(error).toBeNull();
      expect(data?.id).toBeTruthy();
      temporaryDepartureIds.push(data!.id);
      return data!.id;
    };

    const todayStart = futureTaipeiStartTime(now);
    const todayId = todayStart ? await createDeparture(today, todayStart) : null;
    const tomorrowId = await createDeparture(tomorrow, '08:02');
    const res = await ownerA.get('/api/guide/action-inbox');
    expect(res.status).toBe(200);
    const body = await readJson<GuideActionInboxItem[]>(res);
    const tomorrowItem = body.data?.find((item) => item.id === tomorrowId);

    if (todayId && todayStart) {
      const todayItem = body.data?.find((item) => item.id === todayId);
      expect(todayItem).toMatchObject({
        kind: 'DEPARTURE',
        tripId: TRIP_A.id,
        tripName: 'A 店測試行程',
        planName: '標準團（測試）',
        departureDate: today,
        startTime: todayStart,
        departureDay: 'TODAY',
        priority: 'TODAY',
        href: `/tenant/trips/${TRIP_A.id}`,
      });
    }
    expect(tomorrowItem).toMatchObject({
      kind: 'DEPARTURE',
      departureDate: tomorrow,
      startTime: '08:02',
      departureDay: 'TOMORROW',
      priority: 'UPCOMING',
      href: `/tenant/trips/${TRIP_A.id}`,
    });

    const ownerB = await loginAs(SHOP_B.owner.email, SHOP_B.owner.password);
    const shopBResponse = await ownerB.get('/api/guide/action-inbox');
    expect(shopBResponse.status).toBe(200);
    const shopBBody = await readJson<GuideActionInboxItem[]>(shopBResponse);
    expect(shopBBody.data?.some((item) => temporaryDepartureIds.includes(item.id))).toBe(false);
  });

  it('GET /api/guide/action-inbox 也回傳 REVIEW_REQUIRED 與 AT_RISK 團次（同一聚合端點），並且不跨租戶（#43 類別 3／4）', async () => {
    const now = new Date();
    const { tomorrow } = getGuideActionInboxDateWindow(now, 'Asia/Taipei');
    const futureDeadline = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reviewRow, error: reviewError } = await admin.from('trip_departures').insert({
      tenant_id: SHOP_A.id,
      trip_id: TRIP_A.id,
      plan_id: TRIP_A.planA1,
      departs_on: tomorrow,
      start_time: '09:00',
      capacity: 10,
      status: 'OPEN',
      formation_status: 'REVIEW_REQUIRED',
      min_to_depart_snapshot: 4,
      formation_deadline_at: futureDeadline,
    }).select('id').single();
    expect(reviewError).toBeNull();
    expect(reviewRow?.id).toBeTruthy();
    const reviewId = reviewRow!.id as string;
    temporaryDepartureIds.push(reviewId);

    const { data: atRiskRow, error: atRiskError } = await admin.from('trip_departures').insert({
      tenant_id: SHOP_A.id,
      trip_id: TRIP_A.id,
      plan_id: TRIP_A.planA1,
      departs_on: tomorrow,
      start_time: '10:00',
      capacity: 10,
      seats_booked: 3,
      status: 'OPEN',
      formation_status: 'AT_RISK',
      min_to_depart_snapshot: 4,
      formed_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      formed_by: 'SYSTEM',
      formed_participants: 5,
    }).select('id').single();
    expect(atRiskError).toBeNull();
    expect(atRiskRow?.id).toBeTruthy();
    const atRiskId = atRiskRow!.id as string;
    temporaryDepartureIds.push(atRiskId);

    // 同一支既有端點，不是另開的 /formation 端點——這正是 #43 §4 要求的單一聚合入口。
    const res = await ownerA.get('/api/guide/action-inbox');
    expect(res.status).toBe(200);
    const body = await readJson<GuideActionInboxItem[]>(res);
    expect(body.success).toBe(true);

    // Final Risk（claude-fable-5-1）覆核發現的 HIGH：這兩筆的 departs_on 是 tomorrow
    // 且 status OPEN，因此同時落在舊版 DEPARTURE query（status in OPEN/CLOSED，
    // 今日～明日）與 formation query（formation_status in REVIEW_REQUIRED/AT_RISK）
    // 的交集裡——同一個團次會被彙整成兩張卡。單靠 `find()` 抓第一筆符合的卡片
    // 測不出「這個 id 出現了兩次」，因為 `find()` 只回傳陣列裡第一個符合的元素，
    // 不管後面還有沒有重複。所以這裡改成先把整份清單依 id 分組，斷言：
    //   1. 每個 id 在整份已排序清單裡只出現一次（用 `(id, kind)` 而不只是 id，
    //      避免「id 唯一但 kind 抓錯」這種更隱晦的錯誤悄悄過關）。
    //   2. 該 id 對應的 kind 是 formation query 的 REVIEW_REQUIRED／AT_RISK，
    //      不是舊 DEPARTURE query 的 'DEPARTURE'——後者才是這個 HIGH 實際重現時
    //      （reviewer 記錄的 `Y:DEPARTURE X:DEPARTURE X:AT_RISK Y:REVIEW_REQUIRED`）
    //      `find()` 會抓到的那張假卡片。
    const items = body.data ?? [];
    const reviewMatches = items.filter((item) => item.id === reviewId);
    const atRiskMatches = items.filter((item) => item.id === atRiskId);
    expect(reviewMatches).toHaveLength(1);
    expect(atRiskMatches).toHaveLength(1);
    expect(reviewMatches.map((item) => item.kind)).toEqual(['REVIEW_REQUIRED']);
    expect(atRiskMatches.map((item) => item.kind)).toEqual(['AT_RISK']);

    const reviewItem = reviewMatches[0];
    expect(reviewItem).toMatchObject({
      kind: 'REVIEW_REQUIRED',
      tripId: TRIP_A.id,
      minToDepart: 4,
      href: `/tenant/trips/${TRIP_A.id}`,
    });
    // PostgREST 回傳 timestamptz 是 `...541+00:00`，`futureDeadline` 是
    // `toISOString()` 產出的 `...541Z`——兩者是同一個 instant 的不同字面表示法，
    // 不能用 `toMatchObject` 做字串相等。跟 `bookings-modified.27.test.ts:375`
    // 同一套作法：比較解析後的 instant，不是字串本身。
    expect(Date.parse((reviewItem as { formationDeadlineAt?: string })?.formationDeadlineAt as string)).toBe(Date.parse(futureDeadline));
    expect(Date.parse(reviewItem?.dueAt as string)).toBe(Date.parse(futureDeadline));

    const atRiskItem = atRiskMatches[0];
    expect(atRiskItem).toMatchObject({
      kind: 'AT_RISK',
      tripId: TRIP_A.id,
      minToDepart: 4,
      formedParticipants: 5,
      href: `/tenant/trips/${TRIP_A.id}`,
    });
    // AT_RISK 的下一個真正期限是出發時刻，不是舊的 formation_deadline_at（本例根本沒設）。
    expect(atRiskItem?.dueAt).not.toBe(futureDeadline);

    // 兩筆 formation 卡片與既有 booking/departure 卡片混在同一份已排序清單裡，
    // 而不是分開的兩份清單——鎖住 #43 §2「同優先級依截止時間、建立時間排序」
    // 只在單一清單上成立這件事。
    const priorityRank: Record<GuideActionInboxItem['priority'], number> = { IMMEDIATE: 0, TODAY: 1, UPCOMING: 2 };
    for (let i = 1; i < (body.data?.length ?? 0); i += 1) {
      expect(priorityRank[body.data![i - 1].priority]).toBeLessThanOrEqual(priorityRank[body.data![i].priority]);
    }

    const ownerB = await loginAs(SHOP_B.owner.email, SHOP_B.owner.password);
    const shopBResponse = await ownerB.get('/api/guide/action-inbox');
    expect(shopBResponse.status).toBe(200);
    const shopBBody = await readJson<GuideActionInboxItem[]>(shopBResponse);
    expect(shopBBody.data?.some((item) => item.id === reviewId || item.id === atRiskId)).toBe(false);
  });

  it('沒有 PRIMARY 指派的 REVIEW_REQUIRED／AT_RISK 團次不會同時冒出 STAFF_UNASSIGNED 卡片（#479 根因迴歸鎖）', async () => {
    // Issue #479 的真正重複根因：#43 類別 7（STAFF_CONFLICT／STAFF_UNASSIGNED）
    // 的候選查詢跟 DEPARTURE 查詢一樣讀 `status in (OPEN,CLOSED)` 且
    // `departs_on >= today`，但先前沒有排除 formation query 已經涵蓋的
    // REVIEW_REQUIRED／AT_RISK 團次。一個尚未成團、且完全沒有人員指派的團次
    // 天生沒有 PRIMARY，會被類別 7 判成 STAFF_UNASSIGNED，同時又被 formation
    // query 判成 REVIEW_REQUIRED／AT_RISK——同一個團次疊出兩張卡，深連結
    // （`/tenant/trips/:tripId`）還完全一樣。這條測試直接鎖住「類別 7 查詢也要
    // 排除 formation_status」這個修法，不只靠上面那條端對端聚合斷言反推：上面
    // 那條測試就算類別 7 查詢忘了排除，只要 DEPARTURE 查詢本身排除正確，
    // reviewMatches/atRiskMatches 的長度斷言一樣會抓到重複，但不會告訴你重複
    // 的第二張卡到底是哪個查詢生出來的——這裡直接斷言 kind 不是 STAFF_UNASSIGNED。
    const { tomorrow } = getGuideActionInboxDateWindow(new Date(), 'Asia/Taipei');

    const { data: reviewNoStaffRow, error: reviewNoStaffError } = await admin.from('trip_departures').insert({
      tenant_id: SHOP_A.id,
      trip_id: TRIP_A.id,
      plan_id: TRIP_A.planA1,
      departs_on: tomorrow,
      start_time: '11:00',
      capacity: 10,
      status: 'OPEN',
      formation_status: 'REVIEW_REQUIRED',
      min_to_depart_snapshot: 4,
      formation_deadline_at: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    }).select('id').single();
    expect(reviewNoStaffError).toBeNull();
    expect(reviewNoStaffRow?.id).toBeTruthy();
    const reviewNoStaffId = reviewNoStaffRow!.id as string;
    temporaryDepartureIds.push(reviewNoStaffId);

    const res = await ownerA.get('/api/guide/action-inbox');
    expect(res.status).toBe(200);
    const body = await readJson<GuideActionInboxItem[]>(res);
    expect(body.success).toBe(true);

    const matches = (body.data ?? []).filter((item) => item.id === reviewNoStaffId);
    expect(matches).toHaveLength(1);
    expect(matches.map((item) => item.kind)).toEqual(['REVIEW_REQUIRED']);
  });

  it('已經出發過但仍是 REVIEW_REQUIRED／AT_RISK 的舊團次不會永遠卡在收件匣（MEDIUM finding）', async () => {
    // 0107 還沒有 #41 §6 的自動轉態，理論上這種列不該長期存在，但既然可能發生，
    // formation query 就必須有 `.gte('departs_on', today)` 這個下限，否則已出發的
    // 舊團次會跟現在的團次搶 `.limit(20)` 的名額，而且永遠顯示「立即處理」。
    const now = new Date();
    const { today } = getGuideActionInboxDateWindow(now, 'Asia/Taipei');
    const yesterday = new Date(new Date(`${today}T12:00:00.000Z`).getTime() - 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);

    const { data: staleRow, error: staleError } = await admin.from('trip_departures').insert({
      tenant_id: SHOP_A.id,
      trip_id: TRIP_A.id,
      plan_id: TRIP_A.planA1,
      departs_on: yesterday,
      start_time: '09:00',
      capacity: 10,
      status: 'OPEN',
      formation_status: 'REVIEW_REQUIRED',
      min_to_depart_snapshot: 4,
      formation_deadline_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    }).select('id').single();
    expect(staleError).toBeNull();
    expect(staleRow?.id).toBeTruthy();
    const staleId = staleRow!.id as string;
    temporaryDepartureIds.push(staleId);

    const res = await ownerA.get('/api/guide/action-inbox');
    expect(res.status).toBe(200);
    const body = await readJson<GuideActionInboxItem[]>(res);
    expect(body.success).toBe(true);
    expect(body.data?.some((item) => item.id === staleId)).toBe(false);
  });
});
