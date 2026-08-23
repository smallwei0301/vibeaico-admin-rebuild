import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { aiSettingsSchema } from '@/config/tenant-settings';

/**
 * GET/PUT /api/ai-settings — AI 客服設定（09 分冊 §7.1）。
 * 讀寫 tenant_settings.ai jsonb（migration 0011）；/tenant/ai-settings 頁使用。
 */

/** GET — 回 AiSettings；老店（列不存在 / ai 空）由 zod 預設值補齊。 */
export const GET = handle(async () => {
  const t = await requireTenant();
  const { data: row, error } = await t.supabase
    .from('tenant_settings')
    .select('ai')
    .eq('tenant_id', t.tenantId)
    .maybeSingle();
  if (error) throw error;

  return ok(aiSettingsSchema.parse(row?.ai ?? {}));
});

/** PUT — body = AiSettings（整包覆蓋）⚙MANAGER。 */
export const PUT = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  // TODO(gating agent): 這裡之後要加 requireFeature(t.tenantId, 'AI_ASSISTANT')
  // —— 閘門統一由 src/server/features.ts 的 agent 之後套（09 分冊 §5），此處先不擋。
  const ai = aiSettingsSchema.parse(await req.json());

  const { error } = await t.supabase
    .from('tenant_settings')
    .upsert({ tenant_id: t.tenantId, ai }, { onConflict: 'tenant_id' });
  if (error) throw error;

  return ok();
});
