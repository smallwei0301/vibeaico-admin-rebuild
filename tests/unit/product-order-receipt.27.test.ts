/**
 * 消費明細文案（LINE 純文字 + Email HTML）的純函式測試 — issue #27 ③
 * -----------------------------------------------------------------------------
 * 勾選框寫的是「LINE 通知顧客**消費明細**」，所以「有送出」還不夠 —— 送出去的
 * 東西必須真的是明細：品項、數量、金額、訂單編號一個都不能少。這裡把兩個管道的
 * 內容組裝函式都當純函式驗（不碰網路/DB，12 分冊 §3）。
 *
 * Email 模板刻意與 `orderHtml`（寄給**店家**的新訂單通知，只有一行摘要）分開，
 * 本檔一併釘住這件事：兩者不得互相污染。
 */
import { describe, expect, it } from 'vitest';

import { buildProductOrderReceiptText } from '@/server/line-notify';
import { orderHtml, productOrderReceiptHtml } from '@/server/email/templates';

const ITEMS = [
  { name: '洗髮精', quantity: 2, price: 480 },
  { name: '護髮油', quantity: 1, price: 1200 },
];
const TOTAL = 480 * 2 + 1200; // 2160

describe('buildProductOrderReceiptText（LINE 純文字明細）', () => {
  const text = buildProductOrderReceiptText({
    shop: '測試沙龍', orderNo: 'PO2608250001', items: ITEMS, totalAmount: TOTAL,
  });

  it('含店名與訂單編號', () => {
    expect(text).toContain('【測試沙龍】');
    expect(text).toContain('訂單編號：PO2608250001');
  });

  it('逐項列出品項名稱與數量', () => {
    expect(text).toContain('洗髮精 ×2');
    expect(text).toContain('護髮油 ×1');
  });

  it('每項小計為單價 × 數量，另有合計', () => {
    expect(text).toContain('NT$ 960');    // 480 × 2
    expect(text).toContain('NT$ 1,200');  // 1200 × 1
    expect(text).toContain('合計：NT$ 2,160');
  });

  it('沒有品項時仍是一則合法訊息（不丟錯、仍有編號與合計）', () => {
    const empty = buildProductOrderReceiptText({
      shop: '測試沙龍', orderNo: 'PO2608250099', items: [], totalAmount: 0,
    });
    expect(empty).toContain('PO2608250099');
    expect(empty).toContain('合計：NT$ 0');
  });
});

describe('productOrderReceiptHtml（Email 明細信）', () => {
  const html = productOrderReceiptHtml({
    shopName: '測試沙龍', orderNo: 'PO2608250001', customerName: '王小明',
    items: ITEMS, totalAmount: TOTAL,
  });

  it('含顧客稱呼、訂單編號、每一個品項與數量、小計與合計', () => {
    expect(html).toContain('王小明');
    expect(html).toContain('PO2608250001');
    expect(html).toContain('洗髮精');
    expect(html).toContain('護髮油');
    expect(html).toContain('NT$ 960');
    expect(html).toContain('NT$ 1,200');
    expect(html).toContain('NT$ 2,160');
  });

  it('使用者可控字串一律 HTML escape（05 §2 末段要求）', () => {
    const evil = productOrderReceiptHtml({
      shopName: '<b>店</b>', orderNo: '<script>', customerName: '"><img>',
      items: [{ name: '<i>品</i>', quantity: 1, price: 1 }], totalAmount: 1,
    });
    expect(evil).not.toContain('<script>');
    expect(evil).not.toContain('<i>品</i>');
    expect(evil).toContain('&lt;script&gt;');
    expect(evil).toContain('&lt;i&gt;品&lt;/i&gt;');
  });

  it('與寄給店家的 orderHtml 是兩封不同的信：店家那封不長出明細表', () => {
    const toShop = orderHtml({
      shopName: '測試沙龍', orderNo: 'PO2608250001', customerName: '王小明', totalAmount: TOTAL,
    });
    expect(toShop).not.toContain('洗髮精');
    expect(toShop).not.toContain('消費明細');
    expect(html).toContain('消費明細');
  });
});
