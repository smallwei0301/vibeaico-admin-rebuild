/** 首頁「今日預約」與預約頁「未處理」查詢用的時間範圍純函式（#908）。 */

/** 瀏覽器本地時間 `now` 當天 00:00:00.000 ~ 23:59:59.999，轉成 ISO。 */
export function localDayRange(now: Date = new Date()): { from: string; to: string } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return { from: start.toISOString(), to: end.toISOString() };
}

/**
 * 「未處理」預約的 API 時間上限：僅在使用者未設結束日期時帶現在時間；
 * 有 endDate 則維持原行為（回傳 undefined）。
 */
export function unprocessedUpperBound(
  status: string, endDate: string | undefined | null, now: Date = new Date(),
): string | undefined {
  if (status !== 'UNPROCESSED' || endDate) return undefined;
  return now.toISOString();
}
