import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createAdminSupabase, isFeatureActive } = vi.hoisted(() => ({
  createAdminSupabase: vi.fn(), isFeatureActive: vi.fn(),
}));
vi.mock('@/server/supabase', () => ({ createAdminSupabase }));
vi.mock('@/server/features', () => ({ isFeatureActive }));

import { consumePushQuota } from '@/server/line';

describe('Issue #17 quota reservation failure', () => {
  beforeEach(() => {
    createAdminSupabase.mockReset();
    isFeatureActive.mockReset();
  });

  it('fails closed when the feature lookup errors, before issuing a quota RPC', async () => {
    isFeatureActive.mockRejectedValue(new Error('feature query unavailable'));
    await expect(consumePushQuota('tenant', 1)).resolves.toBe(false);
    expect(createAdminSupabase).not.toHaveBeenCalled();
  });

  it('returns the atomic RPC result and sends the computed base quota', async () => {
    isFeatureActive.mockResolvedValue(false);
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    createAdminSupabase.mockReturnValue({ rpc });
    await expect(consumePushQuota('tenant', 2)).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('consume_push_quota_17', expect.objectContaining({
      p_tenant_id: 'tenant', p_count: 2, p_quota: 200,
    }));
  });
});
