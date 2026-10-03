/**
 * 公開行程詳情（頁面與 API）共用的節流規則（使用共用 rate-limit 模組的 peek／check）。
 *
 * 兩層：
 * 1. 來源級（只以 IP 為 key）：300 次／10 分鐘。
 * 2. 店家級（IP＋shopCode，頁面與 API 各自前綴）：60 次／10 分鐘。店家級 key 含 shopCode，攻擊者換店碼就能拿到新額度；
 *    來源級上限讓同一 IP 換多個「合法格式」店碼時，總量仍受限，也限制每個 IP 能建立的 bucket 數。
 * 呼叫端必須先以 SHOP_CODE_PATTERN 驗證 shopCode，格式不合者不得進入此函式（不建立 bucket）。
 */
import { checkRateLimit, peekRateLimit } from '@/server/rate-limit';

export const PUBLIC_TRIP_WINDOW_MS = 10 * 60 * 1000;
export const PUBLIC_TRIP_IP_MAX = 300;
export const PUBLIC_TRIP_SHOP_MAX = 60;

export function consumePublicTripRateLimit(
  scope: 'page' | 'api',
  ip: string,
  shopCode: string,
): boolean {
  const ipKey = `public-trip-ip:${ip}`;
  const shopKey = `public-trip-${scope}:${ip}:${shopCode}`;
  const ipLimit = { max: PUBLIC_TRIP_IP_MAX, windowMs: PUBLIC_TRIP_WINDOW_MS };
  const shopLimit = { max: PUBLIC_TRIP_SHOP_MAX, windowMs: PUBLIC_TRIP_WINDOW_MS };
  // 先 peek（不建立、不修改 bucket）：被來源級擋下的請求不會建立新的店家級 bucket（換無限多個合法格式
  // 店碼也無法讓 bucket Map 無上限成長）；被店家級擋下的請求也不會扣來源級額度（CGNAT 共用 IP 的
  // 其他旅客不被誤傷）。兩者都允許才依序扣兩層。
  if (!peekRateLimit(ipKey, ipLimit)) return false;
  if (!peekRateLimit(shopKey, shopLimit)) return false;
  checkRateLimit(shopKey, shopLimit);
  return checkRateLimit(ipKey, ipLimit);
}
