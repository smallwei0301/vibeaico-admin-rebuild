/**
 * src/server/promotion-visitor-hash.ts — 匿名近似 UV 的 visitor_hash（Issue #23）
 * -----------------------------------------------------------------------------
 * Owner Decision `docs/decisions/2026-09-14-promotion-anonymous-approximate-uv.md`：
 * `visitor_hash` = 每日輪替 salt ＋ 當次 IP ＋ UA（或等價低敏訊號）算出的匿名 hash。
 * DB 只存 hash；原始 IP 只在計算當下短暫存在於呼叫堆疊裡，這個檔案完全不落地、
 * 也完全不 log 它。
 *
 * ⚠️ 這個檔案刻意寫成純函式（輸入 → 輸出，不碰 env / DB / console / next/headers）：
 *   1. 讓「同日同輸入同 hash、跨日 salt 改變則 hash 改變」這條 Owner Decision 明文
 *      要求的行為可以用 deterministic 單元測試直接證明，不需要真的發請求。
 *   2. 呼叫端（`src/server/promotion-events.ts`）自己決定 secret 與 ip/UA 從哪裡
 *      取得——這裡沒有任何 console.* 呼叫，不可能意外把原始 IP 印進 log。
 */
import { createHash } from 'crypto';

/** 低敏 UA 分類桶；DB 只存這個分類，不存原始 User-Agent 字串。 */
export type UserAgentClass = 'MOBILE' | 'DESKTOP' | 'BOT' | 'OTHER';

const BOT_PATTERN = /bot|crawler|spider|slurp|facebookexternalhit|bingpreview|headlesschrome/i;
const MOBILE_PATTERN = /mobile|iphone|ipad|ipod|android|line\//i;

/** 把原始 User-Agent 字串分類成低敏桶；空字串／缺值一律歸 'OTHER'。 */
export function classifyUserAgent(userAgent: string | null | undefined): UserAgentClass {
  const ua = (userAgent ?? '').trim();
  if (!ua) return 'OTHER';
  if (BOT_PATTERN.test(ua)) return 'BOT';
  if (MOBILE_PATTERN.test(ua)) return 'MOBILE';
  return 'DESKTOP';
}

/**
 * 台北「今天」的 YYYY-MM-DD——salt 每日輪替的邊界。
 *
 * 與 `src/server/tz.ts` 同一套「取 UTC 時間 +8 小時再用 getUTC* 讀欄位」算法，
 * 這裡不直接 import 該檔是因為它是純日期字串小工具，沒有 timestamptz range 的
 * 需求，維持這個模組完全獨立、零相依，方便單元測試。
 */
export function taipeiDateKey(now: Date = new Date()): string {
  const t = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const y = t.getUTCFullYear();
  const m = String(t.getUTCMonth() + 1).padStart(2, '0');
  const d = String(t.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 每日輪替 salt：平台密鑰（不外流）＋ 當天日期字串。
 * salt 本身不是秘密洩漏面——它不含 ip/ua，只用來讓同一組 (ip, ua) 在不同天
 * 產生不同的 visitor_hash，讓「近似 UV 不能跨日精準追蹤同一人」這條隱私邊界成立。
 */
export function dailySalt(secret: string, dateKey: string): string {
  return createHash('sha256').update(`promotion-visitor-salt:${dateKey}:${secret}`).digest('hex');
}

export type ComputeVisitorHashInput = {
  /** 當次請求的來源 IP。只作為這個函式的輸入短暫存在，回傳值與任何副作用都不含它。 */
  ip: string;
  userAgent: string | null | undefined;
  /** `taipeiDateKey()` 產生的日期字串；由呼叫端傳入，方便測試固定日期。 */
  dateKey: string;
  secret: string;
};

/**
 * 算出匿名 `visitor_hash`。
 *
 * - 同一天 ＋ 同一組 (ip, userAgent 分類) → 一定得到同一個 hash（PV 可以正確去重成 UV）。
 * - `dateKey` 不同 → 即使 ip/userAgent 完全相同也會得到不同 hash——這正是「近似 UV
 *   而非精準去重」的來源，Owner Decision 已明文接受這個因跨日 salt 輪替造成的誤差。
 * - 回傳值是 sha256 hex digest：單向、無法逆推回原始 ip；這個函式本身也從不
 *   `console.*` 或以任何其他方式外洩 `input.ip`。
 */
export function computeVisitorHash(input: ComputeVisitorHashInput): string {
  const salt = dailySalt(input.secret, input.dateKey);
  const uaClass = classifyUserAgent(input.userAgent);
  return createHash('sha256').update(`${salt}:${input.ip}:${uaClass}`).digest('hex');
}
