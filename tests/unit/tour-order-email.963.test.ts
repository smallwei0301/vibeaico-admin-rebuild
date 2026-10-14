/**
 * #963：導遊確認收到訂金後以 Email 通知旅客訂金與尾款。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { tourOrderStatusHtml, TOUR_ORDER_STATUS_EMAIL_COPY } from '@/server/email/templates';

const base = {
  shopName: '海島<店>', orderNo: 'T-1&2', tripTitle: '山<行>', planName: '方案"A"',
  departsOn: '2026-11-01', statusUrl: 'https://x.test/s/abc/requests/o1?contact=a%40b.c&x=1',
};

describe('tourOrderStatusHtml DEPOSIT_RECEIVED', () => {
  it('文案', () => {
    expect(TOUR_ORDER_STATUS_EMAIL_COPY.DEPOSIT_RECEIVED).toEqual({
      subject: '已確認收到訂金', title: '店家已確認收到訂金',
      lead: '店家已確認收到您的訂金，名額已為您保留；尾款請依店家指示於出發前付清。',
    });
    const h = tourOrderStatusHtml('DEPOSIT_RECEIVED', base);
    expect(h).toContain('店家已確認收到訂金');
    expect(h).toContain('尾款請依店家指示於出發前付清');
  });
  it('列出已收訂金與尚餘尾款', () => {
    const h = tourOrderStatusHtml('DEPOSIT_RECEIVED', { ...base, paidText: 'NT$ 3,000', balanceText: 'NT$ 9,000' });
    expect(h).toContain('已收訂金');
    expect(h).toContain('NT$ 3,000');
    expect(h).toContain('尚餘尾款');
    expect(h).toContain('NT$ 9,000');
  });
  it('尾款為空不顯示尾款列；其他 kind 不顯示金額列', () => {
    const h = tourOrderStatusHtml('DEPOSIT_RECEIVED', { ...base, paidText: 'NT$ 3,000' });
    expect(h).not.toContain('尚餘尾款');
    const p = tourOrderStatusHtml('PAID', { ...base, paidText: 'NT$ 3,000', balanceText: 'NT$ 1' });
    expect(p).not.toContain('已收訂金');
    expect(p).not.toContain('尚餘尾款');
  });
  it('插值跳脫', () => {
    const h = tourOrderStatusHtml('DEPOSIT_RECEIVED', { ...base, paidText: '<b>1</b>', balanceText: '<i>2</i>' });
    expect(h).toContain('&lt;b&gt;1&lt;/b&gt;');
    expect(h).toContain('&lt;i&gt;2&lt;/i&gt;');
    expect(h).not.toContain('<b>1</b>');
    expect(h).toContain('海島&lt;店&gt;');
  });
});

const sendMock = vi.fn(async (..._a: any[]) => ({ error: null }));
vi.mock('resend', () => ({ Resend: class { emails = { send: (...a: any[]) => sendMock(...a) }; } }));
let orderRow: any;
let hydrated: any;
vi.mock('@/server/supabase', () => ({
  createAdminSupabase: () => ({
    from: (table: string) => {
      const q: any = {
        select: () => q, eq: () => q,
        maybeSingle: async () => ({
          data: table === 'tour_orders' ? orderRow
            : { name: '店名', shop_code: 'shop1', tenant_settings: [{ basic: { tenantName: '顯示店名', timezone: 'Asia/Taipei' } }] },
          error: null,
        }),
      };
      return q;
    },
  }),
}));
vi.mock('@/server/tour-orders', () => ({ hydrateTourOrders: async () => [hydrated] }));

describe('notifyTravelerTourOrderStatus DEPOSIT_RECEIVED', () => {
  beforeEach(() => {
    sendMock.mockClear();
    process.env.RESEND_API_KEY = 'k';
    orderRow = { id: 'o1', contact: { email: 't@example.com' }, paid_amount: 3000 };
    hydrated = { orderNo: 'N1', tripTitle: '行程', planName: '方案', departsOn: '2026-11-01', totalAmount: 12000 };
  });
  it('寄出含已收訂金與尚餘尾款', async () => {
    const { notifyTravelerTourOrderStatus } = await import('@/server/email/tour-order-email');
    await notifyTravelerTourOrderStatus('t1', 'o1', 'DEPOSIT_RECEIVED');
    expect(sendMock).toHaveBeenCalledTimes(1);
    const arg = sendMock.mock.calls[0][0];
    expect(arg.subject).toContain('已確認收到訂金');
    expect(arg.html).toContain('NT$ 3,000');
    expect(arg.html).toContain('NT$ 9,000');
  });
  it('尾款為 0 不顯示尾款列', async () => {
    orderRow.paid_amount = 12000;
    const { notifyTravelerTourOrderStatus } = await import('@/server/email/tour-order-email');
    await notifyTravelerTourOrderStatus('t1', 'o1', 'DEPOSIT_RECEIVED');
    const html = sendMock.mock.calls[0][0].html;
    expect(html).toContain('已收訂金');
    expect(html).not.toContain('尚餘尾款');
  });
  it('金額欄位非有限數時不渲染該列', async () => {
    orderRow.paid_amount = null;
    const { notifyTravelerTourOrderStatus } = await import('@/server/email/tour-order-email');
    await notifyTravelerTourOrderStatus('t1', 'o1', 'DEPOSIT_RECEIVED');
    const html = sendMock.mock.calls[0][0].html;
    expect(html).not.toContain('已收訂金');
    expect(html).not.toContain('尚餘尾款');
  });
});

describe('confirm-payment route wiring（原始碼斷言）', () => {
  const s = readFileSync('src/app/api/tour-orders/[id]/confirm-payment/route.ts', 'utf8');
  it('DEPOSIT 分支在 CAS 失敗 409 之後、return ok 之前，且只排程一次', () => {
    const call = "scheduleTravelerTourOrderNotice(t.tenantId, id, 'DEPOSIT_RECEIVED')";
    const i = s.indexOf(call);
    expect(i).toBeGreaterThan(s.indexOf("if (!data) return fail(409"));
    expect(i).toBeLessThan(s.lastIndexOf('return ok(order)'));
    expect(s.split(call).length - 1).toBe(1);
    expect(s.split("'PAID')").length - 1).toBe(1);
  });
});
