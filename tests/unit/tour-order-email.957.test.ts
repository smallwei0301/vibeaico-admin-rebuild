/**
 * #957：旅客送出團體預約／申請後寄確認信。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { tourOrderStatusHtml } from '@/server/email/templates';

const base = {
  shopName: '海島<店>', orderNo: 'T-1&2', tripTitle: '山<行>', planName: '方案"A"',
  departsOn: '2026-11-01', statusUrl: 'https://x.test/s/abc/requests/o1?contact=a%40b.c&x=1',
};

describe('tourOrderStatusHtml 送出確認', () => {
  it('SUBMITTED_BOOKING：預約已送出、含訂單金額並跳脫插值', () => {
    const h = tourOrderStatusHtml('SUBMITTED_BOOKING', { ...base, totalText: 'NT$ 12,000<x>' });
    expect(h).toContain('您的預約已送出');
    expect(h).toContain('訂單金額');
    expect(h).toContain('NT$ 12,000&lt;x&gt;');
    expect(h).toContain('海島&lt;店&gt;');
    expect(h).toContain('contact=a%40b.c&amp;x=1');
    expect(h).not.toContain('<店>');
  });
  it('SUBMITTED_REQUEST：等候店家回覆，不含金額與付款期限', () => {
    const h = tourOrderStatusHtml('SUBMITTED_REQUEST', { ...base, totalText: 'NT$ 1', deadlineText: 'x' });
    expect(h).toContain('等候店家回覆');
    expect(h).toContain('付款期限');
    expect(h).not.toContain('訂單金額');
    expect(h).not.toContain('>x<');
  });
  it('SUBMITTED_BOOKING 無金額文字不渲染金額列', () => {
    expect(tourOrderStatusHtml('SUBMITTED_BOOKING', base)).not.toContain('訂單金額');
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

describe('notifyTravelerTourOrderStatus 送出確認', () => {
  beforeEach(() => {
    sendMock.mockClear();
    process.env.RESEND_API_KEY = 'k';
    orderRow = { id: 'o1', contact: { email: 't@example.com' } };
    hydrated = {
      orderNo: 'N1', tripTitle: '行程', planName: '方案', departsOn: '2026-11-01',
      holdExpiresAt: '2026-10-20T10:00:00.000Z', totalAmount: 12000,
    };
  });

  it('SUBMITTED_BOOKING：寄出、含 NT$ 金額與狀態頁連結', async () => {
    const { notifyTravelerTourOrderStatus } = await import('@/server/email/tour-order-email');
    await notifyTravelerTourOrderStatus('t1', 'o1', 'SUBMITTED_BOOKING');
    expect(sendMock).toHaveBeenCalledTimes(1);
    const arg = sendMock.mock.calls[0][0];
    expect(arg.to).toBe('t@example.com');
    expect(arg.subject).toContain('預約已送出');
    expect(arg.html).toContain('NT$ 12,000');
    expect(arg.html).toContain('/s/shop1/requests/o1?contact=t%40example.com');
  });

  it('SUBMITTED_REQUEST：不帶金額與付款期限', async () => {
    const { notifyTravelerTourOrderStatus } = await import('@/server/email/tour-order-email');
    await notifyTravelerTourOrderStatus('t1', 'o1', 'SUBMITTED_REQUEST');
    const html = sendMock.mock.calls[0][0].html;
    expect(html).toContain('等候店家回覆');
    expect(html).not.toContain('訂單金額');
    expect(html).not.toContain('2026/10/20');
  });

  it('沒有 email 不寄', async () => {
    const { notifyTravelerTourOrderStatus } = await import('@/server/email/tour-order-email');
    orderRow = { id: 'o1', contact: { phone: '0912' } };
    await notifyTravelerTourOrderStatus('t1', 'o1', 'SUBMITTED_BOOKING');
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe('route wiring（原始碼斷言）', () => {
  for (const [name, kind] of [['tour-bookings', 'SUBMITTED_BOOKING'], ['tour-requests', 'SUBMITTED_REQUEST']] as const) {
    it(`${name}：建單成功後以 ${kind} 排程一次，位於 catch 之前`, () => {
      const s = readFileSync(`src/app/api/public/${name}/route.ts`, 'utf8');
      const call = `scheduleTravelerTourOrderNotice(plan.tenantId, orderId, '${kind}')`;
      expect(s.split(call)).toHaveLength(2);
      expect(s.match(/scheduleTravelerTourOrderNotice\(/g)).toHaveLength(1);
      const i = s.indexOf(call);
      expect(i).toBeGreaterThan(s.search(/await submitPublicTour/));
      expect(i).toBeLessThan(s.indexOf('} catch'));
    });
  }
});

describe('allowTravelerConfirmEmail 節流', () => {
  it('同一 email 每小時 3 封，第 4 次拒絕；大小寫與空白視為同一人', async () => {
    const { allowTravelerConfirmEmail } = await import('@/server/email/tour-order-email');
    const e = 'Victim-A@Example.com';
    expect(allowTravelerConfirmEmail(e, 'ip-a1')).toBe(true);
    expect(allowTravelerConfirmEmail(` ${e.toLowerCase()} `, 'ip-a2')).toBe(true);
    expect(allowTravelerConfirmEmail(e, 'ip-a3')).toBe(true);
    expect(allowTravelerConfirmEmail(e, 'ip-a4')).toBe(false);
    expect(allowTravelerConfirmEmail('other-a@example.com', 'ip-a5')).toBe(true);
  });
  it('同 IP 跨店每小時 10 封，第 11 次拒絕；被收件人擋下不消耗 IP 額度', async () => {
    const { allowTravelerConfirmEmail } = await import('@/server/email/tour-order-email');
    for (let i = 0; i < 10; i += 1) expect(allowTravelerConfirmEmail(`u${i}-b@example.com`, 'ip-b')).toBe(true);
    expect(allowTravelerConfirmEmail('u11-b@example.com', 'ip-b')).toBe(false);
    for (let i = 0; i < 3; i += 1) expect(allowTravelerConfirmEmail('same-c@example.com', 'ip-c')).toBe(true);
    for (let i = 0; i < 5; i += 1) expect(allowTravelerConfirmEmail('same-c@example.com', 'ip-c')).toBe(false);
    for (let i = 0; i < 7; i += 1) expect(allowTravelerConfirmEmail(`v${i}-c@example.com`, 'ip-c')).toBe(true);
  });
  it('沒有 email 一律放行且不佔額度', async () => {
    const { allowTravelerConfirmEmail } = await import('@/server/email/tour-order-email');
    for (let i = 0; i < 20; i += 1) expect(allowTravelerConfirmEmail('', 'ip-d')).toBe(true);
    expect(allowTravelerConfirmEmail(undefined, 'ip-d')).toBe(true);
  });
  it('route 以 allowTravelerConfirmEmail 包住排程且不影響 201', () => {
    for (const name of ['tour-bookings', 'tour-requests']) {
      const s = readFileSync(`src/app/api/public/${name}/route.ts`, 'utf8');
      expect(s).toMatch(/if \(allowTravelerConfirmEmail\(body\.contactEmail, ip\)\)/);
      expect(s).toContain("return ok({ orderId, orderNo }, { status: 201 });");
    }
  });
});
