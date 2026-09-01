/**
 * src/server/features.ts — 功能閘門（Phase 5.5，09 分冊 §5）
 *
 * 有效性判定（09 分冊 §2，全後端統一）：
 *   featureActive(code) = 存在訂閱列 且 active 且 (expires_at is null 或 expires_at > now())
 * `cancelled_at` 不影響到期前可用；`source='GRANTED'` 且 `expires_at null` = 平台永久贈送。
 *
 * 用法：route handler 在 `requireTenant()` 之後呼叫
 *   `await requireFeature(t.tenantId, 'CODE')` → 未訂閱丟 403 FEAT_001。
 * cron / fire-and-forget 段落（不該回 403 的地方）改用 `isFeatureActive()` 判斷跳過。
 *
 * ⚠️ 尚未落地的閘門（落點屬 06 分冊，Phase 6 端點尚不存在，待 Phase 6 實作時套用）：
 * - KEYWORD_REPLY：`/api/settings/line/keyword-replies` 寫入端點 + POST 時檢查
 *   該店筆數 ≥ 20 → 409「每店最多 20 組」
 * - EXTRA_PUSH：由 `src/server/line.ts` 讀取有效訂閱並以資料庫 RPC 原子扣減
 * - CUSTOM_RICH_MENU：06 §6 進階選單端點（create-advanced/create-custom 等；基本 5 主題不擋）
 * - AI_ASSISTANT：webhook 內 AI 回覆分支（09 分冊 §7）
 */
import { createAdminSupabase } from './supabase';
import { ApiHttpError, ERR } from './http';

export async function isFeatureActive(tenantId: string, code: string): Promise<boolean> {
  const admin = createAdminSupabase();
  const { data } = await admin.from('feature_subscriptions')
    .select('active, expires_at').eq('tenant_id', tenantId).eq('code', code).maybeSingle();
  if (!data?.active) return false;
  return !data.expires_at || new Date(data.expires_at) > new Date();
}

export async function requireFeature(tenantId: string, code: string) {
  if (!(await isFeatureActive(tenantId, code)))
    throw new ApiHttpError(403, '此功能尚未訂閱，請至功能商店開通', ERR.FEATURE_LOCKED);
}
