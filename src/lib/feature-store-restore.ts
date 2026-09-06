/**
 * Restore side-effect error handling shared by the HTTP route and its unit
 * contract. The restore itself succeeds when a best-effort coupon/product
 * update fails, so callers can surface a warning without claiming counts.
 */
export type RestoreSideEffectFailure = {
  restoreSideEffectFailed: true;
};

export async function withRestoreSideEffectFallback<T>(
  operation: () => Promise<T>,
  onFailure: (error: unknown) => void,
): Promise<T | RestoreSideEffectFailure> {
  try {
    return await operation();
  } catch (error) {
    onFailure(error);
    return { restoreSideEffectFailed: true };
  }
}
