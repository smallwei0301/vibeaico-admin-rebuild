/**
 * `/tenant/bookings` 頁四個狀態動作在 mock（骨架/demo）模式下真的要留下來
 * -----------------------------------------------------------------------------
 * `confirmBooking`／`completeBooking`／`cancelBooking`／`markNoShow` 的 mock 分支
 * 曾經是 `() => undefined`。頁面的 `runAction()`（比照 #8-B 修好的固定模式：
 * 先呼叫端點、成功後才 `void load()` 重讀）在 mock 模式下因此永遠把狀態讀回
 * 原值——導遊按下「確認」、看到成功 toast，重新整理又變回舊狀態，與 #8-B
 * 修過的 tour-orders 假成功是同一個模式，只是換了一頁。
 *
 * 這裡直接呼叫真正的 service function，驗證效果會反映在下一次 `listBookings()`
 * 讀到的結果裡，並且轉換條件（PENDING/CONFIRMED 才能怎樣）與真實路由一致、
 * 不合法的轉換會丟出會被頁面判斷失敗的 `ApiError`。
 */
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api';
import {
  cancelBooking, completeBooking, confirmBooking, listBookings, markNoShow,
} from '@/services/bookings';
import { MOCK_BOOKINGS } from '@/mock';

describe('bookings 頁狀態動作（mock 分支）真的把異動寫回 MOCK_BOOKINGS', () => {
  it('confirmBooking：PENDING → CONFIRMED，重新 listBookings() 讀到新狀態', async () => {
    const target = MOCK_BOOKINGS.find((b) => b.status === 'PENDING');
    expect(target, '測試 fixture 裡沒有 PENDING 的預約可用').toBeDefined();

    await confirmBooking(target!.id);

    const { content } = await listBookings({ bookingId: target!.id });
    expect(content[0]?.status, 'listBookings() 讀回的仍是存檔前的舊值').toBe('CONFIRMED');

    target!.status = 'PENDING';
  });

  it('completeBooking：CONFIRMED → COMPLETED', async () => {
    const target = MOCK_BOOKINGS.find((b) => b.status === 'CONFIRMED');
    expect(target).toBeDefined();

    await completeBooking(target!.id);

    const { content } = await listBookings({ bookingId: target!.id });
    expect(content[0]?.status).toBe('COMPLETED');

    target!.status = 'CONFIRMED';
  });

  it('cancelBooking：CONFIRMED → CANCELLED', async () => {
    const target = MOCK_BOOKINGS.find((b) => b.status === 'CONFIRMED');
    expect(target).toBeDefined();

    await cancelBooking(target!.id, '客戶改期');

    const { content } = await listBookings({ bookingId: target!.id });
    expect(content[0]?.status).toBe('CANCELLED');

    target!.status = 'CONFIRMED';
  });

  it('markNoShow：CONFIRMED → NO_SHOW', async () => {
    const target = MOCK_BOOKINGS.find((b) => b.status === 'CONFIRMED');
    expect(target).toBeDefined();

    await markNoShow(target!.id);

    const { content } = await listBookings({ bookingId: target!.id });
    expect(content[0]?.status).toBe('NO_SHOW');

    target!.status = 'CONFIRMED';
  });

  it('不合法的轉換丟出 ApiError，不得靜默成功（店家按下去要被告知沒發生）', async () => {
    // 不依賴特定 fixture 一定帶終態列（三份 mock 資料集不保證都有）：
    // 自己先把一筆 CONFIRMED 的推進到 COMPLETED 終態，再驗證對終態的
    // confirm 會被擋下來，最後還原。
    const target = MOCK_BOOKINGS.find((b) => b.status === 'CONFIRMED');
    expect(target, '測試 fixture 裡沒有 CONFIRMED 的預約可用').toBeDefined();

    await completeBooking(target!.id);
    expect(target!.status).toBe('COMPLETED');

    await expect(confirmBooking(target!.id)).rejects.toBeInstanceOf(ApiError);
    // 狀態本身不得被動到
    expect(target!.status).toBe('COMPLETED');

    target!.status = 'CONFIRMED';
  });

  it('找不到該筆預約時丟出 ApiError', async () => {
    await expect(confirmBooking('does-not-exist')).rejects.toBeInstanceOf(ApiError);
  });
});
