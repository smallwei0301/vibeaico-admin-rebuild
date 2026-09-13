/**
 * 逾期釋位 cron 的真實資料驗收（issue #350；來源 PR #271 Final Risk MAJOR-1）
 * -----------------------------------------------------------------------------
 * #350 指出：cron 先前**只有字串斷言**（tests/unit/tour-order-lifecycle.08.test.ts
 * 讀 route 原始碼比對字串），從來沒有跑過真實資料。那正是這個缺陷活下來的原因——
 * 舊斷言寫的是 `rpc('cancel_tour_order')`，等於把缺陷鎖成了「正確」。
 *
 * 缺陷本身：`cancel_tour_order` 的終態守門是
 *     if v_order.status in ('CANCELLED', 'COMPLETED') then return false;
 * **`CONFIRMED` 不在其中。** cron 的 select 與 rpc 執行之間有時間差，一筆在這段
 * 時間內被收款（PENDING → CONFIRMED / PAID）的訂單，仍然會被 cron 以「未在保留
 * 期限內完成付款」取消並釋放名額——店家的錢已經收了，席次卻放回去可以再賣。
 *
 * 所以本檔的兩條主案例是一組對照，缺一不可：
 *   ① 仍然逾期未付款 → cron **必須**取消、**必須**釋放名額
 *   ② 執行前已被改成 CONFIRMED → cron **不得**取消、**不得**釋放名額
 * 只有 ① 的話，把 expire_tour_order 換回 cancel_tour_order 測試照樣全綠。
 *
 * ⚠️ 一律直查 DB 驗 `seats_booked` 與 `status`，不只看 cron 回的 { scanned, cancelled }。
 * 「回報 cancelled: 1 但名額沒放」與「回報 0 卻已經放了」都會讓只看回傳值的測試
 * 全綠，而那正是本專案一直在修的那種假成功。
 */
import { describe, expect, it, beforeAll, afterEach } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { SHOP_A, TRIP_A } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };
const BASE = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';

/**
 * cron 的 Bearer 必須跟 global-setup 餵給 dev server 的是同一個值。
 *
 * `tests/integration/global-setup.ts` 啟 dev server 時設的是
 * `CRON_SECRET: process.env.TEST_CRON_SECRET ?? ''`，而 CI（.github/workflows/ci.yml）
 * 只匯出 `TEST_CRON_SECRET`。本機因為 `.env.local` 裡有 `CRON_SECRET` 才剛好能跑——
 * 只讀 `process.env.CRON_SECRET` 的話，本機全綠、CI 一路 401。
 */
const CRON_SECRET = process.env.TEST_CRON_SECRET ?? process.env.CRON_SECRET ?? '';

let admin: SupabaseClient;
let ownerA: AuthedApi;

const createdOrderIds: string[] = [];

async function dbSeats(departureId: string): Promise<number> {
  const { data, error } = await admin.from('trip_departures')
    .select('seats_booked').eq('id', departureId).maybeSingle();
  expect(error).toBeNull();
  return Number(data?.seats_booked ?? -1);
}

async function dbOrder(id: string) {
  const { data, error } = await admin.from('tour_orders')
    .select('status, payment_status, cancel_reason, hold_expires_at, total_amount, paid_amount')
    .eq('id', id).maybeSingle();
  expect(error).toBeNull();
  return data!;
}

/**
 * 把訂單標成「已收款」。
 *
 * ⚠️ 必須同時寫 `paid_amount = total_amount`。`tour_orders` 上有
 * `check (payment_status <> 'PAID' or paid_amount = total_amount)`——一筆
 * `payment_status = 'PAID'` 而 `paid_amount = 0` 的訂單會被擋成 23514。
 *
 * 那個約束是對的，本檔第一版就是因為少寫金額而被它擋下來。「畫面說收到錢了、
 * 資料庫裡沒有任何金額佐證」正是本專案一直在修的那種假宣稱；繞過約束來讓測試
 * 通過，等於用假資料去驗一個關於真錢的不變量。
 */
async function markPaid(id: string, extra: Record<string, unknown> = {}): Promise<void> {
  const { total_amount } = await dbOrder(id);
  const { error } = await admin.from('tour_orders')
    .update({ status: 'CONFIRMED', payment_status: 'PAID', paid_amount: total_amount, ...extra })
    .eq('id', id);
  expect(error).toBeNull();
}

async function resetDeparture(departureId: string, capacity: number): Promise<void> {
  const { error } = await admin.from('trip_departures')
    .update({ seats_booked: 0, capacity, status: 'OPEN' }).eq('id', departureId);
  expect(error).toBeNull();
}

/**
 * 建一筆訂單並把它推成「已逾期的 PENDING」。
 *
 * manual 建單固定送 p_hold_expires = null（正式環境目前也是如此），所以逾期狀態
 * 只能由測試自己造。這正是 #350 說的「這條 race 目前不可達、但綠界／匯款建單落地
 * 當下就會變成可達」——本檔提前把那個未來狀態做出來驗。
 */
async function createExpiredPendingOrder(partySize: number): Promise<string> {
  const res = await ownerA.post('/api/tour-orders/manual', {
    departureId: TRIP_A.departure1,
    customerName: `逾期測試-${randomUUID().slice(0, 8)}`,
    customerPhone: '0912345678',
    partySize,
    note: '#350 cron 驗收',
  });
  expect(res.status).toBe(200);
  const order = ((await res.json()) as Envelope<any>).data!;
  createdOrderIds.push(order.id);

  const { error } = await admin.from('tour_orders')
    .update({ hold_expires_at: new Date(Date.now() - 60_000).toISOString() })
    .eq('id', order.id);
  expect(error).toBeNull();
  return order.id;
}

async function runCron(): Promise<{ scanned: number; cancelled: number }> {
  const res = await fetch(`${BASE}/api/cron/tour-order-expiry`, {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as { scanned: number; cancelled: number };
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(CRON_SECRET).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
});

afterEach(async () => {
  if (createdOrderIds.length) {
    await admin.from('tour_orders').delete().in('id', createdOrderIds);
    createdOrderIds.length = 0;
  }
  /**
   * ⚠️ 刪訂單**不會**把名額還回去——`seats_booked` 在 `trip_departures` 上，
   * 沒有任何 FK 或 trigger 會連動。只刪訂單就收工，會把非零的 `seats_booked`
   * 留給下一個測試檔。
   *
   * 這是實測踩到的：本檔單獨跑全綠、`tour-orders.10` 單獨跑也全綠，但兩個一起跑
   * 時 `tour-orders.10` 紅 6 條——因為本檔先跑，留下 2 個被佔用的席次。測試不該
   * 依賴執行順序，所以把團次還原成種子狀態（capacity 10、seats_booked 0、OPEN）。
   */
  await resetDeparture(TRIP_A.departure1, 10);
});

describe('#350 逾期釋位 cron（真實資料，非字串斷言）', () => {
  it('① 仍然逾期未付款 → 取消且釋放名額', async () => {
    await resetDeparture(TRIP_A.departure1, 10);
    const id = await createExpiredPendingOrder(3);
    expect(await dbSeats(TRIP_A.departure1)).toBe(3);

    const result = await runCron();
    expect(result.cancelled).toBeGreaterThanOrEqual(1);

    const after = await dbOrder(id);
    expect(after.status).toBe('CANCELLED');
    expect(after.cancel_reason).toContain('未在保留期限內完成付款');
    // 證據在 DB，不在回傳值
    expect(await dbSeats(TRIP_A.departure1)).toBe(0);
  });

  /**
   * ② **這是本檔唯一對 `status = 'PENDING'` 守門敏感的測試**，而且它必須直接呼叫
   * RPC，不能走 cron。
   *
   * 原因是：cron 的 select 自己帶 `.eq('status', 'PENDING')`，一筆已經變成
   * CONFIRMED 的訂單**根本不會進 batch**，RPC 連呼叫都不會被呼叫到。所以任何
   * 「打 cron 端點、期待它不要取消 CONFIRMED 訂單」的測試，在把 RPC 的 PENDING
   * 守門拿掉之後**照樣會綠**——它證明的是 route filter 有效，不是守門有效。
   *
   * 而 #350 要修的正是 select 與 RPC 之間的時間差：cron 撈到它時是 PENDING，
   * 執行 RPC 時已經不是。那個交錯無法用 HTTP 測試確定性地造出來，只能把 RPC
   * 放在鎖底下重新驗，並在這裡直接呼叫它來證明那道驗證真的存在。
   *
   * 變異驗證：拿掉 RPC 的 `status = 'PENDING'`，這一條會轉紅（released 變成 true、
   * 名額被釋放）。
   */
  it('② 狀態已非 PENDING（期限欄位仍在）→ RPC 回 false，不改狀態也不釋放名額', async () => {
    await resetDeparture(TRIP_A.departure1, 10);
    const id = await createExpiredPendingOrder(2);
    expect(await dbSeats(TRIP_A.departure1)).toBe(2);

    // 只改狀態與金額，hold_expires_at 維持已過期——只有 PENDING 守門能擋下它。
    // 這不是為測試捏造的狀態：#350 指出第一個寫入 hold_expires_at 的切片
    // （綠界／匯款建單）就是這條 race 變成可達的時點，而那條付款回呼會不會一併
    // 清掉 hold_expires_at 現在還沒有人寫。守門必須各自獨立成立。
    await markPaid(id);
    expect((await dbOrder(id)).hold_expires_at).not.toBeNull();

    const { data: released, error } = await admin.rpc('expire_tour_order', {
      p_tenant: SHOP_A.id,
      p_order: id,
      p_reason: '不該生效的取消',
    });
    expect(error).toBeNull();
    expect(released).toBe(false);

    const after = await dbOrder(id);
    expect(after.status).toBe('CONFIRMED');
    expect(after.payment_status).toBe('PAID');
    expect(after.cancel_reason ?? '').not.toContain('未在保留期限內完成付款');
    // 名額必須仍被這筆已收款的訂單佔著——放掉就等於可以重複販售同一個席次
    expect(await dbSeats(TRIP_A.departure1)).toBe(2);
  });

  /**
   * ③ 走**真實** confirm-payment 路由，驗證端到端也關上了。
   *
   * 這是寫實案例：confirm-payment 會一併清掉 hold_expires_at，所以兩道守門加上
   * cron 的 route filter 都會擋。正因如此它對單一守門的變異**不敏感**——那是 ②
   * 的工作。保留它是為了擋住「有人把 route filter 拿掉」這類迴歸。
   */
  it('③ 真實 confirm-payment 之後執行 cron → 訂單與名額都不動', async () => {
    await resetDeparture(TRIP_A.departure1, 10);
    const id = await createExpiredPendingOrder(2);

    const res = await ownerA.post(`/api/tour-orders/${id}/confirm-payment`, {});
    expect(res.status).toBe(200);

    const confirmed = await dbOrder(id);
    expect(confirmed.status).toBe('CONFIRMED');
    expect(confirmed.payment_status).toBe('PAID');
    expect(confirmed.paid_amount).toBe(confirmed.total_amount);
    expect(confirmed.hold_expires_at).toBeNull();

    await runCron();

    expect((await dbOrder(id)).status).toBe('CONFIRMED');
    expect(await dbSeats(TRIP_A.departure1)).toBe(2);
  });

  it('④ hold_expires_at 為 null（LINE／手動單）→ 永遠不被 cron 取消', async () => {
    await resetDeparture(TRIP_A.departure1, 10);
    const res = await ownerA.post('/api/tour-orders/manual', {
      departureId: TRIP_A.departure1,
      customerName: `無期限-${randomUUID().slice(0, 8)}`,
      customerPhone: '0912345678',
      partySize: 2,
      note: '#350 無期限單',
    });
    expect(res.status).toBe(200);
    const order = ((await res.json()) as Envelope<any>).data!;
    createdOrderIds.push(order.id);
    expect(order.holdExpiresAt ?? null).toBeNull();

    await runCron();

    expect((await dbOrder(order.id)).status).toBe('PENDING');
    expect(await dbSeats(TRIP_A.departure1)).toBe(2);
  });

  it('⑤ 沒有 Bearer 的請求被擋下（cron 端點等同批次取消）', async () => {
    const res = await fetch(`${BASE}/api/cron/tour-order-expiry`);
    expect(res.status).toBe(401);
  });
});
