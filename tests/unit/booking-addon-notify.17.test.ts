import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createAdminSupabase, getLineCredentials, linePush, consumePushQuota } = vi.hoisted(() => ({
  createAdminSupabase: vi.fn(), getLineCredentials: vi.fn(), linePush: vi.fn(), consumePushQuota: vi.fn(),
}));
vi.mock('@/server/supabase', () => ({ createAdminSupabase }));
vi.mock('@/server/line', () => ({ getLineCredentials, linePush, consumePushQuota }));

import { notifyBookingAddonReceipt } from '@/server/booking-addon-notify';

function single(data: unknown) {
  const chain: any = { maybeSingle: vi.fn().mockResolvedValue({ data }) };
  chain.eq = vi.fn(() => chain);
  return { select: vi.fn(() => chain) };
}

describe('Issue #17 add-on receipt quota boundary', () => {
  beforeEach(() => {
    getLineCredentials.mockReset(); linePush.mockReset(); consumePushQuota.mockReset();
    createAdminSupabase.mockReturnValue({ from: vi.fn((table: string) => {
      if (table === 'bookings') return single({ booking_no: 'BK-17', customer_id: 'customer' });
      if (table === 'customers') return single({ line_user_id: 'line-user' });
      return single({ name: 'tenant' });
    }) });
  });

  it('returns QUOTA_EXCEEDED and performs zero provider calls when reservation fails closed', async () => {
    getLineCredentials.mockResolvedValue({ token: 'token' });
    consumePushQuota.mockResolvedValue(false);
    await expect(notifyBookingAddonReceipt('tenant', {
      bookingId: 'booking', item: { name: 'item', quantity: 1, price: 10 }, addonTotal: 10, bookingTotal: 110,
    })).resolves.toBe('QUOTA_EXCEEDED');
    expect(linePush).not.toHaveBeenCalled();
  });

  it('pushes exactly one receipt after a successful quota reservation', async () => {
    getLineCredentials.mockResolvedValue({ token: 'token' });
    consumePushQuota.mockResolvedValue(true);
    linePush.mockResolvedValue({});
    await expect(notifyBookingAddonReceipt('tenant', {
      bookingId: 'booking', item: { name: 'item', quantity: 2, price: 10 }, addonTotal: 20, bookingTotal: 120,
    })).resolves.toBe('LINE');
    expect(consumePushQuota).toHaveBeenCalledWith('tenant', 1);
    expect(linePush).toHaveBeenCalledWith('token', 'line-user', [expect.objectContaining({ type: 'text' })]);
  });
});
