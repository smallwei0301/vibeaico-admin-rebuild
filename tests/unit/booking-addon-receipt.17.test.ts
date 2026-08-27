/**
 * 加購「消費明細」LINE 文字的單元測試（GitHub issue #17 / 補齊-2）。
 *
 * `buildBookingAddonReceiptText` 是純函式，可以直接驗內容——這一則訊息是**送到
 * 顧客手機上**的，寫錯金額的代價比後台顯示錯高得多，所以除了整合測試裡「有沒有
 * 送出」之外，內容本身也要單獨釘住。
 *
 * 整合測試在 `tests/integration/api/booking-addons.17.test.ts`（送出與否、額度、
 * 零請求）；那裡也會比對這裡定義的同一組數字格式。
 */
import { describe, expect, it } from 'vitest';
import { buildBookingAddonReceiptText } from '@/server/booking-addon-notify';

describe('加購消費明細的 LINE 文字（issue #17）', () => {
  const base = {
    shop: '米道髮廊',
    bookingNo: 'B2609010001',
    items: [{ name: '深層護髮', quantity: 2, price: 800 }],
    addonTotal: 1600,
    bookingTotal: 2600,
  };

  it('含店名、預約編號、逐項小計、本次加購合計與加購後的預約金額', () => {
    const text = buildBookingAddonReceiptText(base);
    expect(text).toContain('【米道髮廊】');
    expect(text).toContain('預約編號：B2609010001');
    expect(text).toContain('・深層護髮 ×2　NT$ 1,600');
    expect(text).toContain('本次加購：NT$ 1,600');
    expect(text).toContain('預約金額：NT$ 2,600');
  });

  it('逐項小計是 price × quantity，不是單價', () => {
    const text = buildBookingAddonReceiptText({
      ...base,
      items: [{ name: '青草膏', quantity: 3, price: 120 }],
      addonTotal: 360,
      bookingTotal: 1360,
    });
    expect(text).toContain('・青草膏 ×3　NT$ 360');
    expect(text).not.toContain('NT$ 120');
  });

  it('不宣稱任何沒發生的事：沒有「已通知」「將收到」之類的措辭', () => {
    // 這則文字是送給顧客看的通知本體，不該在裡面自我宣告「你已經收到通知了」
    const text = buildBookingAddonReceiptText(base);
    expect(text).not.toMatch(/已通知|將收到|已收到/);
  });

  it('0 元加購也印得出來（招待項目要讓顧客看得到，只是不加錢）', () => {
    const text = buildBookingAddonReceiptText({
      ...base,
      items: [{ name: '招待毛巾', quantity: 1, price: 0 }],
      addonTotal: 0,
      bookingTotal: 1000,
    });
    expect(text).toContain('・招待毛巾 ×1　NT$ 0');
    expect(text).toContain('本次加購：NT$ 0');
  });
});
