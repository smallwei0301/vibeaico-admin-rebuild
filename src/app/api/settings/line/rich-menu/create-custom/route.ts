import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { getLineCredentials } from '@/server/line';
import { lineSettingsSchema } from '@/config/tenant-settings';
import {
  richMenuCustomSchema, buildCustomRichMenuPayload, publishRichMenu,
} from '@/server/rich-menu';

/**
 * POST /api/settings/line/rich-menu/create-custom —— 完全自訂座標區塊的發布
 * 規格：docs/integration/06-LINE-INTEGRATION.md §6.2.4
 *
 * 與 `create-advanced` 的唯一差別：**座標由呼叫端給**，不套 `RICH_MENU_LAYOUTS`
 * 的格線。所以這一支不需要 businessType（沒有「缺的格子用業態預設補」這件事，
 * 每一個 area 都是店家自己畫出來的）。
 *
 * 越界檢查在 `buildCustomRichMenuPayload()`：超出 2500×1686 的區塊 LINE 會整包退，
 * 當場 400 才換得掉；讓它送出去等於把失敗推遲到店家已經離開畫面的時候。
 *
 * 閘門：`CUSTOM_RICH_MENU` ＋ MANAGER。
 */
export const POST = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  await requireFeature(t.tenantId, 'CUSTOM_RICH_MENU');

  const body = richMenuCustomSchema.parse(await req.json().catch(() => ({})));
  const { token, lineConfig } = await getLineCredentials(t.tenantId);
  const line = lineSettingsSchema.partial().parse(lineConfig);

  const bgImageUrl = body.bgImageUrl || line.richMenuBgImageUrl || '';

  const result = await publishRichMenu({
    supabase: t.supabase,
    tenantId: t.tenantId,
    token,
    payload: buildCustomRichMenuPayload(body),
    config: { ...body, bgImageUrl, kind: 'CUSTOM' },
    theme: body.theme,
    bgImageUrl,
    lineConfig,
  });

  return ok(result);
});
