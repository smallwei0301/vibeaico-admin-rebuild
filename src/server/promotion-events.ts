/**
 * src/server/promotion-events.ts — 公開頁埋點與 180 天 retention cleanup（Issue #23）
 * -----------------------------------------------------------------------------
 * Owner Decision `docs/decisions/2026-09-14-promotion-anonymous-approximate-uv.md`
 * ＋ Issue #23「公開頁造訪真的產生 event；埋點失敗不得影響公開頁」。
 *
 * `recordPromotionPageView()` 是 **best-effort**：任何一步失敗（缺 env、DB 暫時
 * 不可用、headers() 讀取失敗……）一律吞掉，只在伺服器 log 留一行方便排查，絕不
 * 讓例外冒到呼叫端（`/s/[shopCode]` 的公開頁 render 路徑）——那條頁面對顧客而言
 * 是全站唯一不需要登入就打得到的頁面，統計是次要副作用，不能因為它失敗就打掛
 * 顧客的瀏覽體驗。
 *
 * 寫入用 service role（`createAdminSupabase()`），不是因為需要繞過什麼合法的
 * RLS，而是匿名訪客本來就不是任何租戶的成員、也不該是——`tenant_id` 只能來自
 * server 端已經從 shopCode 解析出的那個租戶（見 `src/server/public-shop.ts`），
 * 從來不接受呼叫端指定，這正是遷移檔「匿名寫入安全」一節要求的邊界。
 */
import { headers } from 'next/headers';
import { createAdminSupabase } from '@/server/supabase';
import {
  classifyUserAgent,
  computeVisitorHash,
  taipeiDateKey,
} from '@/server/promotion-visitor-hash';

export type PromotionSource = 'QR' | 'LINE' | 'DIRECT';

/**
 * Issue #23 最小來源分類：`?src=qr` → QR、`?src=line` → LINE、其餘（含無參數）
 * → DIRECT。大小寫不敏感；不認得的值一律落 DIRECT，不為了 enum 好看自行猜測
 * 新來源（REFERRAL 等只有在 current public-link contract 真有可驗證入口時才加）。
 */
export function classifySource(rawSrc: string | undefined | null): PromotionSource {
  const v = (rawSrc ?? '').trim().toLowerCase();
  if (v === 'qr') return 'QR';
  if (v === 'line') return 'LINE';
  return 'DIRECT';
}

/**
 * 算 visitor_hash 用的平台密鑰。專用密鑰未設定時退回 `SETTINGS_ENCRYPTION_KEY`，
 * 兩者都沒有時退回一個固定字串——寧可讓匿名統計在還沒設密鑰的環境（例如本機
 * mock 開發）下「salt 不夠隨機但功能可跑」，也不要讓公開頁因為缺一把統計用的
 * 鍵就整頁壞掉；這與本檔「埋點失敗不能打掛公開頁」是同一個立場，只是更早一步。
 */
function visitorSaltSecret(): string {
  return (
    process.env.PROMOTION_VISITOR_SALT_SECRET ||
    process.env.SETTINGS_ENCRYPTION_KEY ||
    'promotion-visitor-hash-dev-fallback-secret'
  );
}

/** Vercel／多數 proxy 慣例：`x-forwarded-for` 第一段是原始客戶端 IP。 */
function extractClientIp(h: Headers): string {
  const xff = h.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = h.get('x-real-ip')?.trim();
  return real || 'unknown';
}

/**
 * 公開頁造訪時 best-effort 寫一列 `page_view_events`。
 *
 * ⚠️ 整個函式體都在 try/catch 裡，不只是 DB 呼叫那一行——讀 `headers()`、算
 * hash 任何一步都可能丟錯，全部都不能影響公開頁的 render。
 */
export async function recordPromotionPageView(params: {
  tenantId: string;
  path: string;
  rawSrc: string | undefined | null;
}): Promise<void> {
  try {
    const h = await headers();
    const ip = extractClientIp(h);
    const userAgent = h.get('user-agent');
    const source = classifySource(params.rawSrc);
    const visitorHash = computeVisitorHash({
      ip,
      userAgent,
      dateKey: taipeiDateKey(),
      secret: visitorSaltSecret(),
    });
    const userAgentClass = classifyUserAgent(userAgent);

    const admin = createAdminSupabase();
    const { error } = await admin.from('page_view_events').insert({
      tenant_id: params.tenantId,
      path: params.path,
      source,
      visitor_hash: visitorHash,
      user_agent_class: userAgentClass,
    });
    if (error) {
      // 統計失敗要看得到（不能靜默到連排查線索都沒有），但不能讓例外冒出這個函式。
      console.error('[promotion] page_view_events insert failed', {
        tenantId: params.tenantId,
        path: params.path,
        message: error.message,
      });
    }
  } catch (e) {
    console.error('[promotion] recordPromotionPageView failed', {
      tenantId: params.tenantId,
      path: params.path,
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

/** 180 天保留邊界；cleanup route 與測試共用同一個常數，避免兩處數字漂移。 */
export const PROMOTION_EVENT_RETENTION_DAYS = 180;

/**
 * 刪除超過 180 天的 `page_view_events`（bounded：只刪過期列，`created_at` 在
 * 保留視窗內的完全不動——`.lt('created_at', cutoffIso)` 本身就是這個邊界）。
 *
 * 丟出的錯誤由呼叫端（cron route）決定怎麼回應；這裡不吞錯，因為 cleanup 本身
 * 失敗要看得見，只是**呼叫它的地方**（cron route）必須確保這個失敗不影響公開頁。
 */
export async function cleanupExpiredPromotionEvents(
  now: Date = new Date(),
): Promise<{ deleted: number; cutoffIso: string }> {
  const cutoffIso = new Date(
    now.getTime() - PROMOTION_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from('page_view_events')
    .delete()
    .lt('created_at', cutoffIso)
    .select('id');
  if (error) throw error;
  return { deleted: (data ?? []).length, cutoffIso };
}
