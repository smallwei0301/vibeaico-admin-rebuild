import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createAdminSupabase, getLineCredentials, linePush,
  reservePushQuotaForBookingAddon, refundPushQuotaForBookingAddon,
} = vi.hoisted(() => ({
  createAdminSupabase: vi.fn(), getLineCredentials: vi.fn(), linePush: vi.fn(),
  reservePushQuotaForBookingAddon: vi.fn(), refundPushQuotaForBookingAddon: vi.fn(),
}));
vi.mock('@/server/supabase', () => ({ createAdminSupabase }));
vi.mock('@/server/line', () => ({
  getLineCredentials, linePush, reservePushQuotaForBookingAddon, refundPushQuotaForBookingAddon,
}));

import { ApiHttpError, ERR } from '@/server/http';
import { notifyBookingAddonReceipt } from '@/server/booking-addon-notify';

function single(data: unknown, error: unknown = null) {
  const chain: any = { maybeSingle: vi.fn().mockResolvedValue({ data, error }) };
  chain.eq = vi.fn(() => chain);
  return { select: vi.fn(() => chain) };
}

function baseAdmin(overrides: { booking?: unknown; customer?: unknown; tenant?: unknown; errors?: Record<string, unknown> } = {}) {
  const { booking = { booking_no: 'BK-17', customer_id: 'customer' }, customer = { line_user_id: 'line-user' }, tenant = { name: 'tenant' }, errors = {} } = overrides;
  createAdminSupabase.mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === 'bookings') return single(booking, errors.bookings);
      if (table === 'customers') return single(customer, errors.customers);
      return single(tenant, errors.tenants);
    }),
  });
}

function params() {
  return { bookingId: 'booking', item: { name: 'item', quantity: 1, price: 10 }, addonTotal: 10, bookingTotal: 110 };
}

describe('Issue #17 add-on receipt outcome boundary', () => {
  beforeEach(() => {
    getLineCredentials.mockReset(); linePush.mockReset();
    reservePushQuotaForBookingAddon.mockReset(); refundPushQuotaForBookingAddon.mockReset();
    createAdminSupabase.mockReset();
    baseAdmin();
  });

  it('distinguishes exhausted quota and performs zero provider or refund calls', async () => {
    getLineCredentials.mockResolvedValue({ token: 'token' });
    reservePushQuotaForBookingAddon.mockResolvedValue({ state: 'EXHAUSTED' });

    await expect(notifyBookingAddonReceipt('tenant', params())).resolves.toMatchObject({
      outcome: 'QUOTA_EXCEEDED', classification: 'QUOTA_EXHAUSTED',
    });
    expect(linePush).not.toHaveBeenCalled();
    expect(refundPushQuotaForBookingAddon).not.toHaveBeenCalled();
  });

  it('keeps feature/quota read errors pending instead of calling them quota exhaustion', async () => {
    getLineCredentials.mockResolvedValue({ token: 'token' });
    reservePushQuotaForBookingAddon.mockResolvedValue({ state: 'UNKNOWN', error: new Error('feature read unavailable') });

    await expect(notifyBookingAddonReceipt('tenant', params())).resolves.toMatchObject({
      outcome: 'PENDING', classification: 'DB_UNAVAILABLE',
    });
    expect(linePush).not.toHaveBeenCalled();
  });

  it('keeps customer/settings DB errors pending instead of NO_LINE or NOT_CONFIGURED', async () => {
    baseAdmin({ errors: { customers: { code: '08006', message: 'customer read unavailable' } } });
    await expect(notifyBookingAddonReceipt('tenant', params())).resolves.toMatchObject({
      outcome: 'PENDING', classification: 'DB_UNAVAILABLE',
    });
    expect(getLineCredentials).not.toHaveBeenCalled();

    baseAdmin();
    getLineCredentials.mockRejectedValue({ code: 'PGRST001', message: 'settings unavailable' });
    await expect(notifyBookingAddonReceipt('tenant', params())).resolves.toMatchObject({
      outcome: 'PENDING', classification: 'DB_UNAVAILABLE',
    });
  });

  it('returns NO_LINE only for a confirmed customer row without a LINE user', async () => {
    baseAdmin({ customer: { line_user_id: null } });
    await expect(notifyBookingAddonReceipt('tenant', params())).resolves.toMatchObject({
      outcome: 'NO_LINE', classification: 'NO_LINE',
    });
    expect(getLineCredentials).not.toHaveBeenCalled();
  });

  it('pushes exactly one receipt after a successful quota reservation', async () => {
    getLineCredentials.mockResolvedValue({ token: 'token' });
    reservePushQuotaForBookingAddon.mockResolvedValue({ state: 'RESERVED', month: '2026-09', count: 1 });
    linePush.mockResolvedValue({});

    await expect(notifyBookingAddonReceipt('tenant', {
      bookingId: 'booking', item: { name: 'item', quantity: 2, price: 10 }, addonTotal: 20, bookingTotal: 120,
    })).resolves.toMatchObject({ outcome: 'LINE', classification: 'DELIVERED' });
    expect(reservePushQuotaForBookingAddon).toHaveBeenCalledWith('tenant', 1);
    expect(linePush).toHaveBeenCalledWith('token', 'line-user', [expect.objectContaining({ type: 'text' })]);
  });

  it('refunds only a confirmed provider rejection before settling FAILED', async () => {
    getLineCredentials.mockResolvedValue({ token: 'token' });
    reservePushQuotaForBookingAddon.mockResolvedValue({ state: 'RESERVED', month: '2026-09', count: 1 });
    linePush.mockRejectedValue(new ApiHttpError(502, 'rejected', ERR.LINE_API_ERROR));
    refundPushQuotaForBookingAddon.mockResolvedValue(true);

    await expect(notifyBookingAddonReceipt('tenant', params())).resolves.toMatchObject({
      outcome: 'FAILED', classification: 'CONFIRMED_PROVIDER_REJECTION', quotaRefunded: true,
    });
    expect(refundPushQuotaForBookingAddon).toHaveBeenCalledWith('tenant', '2026-09', 1);
  });

  it('keeps transport ambiguity pending and never refunds an unknown provider result', async () => {
    getLineCredentials.mockResolvedValue({ token: 'token' });
    reservePushQuotaForBookingAddon.mockResolvedValue({ state: 'RESERVED', month: '2026-09', count: 1 });
    linePush.mockRejectedValue(new TypeError('fetch failed')); // response may have been accepted

    await expect(notifyBookingAddonReceipt('tenant', params())).resolves.toMatchObject({
      outcome: 'PENDING', classification: 'PROVIDER_AMBIGUOUS',
    });
    expect(refundPushQuotaForBookingAddon).not.toHaveBeenCalled();
  });

  it('keeps a confirmed rejection pending if the refund result is unavailable', async () => {
    getLineCredentials.mockResolvedValue({ token: 'token' });
    reservePushQuotaForBookingAddon.mockResolvedValue({ state: 'RESERVED', month: '2026-09', count: 1 });
    linePush.mockRejectedValue(new ApiHttpError(502, 'rejected', ERR.LINE_API_ERROR));
    refundPushQuotaForBookingAddon.mockResolvedValue(false);

    await expect(notifyBookingAddonReceipt('tenant', params())).resolves.toMatchObject({
      outcome: 'PENDING', classification: 'DB_UNAVAILABLE',
    });
  });
});
