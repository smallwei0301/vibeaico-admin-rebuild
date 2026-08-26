import { z } from 'zod';
import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { type BusinessType } from '@/config/modes';
import { findSceneTemplate } from '@/config/rich-menu-scenes';
import { DEFAULT_RICH_MENU_LAYOUT } from '@/config/rich-menu-layouts';
import { richMenuDesignSchema, buildRichMenuPayload, previewImageDataUrl } from '@/server/rich-menu';

/**
 * POST /api/settings/line/rich-menu/preview-scene —— 情境範本的預覽
 * 規格：docs/integration/06-LINE-INTEGRATION.md §6.2.5
 *
 * ⚠️ **零 LINE 呼叫**（理由與斷言見 preview-advanced 的檔頭方框）。
 *
 * 回傳的東西與 `create-scene` 真的會建立的那一份**逐欄一致**——包含
 * 「每格文案用業態預設、不是範本自己的文案」這件事（§6.2.4 的已知規格缺口）。
 * 預覽顯示一組漂亮的餐廳文案、發布出去卻是預設六格，那個落差正是本專案在清的
 * 那一類假成功，所以兩支共用同一個 `buildRichMenuPayload()`。
 */
const bodySchema = z.object({ sceneId: z.string().trim().min(1, '請選擇一個情境範本') });

export const POST = handle(async (req) => {
  const t = await requireTenant();

  const { sceneId } = bodySchema.parse(await req.json().catch(() => ({})));
  const scene = findSceneTemplate(sceneId);
  if (!scene) throw new ApiHttpError(404, '找不到這個情境範本', ERR.NOT_FOUND);

  const { data: tenantRow } = await t.supabase.from('tenants')
    .select('business_type').eq('id', t.tenantId).maybeSingle();
  const businessType = (tenantRow?.business_type ?? 'LOCAL_SHOP') as BusinessType;

  const design = richMenuDesignSchema.parse({
    theme: scene.theme,
    layout: DEFAULT_RICH_MENU_LAYOUT,
    cells: [],
  });
  const payload = buildRichMenuPayload(design, businessType);

  return ok({
    sceneId: scene.id,
    sceneName: scene.name,
    size: payload.size,
    chatBarText: payload.chatBarText,
    areas: payload.areas,
    theme: scene.theme,
    imageDataUrl: previewImageDataUrl(scene.theme),
    imageIsFlatColor: true,
    /**
     * ⚠️ 誠實欄位：範本**只決定主題配色**，六格文案用的是業態預設值。
     * 頁面要照這個旗標顯示說明，不得讓店家以為按下去會拿到範本專屬文案。
     */
    cellsAreModeDefaults: true,
  });
});
