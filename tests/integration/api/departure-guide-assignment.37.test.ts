/**
 * 團次導遊指派 ＋ 雙向撞班（issue #37 §3、§4）端到端整合測試
 * -----------------------------------------------------------------------------
 * ## 這一檔要證的是什麼（以及它證不到什麼）
 *
 * 單元層（`tests/unit/departure-guide-assignment.37.test.ts`）驗的是純函式：
 * 0/1/2+ 的解析、佔用區間、撞班判斷。那些全部通過，仍然完全可能出現：
 *
 *   - API 根本沒呼叫那些函式；
 *   - 呼叫了但沒把結果寫進 `trip_departure_staff`；
 *   - 寫了但 `available-slots` 那一側沒讀，於是**反向**撞班照樣發生。
 *
 * 「函式對了」與「顧客那一側真的不會被排到同一個人」是兩件事（PB-027）。所以本檔
 * 每一條都走**真實 HTTP ＋ 真實資料庫**：打 API，然後直接查 `trip_departure_staff`，
 * 或再打 `/api/bookings/available-slots` 看那個人有沒有消失。
 *
 * ## 前置隔離
 *
 * - 自己造行程／方案／團次／預約，全部帶 `I37` 前綴或本檔專用 uuid，afterAll 只刪自己的。
 * - 用 `SHOP_A.staffA1` / `staffA2` 這兩位既有員工，但**每一條測試自己安排時段**，
 *   不依賴種子資料裡既有預約的時間——那些時間會隨種子演進而變，測試會在無關的改動下轉紅。
 * - 日期一律用 2027 年的固定日，遠離種子資料與其他測試檔用到的區間。
 * - `TOUR_MODULE` 訂閱：本檔開頭先確認它有效。缺了的話所有寫入都會被閘門正確地擋下，
 *   而測試紅的會是「前提沒準備好」不是「功能壞了」——#5 踩過這個坑。
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A, SHOP_B } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };
const BASE = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';

const TAG = 'I37';
/** 本檔專用行程／方案；不碰 TRIP_A，避免與 tours.10 互相干擾。 */
const TRIP = '73700000-0000-4000-8000-000000000001';
const PLAN = '73700000-0000-4000-8000-000000000011';

/** 遠離種子資料的固定日期。DAY_BUSY 上會被安排一場一般預約。 */
const DAY_FREE = '2027-05-10';
const DAY_BUSY = '2027-05-11';
const DAY_OTHER = '2027-05-12';
/**
 * 只給「反向：available-slots」那一條用的專屬日期。
 *
 * 同檔前面的測試會在 DAY_FREE 上建立／取消 staffA1 的團次；共用同一天的話，那一條
 * 的前置（先確認 staffA1 本來就有可用時段）會受前面幾條的執行順序影響——一條測試
 * 的成敗不該取決於別條先跑了什麼。
 */
const DAY_SLOTS = '2027-05-13';
/** B 店的員工，專供跨租戶拒絕測試；beforeAll 造、afterAll 刪。 */
const STAFF_B = '73700000-0000-4000-8000-0000000000b1';

let admin: SupabaseClient;
let api: AuthedApi;
let apiB: AuthedApi;
const createdDepartures: string[] = [];
let seededBookingId = '';
/** 測前的 TOUR_MODULE 訂閱列；null 代表測前根本沒有，afterAll 要刪回去。 */
let featureSnapshot: Record<string, unknown> | null = null;

async function json<T>(response: Response): Promise<Envelope<T>> {
  return (await response.json()) as Envelope<T>;
}

/**
 * available-slots 回的是 **UTC ISO**，而團次的 `startTime` 是**台北**時分。
 *
 * ⚠️ 直接 `iso.slice(11, 16)` 會拿到 UTC 的時分，把台北 09:00 的時段寫成 01:00 ——
 * 那樣建出來的團次根本不在該時段上，後面「那個人從時段裡消失了」的斷言就會變成
 * 一條永遠通過、卻什麼都沒驗到的測試。
 */
function taipeiHm(iso: string): string {
  const t = new Date(Date.parse(iso) + 8 * 60 * 60 * 1000);
  return `${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`;
}

type DepartureBody = {
  id: string;
  primaryStaffId: string | null;
  primaryStaffName: string;
  assistantStaffIds: string[];
};

/**
 * 直查 DB：這一團在 `trip_departure_staff` 上實際存了什麼。
 *
 * ⚠️ `role` 是 **enum**，所以 `.order('role')` 排的是**列舉宣告順序**
 * （PRIMARY、ASSISTANT），不是字母順序。斷言不該綁在那個順序上——改成在 JS 這邊
 * 用字串排序，資料庫端換了列舉宣告順序也不會讓測試莫名其妙轉紅。
 */
async function assignmentRows(departureId: string) {
  const { data, error } = await admin.from('trip_departure_staff')
    .select('staff_id, role').eq('departure_id', departureId);
  expect(error).toBeNull();
  return [...(data ?? [])].sort((a, b) =>
    String(a.role).localeCompare(String(b.role)) || String(a.staff_id).localeCompare(String(b.staff_id)));
}

async function createDeparture(body: Record<string, unknown>) {
  const response = await api.post(`/api/trips/${TRIP}/departures`, body);
  const payload = await json<DepartureBody>(response);
  if (payload.data?.id) createdDepartures.push(payload.data.id);
  return { response, payload };
}

beforeAll(async () => {
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  api = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
  apiB = await loginAs(SHOP_B.owner.email, SHOP_B.owner.password);

  /**
   * 前提：TOUR_MODULE 必須有效，否則所有寫入都會被 `requireFeature` 正確擋下，
   * 而紅的會是「前提沒備好」不是「功能壞了」。
   *
   * ⚠️ **標準種子沒有給 SHOP_A TOUR_MODULE**（`keyword-replies.05.test.ts` 的檔頭
   * 逐字記著這一點），而閘門讀的是 `feature_subscriptions`，不是 `tenant_features`。
   * 所以本檔比照 `tours.10` / `keyword-replies.05` 的既有做法**自己開通**，並在
   * afterAll 還原成測前的樣子（原本沒有就刪掉，不留下我造的訂閱給別的測試檔）。
   */
  const { data: featureBefore, error: featureReadError } = await admin.from('feature_subscriptions')
    .select('*').eq('tenant_id', SHOP_A.id).eq('code', 'TOUR_MODULE').maybeSingle();
  expect(featureReadError).toBeNull();
  featureSnapshot = featureBefore ?? null;
  const { error: grantError } = await admin.from('feature_subscriptions').upsert({
    tenant_id: SHOP_A.id, code: 'TOUR_MODULE', active: true,
    expires_at: null, source: 'GRANTED', cancelled_at: null,
  }, { onConflict: 'tenant_id,code' });
  expect(grantError).toBeNull();

  // 本檔專用行程（duration_hours = 3 → 團次佔用 3 小時，不是整日）與方案。
  await admin.from('trips').upsert({
    id: TRIP, tenant_id: SHOP_A.id, title: `${TAG} 導遊指派測試行程`,
    slug: `itest-37-${Date.now()}`, duration_hours: 3, status: 'PUBLISHED',
  });
  await admin.from('trip_plans').upsert({
    id: PLAN, tenant_id: SHOP_A.id, trip_id: TRIP, name: `${TAG} 標準方案`,
    price_per_person: 1000, min_party: 1, max_party: 20,
  });

  /**
   * DAY_BUSY 09:00–10:00 給 staffA1 排一場一般服務預約（台北時間 → UTC -8）。
   *
   * ⚠️ `bookings` 上 **not-null 且沒有預設值**的欄位共七個，全部都要給：
   * `tenant_id` / `booking_no` / `customer_id` / `service_id` / `start_at` /
   * `end_at` / `duration_minutes`。這是對**真 schema** 逐欄列出來的結果，不是憑
   * 印象挑幾個——#285 的教訓正是「對著一個少了欄位的簡化替身驗過」不等於驗過，
   * 而本檔第一版就漏了 `booking_no` 與 `duration_minutes`，在 CI 才炸。
   *
   * `booking_no` 帶 TAG 前綴且加上時間戳，避免與種子或其他測試檔的單號相撞。
   */
  const { data: booking, error } = await admin.from('bookings').insert({
    tenant_id: SHOP_A.id,
    booking_no: `${TAG}-${Date.now()}`,
    customer_id: SHOP_A.customerA1,
    service_id: SHOP_A.serviceA1,
    staff_id: SHOP_A.staffA1,
    start_at: `${DAY_BUSY}T01:00:00Z`,
    end_at: `${DAY_BUSY}T02:00:00Z`,
    duration_minutes: 60,
    status: 'CONFIRMED',
    note: `${TAG} 佔用測試`,
  }).select('id').single();
  expect(error).toBeNull();
  seededBookingId = booking!.id;

  // 跨租戶測試需要一個**真的存在、但屬於別家店**的 staff id。用一個不存在的
  // uuid 只能證明「查無此人」，證不了「跨租戶被擋」——那是兩種不同的 404。
  await admin.from('staff').upsert({
    id: STAFF_B, tenant_id: SHOP_B.id, name: `${TAG} B 店員工`, bookable: true, active: true,
  });
});

afterAll(async () => {
  // 只刪自己造的：整表 delete 會清掉別的測試檔的前置資料。
  if (createdDepartures.length > 0) {
    await admin.from('trip_departure_staff').delete().in('departure_id', createdDepartures);
    await admin.from('trip_departures').delete().in('id', createdDepartures);
  }
  await admin.from('trip_departures').delete().eq('trip_id', TRIP);
  if (seededBookingId) await admin.from('bookings').delete().eq('id', seededBookingId);
  await admin.from('trip_plans').delete().eq('id', PLAN);
  await admin.from('trips').delete().eq('id', TRIP);
  await admin.from('staff').delete().eq('id', STAFF_B);
  // TOUR_MODULE 還原成測前的樣子：測前沒有就刪掉，有就寫回原本那一列。
  if (featureSnapshot) {
    await admin.from('feature_subscriptions').upsert(featureSnapshot, { onConflict: 'tenant_id,code' });
  } else {
    await admin.from('feature_subscriptions').delete()
      .eq('tenant_id', SHOP_A.id).eq('code', 'TOUR_MODULE');
  }
});

describe('指派真的被寫進 trip_departure_staff', () => {
  it('建立團次時指定主導遊 → DB 有一列 PRIMARY，回應也帶得回姓名', async () => {
    const { response, payload } = await createDeparture({
      planId: PLAN, departsOn: DAY_FREE, startTime: '09:00', capacity: 8,
      primaryStaffId: SHOP_A.staffA1,
    });
    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data!.primaryStaffId).toBe(SHOP_A.staffA1);
    // 姓名不是前端自己拼的：後端要真的帶回來，否則列表只能顯示一個 uuid。
    expect(payload.data!.primaryStaffName).not.toBe('');

    const rows = await assignmentRows(payload.data!.id);
    expect(rows).toEqual([{ staff_id: SHOP_A.staffA1, role: 'PRIMARY' }]);
  });

  it('主導遊 ＋ 協同導遊 → DB 有 PRIMARY 與 ASSISTANT 各一列', async () => {
    const { payload } = await createDeparture({
      planId: PLAN, departsOn: DAY_OTHER, startTime: '14:00', capacity: 8,
      primaryStaffId: SHOP_A.staffA1, assistantStaffIds: [SHOP_A.staffA2],
    });
    const rows = await assignmentRows(payload.data!.id);
    expect(rows).toEqual([
      { staff_id: SHOP_A.staffA2, role: 'ASSISTANT' },
      { staff_id: SHOP_A.staffA1, role: 'PRIMARY' },
    ]);
  });

  it('改派後原人員立即釋放、新人員立即占用（§5.4）', async () => {
    const { payload } = await createDeparture({
      planId: PLAN, departsOn: DAY_OTHER, startTime: '18:00', capacity: 8,
      primaryStaffId: SHOP_A.staffA1,
    });
    const id = payload.data!.id;

    const updated = await api.put(`/api/trip-departures/${id}`, { primaryStaffId: SHOP_A.staffA2 });
    expect(updated.status).toBe(200);
    const rows = await assignmentRows(id);
    // 原人員必須真的不見了；只斷言「新人員在」的話，一個「只新增不刪除」的實作
    // 會全綠，而那正是雙重占用的來源。
    expect(rows).toEqual([{ staff_id: SHOP_A.staffA2, role: 'PRIMARY' }]);
  });

  it('只改名額（不帶指派欄位）不會清掉既有的主導遊與協同導遊', async () => {
    const { payload } = await createDeparture({
      planId: PLAN, departsOn: DAY_OTHER, startTime: '20:00', capacity: 8,
      primaryStaffId: SHOP_A.staffA1, assistantStaffIds: [SHOP_A.staffA2],
    });
    const id = payload.data!.id;
    const updated = await api.put(`/api/trip-departures/${id}`, { capacity: 9 });
    expect(updated.status).toBe(200);
    expect(await assignmentRows(id)).toHaveLength(2);
  });
});

describe('雙向撞班', () => {
  it('已有一般服務預約 → 重疊團次不可指派同一人，且訊息說得出原因', async () => {
    const { response, payload } = await createDeparture({
      planId: PLAN, departsOn: DAY_BUSY, startTime: '09:00', capacity: 8,
      primaryStaffId: SHOP_A.staffA1,
    });
    expect(response.status).toBe(409);
    // §5.1：「錯誤必須說明衝突來源與時間，不只回 409」
    expect(payload.message).toContain('一般服務預約');
    // 半成品檢查：被擋下時不得留下任何團次
    const { data } = await admin.from('trip_departures').select('id')
      .eq('trip_id', TRIP).eq('departs_on', DAY_BUSY);
    expect(data ?? []).toHaveLength(0);
  });

  it('沒撞到的人不受影響（不得使用全店粗略封鎖，§5.4）', async () => {
    const { response, payload } = await createDeparture({
      planId: PLAN, departsOn: DAY_BUSY, startTime: '09:00', capacity: 8,
      primaryStaffId: SHOP_A.staffA2,
    });
    expect(response.status).toBe(200);
    expect(payload.data!.primaryStaffId).toBe(SHOP_A.staffA2);
  });

  it('團次撞團次：同一人同時段的第二團被擋下', async () => {
    const first = await createDeparture({
      planId: PLAN, departsOn: DAY_FREE, startTime: '13:00', capacity: 8,
      primaryStaffId: SHOP_A.staffA2,
    });
    expect(first.response.status).toBe(200);
    const second = await createDeparture({
      planId: PLAN, departsOn: DAY_FREE, startTime: '14:00', capacity: 8,
      primaryStaffId: SHOP_A.staffA2,
    });
    expect(second.response.status).toBe(409);
    expect(second.payload.message).toContain('其他團次');
  });

  it('ASSISTANT 也占用時間：以協同身分被指派的人，接不下同時段的另一團', async () => {
    const first = await createDeparture({
      planId: PLAN, departsOn: DAY_OTHER, startTime: '08:00', capacity: 8,
      primaryStaffId: SHOP_A.staffA1, assistantStaffIds: [SHOP_A.staffA2],
    });
    expect(first.response.status).toBe(200);
    const second = await createDeparture({
      planId: PLAN, departsOn: DAY_OTHER, startTime: '09:00', capacity: 8,
      primaryStaffId: SHOP_A.staffA2,
    });
    expect(second.response.status).toBe(409);
  });

  it('CANCELLED 團次釋放時間', async () => {
    const first = await createDeparture({
      planId: PLAN, departsOn: DAY_FREE, startTime: '19:00', capacity: 8,
      primaryStaffId: SHOP_A.staffA1,
    });
    expect(first.response.status).toBe(200);
    const cancelled = await api.put(`/api/trip-departures/${first.payload.data!.id}`, { status: 'CANCELLED' });
    expect(cancelled.status).toBe(200);

    const second = await createDeparture({
      planId: PLAN, departsOn: DAY_FREE, startTime: '20:00', capacity: 8,
      primaryStaffId: SHOP_A.staffA1,
    });
    // 對照組意義：若「釋放」沒有實作，這一發會是 409。
    expect(second.response.status).toBe(200);
  });

  it('⚠️ 反向：被團次指派的人不會再出現在 /api/bookings/available-slots', async () => {
    // 這一條是本檔最重要的一項。前面所有測試都在團次那一側；只做那一側的話，
    // 顧客端仍然可以把已經在帶團的導遊預約走——撞班只擋了一半。
    const before = await api.get(
      `/api/bookings/available-slots?serviceId=${SHOP_A.serviceA1}&staffId=${SHOP_A.staffA1}&date=${DAY_SLOTS}`,
    );
    const beforeSlots = (await json<{ slots: Array<{ start: string; staffIds: string[] }> }>(before)).data!.slots;
    // 對照組：先確認這一天本來就有該員工的時段，否則下面的「消失了」等於什麼都沒證明
    // （空集合永遠滿足「不包含某人」）。
    expect(beforeSlots.some((s) => s.staffIds.includes(SHOP_A.staffA1))).toBe(true);
    const targetSlot = beforeSlots.find((s) => s.staffIds.includes(SHOP_A.staffA1))!;

    const created = await createDeparture({
      planId: PLAN, departsOn: DAY_SLOTS, startTime: taipeiHm(targetSlot.start), capacity: 8,
      primaryStaffId: SHOP_A.staffA1,
    });
    // 這一發若因撞班被擋，本測試就沒有前提可驗，明確失敗而不是靜默跳過。
    expect(created.response.status, created.payload.message ?? '').toBe(200);

    const after = await api.get(
      `/api/bookings/available-slots?serviceId=${SHOP_A.serviceA1}&staffId=${SHOP_A.staffA1}&date=${DAY_SLOTS}`,
    );
    const afterSlots = (await json<{ slots: Array<{ start: string; staffIds: string[] }> }>(after)).data!.slots;
    const stillThere = afterSlots.find((s) => s.start === targetSlot.start);
    expect(stillThere?.staffIds ?? []).not.toContain(SHOP_A.staffA1);
  });
});

describe('跨租戶與 0/1/2+', () => {
  it('跨租戶 staff id 被拒（§5.4）', async () => {
    const { response } = await createDeparture({
      planId: PLAN, departsOn: DAY_OTHER, startTime: '22:00', capacity: 8,
      primaryStaffId: STAFF_B,
    });
    expect(response.status).toBe(404);
  });

  it('B 店的擁有者動不了 A 店的團次', async () => {
    const mine = await createDeparture({
      planId: PLAN, departsOn: DAY_OTHER, startTime: '23:00', capacity: 8,
      primaryStaffId: SHOP_A.staffA1,
    });
    expect(mine.response.status).toBe(200);
    const target = mine.payload.data!.id;

    /**
     * ⚠️ 分兩段驗，因為兩段擋下來的是**不同的東西**。
     *
     * 種子沒有給 SHOP_B `TOUR_MODULE`，所以第一段其實是**功能閘門**先回 403
     * ——那還沒證明租戶隔離有效。只斷言 403 就收工，等於把「B 店沒買這個模組」
     * 誤讀成「跨租戶被擋下」。
     */
    const gated = await apiB.put(`/api/trip-departures/${target}`, { capacity: 5 });
    expect(gated.status).toBe(403);

    // 第二段才是真的租戶隔離：暫時給 SHOP_B 開通模組，讓它越過閘門，這時仍必須 404。
    const { error: grantError } = await admin.from('feature_subscriptions').upsert({
      tenant_id: SHOP_B.id, code: 'TOUR_MODULE', active: true,
      expires_at: null, source: 'GRANTED', cancelled_at: null,
    }, { onConflict: 'tenant_id,code' });
    expect(grantError).toBeNull();
    try {
      const crossTenant = await apiB.put(`/api/trip-departures/${target}`, { capacity: 5 });
      expect(crossTenant.status).toBe(404);
      // A 店那一團完全沒被動到
      const { data: after } = await admin.from('trip_departures')
        .select('capacity').eq('id', target).maybeSingle();
      expect(after?.capacity).toBe(8);
    } finally {
      await admin.from('feature_subscriptions').delete()
        .eq('tenant_id', SHOP_B.id).eq('code', 'TOUR_MODULE');
    }
  });

  it('批次開團：撞班的日期被跳過並回報原因，可用的日期照常建立', async () => {
    // DAY_BUSY 那天 staffA1 有一般預約 → 該日應被跳過並出現在 conflicts[]。
    const response = await api.post(`/api/trips/${TRIP}/departures/batch`, {
      planId: PLAN, from: DAY_FREE, to: DAY_OTHER,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      startTime: '09:00', capacity: 8,
      primaryStaffId: SHOP_A.staffA1,
    });
    const payload = await json<{
      created: number; skipped: number;
      conflicts: Array<{ date: string; staffId: string; reason: string }>;
      departures: Array<{ id: string }>;
    }>(response);
    expect(response.status).toBe(200);
    for (const d of payload.data!.departures) createdDepartures.push(d.id);

    const busyConflict = payload.data!.conflicts.find((c) => c.date === DAY_BUSY);
    expect(busyConflict, '撞班的日期必須出現在 conflicts[]，混在 skipped 數字裡店家看不出原因')
      .toBeTruthy();
    expect(busyConflict!.staffId).toBe(SHOP_A.staffA1);
  });
});
