/**
 * 公開頁建單的來源通路（issue #1090）
 * -----------------------------------------------------------------------------
 * 旅客從公開商店頁送出的團體訂單，`tour_orders.source` 預設是 `VIBEAI_SHOP`；
 * 只有確實從 LINE 帶出的連結（網址帶 `?src=line`）才記 `LINE`。
 *
 * 旅客端只能宣告 `channel: 'LINE' | 'SHOP'`（選填），伺服器端白名單驗證：
 * 其他任何值（含 MANUAL／MIDAO／亂碼）一律回退成 `VIBEAI_SHOP`，不回 400
 * ——來源只是歸因標籤，不值得讓旅客的訂位因此失敗。
 */
export const PUBLIC_ORDER_CHANNELS = ['LINE', 'SHOP'] as const;
export type PublicOrderChannel = (typeof PUBLIC_ORDER_CHANNELS)[number];

export type PublicOrderSource = 'LINE' | 'VIBEAI_SHOP';

/** 伺服器端白名單：只有字面上等於 'LINE' 才記 LINE，其餘一律 VIBEAI_SHOP。 */
export function resolvePublicOrderSource(channel: unknown): PublicOrderSource {
  return channel === 'LINE' ? 'LINE' : 'VIBEAI_SHOP';
}

/** LINE 端產生公開連結時附帶的查詢參數。 */
export const LINE_SOURCE_PARAM = 'src';
export const LINE_SOURCE_VALUE = 'line';
/**
 * 後台「推廣」頁給店家貼進 LINE 圖文選單的網址是 `?utm_source=line`（已發布的選單不必重貼），
 * 所以 `utm_source=line` 與 `src=line` 都視為 LINE 來源。只認這兩個鍵、值只認 line。
 */
export const LINE_SOURCE_PARAMS = [LINE_SOURCE_PARAM, 'utm_source'] as const;

/**
 * 在「最終要送出的完整網址」上補 `src=line`。
 * 只能對完整網址呼叫，不可套在之後還要再接路徑的 base 上。
 * 已有查詢字串用 `&`、已帶 src 不重複、hash 保留在最後。
 */
export function withLineSource(url: string): string {
  const hashAt = url.indexOf('#');
  const hash = hashAt >= 0 ? url.slice(hashAt) : '';
  const head = hashAt >= 0 ? url.slice(0, hashAt) : url;
  if (new RegExp(`[?&]${LINE_SOURCE_PARAM}=`).test(head)) return url;
  const sep = head.includes('?') ? (/[?&]$/.test(head) ? '' : '&') : '?';
  return `${head}${sep}${LINE_SOURCE_PARAM}=${LINE_SOURCE_VALUE}${hash}`;
}

const STORAGE_KEY = 'vibeai:order-channel';

/** 網址參數是否標示來自 LINE（`src=line` 或 `utm_source=line`，大小寫不拘）。 */
export function isLineSourceSearch(search: string): boolean {
  const sp = new URLSearchParams(search);
  return LINE_SOURCE_PARAMS.some((k) => sp.get(k)?.toLowerCase() === LINE_SOURCE_VALUE);
}

/** client：進入公開頁時呼叫；網址帶 src=line／utm_source=line 就記在 sessionStorage，之後頁面跳轉仍保留。 */
export function captureLineSource(): void {
  try {
    if (isLineSourceSearch(window.location.search)) window.sessionStorage.setItem(STORAGE_KEY, 'LINE');
  } catch { /* storage 不可用時退回只看網址 */ }
}

/** client：送出表單時取得要帶給 API 的 channel。 */
export function readOrderChannel(): PublicOrderChannel {
  try {
    if (isLineSourceSearch(window.location.search)) return 'LINE';
    if (window.sessionStorage.getItem(STORAGE_KEY) === 'LINE') return 'LINE';
  } catch { /* 同上 */ }
  return 'SHOP';
}
