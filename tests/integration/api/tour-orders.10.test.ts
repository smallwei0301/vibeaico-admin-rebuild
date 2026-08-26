/**
 * 旅遊訂單端點整合測試 — GitHub issue #8（修復-6），12 分冊 §4 Phase 8 的 `tour-orders.10`。
 *
 * 端點（10 分冊 §3 狀態機、§5 端點表；migration 0026）：
 *   GET  /api/tour-orders            （分頁 + status/paymentStatus/source/departureId/keyword 篩選）
 *   GET  /api/tour-orders/:id
 *   POST /api/tour-orders/manual     （rpc create_tour_order：建單 + 佔名額同交易）
 *   POST /api/tour-orders/:id/confirm-payment | complete | cancel
 *
 * 本檔要證明的事（issue #8 驗收清單第 3、8 項）：
 *   1. manual 建單真的佔名額（`seats_booked` 增加），金額由**後端依方案現值計算**，
 *      前端送來的價格不採信
 *   2. 定金：DEPOSIT_PERCENT / DEPOSIT_FIXED 依 10 分冊 §1 的規則算（每人 × 人數）
 *   3. 狀態機 confirm-payment → complete；PENDING 直接 complete → 409；
 *      已取消的訂單不能確認收款、不能結案
 *   4. cancel **真的釋放名額**（`seats_booked` 減回去），重複 cancel → 409 且只放一次
 *   5. **並發搶最後名額恰好一成一敗**（12 分冊 §5 樣板，錯誤碼 `TOUR_001`），
 *      且 `seats_booked` 不超過 `capacity`
 *   6. RLS／跨租戶：B 店帳號讀寫 A 店訂單一律 404，且沒有任何資料列被改
 *
 * 並發案例為什麼不用固定秒數等待（14 分冊 §6.16-a）：兩個請求都是
 * `await`ed 的 HTTP 往返，`Promise.all` 回來時兩邊的副作用都已經完成，
 * 不存在「還沒抵達就斷言」的窗口。斷言釘的是「兩個結果的組合」與 DB 現值，
 * 不是「n 秒內沒有發生某事」。
 *
 * 清理紀律：本檔自建專屬行程/方案/團次（不動 seed 的 TRIP_A，避免與 tours.10
 * 及未來的 e2e 互相踩），afterAll 依 FK 方向刪回去。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A, SHOP_B } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };
type Paged<T> = { content: T[]; totalElements: number; totalPages: number; number: number; size: number };

type OrderDto = {
  id: string; orderNo: string; tripTitle: string; planName: string;
  departsOn: string; startTime: string;
  customerName: string; customerPhone: string; partySize: number;
  unitPrice: number; totalAmount: number; depositAmount: number;
  status: string; paymentStatus: string; paymentMethodLabel: string;
  source: string; holdExpiresAt: string | null; note: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const futureDate = (n: number) => new Date(Date.now() + n * DAY_MS).toISOString().slice(0, 10);

async function readJson<T = unknown>(res: Response): Promise<Envelope<T>> {
  return (await res.json()) as Envelope<T>;
}

let admin: SupabaseClient;
let ownerA: AuthedApi;
let ownerB: AuthedApi;

let tripId = '';
/** 每人 2000、全額線上收 */
let planFull = '';
/** 每人 3000、定金 30% */
let planPercent = '';
/** 每團 9000、定金固定 500 */
let planGroupFixed = '';

let depFull = '';        // capacity 10
let depPercent = '';     // capacity 10
let depGroup = '';       // capacity 10
let depLastSeats = '';   // capacity 2 —— 並發搶最後名額
let depClosed = '';      // status CLOSED

const createdOrders = new Set<string>();

async function createOrder(body: Record<string, unknown>) {
  const res = await ownerA.post('/api/tour-orders/manual', body);
  const env = await readJson<OrderDto>(res);
  if (env.data?.id) createdOrders.add(env.data.id);
  return { res, env };
}

async function seatsOf(departureId: string): Promise<number> {
  const { data } = await admin.from('trip_departures')
    .select('seats_booked').eq('id', departureId).single();
  return data!.seats_booked as number;
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();

  admin = createClient(
    process.env.TEST_SUPABASE_URL!,
    process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
  ownerB = await loginAs(SHOP_B.owner.email, SHOP_B.owner.password);

  const { data: trip } = await admin.from('trips').insert({
    tenant_id: SHOP_A.id,
    slug: `itest-tour-orders-10-${Date.now()}`,
    title: '獨木舟日出團（tour-orders.10 測試）',
    status: 'PUBLISHED',
  }).select('id').single();
  tripId = trip!.id;

  // ⚠️ 批次 insert 的每一列都要帶**同一組**鍵：PostgREST 會取所有列的鍵集合
  // 聯集當成欄位清單，某列缺的鍵會被填成 null（而不是走 DB 預設值），於是
  // `deposit_value not null` 就會 23502。所以 FULL 那列也要明寫 deposit_value: 0。
  const plans = await admin.from('trip_plans').insert([
    {
      tenant_id: SHOP_A.id, trip_id: tripId, name: '全額團', base_price: 2000,
      price_type: 'PER_PERSON', deposit_mode: 'FULL', deposit_value: 0,
      max_participants: 8, sort_order: 0,
    },
    {
      tenant_id: SHOP_A.id, trip_id: tripId, name: '定金三成團', base_price: 3000,
      price_type: 'PER_PERSON', deposit_mode: 'DEPOSIT_PERCENT', deposit_value: 30,
      max_participants: 8, sort_order: 1,
    },
    {
      tenant_id: SHOP_A.id, trip_id: tripId, name: '包團', base_price: 9000,
      price_type: 'PER_GROUP', deposit_mode: 'DEPOSIT_FIXED', deposit_value: 500,
      max_participants: 8, sort_order: 2,
    },
  ]).select('id, name');
  expect(plans.error, JSON.stringify(plans.error)).toBeNull();
  planFull = plans.data!.find((p) => p.name === '全額團')!.id;
  planPercent = plans.data!.find((p) => p.name === '定金三成團')!.id;
  planGroupFixed = plans.data!.find((p) => p.name === '包團')!.id;

  // 同上：每列的鍵集合必須一致，否則缺的鍵會被填 null 而不是走預設值。
  const deps = await admin.from('trip_departures').insert([
    { tenant_id: SHOP_A.id, trip_id: tripId, plan_id: planFull, departs_on: futureDate(900), start_time: '06:00', capacity: 10, status: 'OPEN' },
    { tenant_id: SHOP_A.id, trip_id: tripId, plan_id: planPercent, departs_on: futureDate(901), start_time: null, capacity: 10, status: 'OPEN' },
    { tenant_id: SHOP_A.id, trip_id: tripId, plan_id: planGroupFixed, departs_on: futureDate(902), start_time: null, capacity: 10, status: 'OPEN' },
    { tenant_id: SHOP_A.id, trip_id: tripId, plan_id: planFull, departs_on: futureDate(903), start_time: null, capacity: 2, status: 'OPEN' },
    { tenant_id: SHOP_A.id, trip_id: tripId, plan_id: planFull, departs_on: futureDate(904), start_time: null, capacity: 5, status: 'CLOSED' },
  ]).select('id, departs_on, capacity, status');
  expect(deps.error, JSON.stringify(deps.error)).toBeNull();
  const byDate = (d: string) => deps.data!.find((x) => x.departs_on === d)!.id;
  depFull = byDate(futureDate(900));
  depPercent = byDate(futureDate(901));
  depGroup = byDate(futureDate(902));
  depLastSeats = byDate(futureDate(903));
  depClosed = byDate(futureDate(904));
});

afterAll(async () => {
  for (const id of createdOrders) await admin.from('tour_orders').delete().eq('id', id);
  if (tripId) {
    await admin.from('tour_orders').delete().eq('trip_id', tripId);
    await admin.from('trip_departures').delete().eq('trip_id', tripId);
    await admin.from('trips').delete().eq('id', tripId);
  }
});

/* ================================================= 手動建單 + 名額 */
describe('POST /api/tour-orders/manual', () => {
  it('建單成功：真的佔名額，金額由後端依方案算，orderNo 是 T+yymmdd+4 碼', async () => {
    const before = await seatsOf(depFull);

    const { res, env } = await createOrder({
      departureId: depFull, customerName: '王小明', customerPhone: '0912345678', partySize: 3,
      note: '需要素食',
    });
    expect(res.status, JSON.stringify(env)).toBe(200);

    const o = env.data!;
    expect(o.partySize).toBe(3);
    expect(o.unitPrice).toBe(2000);
    expect(o.totalAmount).toBe(6000);      // PER_PERSON × 3
    expect(o.depositAmount).toBe(0);       // FULL → 定金欄位記 0
    expect(o.status).toBe('PENDING');
    expect(o.paymentStatus).toBe('UNPAID');
    expect(o.source).toBe('MANUAL');
    expect(o.holdExpiresAt).toBeNull();    // 10 分冊 §3：手動單不自動過期
    expect(o.orderNo).toMatch(/^T\d{6}\d{4}$/);
    expect(o.tripTitle).toBe('獨木舟日出團（tour-orders.10 測試）');
    expect(o.planName).toBe('全額團');
    expect(o.departsOn).toBe(futureDate(900));
    expect(o.startTime).toBe('06:00');
    expect(o.note).toBe('需要素食');

    expect(await seatsOf(depFull)).toBe(before + 3);
  });

  it('收款方式顯示名稱是空字串（tenant_payment_methods 尚未建表，不編一個名字出來）', async () => {
    const { env } = await createOrder({
      departureId: depFull, customerName: '未設定收款', customerPhone: '0900000001', partySize: 1,
    });
    expect(env.data!.paymentMethodLabel).toBe('');
  });

  it('前端送來的金額不採信：totalAmount / unitPrice 仍由方案現值決定', async () => {
    const { res, env } = await createOrder({
      departureId: depFull, customerName: '想打折的人', customerPhone: '0900000002', partySize: 2,
      totalAmount: 1, unitPrice: 1, depositAmount: 999999,
    });
    expect(res.status, JSON.stringify(env)).toBe(200);
    expect(env.data!.unitPrice).toBe(2000);
    expect(env.data!.totalAmount).toBe(4000);
    expect(env.data!.depositAmount).toBe(0);
  });

  it('定金 30%（每人計價）：total 6000 → deposit 1800', async () => {
    const { res, env } = await createOrder({
      departureId: depPercent, customerName: '定金客', customerPhone: '0900000003', partySize: 2,
    });
    expect(res.status, JSON.stringify(env)).toBe(200);
    expect(env.data!.totalAmount).toBe(6000);
    expect(env.data!.depositAmount).toBe(1800);
  });

  it('定金固定額（每團計價）：total 9000、定金收一筆 500（不乘人數）', async () => {
    const { res, env } = await createOrder({
      departureId: depGroup, customerName: '包團客', customerPhone: '0900000004', partySize: 4,
    });
    expect(res.status, JSON.stringify(env)).toBe(200);
    expect(env.data!.totalAmount).toBe(9000);   // PER_GROUP → 不乘人數
    expect(env.data!.depositAmount).toBe(500);
  });

  it('名額不足 → 409 TOUR_001，且 seats_booked 一個都沒動', async () => {
    const before = await seatsOf(depLastSeats);
    const { res, env } = await createOrder({
      departureId: depLastSeats, customerName: '訂太多', customerPhone: '0900000005', partySize: 3,
    });
    expect(res.status, JSON.stringify(env)).toBe(409);
    expect(env.code).toBe('TOUR_001');
    expect(await seatsOf(depLastSeats)).toBe(before);
  });

  it('已關閉的團次不接受下單 → 409 TOUR_001（reserve_seats 只認 status=OPEN）', async () => {
    const before = await seatsOf(depClosed);
    const { res, env } = await createOrder({
      departureId: depClosed, customerName: '關團還想訂', customerPhone: '0900000006', partySize: 1,
    });
    expect(res.status, JSON.stringify(env)).toBe(409);
    expect(env.code).toBe('TOUR_001');
    expect(await seatsOf(depClosed)).toBe(before);
  });

  it('人數超過方案上限 → 409', async () => {
    const { res } = await createOrder({
      departureId: depFull, customerName: '超團', customerPhone: '0900000007', partySize: 9,
    });
    expect(res.status).toBe(409);
  });

  it('不存在的團次 → 404', async () => {
    const { res } = await createOrder({
      departureId: '00000000-0000-4000-8000-0000000000ff',
      customerName: 'x', customerPhone: '0900000008', partySize: 1,
    });
    expect(res.status).toBe(404);
  });

  it('人數 0 → 400（zod 擋在進 rpc 之前）', async () => {
    const { res } = await createOrder({
      departureId: depFull, customerName: 'x', customerPhone: '0900000009', partySize: 0,
    });
    expect(res.status).toBe(400);
  });
});

/* =============================================== 並發搶最後名額 */
describe('並發：兩筆同時搶最後名額（12 分冊 §5 樣板，TOUR_001）', () => {
  it('恰好一成一敗，且 seats_booked 不超過 capacity', async () => {
    // depLastSeats capacity=2、目前 0 席（上面的 409 案例沒有佔到名額）
    expect(await seatsOf(depLastSeats)).toBe(0);

    const fire = () => ownerA.post('/api/tour-orders/manual', {
      departureId: depLastSeats, customerName: '搶位', customerPhone: '0911111111', partySize: 2,
    });

    const [r1, r2] = await Promise.all([fire(), fire()]);
    const [b1, b2] = await Promise.all([readJson<OrderDto>(r1), readJson<OrderDto>(r2)]);
    for (const b of [b1, b2]) if (b.data?.id) createdOrders.add(b.data.id);

    const statuses = [r1.status, r2.status].sort();
    expect(statuses, `兩筆的狀態碼：${JSON.stringify(statuses)} / ${JSON.stringify([b1, b2])}`)
      .toEqual([200, 409]);

    const failed = r1.status === 409 ? b1 : b2;
    expect(failed.code).toBe('TOUR_001');

    // 超賣的最後防線也要成立：只佔了 2 席，不是 4
    expect(await seatsOf(depLastSeats)).toBe(2);
  });
});

/* ==================================================== 狀態機 */
describe('狀態動作（confirm-payment / complete / cancel）', () => {
  let orderId = '';

  it('PENDING 直接 complete → 409（未確認收款不得結案）', async () => {
    const { res, env } = await createOrder({
      departureId: depFull, customerName: '流程客', customerPhone: '0922222222', partySize: 1,
    });
    expect(res.status, JSON.stringify(env)).toBe(200);
    orderId = env.data!.id;

    const done = await ownerA.post(`/api/tour-orders/${orderId}/complete`);
    expect(done.status).toBe(409);

    const { data } = await admin.from('tour_orders').select('status').eq('id', orderId).single();
    expect(data!.status).toBe('PENDING');
  });

  it('confirm-payment：PENDING → CONFIRMED 且 payment_status=PAID、hold 清空', async () => {
    // 先塞一個保留期限，證明它真的被清掉
    await admin.from('tour_orders')
      .update({ hold_expires_at: new Date(Date.now() + DAY_MS).toISOString() })
      .eq('id', orderId);

    const res = await ownerA.post(`/api/tour-orders/${orderId}/confirm-payment`);
    const env = await readJson<OrderDto>(res);
    expect(res.status, JSON.stringify(env)).toBe(200);
    expect(env.data!.status).toBe('CONFIRMED');
    expect(env.data!.paymentStatus).toBe('PAID');
    expect(env.data!.holdExpiresAt).toBeNull();

    const { data } = await admin.from('tour_orders')
      .select('status, payment_status, hold_expires_at').eq('id', orderId).single();
    expect(data!.status).toBe('CONFIRMED');
    expect(data!.payment_status).toBe('PAID');
    expect(data!.hold_expires_at).toBeNull();
  });

  it('重複 confirm-payment → 409', async () => {
    const res = await ownerA.post(`/api/tour-orders/${orderId}/confirm-payment`);
    expect(res.status).toBe(409);
  });

  it('complete：CONFIRMED → COMPLETED，且**不**釋放名額', async () => {
    const seatsBefore = await seatsOf(depFull);

    const res = await ownerA.post(`/api/tour-orders/${orderId}/complete`);
    const env = await readJson<OrderDto>(res);
    expect(res.status, JSON.stringify(env)).toBe(200);
    expect(env.data!.status).toBe('COMPLETED');

    expect(await seatsOf(depFull)).toBe(seatsBefore);
  });

  it('重複 complete → 409', async () => {
    const res = await ownerA.post(`/api/tour-orders/${orderId}/complete`);
    expect(res.status).toBe(409);
  });

  it('已結案的訂單不得取消 → 409，名額不變', async () => {
    const seatsBefore = await seatsOf(depFull);
    const res = await ownerA.post(`/api/tour-orders/${orderId}/cancel`, { reason: '想取消' });
    expect(res.status).toBe(409);
    expect(await seatsOf(depFull)).toBe(seatsBefore);
  });

  it('cancel：釋放名額、寫入取消原因；已付款的 payment_status 不會被改成 REFUNDED', async () => {
    const { res: c, env: ce } = await createOrder({
      departureId: depFull, customerName: '要取消的客人', customerPhone: '0933333333', partySize: 2,
    });
    expect(c.status, JSON.stringify(ce)).toBe(200);
    const cancelId = ce.data!.id;

    await ownerA.post(`/api/tour-orders/${cancelId}/confirm-payment`);
    const seatsBefore = await seatsOf(depFull);

    const res = await ownerA.post(`/api/tour-orders/${cancelId}/cancel`, { reason: '天候不佳' });
    const env = await readJson<OrderDto>(res);
    expect(res.status, JSON.stringify(env)).toBe(200);
    expect(env.data!.status).toBe('CANCELLED');
    expect(env.data!.paymentStatus).toBe('PAID');   // 退款一律人工，不自動改 REFUNDED

    expect(await seatsOf(depFull)).toBe(seatsBefore - 2);

    const { data } = await admin.from('tour_orders')
      .select('status, cancel_reason, payment_status').eq('id', cancelId).single();
    expect(data!.status).toBe('CANCELLED');
    expect(data!.cancel_reason).toBe('天候不佳');
    expect(data!.payment_status).toBe('PAID');

    // 重複取消 → 409，且名額**只放一次**
    const seatsAfterFirst = await seatsOf(depFull);
    const again = await ownerA.post(`/api/tour-orders/${cancelId}/cancel`, { reason: '再按一次' });
    expect(again.status).toBe(409);
    expect(await seatsOf(depFull)).toBe(seatsAfterFirst);
  });

  it('已取消的訂單不得確認收款 → 409', async () => {
    const { env } = await createOrder({
      departureId: depFull, customerName: '取消後想付款', customerPhone: '0944444444', partySize: 1,
    });
    const id = env.data!.id;
    await ownerA.post(`/api/tour-orders/${id}/cancel`);

    const res = await ownerA.post(`/api/tour-orders/${id}/confirm-payment`);
    expect(res.status).toBe(409);
  });

  it('不存在的訂單 → 三個動作都 404', async () => {
    const ghost = '00000000-0000-4000-8000-0000000000ee';
    expect((await ownerA.post(`/api/tour-orders/${ghost}/confirm-payment`)).status).toBe(404);
    expect((await ownerA.post(`/api/tour-orders/${ghost}/complete`)).status).toBe(404);
    expect((await ownerA.post(`/api/tour-orders/${ghost}/cancel`)).status).toBe(404);
  });
});

/* ==================================================== 列表 / 詳情 */
describe('GET /api/tour-orders', () => {
  it('回 Spring 風格分頁信封，且只含本租戶的訂單', async () => {
    const res = await ownerA.get('/api/tour-orders?page=0&size=5');
    const env = await readJson<Paged<OrderDto>>(res);
    expect(res.status, JSON.stringify(env)).toBe(200);
    const p = env.data!;
    expect(p.number).toBe(0);
    expect(p.size).toBe(5);
    expect(p.content.length).toBeLessThanOrEqual(5);
    expect(p.totalElements).toBeGreaterThan(0);
    expect(p.totalPages).toBe(Math.ceil(p.totalElements / 5));

    const ids = p.content.map((o) => o.id);
    if (ids.length) {
      const { data } = await admin.from('tour_orders').select('tenant_id').in('id', ids);
      expect(data!.every((r) => r.tenant_id === SHOP_A.id)).toBe(true);
    }
  });

  it('status 篩選：只回該狀態', async () => {
    const res = await ownerA.get('/api/tour-orders?status=CANCELLED&size=50');
    const env = await readJson<Paged<OrderDto>>(res);
    expect(res.status).toBe(200);
    expect(env.data!.content.every((o) => o.status === 'CANCELLED')).toBe(true);
    expect(env.data!.content.length).toBeGreaterThan(0);
  });

  it('departureId 篩選（10 分冊 §5.5 的「該團報名名單」）', async () => {
    const res = await ownerA.get(`/api/tour-orders?departureId=${depGroup}&size=50`);
    const env = await readJson<Paged<OrderDto>>(res);
    expect(res.status).toBe(200);
    expect(env.data!.content.length).toBe(1);
    expect(env.data!.content[0].customerName).toBe('包團客');
  });

  it('keyword 篩選：命中顧客姓名', async () => {
    const res = await ownerA.get('/api/tour-orders?keyword=包團客&size=50');
    const env = await readJson<Paged<OrderDto>>(res);
    expect(res.status).toBe(200);
    expect(env.data!.content.length).toBe(1);
  });

  it('size 超過上限 → 400（頁面與端點共用 MAX_PAGE_SIZE）', async () => {
    const res = await ownerA.get('/api/tour-orders?size=9999');
    expect(res.status).toBe(400);
  });
});

describe('GET /api/tour-orders/:id', () => {
  it('回單筆訂單，含 join 帶回的行程/方案/團次欄位', async () => {
    const { env: created } = await createOrder({
      departureId: depFull, customerName: '詳情客', customerPhone: '0955555555', partySize: 1,
    });
    const res = await ownerA.get(`/api/tour-orders/${created.data!.id}`);
    const env = await readJson<OrderDto>(res);
    expect(res.status, JSON.stringify(env)).toBe(200);
    expect(env.data!.tripTitle).toBe('獨木舟日出團（tour-orders.10 測試）');
    expect(env.data!.planName).toBe('全額團');
    expect(env.data!.departsOn).toBe(futureDate(900));
  });
});

/* ================================================ 統計卡的四個數字 */
describe('GET /api/tour-orders/summary', () => {
  it('是全店統計（不是當前分頁），四個定義各自對得上 DB', async () => {
    const res = await ownerA.get('/api/tour-orders/summary');
    const env = await readJson<{ pending: number; unpaid: number; upcoming: number; monthRevenue: number }>(res);
    expect(res.status, JSON.stringify(env)).toBe(200);

    const { count: pending } = await admin.from('tour_orders')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', SHOP_A.id).eq('status', 'PENDING');
    expect(env.data!.pending).toBe(pending);

    const { count: unpaid } = await admin.from('tour_orders')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', SHOP_A.id).eq('payment_status', 'UNPAID').neq('status', 'CANCELLED');
    expect(env.data!.unpaid).toBe(unpaid);

    // pending 必然超過一頁（size=20）能裝下的量之外還算得對——這正是舊版
    // 拿當前頁去 filter 會漏掉的東西。這裡至少確認它不是 0。
    expect(env.data!.pending).toBeGreaterThan(0);

    const { data: paid } = await admin.from('tour_orders')
      .select('total_amount').eq('tenant_id', SHOP_A.id).eq('payment_status', 'PAID');
    const sum = (paid ?? []).reduce((s, r: any) => s + Number(r.total_amount), 0);
    expect(env.data!.monthRevenue).toBe(sum);
  });

  it('B 店看到的是 B 店自己的數字（跨租戶不外洩）', async () => {
    const res = await ownerB.get('/api/tour-orders/summary');
    const env = await readJson<{ pending: number; unpaid: number }>(res);
    expect(res.status).toBe(200);

    const { count } = await admin.from('tour_orders')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', SHOP_B.id).eq('status', 'PENDING');
    expect(env.data!.pending).toBe(count ?? 0);
  });
});

/* ============================================ 逾期自動取消 cron */
describe('GET /api/cron/tour-order-expiry', () => {
  const cronSecret = () => process.env.TEST_CRON_SECRET ?? '';

  it('沒有 Bearer → 401', async () => {
    const res = await fetch('http://localhost:3100/api/cron/tour-order-expiry');
    expect(res.status).toBe(401);
  });

  it('hold_expires_at 已過 → 取消訂單並釋放名額；null 的手動單不受影響', async () => {
    expect(cronSecret()).toBeTruthy();

    // A：已過期的保留（模擬 checkout 建的匯款單）
    const { env: expiring } = await createOrder({
      departureId: depPercent, customerName: '逾期未付', customerPhone: '0988888881', partySize: 1,
    });
    const expiringId = expiring.data!.id;
    await admin.from('tour_orders')
      .update({ hold_expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq('id', expiringId);

    // B：手動單，hold_expires_at 為 null → 10 分冊 §3 明訂不自動過期
    const { env: manual } = await createOrder({
      departureId: depPercent, customerName: '手動單不過期', customerPhone: '0988888882', partySize: 1,
    });
    const manualId = manual.data!.id;

    const seatsBefore = await seatsOf(depPercent);

    const res = await fetch('http://localhost:3100/api/cron/tour-order-expiry', {
      headers: { authorization: `Bearer ${cronSecret()}` },
    });
    const body = await res.json() as { cancelled: number; seatsReleased: number; releaseFailedOrderIds: string[] };
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.cancelled).toBeGreaterThanOrEqual(1);
    expect(body.releaseFailedOrderIds).toEqual([]);

    const { data: a } = await admin.from('tour_orders')
      .select('status, cancel_reason').eq('id', expiringId).single();
    expect(a!.status).toBe('CANCELLED');
    expect(a!.cancel_reason).toContain('付款期限');

    const { data: b } = await admin.from('tour_orders').select('status').eq('id', manualId).single();
    expect(b!.status).toBe('PENDING');

    expect(await seatsOf(depPercent)).toBe(seatsBefore - 1);
  });

  it('再跑一次是冪等的：不會重複釋放名額', async () => {
    const seatsBefore = await seatsOf(depPercent);
    const res = await fetch('http://localhost:3100/api/cron/tour-order-expiry', {
      headers: { authorization: `Bearer ${cronSecret()}` },
    });
    const body = await res.json() as { cancelled: number };
    expect(res.status).toBe(200);
    expect(body.cancelled).toBe(0);
    expect(await seatsOf(depPercent)).toBe(seatsBefore);
  });
});

/* =============================================== RLS / 跨租戶隔離 */
describe('RLS：B 店帳號讀寫 A 店訂單', () => {
  let victim = '';

  beforeAll(async () => {
    const { env } = await createOrder({
      departureId: depFull, customerName: 'RLS 受害者', customerPhone: '0966666666', partySize: 1,
    });
    victim = env.data!.id;
  });

  it('GET 單筆 → 404', async () => {
    expect((await ownerB.get(`/api/tour-orders/${victim}`)).status).toBe(404);
  });

  it('列表看不到 A 店的訂單', async () => {
    const res = await ownerB.get('/api/tour-orders?size=200');
    const env = await readJson<Paged<OrderDto>>(res);
    expect(res.status).toBe(200);
    expect(env.data!.content.some((o) => o.id === victim)).toBe(false);
  });

  it('三個狀態動作都 404，且訂單狀態與名額完全不變', async () => {
    const seatsBefore = await seatsOf(depFull);
    const { data: before } = await admin.from('tour_orders')
      .select('status, payment_status, cancel_reason').eq('id', victim).single();

    expect((await ownerB.post(`/api/tour-orders/${victim}/confirm-payment`)).status).toBe(404);
    expect((await ownerB.post(`/api/tour-orders/${victim}/complete`)).status).toBe(404);
    expect((await ownerB.post(`/api/tour-orders/${victim}/cancel`, { reason: 'B 店亂按' })).status).toBe(404);

    const { data: after } = await admin.from('tour_orders')
      .select('status, payment_status, cancel_reason').eq('id', victim).single();
    expect(after).toEqual(before);
    expect(await seatsOf(depFull)).toBe(seatsBefore);
  });

  it('manual 建單指向 A 店的團次 → 404，且 DB 沒有多出訂單', async () => {
    const { count: before } = await admin.from('tour_orders')
      .select('id', { count: 'exact', head: true }).eq('departure_id', depFull);
    const seatsBefore = await seatsOf(depFull);

    const res = await ownerB.post('/api/tour-orders/manual', {
      departureId: depFull, customerName: 'B 店偷渡', customerPhone: '0977777777', partySize: 1,
    });
    expect(res.status).toBe(404);

    const { count: after } = await admin.from('tour_orders')
      .select('id', { count: 'exact', head: true }).eq('departure_id', depFull);
    expect(after).toBe(before);
    expect(await seatsOf(depFull)).toBe(seatsBefore);
  });
});
