import { describe, expect, it, vi } from 'vitest';
import {
  buildFeatureRestoreNotice,
  restoreFeatureWithNotice,
  type FeatureRestoreCopy,
} from '@/lib/feature-restore';

const copy: FeatureRestoreCopy = {
  restored: (name) => `${name} restored`,
  couponsRestored: (count) => `${count} coupons restored`,
  productsRestored: (count) => `${count} products restored`,
  restoreSideEffectFailed: '\nmanual recovery required',
};

describe('buildFeatureRestoreNotice', () => {
  it('keeps the normal restore message when the API returns no details', () => {
    expect(buildFeatureRestoreNotice('Coupons', undefined, copy)).toEqual({
      message: 'Coupons restored',
      tone: 'success',
    });
  });

  it('includes positive coupon and product restore counts', () => {
    expect(buildFeatureRestoreNotice(
      'Catalog',
      { restoredCoupons: 2, restoredProducts: 3 },
      copy,
    )).toEqual({
      message: 'Catalog restored\n2 coupons restored\n3 products restored',
      tone: 'success',
    });
  });

  it('warns when restoring the subscription succeeds but side effects fail', () => {
    expect(buildFeatureRestoreNotice(
      'Catalog',
      { restoreSideEffectFailed: true },
      copy,
    )).toEqual({
      message: 'Catalog restored\nmanual recovery required',
      tone: 'warning',
    });
  });

  it('does not show zero-count side-effect details', () => {
    expect(buildFeatureRestoreNotice(
      'Catalog',
      { restoredCoupons: 0, restoredProducts: 0 },
      copy,
    )).toEqual({
      message: 'Catalog restored',
      tone: 'success',
    });
  });

  it('passes the restore API result through the page-facing wiring seam', async () => {
    const restore = vi.fn().mockResolvedValue({ restoredCoupons: 2 });

    await expect(restoreFeatureWithNotice('COUPON_SYSTEM', 'Catalog', restore, copy)).resolves.toEqual({
      message: 'Catalog restored\n2 coupons restored',
      tone: 'success',
    });
    expect(restore).toHaveBeenCalledWith('COUPON_SYSTEM');
  });
});
