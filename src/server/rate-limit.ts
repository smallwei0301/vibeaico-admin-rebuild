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
 * 從請求標頭取用戶端 IP。Vercel／大多數反向代理會設定 `x-forwarded-for`
 * （可能是逗號分隔的多層代理鏈，第一個是原始客戶端）；本機開發或代理沒有
 * 設定時退回固定字串——這種情況下所有請求共用同一個節流額度，是刻意的保守
 * 退路（寧可誤傷同一台機器上的多個請求，也不要因為抓不到 IP 就完全不節流）。
 */
export function clientIpFromHeaders(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = headers.get('x-real-ip');
  if (real) return real.trim();
  return 'unknown-ip';
}
