/**
 * GUIDE 側接受／拒絕 REQUEST 訂單 — HTTP 驗收（issue #46）
 * -----------------------------------------------------------------------------
 * 這一檔的靈魂是 `docs/integration/18-GUIDE-COMMERCE-LIFECYCLE.md` §0.2 那句
 * 「REQUEST 旅客送出申請時不鎖導遊時間；導遊接受時才原子重查 availability
 * 並建立／鎖定私人 Departure」——以及 `0111` migration 修正的那個「假成功」：
 * 修法之前 `create_tour_order` 對所有 sales_mode 一律 `reserve_seats`，
 * REQUEST 訂單在送出申請的當下就已經佔著名額。
 *
 * 每一條狀態轉換都**用 service role 直查 `trip_departures.seats_booked`**，
 * 不只看 HTTP 狀態碼——同 `tour-orders.10.test.ts` 的既有紀律。
 *
 * 這裡把 `TRIP_A.planA1` 暫時改成 `sales_mode = 'REQUEST'` 來建 REQUEST 訂單
 * （fixtures 目前沒有專用的 REQUEST 方案），每個案例自理，afterEach 一律
 * 還原，不動共用種子。
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

async function dbSeats(departureId: string): Promise<number> {
  const { data, error } = await admin.from('trip_departures')
    .select('seats_booked').eq('id', departureId).maybeSingle();
  expect(error).toBeNull();
  return Number(data?.seats_booked ?? -1);
}

async function resetDeparture(departureId: string, capacity: number): Promise<void> {
  const { error } = await admin.from('trip_departures')
    .update({ seats_booked: 0, capacity, status: 'OPEN' }).eq('id', departureId);
  expect(error).toBeNull();
}

/** 把 planA1 切成 REQUEST 方案，回傳一個把它切回 FIXED_DEPARTURE 的還原函式 */
async function setPlanRequestMode(
  planId: string, mode: 'REQUEST' | 'FIXED_DEPARTURE', holdHours?: number,
): Promise<void> {
  const patch: Record<string, unknown> = { sales_mode: mode };
  if (holdHours !== undefined) patch.request_hold_hours = holdHours;
  const { data, error } = await admin.from('trip_plans').update(patch)
    .eq('tenant_id', SHOP_A.id).eq('id', planId).select('sales_mode, request_hold_hours').single();
  expect(error).toBeNull();
  expect(data?.sales_mode).toBe(mode);
  if (holdHours !== undefined) expect(Number(data?.request_hold_hours)).toBe(holdHours);
}

const createdOrderIds: string[] = [];
const createdOrderNotes: string[] = [];

async function createOrder(
  api: AuthedApi, departureId: string, partySize: number, note = '',
): Promise<Response> {
  // Register ownership before the request: a failed response can still have
  // committed a real order. Never infer ownership from a shared tenant alone.
  const marker = `request-accept-46-${randomUUID()}${note ? ` ${note}` : ''}`;
  createdOrderNotes.push(marker);
  return api.post('/api/tour-orders/manual', {
    departureId,
    customerName: `測試顧客-${randomUUID().slice(0, 8)}`,
    customerPhone: '0912345678',
    partySize,
    note: marker,
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

afterEach(async ({ task }) => {
  const errors: unknown[] = [];
  if (admin && createdOrderNotes.length) {
    try {
      const owned = await admin.from('tour_orders').select('id')
        .eq('tenant_id', SHOP_A.id).in('note', [...createdOrderNotes]);
      if (owned.error) errors.push(owned.error);
      else {
        const foundIds = new Set((owned.data ?? []).map(row => row.id));
        if (createdOrderIds.length) {
          const recorded = await admin.from('tour_orders').select('id, tenant_id, note').in('id', [...createdOrderIds]);
          if (recorded.error) errors.push(recorded.error);
          else for (const row of recorded.data ?? []) {
            if (row.tenant_id !== SHOP_A.id || !createdOrderNotes.includes(row.note)) {
              errors.push(new Error(`order ${row.id}: recorded ID lacks this suite's exact owned marker`));
            }
          }
        }
        for (const id of foundIds) if (!createdOrderIds.includes(id)) createdOrderIds.push(id);
        // Exact registered notes only; no broad deletion of shared fixture orders.
        const deleted = await admin.from('tour_orders').delete()
          .eq('tenant_id', SHOP_A.id).in('note', [...createdOrderNotes]);
        if (deleted.error) errors.push(deleted.error);
      }
      const remaining = await admin.from('tour_orders').select('id')
        .eq('tenant_id', SHOP_A.id).in('note', [...createdOrderNotes]);
      if (remaining.error) errors.push(remaining.error);
      else if (remaining.data?.length) errors.push(new Error('REQUEST owned order marker residue after cleanup'));
      if (createdOrderIds.length) {
        const remainingIds = await admin.from('tour_orders').select('id').in('id', [...createdOrderIds]);
        if (remainingIds.error) errors.push(remainingIds.error);
        else if (remainingIds.data?.length) errors.push(new Error('REQUEST recorded owned order IDs remain after cleanup'));
      }
    } catch (error) { errors.push(error); }
  }
  // Restore both plans even if order cleanup failed; each update verifies its
  // persisted readback. Keep ownership arrays if any cleanup/restoration fails.
  if (admin) for (const plan of [TRIP_A.planA1, TRIP_A.planA2]) {
    try { await setPlanRequestMode(plan, 'FIXED_DEPARTURE', 12); }
    catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError([...(task.result?.errors ?? []), ...errors], '#46 REQUEST cleanup/restoration failed');
  createdOrderIds.length = 0;
  createdOrderNotes.length = 0;
});

describe('REQUEST 訂單送出申請時不鎖名額（18 分冊 §0.2；0111 修正的假成功）', () => {
  it('建立 REQUEST 訂單後 seats_booked 完全不動，訂單以 PENDING／seats_reserved=false 入列', async () => {
    await resetDeparture(TRIP_A.departure1, 10);
    await setPlanRequestMode(TRIP_A.planA1, 'REQUEST');
    const before = await dbSeats(TRIP_A.departure1);

    const res = await createOrder(ownerA, TRIP_A.departure1, 2);
    expect(res.status).toBe(200);
    const order = (await json<any>(res)).data!;
    createdOrderIds.push(order.id);

    expect(order.status).toBe('PENDING');
    // ⚠️ 這一條是本輪要修的假成功：修法之前這裡會是 before + 2。
    expect(await dbSeats(TRIP_A.departure1)).toBe(before);

    const { data: row, error } = await admin.from('tour_orders')
      .select('seats_reserved').eq('id', order.id).maybeSingle();
    expect(error).toBeNull();
    expect(row!.seats_reserved).toBe(false);
  });

  it('非 REQUEST 方案（FIXED_DEPARTURE）維持原行為：建單當下就鎖名額', async () => {
    await resetDeparture(TRIP_A.departure1, 10);
    const before = await dbSeats(TRIP_A.departure1);
    const res = await createOrder(ownerA, TRIP_A.departure1, 2);
    expect(res.status).toBe(200);
    const order = (await json<any>(res)).data!;
    createdOrderIds.push(order.id);
    expect(await dbSeats(TRIP_A.departure1)).toBe(before + 2);

    const { data: row, error } = await admin.from('tour_orders')
      .select('seats_reserved').eq('id', order.id).maybeSingle();
    expect(error).toBeNull();
    expect(row!.seats_reserved).toBe(true);
  });
});

describe('導遊接受 REQUEST 訂單（accept）', () => {
  it('接受成功：鎖名額、hold_expires_at 用 plan 預設算出、狀態轉 CONFIRMED', async () => {
    await resetDeparture(TRIP_A.departure1, 10);
    await setPlanRequestMode(TRIP_A.planA1, 'REQUEST', 12);
    const before = await dbSeats(TRIP_A.departure1);

    const created = await createOrder(ownerA, TRIP_A.departure1, 3);
    const order = (await json<any>(created)).data!;
    createdOrderIds.push(order.id);
    expect(await dbSeats(TRIP_A.departure1)).toBe(before);

    const beforeAcceptAt = Date.now();
    const accepted = await ownerA.post(`/api/tour-orders/${order.id}/accept`, {});
    expect(accepted.status).toBe(200);
    const afterAccept = (await json<any>(accepted)).data!;
    expect(afterAccept.status).toBe('CONFIRMED');
    expect(afterAccept.holdExpiresAt).not.toBeNull();

    // 12 小時預設：允許測試執行本身花費的秒級誤差。
    const expiresAt = new Date(afterAccept.holdExpiresAt).getTime();
    const expectedMs = beforeAcceptAt + 12 * 60 * 60 * 1000;
    expect(Math.abs(expiresAt - expectedMs)).toBeLessThan(60_000);

    // 名額在接受這一刻才真的被鎖。
    expect(await dbSeats(TRIP_A.departure1)).toBe(before + 3);

    const { data: row, error } = await admin.from('tour_orders')
      .select('seats_reserved').eq('id', order.id).maybeSingle();
    expect(error).toBeNull();
    expect(row!.seats_reserved).toBe(true);
  });

  it('接受時可覆寫保留時數（holdHours），Plan 預設值不受影響', async () => {
    await resetDeparture(TRIP_A.departure1, 10);
    await setPlanRequestMode(TRIP_A.planA1, 'REQUEST', 12);
    const created = await createOrder(ownerA, TRIP_A.departure1, 1);
    const order = (await json<any>(created)).data!;
    createdOrderIds.push(order.id);

    const beforeAcceptAt = Date.now();
    const accepted = await ownerA.post(`/api/tour-orders/${order.id}/accept`, { holdHours: 1 });
    expect(accepted.status).toBe(200);
    const afterAccept = (await json<any>(accepted)).data!;
    const expiresAt = new Date(afterAccept.holdExpiresAt).getTime();
    expect(Math.abs(expiresAt - (beforeAcceptAt + 60 * 60 * 1000))).toBeLessThan(60_000);

    // Plan 的預設值本身沒被這次覆寫動到。
    const { data: plan, error } = await admin.from('trip_plans')
      .select('request_hold_hours').eq('id', TRIP_A.planA1).maybeSingle();
    expect(error).toBeNull();
    expect(Number(plan!.request_hold_hours)).toBe(12);
  });

  it('重查名額時已被別的案件用掉 → 409 TOUR_001，且不改動任何資料', async () => {
    await resetDeparture(TRIP_A.departureCap2, 2);
    // departureCap2 的 plan_id 是 planA2（見 scripts/test/seed.mjs），不是
    // planA1——這裡切成 REQUEST 的必須是 departureCap2 實際所屬的方案。
    await setPlanRequestMode(TRIP_A.planA2, 'REQUEST');

    // departureCap2 容量剛好 2：用 admin 直接佔滿，模擬「這段時間被別的
    // （非 REQUEST）訂單佔走」，再讓 REQUEST 訂單去搶。
    const { error: occupyError } = await admin.from('trip_departures')
      .update({ seats_booked: 2 }).eq('id', TRIP_A.departureCap2);
    expect(occupyError).toBeNull();

    // REQUEST 建單當下不檢查容量（不鎖名額），所以即使已經滿團，送出申請仍然成功——
    // 這正是「送出申請不鎖時間」的另一面：導遊接受前，容量狀態對申請本身不是門檻。
    const created = await createOrder(ownerA, TRIP_A.departureCap2, 1);
    expect(created.status).toBe(200);
    const order = (await json<any>(created)).data!;
    createdOrderIds.push(order.id);
    expect(await dbSeats(TRIP_A.departureCap2)).toBe(2);

    const accepted = await ownerA.post(`/api/tour-orders/${order.id}/accept`, {});
    expect(accepted.status).toBe(409);
    expect((await json(accepted)).code).toBe('TOUR_001');

    // 失敗時完全不動資料：名額沒變、訂單仍是 PENDING。
    expect(await dbSeats(TRIP_A.departureCap2)).toBe(2);
    const { data: row, error } = await admin.from('tour_orders')
      .select('status, seats_reserved, hold_expires_at').eq('id', order.id).maybeSingle();
    expect(error).toBeNull();
    expect(row!.status).toBe('PENDING');
    expect(row!.seats_reserved).toBe(false);
    expect(row!.hold_expires_at).toBeNull();
  });

  it('對非 REQUEST 方案的訂單呼叫 accept → 409 TOUR_002，不改動任何資料', async () => {
    await resetDeparture(TRIP_A.departure1, 10);
    // planA1 維持預設 FIXED_DEPARTURE（afterEach 已還原），建的是一筆普通訂單。
    const created = await createOrder(ownerA, TRIP_A.departure1, 1);
    const order = (await json<any>(created)).data!;
    createdOrderIds.push(order.id);
    expect(await dbSeats(TRIP_A.departure1)).toBe(1);

    const accepted = await ownerA.post(`/api/tour-orders/${order.id}/accept`, {});
    expect(accepted.status).toBe(409);
    expect((await json(accepted)).code).toBe('TOUR_002');
    expect(await dbSeats(TRIP_A.departure1)).toBe(1); // 沒有被重複鎖一次

    const { data: row, error } = await admin.from('tour_orders')
      .select('status').eq('id', order.id).maybeSingle();
    expect(error).toBeNull();
    expect(row!.status).toBe('PENDING');
  });

  it('對已經是 CONFIRMED 的 REQUEST 訂單重複呼叫 accept → 409 TOUR_002', async () => {
    await resetDeparture(TRIP_A.departure1, 10);
    await setPlanRequestMode(TRIP_A.planA1, 'REQUEST');
    const created = await createOrder(ownerA, TRIP_A.departure1, 2);
    const order = (await json<any>(created)).data!;
    createdOrderIds.push(order.id);

    expect((await ownerA.post(`/api/tour-orders/${order.id}/accept`, {})).status).toBe(200);
    expect(await dbSeats(TRIP_A.departure1)).toBe(2);

    const again = await ownerA.post(`/api/tour-orders/${order.id}/accept`, {});
    expect(again.status).toBe(409);
    expect((await json(again)).code).toBe('TOUR_002');
    // 沒有重複鎖一次名額。
    expect(await dbSeats(TRIP_A.departure1)).toBe(2);
  });

  it('別家店的訂單 → 404，不改動任何資料', async () => {
    await resetDeparture(TRIP_A.departure1, 10);
    await setPlanRequestMode(TRIP_A.planA1, 'REQUEST');
    const created = await createOrder(ownerA, TRIP_A.departure1, 1);
    const order = (await json<any>(created)).data!;
    createdOrderIds.push(order.id);

    const res = await ownerB.post(`/api/tour-orders/${order.id}/accept`, {});
    expect([403, 404]).toContain(res.status);
    expect(await dbSeats(TRIP_A.departure1)).toBe(0);
    const { data: row, error } = await admin.from('tour_orders')
      .select('status').eq('id', order.id).maybeSingle();
    expect(error).toBeNull();
    expect(row!.status).toBe('PENDING');
  });
});

describe('導遊拒絕 REQUEST 訂單（reject）', () => {
  it('拒絕成功：狀態轉 CANCELLED，因為從未鎖過名額所以 seats_booked 完全不動', async () => {
    await resetDeparture(TRIP_A.departure1, 10);
    await setPlanRequestMode(TRIP_A.planA1, 'REQUEST');
    const before = await dbSeats(TRIP_A.departure1);
    const created = await createOrder(ownerA, TRIP_A.departure1, 2);
    const order = (await json<any>(created)).data!;
    createdOrderIds.push(order.id);
    expect(await dbSeats(TRIP_A.departure1)).toBe(before);

    const rejected = await ownerA.post(`/api/tour-orders/${order.id}/reject`, { reason: '時段衝突' });
    expect(rejected.status).toBe(200);
    const afterReject = (await json<any>(rejected)).data!;
    expect(afterReject.status).toBe('CANCELLED');
    // ⚠️ 這是修法後最容易錯的一條：如果 reject_tour_request 無條件 release_seats，
    // 這裡會變成 before - 2（憑空放出一個從未存在的名額）。
    expect(await dbSeats(TRIP_A.departure1)).toBe(before);
  });

  it('拒絕已被接受（CONFIRMED）的訂單 → 409 TOUR_002，名額不釋放（改走 /cancel）', async () => {
    await resetDeparture(TRIP_A.departure1, 10);
    await setPlanRequestMode(TRIP_A.planA1, 'REQUEST');
    const created = await createOrder(ownerA, TRIP_A.departure1, 2);
    const order = (await json<any>(created)).data!;
    createdOrderIds.push(order.id);
    expect((await ownerA.post(`/api/tour-orders/${order.id}/accept`, {})).status).toBe(200);
    expect(await dbSeats(TRIP_A.departure1)).toBe(2);

    const rejected = await ownerA.post(`/api/tour-orders/${order.id}/reject`, {});
    expect(rejected.status).toBe(409);
    expect((await json(rejected)).code).toBe('TOUR_002');
    // 已經鎖住的名額不因一次無效的 reject 呼叫而被放掉。
    expect(await dbSeats(TRIP_A.departure1)).toBe(2);
  });

  it('對非 REQUEST 方案的訂單呼叫 reject → 409 TOUR_002，名額不釋放', async () => {
    await resetDeparture(TRIP_A.departure1, 10);
    const created = await createOrder(ownerA, TRIP_A.departure1, 1);
    const order = (await json<any>(created)).data!;
    createdOrderIds.push(order.id);
    expect(await dbSeats(TRIP_A.departure1)).toBe(1);

    const rejected = await ownerA.post(`/api/tour-orders/${order.id}/reject`, {});
    expect(rejected.status).toBe(409);
    expect((await json(rejected)).code).toBe('TOUR_002');
    expect(await dbSeats(TRIP_A.departure1)).toBe(1);
  });

  it('別家店的訂單 → 404，不改動任何資料', async () => {
    await resetDeparture(TRIP_A.departure1, 10);
    await setPlanRequestMode(TRIP_A.planA1, 'REQUEST');
    const created = await createOrder(ownerA, TRIP_A.departure1, 1);
    const order = (await json<any>(created)).data!;
    createdOrderIds.push(order.id);

    const res = await ownerB.post(`/api/tour-orders/${order.id}/reject`, {});
    expect([403, 404]).toContain(res.status);
    const { data: row, error } = await admin.from('tour_orders')
      .select('status').eq('id', order.id).maybeSingle();
    expect(error).toBeNull();
    expect(row!.status).toBe('PENDING');
  });
});

describe('cancel_tour_order 對 seats_reserved 的守門（0111 Final Risk B1，claude-fable-5-1）', () => {
  it('取消一筆從未被接受的 PENDING REQUEST 訂單 → 200，seats_booked 完全不動（從未鎖過，不該被放）', async () => {
    await resetDeparture(TRIP_A.departure1, 10);
    await setPlanRequestMode(TRIP_A.planA1, 'REQUEST');
    const before = await dbSeats(TRIP_A.departure1);

    const created = await createOrder(ownerA, TRIP_A.departure1, 2);
    const order = (await json<any>(created)).data!;
    createdOrderIds.push(order.id);
    expect(await dbSeats(TRIP_A.departure1)).toBe(before);

    const cancelled = await ownerA.post(`/api/tour-orders/${order.id}/cancel`, { reason: '顧客取消申請' });
    expect(cancelled.status).toBe(200);
    const afterCancel = (await json<any>(cancelled)).data!;
    expect(afterCancel.status).toBe('CANCELLED');
    // ⚠️ 修法前 cancel_tour_order 無條件 release_seats，這裡會變成 before - 2。
    expect(await dbSeats(TRIP_A.departure1)).toBe(before);

    const { data: row, error } = await admin.from('tour_orders')
      .select('seats_reserved').eq('id', order.id).maybeSingle();
    expect(error).toBeNull();
    expect(row!.seats_reserved).toBe(false);
  });

  it('取消一筆已被接受（CONFIRMED，seats_reserved=true）的 REQUEST 訂單 → 名額釋放剛好一次', async () => {
    await resetDeparture(TRIP_A.departure1, 10);
    await setPlanRequestMode(TRIP_A.planA1, 'REQUEST');
    const before = await dbSeats(TRIP_A.departure1);

    const created = await createOrder(ownerA, TRIP_A.departure1, 3);
    const order = (await json<any>(created)).data!;
    createdOrderIds.push(order.id);

    expect((await ownerA.post(`/api/tour-orders/${order.id}/accept`, {})).status).toBe(200);
    expect(await dbSeats(TRIP_A.departure1)).toBe(before + 3);

    const cancelled = await ownerA.post(`/api/tour-orders/${order.id}/cancel`, { reason: '導遊臨時取消' });
    expect(cancelled.status).toBe(200);
    // 已鎖住的 3 個名額被放回，且只放一次。
    expect(await dbSeats(TRIP_A.departure1)).toBe(before);

    const { data: row, error } = await admin.from('tour_orders')
      .select('status, seats_reserved').eq('id', order.id).maybeSingle();
    expect(error).toBeNull();
    expect(row!.status).toBe('CANCELLED');
    expect(row!.seats_reserved).toBe(false);
  });
});

describe('confirm-payment 對 seats_reserved 的守門（0111 Final Risk B2，claude-fable-5-1）', () => {
  it('對尚未被接受（PENDING，seats_reserved=false）的 REQUEST 訂單呼叫 confirm-payment → 409 TOUR_002，不改動任何資料', async () => {
    await resetDeparture(TRIP_A.departure1, 10);
    await setPlanRequestMode(TRIP_A.planA1, 'REQUEST');
    const before = await dbSeats(TRIP_A.departure1);

    const created = await createOrder(ownerA, TRIP_A.departure1, 2);
    const order = (await json<any>(created)).data!;
    createdOrderIds.push(order.id);
    expect(await dbSeats(TRIP_A.departure1)).toBe(before);

    const confirmed = await ownerA.post(`/api/tour-orders/${order.id}/confirm-payment`, {});
    expect(confirmed.status).toBe(409);
    expect((await json(confirmed)).code).toBe('TOUR_002');
    // ⚠️ 修法前這裡會回 200，做出一筆「已收款、已確認」但從未鎖過名額的訂單。
    expect(await dbSeats(TRIP_A.departure1)).toBe(before);

    const { data: row, error } = await admin.from('tour_orders')
      .select('status, payment_status, paid_amount').eq('id', order.id).maybeSingle();
    expect(error).toBeNull();
    expect(row!.status).toBe('PENDING');
    expect(row!.payment_status).not.toBe('PAID');
    expect(Number(row!.paid_amount ?? 0)).toBe(0);
  });

  it('accept 之後訂單是 CONFIRMED + UNPAID，confirm-payment 可登記收款（#769）：PAID、paid_amount = total、hold 清空、名額不變', async () => {
    // accept_tour_request 把 REQUEST 訂單轉成 CONFIRMED（鎖名額＋起算 hold_expires_at），付款仍 UNPAID。
    // #769：這種「已接受、未付款」的單必須能登記收款；status 維持 CONFIRMED。
    await resetDeparture(TRIP_A.departure1, 10);
    await setPlanRequestMode(TRIP_A.planA1, 'REQUEST');

    const created = await createOrder(ownerA, TRIP_A.departure1, 1);
    const order = (await json<any>(created)).data!;
    createdOrderIds.push(order.id);

    expect((await ownerA.post(`/api/tour-orders/${order.id}/accept`, {})).status).toBe(200);
    expect(await dbSeats(TRIP_A.departure1)).toBe(1);

    const confirmed = await ownerA.post(`/api/tour-orders/${order.id}/confirm-payment`, {});
    expect(confirmed.status).toBe(200);
    expect(await dbSeats(TRIP_A.departure1)).toBe(1);

    const { data: row, error } = await admin.from('tour_orders')
      .select('status, payment_status, paid_amount, total_amount, hold_expires_at')
      .eq('id', order.id).maybeSingle();
    expect(error).toBeNull();
    expect(row!.status).toBe('CONFIRMED');
    expect(row!.payment_status).toBe('PAID');
    expect(Number(row!.paid_amount)).toBe(Number(row!.total_amount));
    expect(row!.hold_expires_at).toBeNull();

    // 已 PAID 再登記一次 → 409，不得重複收款
    const again = await ownerA.post(`/api/tour-orders/${order.id}/confirm-payment`, {});
    expect(again.status).toBe(409);
    expect((await json(again)).code).toBe('REQ_003');
  });
});

describe('TOUR_MODULE 未訂閱時，accept／reject 一律 403', () => {
  it('停用訂閱 → accept／reject 都 403 FEAT_001，且不改動任何資料', async () => {
    await resetDeparture(TRIP_A.departure1, 10);
    await setPlanRequestMode(TRIP_A.planA1, 'REQUEST');
    const created = await createOrder(ownerA, TRIP_A.departure1, 1);
    const order = (await json<any>(created)).data!;
    createdOrderIds.push(order.id);

    const { error: deleteError } = await admin.from('feature_subscriptions').delete()
      .eq('tenant_id', SHOP_A.id).eq('code', 'TOUR_MODULE');
    expect(deleteError).toBeNull();
    try {
      for (const path of ['accept', 'reject']) {
        const res = await ownerA.post(`/api/tour-orders/${order.id}/${path}`, {});
        expect(res.status).toBe(403);
        expect((await json(res)).code).toBe('FEAT_001');
      }
      const { data: row, error } = await admin.from('tour_orders')
        .select('status').eq('id', order.id).maybeSingle();
      expect(error).toBeNull();
      expect(row!.status).toBe('PENDING');
    } finally {
      const { error } = await admin.from('feature_subscriptions').upsert({
        tenant_id: SHOP_A.id, code: 'TOUR_MODULE', active: true,
        expires_at: null, source: 'GRANTED', cancelled_at: null,
      }, { onConflict: 'tenant_id,code' });
      expect(error).toBeNull();
    }
  });
});
