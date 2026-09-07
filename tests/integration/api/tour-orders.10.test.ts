/**
 * 旅遊訂單 HTTP 驗收（issue #8-B；10 分冊 §1.1／§2／§3、12 分冊 §4 Phase 8）
 * -----------------------------------------------------------------------------
 * 這一檔的靈魂是**並發不超賣**（12 分冊 §5）。其餘案例都圍著同一個問題轉：
 * 名額有沒有在該扣的時候扣、該放的時候放、不該放的時候不放。
 *
 * ⚠️ 每一條狀態轉換都**用 service role 直查 `trip_departures.seats_booked`** 驗證，
 * 不只看 HTTP 狀態碼。「回 200 但名額沒扣」與「回 409 卻已經扣了」都會讓只看
 * 狀態碼的測試全綠——而那正是這張 issue 要修的那種假成功。
 *
 * ⚠️ 12 分冊 §5 的樣板打的是 `/api/public/checkout`（旅客端，Phase 9）。那支路由
 * 屬於另一個切片、目前不存在，所以這裡改打 `/api/tour-orders/manual`。
 * **兩者走的是同一支 `create_tour_order` rpc**，也就是同一個原子扣減，
 * 樣板要證明的不變量完全相同；公開 checkout 落地後應在該檔再驗一次旅客端路徑。
 */
import { describe, expect, it, beforeAll, afterEach } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { SHOP_A, SHOP_B, TRIP_A } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };
const BASE = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';

async function json<T>(response: Response): Promise<Envelope<T>> {
  return (await response.json()) as Envelope<T>;
}

let admin: SupabaseClient;
let ownerA: AuthedApi;
let ownerB: AuthedApi;

/** 直查團次的已報名人數 —— 「證據」本身 */
async function dbSeats(departureId: string): Promise<number> {
  const { data, error } = await admin.from('trip_departures')
    .select('seats_booked').eq('id', departureId).maybeSingle();
  expect(error).toBeNull();
  return Number(data?.seats_booked ?? -1);
}

/** 把團次的名額狀態還原成乾淨起點（每個案例自理，不動共用種子） */
async function resetDeparture(departureId: string, capacity: number): Promise<void> {
  const { error } = await admin.from('trip_departures')
    .update({ seats_booked: 0, capacity, status: 'OPEN' }).eq('id', departureId);
  expect(error).toBeNull();
}

/** 本檔建立的訂單一律清掉，避免污染後續測試與殘留檢查 */
const createdOrderIds: string[] = [];

async function createOrder(
  api: AuthedApi, departureId: string, partySize: number, note = '',
): Promise<Response> {
  return api.post('/api/tour-orders/manual', {
    departureId,
    customerName: `測試顧客-${randomUUID().slice(0, 8)}`,
    customerPhone: '0912345678',
    partySize,
    note,
  });
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
  ownerB = await loginAs(SHOP_B.owner.email, SHOP_B.owner.password);
});

afterEach(async () => {
  if (createdOrderIds.length) {
    await admin.from('tour_orders').delete().in('id', createdOrderIds);
    createdOrderIds.length = 0;
  }
});

describe('建單佔名額，且名額由 DB 原子扣減', () => {
  it('建立訂單後 seats_booked 恰好 +partySize，金額由方案價格算出', async () => {
    await resetDeparture(TRIP_A.departure1, 10);
    const before = await dbSeats(TRIP_A.departure1);

    const res = await createOrder(ownerA, TRIP_A.departure1, 3, '整合測試');
    expect(res.status).toBe(200);
    const order = (await json<any>(res)).data!;
    createdOrderIds.push(order.id);

    expect(order.orderNo).toMatch(/^TO\d{10}$/);
    expect(order.partySize).toBe(3);
    expect(order.status).toBe('PENDING');
    expect(order.paymentStatus).toBe('UNPAID');
    expect(order.source).toBe('MANUAL');
    // 手動單不自動過期（10 分冊 §3 的表格）
    expect(order.holdExpiresAt).toBeNull();
    expect(order.totalAmount).toBe(order.unitPrice * 3);
    expect(order.note).toBe('整合測試');
    // 關聯值真的補齊了（不是空字串佔位）
    expect(order.tripTitle.length).toBeGreaterThan(0);
    expect(order.planName.length).toBeGreaterThan(0);
    expect(order.departsOn.length).toBeGreaterThan(0);

    expect(await dbSeats(TRIP_A.departure1)).toBe(before + 3);
  });

  it('人數超過剩餘名額 → 409 TOUR_001，且 seats_booked 一個都沒動', async () => {
    await resetDeparture(TRIP_A.departureCap2, 2);
    const res = await createOrder(ownerA, TRIP_A.departureCap2, 3);
    expect(res.status).toBe(409);
    expect((await json(res)).code).toBe('TOUR_001');
    // ⚠️ 這一條才是重點：失敗時不得留下任何扣減
    expect(await dbSeats(TRIP_A.departureCap2)).toBe(0);
  });

  it('CLOSED 的團次不接受新訂單，且不扣名額', async () => {
    await resetDeparture(TRIP_A.departure2, 10);
    const { error } = await admin.from('trip_departures')
      .update({ status: 'CLOSED' }).eq('id', TRIP_A.departure2);
    expect(error).toBeNull();
    try {
      const res = await createOrder(ownerA, TRIP_A.departure2, 1);
      expect(res.status).toBe(409);
      expect(await dbSeats(TRIP_A.departure2)).toBe(0);
    } finally {
      await resetDeparture(TRIP_A.departure2, 10);
    }
  });

  it('別家店的團次 → 404，且不扣名額', async () => {
    await resetDeparture(TRIP_A.departure1, 10);
    const res = await createOrder(ownerB, TRIP_A.departure1, 1);
    // SHOP_B 沒有 TOUR_MODULE 訂閱時會先被閘門擋在 403；有訂閱時才走到 404。
    // 兩者都必須「不成功」，且**名額一個都不能動**——那才是租戶隔離要保證的事。
    expect([403, 404]).toContain(res.status);
    expect(await dbSeats(TRIP_A.departure1)).toBe(0);
  });
});

describe('並發搶最後名額，恰好一成一敗（12 分冊 §5 樣板）', () => {
  it('兩個並發建單各要 2 席、只夠一單 → 一個 200 一個 409 TOUR_001', async () => {
    await resetDeparture(TRIP_A.departureCap2, 2);

    const [r1, r2] = await Promise.all([
      createOrder(ownerA, TRIP_A.departureCap2, 2),
      createOrder(ownerA, TRIP_A.departureCap2, 2),
    ]);

    const codes = [r1.status, r2.status].sort();
    // 恰好一成一敗：不能兩敗（過度保守，賣不出去），也不能兩成（超賣）
    expect(codes).toEqual([200, 409]);

    const winner = r1.status === 200 ? r1 : r2;
    const loser = r1.status === 409 ? r1 : r2;
    const winnerBody = await json<any>(winner);
    createdOrderIds.push(winnerBody.data!.id);
    expect((await json(loser)).code).toBe('TOUR_001');

    // seats_booked 恰為 2 —— 不是 4（超賣），也不是 0（贏家沒扣到）
    expect(await dbSeats(TRIP_A.departureCap2)).toBe(2);

    // 而且資料庫裡真的只有一筆訂單
    const { data: orders, error } = await admin.from('tour_orders')
      .select('id').eq('departure_id', TRIP_A.departureCap2).eq('status', 'PENDING');
    expect(error).toBeNull();
    expect(orders).toHaveLength(1);
  });
});

describe('狀態機：confirm-payment → complete，與取消釋放名額', () => {
  it('PENDING → CONFIRMED（付款狀態轉 PAID、保留期限清空）→ COMPLETED，名額全程不釋放', async () => {
    await resetDeparture(TRIP_A.departure1, 10);
    const created = await createOrder(ownerA, TRIP_A.departure1, 2);
    expect(created.status).toBe(200);
    const id = (await json<any>(created)).data!.id;
    createdOrderIds.push(id);
    expect(await dbSeats(TRIP_A.departure1)).toBe(2);

    const confirmed = await ownerA.post(`/api/tour-orders/${id}/confirm-payment`);
    expect(confirmed.status).toBe(200);
    const afterConfirm = (await json<any>(confirmed)).data!;
    expect(afterConfirm.status).toBe('CONFIRMED');
    expect(afterConfirm.paymentStatus).toBe('PAID');
    expect(afterConfirm.holdExpiresAt).toBeNull();
    expect(await dbSeats(TRIP_A.departure1)).toBe(2);

    // ⚠️ 「已付款」必須連同實收金額一起落庫。只翻旗標的話，資料庫裡會出現一筆
    // paymentStatus=PAID 而 paid_amount=0 的訂單——畫面說收到錢了，沒有任何金額佐證。
    // 這一條是本輪被 CI 的 23514 抓出來的（見 0087 的「實收金額」段）。
    const { data: paidRow, error: paidError } = await admin.from('tour_orders')
      .select('paid_amount, total_amount').eq('id', id).maybeSingle();
    expect(paidError).toBeNull();
    expect(Number(paidRow!.paid_amount)).toBe(Number(paidRow!.total_amount));
    expect(Number(paidRow!.paid_amount)).toBeGreaterThan(0);

    // 重複確認 → 409（不是靜默成功：店家按下去沒發生他以為會發生的事）
    expect((await ownerA.post(`/api/tour-orders/${id}/confirm-payment`)).status).toBe(409);

    const completed = await ownerA.post(`/api/tour-orders/${id}/complete`);
    expect(completed.status).toBe(200);
    expect((await json<any>(completed)).data!.status).toBe('COMPLETED');
    // 團已經出過了，席次本來就被消耗掉——完成**不得**釋放名額
    expect(await dbSeats(TRIP_A.departure1)).toBe(2);
  });

  it('PENDING 直接 complete → 409（必須先確認收款）', async () => {
    await resetDeparture(TRIP_A.departure1, 10);
    const created = await createOrder(ownerA, TRIP_A.departure1, 1);
    const id = (await json<any>(created)).data!.id;
    createdOrderIds.push(id);
    expect((await ownerA.post(`/api/tour-orders/${id}/complete`)).status).toBe(409);
    expect(await dbSeats(TRIP_A.departure1)).toBe(1);
  });

  it('取消釋放名額；重複取消回 409 且**不再釋放一次**', async () => {
    await resetDeparture(TRIP_A.departure1, 10);
    const created = await createOrder(ownerA, TRIP_A.departure1, 4);
    const id = (await json<any>(created)).data!.id;
    createdOrderIds.push(id);
    expect(await dbSeats(TRIP_A.departure1)).toBe(4);

    const cancelled = await ownerA.post(`/api/tour-orders/${id}/cancel`, { reason: '顧客改期' });
    expect(cancelled.status).toBe(200);
    const afterCancel = (await json<any>(cancelled)).data!;
    expect(afterCancel.status).toBe('CANCELLED');
    expect(await dbSeats(TRIP_A.departure1)).toBe(0);

    // ⚠️ 這一條防的是「名額憑空多出來」：重複取消若又釋放一次，
    // seats_booked 會被壓到負數或讓已客滿的團看起來有空位。
    const again = await ownerA.post(`/api/tour-orders/${id}/cancel`, { reason: '再按一次' });
    expect(again.status).toBe(409);
    expect(await dbSeats(TRIP_A.departure1)).toBe(0);
  });

  it('已完成的訂單不能再取消（終態），名額也不釋放', async () => {
    await resetDeparture(TRIP_A.departure1, 10);
    const created = await createOrder(ownerA, TRIP_A.departure1, 2);
    const id = (await json<any>(created)).data!.id;
    createdOrderIds.push(id);
    await ownerA.post(`/api/tour-orders/${id}/confirm-payment`);
    await ownerA.post(`/api/tour-orders/${id}/complete`);

    expect((await ownerA.post(`/api/tour-orders/${id}/cancel`, {})).status).toBe(409);
    expect(await dbSeats(TRIP_A.departure1)).toBe(2);
  });

  it('取消已付款的訂單**不會**自動改成 REFUNDED（10 分冊 §3：已付款須人工退款）', async () => {
    await resetDeparture(TRIP_A.departure1, 10);
    const created = await createOrder(ownerA, TRIP_A.departure1, 1);
    const id = (await json<any>(created)).data!.id;
    createdOrderIds.push(id);
    await ownerA.post(`/api/tour-orders/${id}/confirm-payment`);

    const cancelled = await ownerA.post(`/api/tour-orders/${id}/cancel`, { reason: '天候取消' });
    expect(cancelled.status).toBe(200);
    const after = (await json<any>(cancelled)).data!;
    expect(after.status).toBe('CANCELLED');
    // 錢還在店家手上，導遊必須看得到「這筆要退」。自動改 REFUNDED 是宣稱一件沒發生的事。
    expect(after.paymentStatus).toBe('PAID');
    expect(await dbSeats(TRIP_A.departure1)).toBe(0);
  });
});

describe('列表、詳情與租戶隔離', () => {
  it('列表可依 status 篩選、依 keyword 搜尋訂單編號，且只回自己租戶的單', async () => {
    await resetDeparture(TRIP_A.departure1, 10);
    const created = await createOrder(ownerA, TRIP_A.departure1, 1);
    const order = (await json<any>(created)).data!;
    createdOrderIds.push(order.id);

    const list = await ownerA.get('/api/tour-orders?status=PENDING&size=50');
    expect(list.status).toBe(200);
    const paged = (await json<any>(list)).data!;
    expect(paged.number).toBe(0);
    expect(paged.content.some((o: any) => o.id === order.id)).toBe(true);
    expect(paged.content.every((o: any) => o.status === 'PENDING')).toBe(true);

    const searched = await ownerA.get(`/api/tour-orders?keyword=${order.orderNo}`);
    expect((await json<any>(searched)).data!.content.map((o: any) => o.id)).toEqual([order.id]);

    // 別家店看不到，也不能透過 id 直接讀
    const otherList = await ownerB.get('/api/tour-orders?size=50');
    if (otherList.status === 200) {
      const otherPaged = (await json<any>(otherList)).data!;
      expect(otherPaged.content.some((o: any) => o.id === order.id)).toBe(false);
    }
    const cross = await ownerB.get(`/api/tour-orders/${order.id}`);
    expect(cross.status).toBe(404);
    expect((await json(cross)).code).toBe('REQ_002');
  });

  it('未登入一律 401 AUTH_001', async () => {
    const res = await fetch(`${BASE}/api/tour-orders`);
    expect(res.status).toBe(401);
    expect((await json(res)).code).toBe('AUTH_001');
  });
});

describe('TOUR_MODULE 未訂閱時，寫入被擋而讀取仍可用', () => {
  it('停用訂閱 → 建單／確認／完成／取消全部 403 FEAT_001，但清單仍回 200', async () => {
    await resetDeparture(TRIP_A.departure1, 10);
    const created = await createOrder(ownerA, TRIP_A.departure1, 1);
    expect(created.status).toBe(200);
    const id = (await json<any>(created)).data!.id;
    createdOrderIds.push(id);

    const { error: deleteError } = await admin.from('feature_subscriptions').delete()
      .eq('tenant_id', SHOP_A.id).eq('code', 'TOUR_MODULE');
    expect(deleteError).toBeNull();
    try {
      for (const request of [
        () => createOrder(ownerA, TRIP_A.departure1, 1),
        () => ownerA.post(`/api/tour-orders/${id}/confirm-payment`),
        () => ownerA.post(`/api/tour-orders/${id}/complete`),
        () => ownerA.post(`/api/tour-orders/${id}/cancel`, {}),
      ]) {
        const res = await request();
        expect(res.status).toBe(403);
        expect((await json(res)).code).toBe('FEAT_001');
      }
      // 名額沒有因為被擋下的請求而改變
      expect(await dbSeats(TRIP_A.departure1)).toBe(1);

      // 讀取面刻意不帶閘門：退訂後店家仍讀得到自己的歷史訂單
      expect((await ownerA.get('/api/tour-orders')).status).toBe(200);
      expect((await ownerA.get(`/api/tour-orders/${id}`)).status).toBe(200);
    } finally {
      const { error } = await admin.from('feature_subscriptions').upsert({
        tenant_id: SHOP_A.id, code: 'TOUR_MODULE', active: true,
        expires_at: null, source: 'GRANTED', cancelled_at: null,
      }, { onConflict: 'tenant_id,code' });
      expect(error).toBeNull();
    }
  });

  it('已登入使用者不得直接對 tour_orders 做 REST DML（繞過路由閘門）', async () => {
    const anon = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await anon.from('tour_orders').insert({
      tenant_id: SHOP_A.id, order_no: `X${Date.now()}`, trip_id: TRIP_A.id,
      plan_id: TRIP_A.planA1, departure_id: TRIP_A.departure1,
      party_size: 1, unit_price: 1, total_amount: 1, source: 'MANUAL',
    });
    expect(error).not.toBeNull();
  });
});
