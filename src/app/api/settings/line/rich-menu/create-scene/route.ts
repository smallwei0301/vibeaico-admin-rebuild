import { z } from 'zod';
import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { getLineCredentials } from '@/server/line';
import { lineSettingsSchema } from '@/config/tenant-settings';
import { type BusinessType } from '@/config/modes';
import { findSceneTemplate } from '@/config/rich-menu-scenes';
import { DEFAULT_RICH_MENU_LAYOUT } from '@/config/rich-menu-layouts';
import {
  richMenuDesignSchema, buildRichMenuPayload, publishRichMenu,
} from '@/server/rich-menu';

/**
 * POST /api/settings/line/rich-menu/create-scene —— 依情境範本一鍵建立
 * 規格：docs/integration/06-LINE-INTEGRATION.md §6.2.4
 *
 * ⚠️ **範本只帶得動主題配色，帶不動每格文案**（REBUILD-SPEC §9.3 第 1 點：
 * 原站「哪一句屬於哪一個範本」的對應已遺失，spec 只留下排序後的扁平字串）。
 * 所以六格一律用 `MODE_PRESETS[businessType].richMenuCells`，版型用預設 3+4。
 *
 * **不得憑空補回遺失的對應關係**——替「🍽️ 餐廳」範本編一組看起來很合理的餐廳
 * 文案，會讓後來的人以為那是還原出來的原站資料（擁有者 2026-08-25 裁決用現有
 * `SCENE_TEMPLATES` 常數即可）。這件事同時寫在店家讀得到的畫面上，不只寫在這裡。
 *
 * 閘門：`CUSTOM_RICH_MENU` ＋ MANAGER。
 */
const bodySchema = z.object({ sceneId: z.string().trim().min(1, '請選擇一個情境範本') });

export const POST = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  await requireFeature(t.tenantId, 'CUSTOM_RICH_MENU');

  const { sceneId } = bodySchema.parse(await req.json().catch(() => ({})));
  const scene = findSceneTemplate(sceneId);
  if (!scene) throw new ApiHttpError(404, '找不到這個情境範本', ERR.NOT_FOUND);

  const { token, lineConfig } = await getLineCredentials(t.tenantId);
  const line = lineSettingsSchema.partial().parse(lineConfig);

  const { data: tenantRow } = await t.supabase.from('tenants')
    .select('business_type').eq('id', t.tenantId).maybeSingle();
  const businessType = (tenantRow?.business_type ?? 'LOCAL_SHOP') as BusinessType;

  const bgImageUrl = line.richMenuBgImageUrl || '';
  // cells 刻意留空 → buildRichMenuPayload() 用業態預設補滿（見上方 ⚠️）
  const design = richMenuDesignSchema.parse({
    theme: scene.theme,
    layout: DEFAULT_RICH_MENU_LAYOUT,
    cells: [],
    bgImageUrl,
    name: `vibeai-scene-${scene.id}`,
  });

  const result = await publishRichMenu({
    supabase: t.supabase,
    tenantId: t.tenantId,
    token,
    payload: buildRichMenuPayload(design, businessType),
    config: { ...design, sceneId: scene.id, sceneName: scene.name },
    theme: scene.theme,
    bgImageUrl,
    lineConfig,
  });

  return ok({ ...result, sceneId: scene.id });
});
