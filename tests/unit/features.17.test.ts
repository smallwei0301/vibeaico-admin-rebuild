import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createAdminSupabase } = vi.hoisted(() => ({ createAdminSupabase: vi.fn() }));
vi.mock('@/server/supabase', () => ({ createAdminSupabase }));

import { isFeatureActive } from '@/server/features';

describe('Issue #17 quota feature boundary', () => {
  beforeEach(() => createAdminSupabase.mockReset());

  it('propagates a feature subscription query error so quota reservation fails closed', async () => {
    const databaseError = { code: '08006', message: 'feature query unavailable' };
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: databaseError });
    const eqCode = vi.fn(() => ({ maybeSingle }));
    const eqTenant = vi.fn(() => ({ eq: eqCode }));
    const select = vi.fn(() => ({ eq: eqTenant }));
    createAdminSupabase.mockReturnValue({ from: vi.fn(() => ({ select })) });

    await expect(isFeatureActive('tenant', 'EXTRA_PUSH')).rejects.toEqual(databaseError);
  });
});
