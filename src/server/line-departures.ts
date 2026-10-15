/**
 * LINE「團次」指令的純函式（#1022）：可列出的團次判定與以店家時區計算的日期窗。
 * 刻意不碰資料庫，讓規則可以單獨測試。
 */
import { resolvePublicTimeZone, tenantNowParts } from '@/lib/public-time-zone';

export const DEPARTURE_WINDOW_DAYS = 14;

/** 純日期字串加減天數（以 UTC 午夜運算，不受任何時區影響，結果仍是日曆日）。 */
export function addCalendarDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** 店家時區的「今天」到「+14 天」（含）。時區缺值或無效回退 Asia/Taipei。 */
export function departureWindow(nowMs: number, timeZone: unknown): { from: string; to: string } {
  const from = tenantNowParts(resolvePublicTimeZone(timeZone), nowMs).today;
  return { from, to: addCalendarDays(from, DEPARTURE_WINDOW_DAYS) };
}

type DepartureLike = { plan_id?: string | null };

/**
 * 排除買不到的團次（停用或查無方案）；公開首頁目前仍以無連結 badge 列出停用方案團次，LINE 刻意更嚴格。
 * plan_id 為 null 的團次維持列出（不附連結）。
 * 呼叫端須先處理方案查詢失敗（交由預設回覆），不得把失敗當成「沒有團次」。
 */
export function filterListableDepartures<T extends DepartureLike>(
  departures: T[],
  plans: Array<{ id: string; active?: boolean | null }>,
): T[] {
  const activeIds = new Set(plans.filter((p) => p.active === true).map((p) => p.id));
  return departures.filter((d) => {
    if (!d.plan_id) return true;
    return activeIds.has(d.plan_id);
  });
}
