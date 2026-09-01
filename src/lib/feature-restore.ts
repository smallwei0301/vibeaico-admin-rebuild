import type { FeatureRestoreResult } from '@/services/settings';

export type FeatureRestoreCopy = {
  restored: (name: string) => string;
  couponsRestored: (count: number) => string;
  productsRestored: (count: number) => string;
  restoreSideEffectFailed: string;
};

export type FeatureRestoreNotice = {
  message: string;
  tone: 'success' | 'warning';
};

export type RestoreFeature = (code: string) => Promise<FeatureRestoreResult | undefined>;

/**
 * 將恢復訂閱 API 的結果轉成使用者可理解的單一提示。
 * 副作用失敗時訂閱本身仍已恢復，必須用警告提示使用者手動補救。
 */
export function buildFeatureRestoreNotice(
  name: string,
  result: FeatureRestoreResult | undefined,
  copy: FeatureRestoreCopy,
): FeatureRestoreNotice {
  if (result?.restoreSideEffectFailed) {
    return {
      message: `${copy.restored(name)}${copy.restoreSideEffectFailed}`,
      tone: 'warning',
    };
  }

  const details = [copy.restored(name)];
  if ((result?.restoredCoupons ?? 0) > 0) {
    details.push(copy.couponsRestored(result?.restoredCoupons ?? 0));
  }
  if ((result?.restoredProducts ?? 0) > 0) {
    details.push(copy.productsRestored(result?.restoredProducts ?? 0));
  }

  return { message: details.join('\n'), tone: 'success' };
}

/** Keep the service call and its user-facing result in one testable seam. */
export async function restoreFeatureWithNotice(
  code: string,
  name: string,
  restore: RestoreFeature,
  copy: FeatureRestoreCopy,
): Promise<FeatureRestoreNotice> {
  return buildFeatureRestoreNotice(name, await restore(code), copy);
}
