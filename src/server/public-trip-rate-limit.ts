/**
 * 公開行程詳情（頁面與 API）共用的節流規則。不修改共用的 rate-limit 模組。
 *
 * 兩層：
 * 1. 來源級（只以 IP 為 key）：300 次／10 分鐘。店家級 key 含 shopCode，攻擊者換店碼就能拿到新額度；
 *    來源級上限讓同一 IP 換多個「合法格式」店碼時，總量仍受限，也限制每個 IP 能建立的 bucket 數。
 * 2. 店家級（IP＋shopCode，頁面與 API 各自前綴）：60 次／10 分鐘。
 * 呼叫端必須先以 SHOP_CODE_PATTERN 驗證 shopCode，格式不合者不得進入此函式（不建立 bucket）。
 */
import { checkRateLimit } from '@/server/rate-limit';

export const PUBLIC_TRIP_WINDOW_MS = 10 * 60 * 1000;
export const PUBLIC_TRIP_IP_MAX = 300;
export const PUBLIC_TRIP_SHOP_MAX = 60;

export function consumePublicTripRateLimit(
  scope: 'page' | 'api',
  ip: string,
  shopCode: string,
): boolean {
  if (!checkRateLimit(`public-trip-ip:${ip}`, { max: PUBLIC_TRIP_IP_MAX, windowMs: PUBLIC_TRIP_WINDOW_MS })) {
    return false;
  }
  return checkRateLimit(`public-trip-${scope}:${ip}:${shopCode}`, {
    max: PUBLIC_TRIP_SHOP_MAX, windowMs: PUBLIC_TRIP_WINDOW_MS,
  });
}
