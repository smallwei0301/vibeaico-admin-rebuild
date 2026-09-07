import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiHttpError, ERR } from '@/server/http';

const mocks = vi.hoisted(() => ({
  requireTenant: vi.fn(),
  requireFeature: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/server/tenant', () => ({ requireTenant: mocks.requireTenant }));
vi.mock('@/server/features', () => ({ requireFeature: mocks.requireFeature }));

import { POST } from '@/app/api/bookings/[id]/apply-points/route';

const context = { params: Promise.resolve({ id: 'booking-a' }) };

async function post(points: unknown) {
  return POST(new Request('http://localhost/api/bookings/booking-a/apply-points', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ points }),
  }), context);
}

describe('Issue #218 booking point redemption route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireTenant.mockResolvedValue({
      tenantId: 'tenant-a',
      supabase: { rpc: mocks.rpc },
    });
    mocks.requireFeature.mockResolvedValue(undefined);
    mocks.rpc.mockResolvedValue({
      data: [{ final_price: 70, customer_points: 40 }],
      error: null,
    });
  });

  it('delegates the complete redemption to the atomic RPC with the selected tenant', async () => {
    const res = await post(30);

    expect(mocks.requireFeature).toHaveBeenCalledWith('tenant-a', 'POINT_SYSTEM');
    expect(mocks.rpc).toHaveBeenCalledWith('apply_booking_points', {
      p_tenant_id: 'tenant-a', p_booking_id: 'booking-a', p_points: 30,
    });
    await expect(res.json()).resolves.toEqual({
      success: true, data: { finalPrice: 70, customerPoints: 40 },
    });
  });

  it.each([
    ['BOOKING_POINTS_BOOKING_NOT_FOUND', 404, 'REQ_002'],
    ['BOOKING_POINTS_CUSTOMER_NOT_FOUND', 404, 'REQ_002'],
    ['BOOKING_POINTS_FINAL_PRICE_EXCEEDED', 400, 'REQ_001'],
    ['BOOKING_POINTS_INSUFFICIENT', 409, 'POINTS_001'],
  ])('preserves %s RPC error semantics', async (message, status, code) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message } });

    const res = await post(30);
    expect(res.status).toBe(status);
    await expect(res.json()).resolves.toMatchObject({ success: false, code });
  });

  it('fails closed at the feature gate without calling the RPC', async () => {
    mocks.requireFeature.mockRejectedValue(new ApiHttpError(403, '此功能尚未訂閱', ERR.FEATURE_LOCKED));

    const res = await post(30);
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ success: false, code: 'FEAT_001' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5])('rejects invalid points (%s) before the RPC', async (points) => {
    const res = await post(points);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ success: false, code: 'REQ_001' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('fails closed when the database has not exposed the RPC and never falls back to table writes', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'function not found' } });

    const res = await post(30);
    expect(res.status).toBe(500);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    await expect(res.json()).resolves.toMatchObject({ success: false, code: 'SYS_001' });
  });

  it('does not issue any non-atomic table writes from the route', async () => {
    const source = await import('node:fs/promises').then(({ readFile }) =>
      readFile('src/app/api/bookings/[id]/apply-points/route.ts', 'utf8'));
    expect(source).toContain("rpc('apply_booking_points'");
    expect(source).not.toMatch(/\.from\('(bookings|customers|customer_point_logs)'\)/);
  });
});
