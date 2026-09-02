import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { consumePushQuotaWith, refundPushQuotaWith, reservePushQuotaWith } from '@/server/line';

type FakeResult = { data: unknown; error: unknown };

function fakeAdmin(subscription: FakeResult, rpcResult: FakeResult) {
  const maybeSingle = vi.fn().mockResolvedValue(subscription);
  const eqCode = vi.fn().mockReturnValue({ maybeSingle });
  const eqTenant = vi.fn().mockReturnValue({ eq: eqCode });
  const select = vi.fn().mockReturnValue({ eq: eqTenant });
  const from = vi.fn().mockReturnValue({ select });
  const rpc = vi.fn().mockResolvedValue(rpcResult);
  return {
    admin: { from, rpc } as unknown as Pick<SupabaseClient, 'from' | 'rpc'>,
    from,
    rpc,
  };
}

describe('Issue #15 push quota atomic seam', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reads the feature flag, then delegates the increment to the guarded RPC', async () => {
    const { admin, from, rpc } = fakeAdmin(
      { data: { active: false, expires_at: null }, error: null },
      { data: true, error: null },
    );
    await expect(consumePushQuotaWith(admin, 'tenant-1', 1)).resolves.toBe(true);
    expect(from).toHaveBeenCalledWith('feature_subscriptions');
    expect(rpc).toHaveBeenCalledWith('consume_push_quota', expect.objectContaining({
      p_tenant_id: 'tenant-1', p_count: 1, p_quota: 200,
    }));
  });

  it('fails closed when feature lookup or the atomic RPC fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const lookup = fakeAdmin(
      { data: null, error: new Error('database unavailable') },
      { data: true, error: null },
    );
    await expect(consumePushQuotaWith(lookup.admin, 'tenant-1', 1))
      .rejects.toMatchObject({ status: 503, code: 'SYS_001' });
    expect(lookup.rpc).not.toHaveBeenCalled();

    const rpcFailure = fakeAdmin(
      { data: null, error: null },
      { data: null, error: new Error('rpc unavailable') },
    );
    await expect(consumePushQuotaWith(rpcFailure.admin, 'tenant-1', 1))
      .rejects.toMatchObject({ status: 503, code: 'SYS_001' });
  });

  it('delegates failed-push reservations to the guarded refund RPC', async () => {
    const { admin, rpc } = fakeAdmin(
      { data: null, error: null },
      { data: true, error: null },
    );
    await expect(refundPushQuotaWith(admin, 'tenant-1', 1)).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('refund_push_quota', expect.objectContaining({
      p_tenant_id: 'tenant-1', p_count: 1,
    }));
  });

  it('persists a message-bound reservation token and original month', async () => {
    const { admin, rpc } = fakeAdmin(
      { data: { active: false, expires_at: null }, error: null },
      { data: [{ accepted: true, reservation_token: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }], error: null },
    );
    const result = await reservePushQuotaWith(
      admin,
      'tenant-1',
      1,
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    );
    expect(result).toMatchObject({ accepted: true, token: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' });
    expect(result.month).toMatch(/^\d{4}-\d{2}$/);
    expect(rpc).toHaveBeenCalledWith('reserve_push_quota', expect.objectContaining({
      p_tenant_id: 'tenant-1',
      p_chat_message_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      p_count: 1,
    }));
  });

  it('uses the reservation month/token for an idempotent refund', async () => {
    const { admin, rpc } = fakeAdmin(
      { data: null, error: null },
      { data: true, error: null },
    );
    await expect(refundPushQuotaWith(admin, 'tenant-1', 1, {
      month: '2026-08', token: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    })).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('refund_push_quota', {
      p_tenant_id: 'tenant-1', p_month: '2026-08', p_count: 1,
      p_reservation_token: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    });
  });
});
