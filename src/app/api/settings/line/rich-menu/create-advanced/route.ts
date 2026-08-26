import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { getLineCredentials } from '@/server/line';
import { lineSettingsSchema } from '@/config/tenant-settings';
import { type BusinessType } from '@/config/modes';
import {
  richMenuDesignSchema, buildRichMenuPayload, publishRichMenu,
} from '@/server/rich-menu';

/**
 * POST /api/settings/line/rich-menu/create-advanced —— 自訂版型／每格設定的發布
 * 規格：docs/integration/06-LINE-INTEGRATION.md §6.2.4
 *
 * 與基本 `create` 的差別只有兩個：版型與每格內容由店家決定（不是 MODE_PRESETS
 * 的固定六格），以及**會維護還原點**（§6.2.2 的三代輪替）。發布序列、回滾、
 * 底圖優先序三者與基本端點共用同一份實作（`src/server/rich-menu.ts`）。
 *
 * 閘門：`CUSTOM_RICH_MENU`（09 分冊 §5：進階端點擋，基本 5 主題不擋）＋ MANAGER。
 */
export const POST = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  await requireFeature(t.tenantId, 'CUSTOM_RICH_MENU');

  const design = richMenuDesignSchema.parse(await req.json().catch(() => ({})));
  const { token, lineConfig } = await getLineCredentials(t.tenantId);
  const line = lineSettingsSchema.partial().parse(lineConfig);

  const { data: tenantRow } = await t.supabase.from('tenants')
    .select('business_type').eq('id', t.tenantId).maybeSingle();
  const businessType = (tenantRow?.business_type ?? 'LOCAL_SHOP') as BusinessType;

  // 底圖：這次請求帶的優先，否則用店家存在 tenant_settings 的那一張
  const bgImageUrl = design.bgImageUrl || line.richMenuBgImageUrl || '';

  const result = await publishRichMenu({
    supabase: t.supabase,
    tenantId: t.tenantId,
    token,
    payload: buildRichMenuPayload(design, businessType),
    config: { ...design, bgImageUrl },
    theme: design.theme,
    bgImageUrl,
    lineConfig,
  });

  return ok(result);
});
