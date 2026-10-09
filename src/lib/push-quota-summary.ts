/**
 * 本月平台推播額度的顯示邏輯（Issue #47）。純函式：不 fetch、不碰 i18n，
 * 門檻與 dashboard 一致（>=80% 警示、>=95% 幾乎用完、剩餘 0 為用完）。
 */
export type PushQuotaLevel = 'unknown' | 'ok' | 'warning' | 'almostOut' | 'exhausted';
export type PushQuotaTone = 'neutral' | 'success' | 'warning' | 'danger';

export interface PushQuotaSummary {
  used: number;
  total: number;
  remaining: number;
  /** 0–100 整數；total 為 0 時固定 0（避免除以零）。 */
  pct: number;
  level: PushQuotaLevel;
  tone: PushQuotaTone;
}

export const PUSH_QUOTA_WARN_PCT = 80;
export const PUSH_QUOTA_ALMOST_OUT_PCT = 95;

export function summarizePushQuota(usedRaw: number, totalRaw: number): PushQuotaSummary {
  const used = Number.isFinite(usedRaw) ? Math.max(0, usedRaw) : 0;
  const total = Number.isFinite(totalRaw) ? Math.max(0, totalRaw) : 0;
  const remaining = Math.max(total - used, 0);
  if (total === 0) {
    return { used, total, remaining: 0, pct: 0, level: 'unknown', tone: 'neutral' };
  }
  const pct = Math.round((used / total) * 100);
  if (remaining === 0) return { used, total, remaining, pct, level: 'exhausted', tone: 'danger' };
  if (pct >= PUSH_QUOTA_ALMOST_OUT_PCT) return { used, total, remaining, pct, level: 'almostOut', tone: 'danger' };
  if (pct >= PUSH_QUOTA_WARN_PCT) return { used, total, remaining, pct, level: 'warning', tone: 'warning' };
  return { used, total, remaining, pct, level: 'ok', tone: 'success' };
}
