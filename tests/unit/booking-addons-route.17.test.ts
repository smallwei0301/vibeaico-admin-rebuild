import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc, adminRpc, requireTenant, notifyBookingAddonReceipt } = vi.hoisted(() => ({
  rpc: vi.fn(), adminRpc: vi.fn(), requireTenant: vi.fn(), notifyBookingAddonReceipt: vi.fn(),
}));

vi.mock('@/server/tenant', () => ({ requireTenant }));
vi.mock('@/server/mappers', () => ({ mapBookingAddon: vi.fn((row) => row) }));
vi.mock('@/server/booking-addon-notify', () => ({ notifyBookingAddonReceipt }));
vi.mock('@/server/supabase', () => ({ createAdminSupabase: vi.fn(() => ({ rpc: adminRpc })) }));

import { POST } from '@/app/api/bookings/[id]/addons/route';
import { DELETE } from '@/app/api/bookings/[id]/addons/[addonId]/route';

describe('Issue #17 add-on route overlap regression', () => {
  beforeEach(() => {
    rpc.mockReset(); adminRpc.mockReset(); notifyBookingAddonReceipt.mockReset();
    requireTenant.mockResolvedValue({ tenantId: 'a1000000-0000-4000-8000-000000000001', supabase: { rpc } });
  });

  function post(body: Record<string, unknown>) {
    return POST(new Request('http://localhost/api/bookings/b/addons', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }), { params: Promise.resolve({ id: 'b' }) });
  }

  function addResult(overrides: Record<string, unknown> = {}) {
    return {
      addon_id: 'addon-1', final_price: '110', duration_minutes: 60,
      end_at: '2026-09-01T10:00:00.000Z', created: true, notified: 'NONE', ...overrides,
    };
  }

  function addonRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'addon-1', service_id: null, name: '加購', price: 10, quantity: 1,
      duration_minutes: 0, staff_id: null, applied_amount: 10, applied_minutes: 0,
      notified: 'NONE', performance_mode: 'NONE', performance_staff_id: null,
      created_at: '2026-09-01T09:00:00.000Z', staff: null, ...overrides,
    };
  }

  function configureAddonRead(row: Record<string, unknown>) {
    const chain: any = { maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }) };
    chain.eq = vi.fn(() => chain);
    const from = vi.fn(() => ({ select: vi.fn(() => chain) }));
    requireTenant.mockResolvedValue({
      tenantId: 'a1000000-0000-4000-8000-000000000001', supabase: { rpc, from },
    });
  }

  it('maps the native bookings exclusion violation (23P01) to truthful 409 with no success envelope', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '23P01', message: 'x_bookings_overlap' } });
    const response = await post({
      name: '會撞期的加購', price: 100, quantity: 1, durationMinutes: 30,
      notify: false, idempotencyKey: '11111111-1111-4111-8111-111111111111',
    });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ success: false, code: 'REQ_003' });
    expect(rpc).toHaveBeenCalledOnce();
  });

  it('returns the authoritative rollback totals from the delete RPC', async () => {
    rpc.mockResolvedValue({ data: [{ final_price: '900', duration_minutes: 60, end_at: '2026-09-01T10:00:00.000Z' }], error: null });
    const response = await DELETE(new Request('http://localhost/api/bookings/b/addons/a', { method: 'DELETE' }), {
      params: Promise.resolve({ id: 'b', addonId: 'a' }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { finalPrice: 900, durationMinutes: 60, endAt: '2026-09-01T10:00:00.000Z' },
    });
  });

  it('surfaces a marker failure after the receipt without claiming the mutation rolled back', async () => {
    const key = '22222222-2222-4222-8222-222222222222';
    configureAddonRead(addonRow());
    rpc.mockResolvedValue({ data: [addResult()], error: null });
    notifyBookingAddonReceipt.mockResolvedValue({ outcome: 'LINE', classification: 'DELIVERED' });
    adminRpc
      .mockResolvedValueOnce({ data: [{ claimed: true, notified: 'PENDING' }], error: null })
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST001', message: 'marker unavailable' } });

    const response = await post({ name: '加購', price: 10, quantity: 1, durationMinutes: 0, notify: true, idempotencyKey: key });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      success: false, code: 'SYS_001', data: { persisted: true, notificationPending: true },
    });
    expect(notifyBookingAddonReceipt).toHaveBeenCalledOnce();
    expect(adminRpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith('add_booking_addon_17', expect.objectContaining({
      p_idempotency_key: key, p_notify: true,
    }));
  });

  it('does not resend LINE or reserve quota when the same key replays an ambiguous PENDING outcome', async () => {
    const key = '33333333-3333-4333-8333-333333333333';
    configureAddonRead(addonRow({ notified: 'PENDING' }));
    rpc
      .mockResolvedValueOnce({ data: [addResult()], error: null })
      .mockResolvedValueOnce({ data: [addResult({ created: false, notified: 'PENDING' })], error: null });
    notifyBookingAddonReceipt.mockResolvedValue({ outcome: 'LINE', classification: 'DELIVERED' });
    adminRpc
      .mockResolvedValueOnce({ data: [{ claimed: true, notified: 'PENDING' }], error: null })
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST001', message: 'marker unavailable' } });

    const first = await post({ name: '加購', price: 10, quantity: 1, durationMinutes: 0, notify: true, idempotencyKey: key });
    const replay = await post({ name: '加購', price: 10, quantity: 1, durationMinutes: 0, notify: true, idempotencyKey: key });

    expect(first.status).toBe(500);
    expect(replay.status).toBe(409);
    await expect(replay.json()).resolves.toMatchObject({
      success: false, code: 'REQ_003', data: { persisted: true, notificationPending: true },
    });
    expect(notifyBookingAddonReceipt).toHaveBeenCalledOnce();
    expect(adminRpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenNthCalledWith(2, 'add_booking_addon_17', expect.objectContaining({
      p_idempotency_key: key, p_notify: true,
    }));
  });

  it('fails closed without a provider call when claim RPC cardinality is not exactly one', async () => {
    const key = '44444444-4444-4444-8444-444444444444';
    configureAddonRead(addonRow());
    rpc.mockResolvedValue({ data: [addResult()], error: null });
    adminRpc.mockResolvedValue({
      data: [
        { claimed: true, notified: 'PENDING' },
        { claimed: false, notified: 'PENDING' },
      ], error: null,
    });

    const response = await post({ name: '加購', price: 10, quantity: 1, durationMinutes: 0, notify: true, idempotencyKey: key });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      success: false, code: 'REQ_003', data: { persisted: true, notificationPending: true },
    });
    expect(notifyBookingAddonReceipt).not.toHaveBeenCalled();
    expect(adminRpc).toHaveBeenCalledOnce();
  });
});
