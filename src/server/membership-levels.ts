import { ApiHttpError, ERR } from './http';

export type MembershipLevelRule = {
  id: string;
  threshold: number;
  active?: boolean | null;
  isDefault?: boolean | null;
};

/**
 * Y.5 membership assignment contract:
 * - only active levels participate;
 * - the highest threshold reached wins;
 * - when no threshold is reached, the active default is the fallback.
 */
export function resolveMembershipLevelId(
  levels: readonly MembershipLevelRule[],
  totalSpent: number,
): string | null {
  const active = levels.filter((level) => level.active !== false);
  const sorted = [...active].sort((a, b) => b.threshold - a.threshold);
  return sorted.find((level) => level.threshold <= totalSpent)?.id
    ?? active.find((level) => level.isDefault === true)?.id
    ?? null;
}

/** Convert the partial unique index race into the API's standard 409 contract. */
export function raiseMembershipLevelWriteError(error: unknown): never {
  if ((error as { code?: unknown } | null)?.code === '23505') {
    throw new ApiHttpError(
      409,
      '預設會員等級已被其他操作設定，請重新整理後再試',
      ERR.CONFLICT,
    );
  }
  throw error;
}
