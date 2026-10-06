/**
 * src/server/rate-limit.ts — 極簡固定視窗節流（issue #46 Final Risk 修復 F1）
 * -----------------------------------------------------------------------------
 * `POST /api/public/tour-requests` 是全站第一支不需要登入就能寫入資料的 API。
 * 在它之前，全 repo 對「節流／rate limit」零命中——所有既有寫入路徑都在
 * `requireTenant()`／`requireTenantManager()` 之後，攻擊者要先有一組帳密。
 * 這支公開端點沒有這道閘門，所以本檔補上進入這個檔案之前完全不存在的第一層
 * 節流防護。
 *
 * ## 誠實的限制（不要假裝這是完整方案）
 *
 * 這是**單一 process 記憶體內**的固定視窗計數器，不是 Redis／Upstash 這類跨
 * instance 共享儲存——本專案目前沒有任何這類基礎設施（`.env.example` 沒有
 * REDIS_URL／UPSTASH_* 這類變數）。在多 instance 的 serverless 部署下（Vercel
 * 預設如此），同一個 IP 打到不同的 lambda instance 會各自維護一份計數，實際
 * 上限是「每個 instance 的上限」乘以「同時服務這個 IP 的 instance 數」，不是
 * 精確的全域上限。
 *
 * 即便如此，這仍然把攻擊成本從「一個腳本、零延遲、打到單一 tenant 上萬次」
 * 拉高到「要嘛分散到夠多 IP，要嘛打到夠多不同 instance」——比完全不設防好，
 * 且是這一輪能在不引入新的付費外部依賴（Redis／Upstash）的前提下，誠實地
 * 立刻生效的第一層。跨 instance 精確節流需要外部共享儲存，留給日後真的量測
 * 到濫用時再評估要不要導入，不在這個修復的範圍內硬做一個看起來完整、實際上
 * 沒有基礎設施支撐的方案。
 */

type Bucket = { count: number; windowStartMs: number };

const buckets = new Map<string, Bucket>();

/** 定期清掉早就過期的 bucket，避免這個 Map 無限成長（記憶體洩漏）。 */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let lastCleanupAt = Date.now();

function cleanupExpired(nowMs: number, windowMs: number): void {
  if (nowMs - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
  lastCleanupAt = nowMs;
  for (const [key, bucket] of buckets) {
    if (nowMs - bucket.windowStartMs >= windowMs) buckets.delete(key);
  }
}

/**
 * 檢查並記錄一次呼叫。回傳 `true` 表示這次呼叫仍在額度內（呼叫端可以繼續）；
 * 回傳 `false` 表示超過額度，呼叫端應該回 429。
 *
 * 固定視窗（fixed window），不是滑動視窗：實作最簡單、足以擋掉本檔要擋的
 * 「單一來源短時間內大量灌單」——不需要為了節流本身的精度再引入複雜度。
 */
export function checkRateLimit(
  key: string,
  { max, windowMs }: { max: number; windowMs: number },
): boolean {
  const now = Date.now();
  cleanupExpired(now, windowMs);

  const existing = buckets.get(key);
  if (!existing || now - existing.windowStartMs >= windowMs) {
    buckets.set(key, { count: 1, windowStartMs: now });
    return true;
  }

  if (existing.count >= max) return false;
  existing.count += 1;
  return true;
}

/**
 * 不建立也不修改 bucket 的檢查：回傳「若現在呼叫 checkRateLimit 是否會被允許」。
 * 沒有 bucket 或視窗已過期 → true；否則 count < max。
 * 用來在真正計數前先擋掉會被拒絕的請求，避免被拒絕的請求仍建立新 bucket（記憶體無上限成長）。
 */
export function peekRateLimit(
  key: string,
  { max, windowMs }: { max: number; windowMs: number },
): boolean {
  const existing = buckets.get(key);
  if (!existing || Date.now() - existing.windowStartMs >= windowMs) return true;
  return existing.count < max;
}

/** 僅供測試：目前 bucket 數量。 */
export function __rateLimitBucketCountForTest(): number {
  return buckets.size;
}

/** 取逗號分隔清單的「最右邊」非空片段（最近一層可信 proxy 附加的值）。 */
function rightmostSegment(value: string | null): string | null {
  if (!value) return null;
  const parts = value.split(',');
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const seg = parts[i]?.trim();
    if (seg) return seg;
  }
  return null;
}

/**
 * 從請求標頭取用戶端 IP，**只採信平台附加的值**（issue #750）。
 *
 * 舊版取 `x-forwarded-for` 的第一段，但那一段是客戶端自己可以偽造的：
 * 攻擊者每次送不同的假 `X-Forwarded-For: 1.2.3.N` 就能換一個 bucket key，
 * 繞過本檔所有 per-IP 節流。
 *
 * Vercel 官方文件（docs/headers/request-headers）：
 * - `x-forwarded-for`：「we currently overwrite the X-Forwarded-For header and
 *   do not forward external IPs. This restriction is in place to prevent IP
 *   spoofing.」→ 在 Vercel 上這個值由平台覆寫，不含客戶端送來的內容。
 * - `x-vercel-forwarded-for`：「identical to the x-forwarded-for header. However,
 *   x-forwarded-for could be overwritten if you're using a proxy on top of Vercel.」
 * - `x-real-ip`：「identical to the x-forwarded-for header.」
 *
 * 取值規則：
 * 1. 優先順序 `x-vercel-forwarded-for` → `x-real-ip` → `x-forwarded-for`。
 *    （在 Vercel 上三者同值；`x-vercel-forwarded-for` 不會被前置 proxy 改寫。）
 * 2. 任何一個標頭若是逗號清單，一律取「最右邊」非空片段——那是離我們最近、
 *    最後一層可信 proxy 附加的值；最左邊的片段是客戶端可控的，絕不採用。
 * 3. 不在 Vercel 上（本機開發／測試）沒有可信平台，也沿用同一套確定性規則，
 *    不會讓客戶端可控的最左片段決定 key。
 * 4. 完全沒有可用標頭 → 退回固定字串 `'unknown-ip'`：所有請求共用同一個額度，
 *    是刻意的保守退路（寧可誤傷，也不因為抓不到 IP 就完全不節流）。
 *
 * 已知限制：若部署在「非 Vercel、且前面沒有會覆寫 XFF 的可信 proxy」的環境，
 * 單一來源仍可自行送出任意 `x-real-ip`／`x-forwarded-for`（rightmost 規則只能
 * 擋掉「附加在前面」的偽造，擋不住完全由客戶端決定的單一值）。本專案正式環境
 * 為 Vercel，故此處不另做 trusted-proxy 設定。
 */
export function clientIpFromHeaders(headers: Headers): string {
  return (
    rightmostSegment(headers.get('x-vercel-forwarded-for')) ??
    rightmostSegment(headers.get('x-real-ip')) ??
    rightmostSegment(headers.get('x-forwarded-for')) ??
    'unknown-ip'
  );
}
