/**
 * #954：導遊接受／婉拒／確認收款後 Email 通知旅客。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { tourOrderStatusHtml } from '@/server/email/templates';

const base = {
  shopName: '海島<店>', orderNo: 'T-1&2', tripTitle: '山<行>', planName: '方案"A"',
  departsOn: '2026-11-01', statusUrl: 'https://x.test/s/abc/requests/o1?contact=a%40b.c&x=1',
};

describe('tourOrderStatusHtml', () => {
  it('ACCEPTED：含期限、連結，並跳脫插值', () => {
    const h = tourOrderStatusHtml('ACCEPTED', { ...base, deadlineText: '2026/10/20 18:00' });
    expect(h).toContain('付款期限');
    expect(h).toContain('2026/10/20 18:00');
    expect(h).toContain('海島&lt;店&gt;');
    expect(h).toContain('T-1&amp;2');
    expect(h).toContain('方案&quot;A&quot;');
    expect(h).not.toContain('<店>');
    expect(h).toContain('contact=a%40b.c&amp;x=1');
  });
  it('REJECTED：原因非空才顯示；空白不顯示；原因被跳脫', () => {
    expect(tourOrderStatusHtml('REJECTED', { ...base, rejectReason: '額滿<b>' })).toContain('店家說明：額滿&lt;b&gt;');
    expect(tourOrderStatusHtml('REJECTED', { ...base, rejectReason: '   ' })).not.toContain('店家說明');
    expect(tourOrderStatusHtml('REJECTED', base)).not.toContain('店家說明');
    expect(tourOrderStatusHtml('REJECTED', { ...base, deadlineText: 'x' })).not.toContain('付款期限');
  });
  it('PAID：已確認收款與狀態頁連結', () => {
    const h = tourOrderStatusHtml('PAID', base);
    expect(h).toContain('已確認收到您的款項');
    expect(h).toContain('查看訂單狀態');
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

describe('notifyTravelerTourOrderStatus', () => {
  beforeEach(() => {
    sendMock.mockClear();
    process.env.RESEND_API_KEY = 'k';
    orderRow = { id: 'o1', contact: { email: ' T@Example.com ' }, status: 'CONFIRMED', payment_status: 'UNPAID' };
    hydrated = {
      orderNo: 'N1', tripTitle: '行程', planName: '方案', departsOn: '2026-11-01',
      holdExpiresAt: '2026-10-20T10:00:00.000Z', status: 'CANCELLED', paymentStatus: 'UNPAID',
      salesMode: 'REQUEST', source: 'PUBLIC', cancelReason: '  行程調整  ',
    };
  });

  it('ACCEPTED：寄給 contact.email，期限以店家時區格式化、連結帶 email', async () => {
    const { notifyTravelerTourOrderStatus } = await import('@/server/email/tour-order-email');
    await notifyTravelerTourOrderStatus('t1', 'o1', 'ACCEPTED');
    expect(sendMock).toHaveBeenCalledTimes(1);
    const arg = sendMock.mock.calls[0][0];
    expect(arg.to).toBe('T@Example.com');
    expect(arg.subject).toContain('顯示店名');
    expect(arg.html).toContain('2026/10/20 18:00');
    expect(arg.html).toContain('/s/shop1/requests/o1?contact=T%40Example.com');
  });

  it('REJECTED：帶導遊原因；PAID 不帶原因與期限', async () => {
    const { notifyTravelerTourOrderStatus } = await import('@/server/email/tour-order-email');
    await notifyTravelerTourOrderStatus('t1', 'o1', 'REJECTED');
    expect(sendMock.mock.calls[0][0].html).toContain('行程調整');
    orderRow = { ...orderRow, payment_status: 'PAID' };
    await notifyTravelerTourOrderStatus('t1', 'o1', 'PAID');
    expect(sendMock.mock.calls[1][0].html).not.toContain('行程調整');
    expect(sendMock.mock.calls[1][0].html).not.toContain('付款期限');
  });

  it('沒有 email 不寄；無 RESEND_API_KEY 不丟錯', async () => {
    const { notifyTravelerTourOrderStatus } = await import('@/server/email/tour-order-email');
    orderRow = { id: 'o1', contact: { phone: '0912' }, status: 'CONFIRMED', payment_status: 'UNPAID' };
    await notifyTravelerTourOrderStatus('t1', 'o1', 'ACCEPTED');
    expect(sendMock).not.toHaveBeenCalled();
    orderRow = { id: 'o1', contact: { email: 'a@b.co' }, status: 'CONFIRMED', payment_status: 'UNPAID' };
    delete process.env.RESEND_API_KEY;
    await expect(notifyTravelerTourOrderStatus('t1', 'o1', 'ACCEPTED')).resolves.toBeUndefined();
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe('route wiring（原始碼斷言）', () => {
  const read = (n: string) => readFileSync(`src/app/api/tour-orders/[id]/${n}/route.ts`, 'utf8');
  it('三支路由皆在成功路徑 after() 通知，位於 return ok 之前', () => {
    for (const [n, kind] of [['accept', 'ACCEPTED'], ['reject', 'REJECTED'], ['confirm-payment', 'PAID']] as const) {
      const s = read(n);
      const i = s.indexOf(`scheduleTravelerTourOrderNotice(t.tenantId, id, '${kind}')`);
      expect(i).toBeGreaterThan(s.indexOf('POST = handle'));
      expect(i).toBeLessThan(s.lastIndexOf('return ok(order)'));
      expect(s.indexOf('return fail(409', 0)).toBeLessThan(i);
    }
  });
  it('不使用 EMAIL_NOTIFICATION 付費閘', () => {
    for (const f of ['src/server/email/tour-order-email.ts', 'src/server/email/send.ts']) {
      expect(readFileSync(f, 'utf8')).not.toMatch(/EMAIL_NOTIFICATION/);
    }
    for (const n of ['accept', 'reject', 'confirm-payment']) expect(read(n)).not.toMatch(/EMAIL_NOTIFICATION/);
  });
});

describe('scheduleTravelerTourOrderNotice', () => {
  it('request scope 之外 after() 丟錯也不外洩', async () => {
    const { scheduleTravelerTourOrderNotice } = await import('@/server/email/tour-order-email');
    expect(() => scheduleTravelerTourOrderNotice('t1', 'o1', 'PAID')).not.toThrow();
  });
});
