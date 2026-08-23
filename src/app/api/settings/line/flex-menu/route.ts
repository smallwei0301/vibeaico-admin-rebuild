import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { lineSettingsSchema } from '@/config/tenant-settings';

/**
 * POST /api/settings/line/flex-menu —— 儲存 Flex 主選單設定（06 分冊 §6）。
 * 存進 tenant_settings.line jsonb；webhook 的「選單」關鍵字回這份設定組出的
 * Flex Message（webhook 屬另一 agent/分冊，這裡只負責儲存）。
 *
 * 只收 Flex 相關欄位（lineSettingsSchema 的 flex* + campaignKeywordEnabled），
 * 不碰 secret 欄位；合併語意與 PUT /api/settings/line 相同——只寫這次真的
 * 帶了的欄位，其餘保留舊值。需 MANAGER。
 */
const bodySchema = lineSettingsSchema.pick({
  flexMenuEnabled: true,
  flexMenuFallback: true,
  flexHeaderColor: true,
  flexHeaderTitle: true,
  flexHeaderSubtitle: true,
  flexShowTip: true,
  campaignKeywordEnabled: true,
}).partial();

export const POST = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  const b = bodySchema.parse(await req.json());

  const { data: row, error: rerr } = await t.supabase
    .from('tenant_settings')
    .select('line')
    .eq('tenant_id', t.tenantId)
    .maybeSingle();
  if (rerr) throw rerr;

  const line = { ...((row?.line ?? {}) as Record<string, unknown>) };
  for (const [k, v] of Object.entries(b)) {
    if (v !== undefined) line[k] = v;
  }
  // jsonb 內永不存 secret（與 PUT /api/settings/line 同一道防線）
  delete line.channelSecret;
  delete line.channelAccessToken;

  const { error } = await t.supabase
    .from('tenant_settings')
    .upsert({ tenant_id: t.tenantId, line }, { onConflict: 'tenant_id' });
  if (error) throw error;

  return ok();
});
