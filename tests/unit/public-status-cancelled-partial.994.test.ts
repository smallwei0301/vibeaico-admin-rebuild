import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { publicTourRequestPage as i18n } from '@/i18n/zh-TW/pages/public-tour-request';

const page = readFileSync('src/app/s/[shopCode]/requests/[orderId]/page.tsx', 'utf8');

describe('#994 已取消且 PARTIAL 的付款說明', () => {
  it('paymentDescriptionFor：CANCELLED+PARTIAL 分支位於 REFUND 分支之後、PARTIAL 明細與通用 fallback 之前', () => {
    const fn = page.slice(page.indexOf('function paymentDescriptionFor'));
    const iRefund = fn.indexOf("'REFUND_PENDING' && refunded > 0");
    const iCancelled = fn.indexOf("order.status === 'CANCELLED' && order.paymentStatus === 'PARTIAL'");
    const iBreakdown = fn.indexOf('partialPaymentBreakdown(order)');
    const iFallback = fn.indexOf('t.status.paymentDescription[order.paymentStatus]');
    expect(iRefund).toBeGreaterThan(-1);
    expect(iCancelled).toBeGreaterThan(iRefund);
    expect(iBreakdown).toBeGreaterThan(iCancelled);
    expect(iFallback).toBeGreaterThan(iBreakdown);
    expect(fn).toContain('t.status.paymentPartialCancelledDescription');
  });
  it('文案不暗示待付，且與取消通知一致導向退款', () => {
    const d = i18n.status.paymentPartialCancelledDescription;
    expect(d).toBe('此訂單已取消；已付部分的退款事宜請與店家確認。');
    expect(d).toContain('退款');
    expect(d).not.toContain('待付');
    expect(d).not.toContain('尚未全額');
    expect(d).not.toBe(i18n.status.paymentDescription.PARTIAL);
  });
  it('其他狀態的 PARTIAL 通用文案不變', () => {
    expect(i18n.status.paymentDescription.PARTIAL).toContain('實際已付金額、待付金額與期限請向店家確認');
  });
  it('頁面無中文字面量', () => {
    const code = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/[一-鿿]/);
  });
});
