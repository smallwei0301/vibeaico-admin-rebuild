import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc, requireTenant } = vi.hoisted(() => ({ rpc: vi.fn(), requireTenant: vi.fn() }));

vi.mock('@/server/tenant', () => ({ requireTenant }));
vi.mock('@/server/mappers', () => ({ mapBookingAddon: vi.fn((row) => row) }));
vi.mock('@/server/booking-addon-notify', () => ({ notifyBookingAddonReceipt: vi.fn() }));
vi.mock('@/server/supabase', () => ({ createAdminSupabase: vi.fn() }));

import { POST } from '@/app/api/bookings/[id]/addons/route';
import { DELETE } from '@/app/api/bookings/[id]/addons/[addonId]/route';

describe('Issue #17 add-on route overlap regression', () => {
  beforeEach(() => {
    rpc.mockReset();
    requireTenant.mockResolvedValue({ tenantId: 'a1000000-0000-4000-8000-000000000001', supabase: { rpc } });
  });

  it('maps the native bookings exclusion violation (23P01) to truthful 409 with no success envelope', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '23P01', message: 'x_bookings_overlap' } });
    const response = await POST(new Request('http://localhost/api/bookings/b/addons', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '會撞期的加購', price: 100, quantity: 1, durationMinutes: 30, notify: false }),
    }), { params: Promise.resolve({ id: 'b' }) });
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
});
