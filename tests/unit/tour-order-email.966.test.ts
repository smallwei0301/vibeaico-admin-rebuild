/**
 * #966：ACCEPTED／PAID 通知信寄送前重讀訂單，狀態已變動則略過，避免寄出過時內容。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendMock = vi.fn(async (..._a: any[]) => ({ error: null }));
vi.mock('resend', () => ({ Resend: class { emails = { send: (...a: any[]) => sendMock(...a) }; } }));
let orderRow: any;
vi.mock('@/server/supabase', () => ({
  createAdminSupabase: () => ({
    from: (table: string) => {
      const q: any = {
        select: () => q, eq: () => q,
        maybeSingle: async () => ({
          data: table === 'tour_orders' ? orderRow
            : { name: '店名', shop_code: 'shop1', tenant_settings: [{ basic: { tenantName: '店', timezone: 'Asia/Taipei' } }] },
          error: null,
        }),
      };
      return q;
    },
  }),
}));
vi.mock('@/server/tour-orders', () => ({
  hydrateTourOrders: async () => [{ orderNo: 'N1', tripTitle: '行程', planName: '方案', departsOn: '2026-11-01', holdExpiresAt: '2026-10-20T10:00:00.000Z', totalAmount: 1000 }],
}));

const row = (status: string, payment_status: string) => ({ id: 'o1', contact: { email: 't@example.com' }, status, payment_status });

describe('#966 通知寄送前狀態守門', () => {
  beforeEach(() => { sendMock.mockClear(); process.env.RESEND_API_KEY = 'k'; });
  const run = async (kind: any) => {
    const { notifyTravelerTourOrderStatus } = await import('@/server/email/tour-order-email');
    await notifyTravelerTourOrderStatus('t1', 'o1', kind);
  };

  it.each([['CONFIRMED', 'PAID'], ['CONFIRMED', 'PARTIAL'], ['CANCELLED', 'UNPAID']])('ACCEPTED 遇 %s＋%s 不寄', async (s, p) => {
    orderRow = row(s, p); await run('ACCEPTED');
    expect(sendMock).not.toHaveBeenCalled();
  });
  it('ACCEPTED 遇 CONFIRMED＋UNPAID 寄出', async () => {
    orderRow = row('CONFIRMED', 'UNPAID'); await run('ACCEPTED');
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
  it.each([['CANCELLED', 'UNPAID'], ['CONFIRMED', 'PARTIAL']])('PAID 遇 %s＋%s 不寄', async (s, p) => {
    orderRow = row(s, p); await run('PAID');
    expect(sendMock).not.toHaveBeenCalled();
  });
  it('PAID 遇 PAID 寄出', async () => {
    orderRow = row('CONFIRMED', 'PAID'); await run('PAID');
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
  it('REJECTED 不受守門影響', async () => {
    orderRow = row('CANCELLED', 'UNPAID'); await run('REJECTED');
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});
