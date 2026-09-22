/**
 * `/tenant/tour-orders` 頁狀態動作在 mock（骨架/demo）模式下真的要留下來
 * -----------------------------------------------------------------------------
 * `confirmTourOrderPayment`／`completeTourOrder`／`cancelTourOrder`／
 * `acceptTourOrder`／`rejectTourOrder` 的 mock 分支曾經是 `() => undefined`，
 * 與 `tests/unit/tour-order-lifecycle.08.test.ts` 已經修過一次的「setRows
 * 偽造」是同一個假成功模式，只是換了資料層那一半——即使頁面正確呼叫了
 * service，service 的 mock 分支也從未真的寫回 `MOCK_TOUR_ORDERS`。
 *
 * 轉換條件與真實路由共用同一份 `canTransitionTourOrder()`／
 * `shouldReleaseSeats()`（`src/server/tour-domain.ts`），這裡直接呼叫真正的
 * service function 驗證效果留在下一次 `listTourOrders()`。
 */
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api';
import {
  acceptTourOrder, cancelTourOrder, completeTourOrder, confirmTourOrderPayment,
  listTourOrders, rejectTourOrder,
} from '@/services/tours';
import { MOCK_TOUR_ORDERS, MOCK_TRIP_DEPARTURES } from '@/mock/tours';

describe('tour-orders 頁狀態動作（mock 分支）真的把異動寫回 MOCK_TOUR_ORDERS', () => {
  it('confirmTourOrderPayment：PENDING → CONFIRMED 且 paymentStatus → PAID', async () => {
    const target = MOCK_TOUR_ORDERS.find((o) => o.status === 'PENDING');
    expect(target, '測試 fixture 裡沒有 PENDING 的訂單可用').toBeDefined();
    const snapshot = { ...target! };

    await confirmTourOrderPayment(target!.id);

    const { content } = await listTourOrders({ orderId: target!.id });
    expect(content[0]?.status, 'listTourOrders() 讀回的仍是存檔前的舊值').toBe('CONFIRMED');
    expect(content[0]?.paymentStatus).toBe('PAID');
    expect(content[0]?.holdExpiresAt).toBeNull();

    Object.assign(target!, snapshot);
  });

  it('completeTourOrder：CONFIRMED → COMPLETED', async () => {
    const target = MOCK_TOUR_ORDERS.find((o) => o.status === 'CONFIRMED');
    expect(target).toBeDefined();
    const snapshot = { ...target! };

    await completeTourOrder(target!.id);

    const { content } = await listTourOrders({ orderId: target!.id });
    expect(content[0]?.status).toBe('COMPLETED');

    Object.assign(target!, snapshot);
  });

  it('cancelTourOrder：CONFIRMED → CANCELLED，且對應團次的 seatsBooked 被釋放', async () => {
    const departure = MOCK_TRIP_DEPARTURES.find((d) => d.seatsBooked > 0);
    expect(departure, '測試 fixture 裡沒有已佔名額的團次可用').toBeDefined();
    const target = MOCK_TOUR_ORDERS.find((o) => o.status === 'CONFIRMED'
      && o.tripId === departure!.tripId && o.planName === departure!.planName
      && o.departsOn === departure!.departsOn && o.startTime === departure!.startTime);
    expect(target, '測試 fixture 裡沒有能對應到團次的 CONFIRMED 訂單可用').toBeDefined();
    const orderSnapshot = { ...target! };
    const seatsBefore = departure!.seatsBooked;

    await cancelTourOrder(target!.id, '客戶要求取消');

    const { content } = await listTourOrders({ orderId: target!.id });
    expect(content[0]?.status).toBe('CANCELLED');
    expect(departure!.seatsBooked, '取消後對應團次的席次沒有被釋放').toBe(seatsBefore - target!.partySize);

    Object.assign(target!, orderSnapshot);
    departure!.seatsBooked = seatsBefore;
  });

  it('acceptTourOrder：PENDING 申請更新 holdExpiresAt，狀態維持 PENDING（比照真實 accept_tour_request 不動 status）', async () => {
    const target = MOCK_TOUR_ORDERS.find((o) => o.status === 'PENDING');
    expect(target).toBeDefined();
    const snapshot = { ...target! };

    await acceptTourOrder(target!.id, 24);

    const { content } = await listTourOrders({ orderId: target!.id });
    expect(content[0]?.status).toBe('PENDING');
    expect(content[0]?.holdExpiresAt).not.toBe(snapshot.holdExpiresAt);
    expect(content[0]?.holdExpiresAt).not.toBeNull();

    Object.assign(target!, snapshot);
  });

  it('rejectTourOrder：PENDING → CANCELLED', async () => {
    const target = MOCK_TOUR_ORDERS.find((o) => o.status === 'PENDING');
    expect(target).toBeDefined();
    const snapshot = { ...target! };

    await rejectTourOrder(target!.id, '名額已滿');

    const { content } = await listTourOrders({ orderId: target!.id });
    expect(content[0]?.status).toBe('CANCELLED');

    Object.assign(target!, snapshot);
  });

  it('不合法的轉換丟出 ApiError，不得靜默成功', async () => {
    const completed = MOCK_TOUR_ORDERS.find((o) => o.status === 'COMPLETED');
    expect(completed, '測試 fixture 裡沒有 COMPLETED 的訂單可用').toBeDefined();

    await expect(confirmTourOrderPayment(completed!.id)).rejects.toBeInstanceOf(ApiError);
    expect(completed!.status).toBe('COMPLETED');
  });

  it('找不到該筆訂單時丟出 ApiError', async () => {
    await expect(completeTourOrder('does-not-exist')).rejects.toBeInstanceOf(ApiError);
  });
});
