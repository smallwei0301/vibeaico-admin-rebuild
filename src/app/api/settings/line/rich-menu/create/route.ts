import { z } from 'zod';
import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { createAdminSupabase } from '@/server/supabase';
import { lineSettingsSchema } from '@/config/tenant-settings';
import { MODE_PRESETS, type BusinessType } from '@/config/modes';
import { RICH_MENU_THEME_KEYS, RICH_MENU_THEME_COLORS } from '@/config/rich-menu-themes';
import { solidColorPng } from '@/server/png';
import {
  getLineCredentials, lineCreateRichMenu, lineUploadRichMenuImage,
  lineSetDefaultRichMenu, lineDeleteRichMenu,
} from '@/server/line';

/**
 * POST /api/settings/line/rich-menu/create —— 建立並發布 Rich Menu（06 分冊 §6 MVP）。
 *
 * 流程（§6 表格 ①–⑤）：
 *   ① 依 richMenuTheme 產生 2500×1686 六格選單設定（message action）
 *   ② POST /v2/bot/richmenu 建立
 *   ③ 上傳圖片到 api-data.line.me（底圖：店家自傳 richMenuBgImageUrl 優先，
 *      否則取 richmenu-assets bucket 內預先做好的主題底圖 themes/{THEME}.png|jpg；
 *      兩者都拿不到 → 404 明確 message）
 *   ④ POST /v2/bot/user/all/richmenu/{id} 設為預設
 *   ⑤ richMenuId 記到 tenant_settings.line jsonb（順帶 best-effort 刪舊選單）
 *
 * 閘門（09 分冊 §5）：CUSTOM_RICH_MENU 只擋**進階**端點（create-advanced 等），
 * 基本主題（本端點）不擋。需 MANAGER。
 *
 * MVP 簡化：richMenuNoOverlay / richMenuTextColor 是文字疊圖合成用（§6 註明
 * 設計器合成屬後期），本端點直接用底圖原圖上傳。
 */

/** 六格（3×2）格線：833+833+834 = 2500；843+843 = 1686 */
const CELLS = [
  { x: 0, y: 0, w: 833, h: 843 }, { x: 833, y: 0, w: 833, h: 843 }, { x: 1666, y: 0, w: 834, h: 843 },
  { x: 0, y: 843, w: 833, h: 843 }, { x: 833, y: 843, w: 833, h: 843 }, { x: 1666, y: 843, w: 834, h: 843 },
];
/**
 * 六格的 message action 文字改由 MODE_PRESETS.richMenuCells 決定。
 *
 * 原本這裡寫死 ['預約','我的預約','服務項目','會員卡','優惠','聯絡我們']，
 * 三種業態共用——但嚮導賣的是行程與團次，他的顧客按「服務項目」送出的文字
 * 沒有任何 handler 認得（那些關鍵字屬 LOCAL_SHOP），等於按了沒反應。
 * CLAUDE.md 明訂模式差異一律進 MODE_PRESETS，不在各處散落 if。
 */
function buildRichMenuBody(theme: string, businessType: BusinessType) {
  return {
    size: { width: 2500, height: 1686 },
    selected: true,
    name: `vibeai-${theme.toLowerCase()}`,
    chatBarText: '選單',
    areas: CELLS.map((c, i) => ({
      bounds: { x: c.x, y: c.y, width: c.w, height: c.h },
      action: {
        type: 'message',
        label: MODE_PRESETS[businessType].richMenuCells[i].label,
        text: MODE_PRESETS[businessType].richMenuCells[i].text,
      },
    })),
  };
}

/**
 * 取得底圖 bytes + contentType。優先順序：
 *   1. 店家自傳底圖（upload-bg-image 存進 bucket 的 public URL）
 *   2. richmenu-assets bucket 裡預先上架的主題圖檔 themes/{THEME}.png|jpg
 *   3. 現生成一張該主題色的純色 PNG（src/server/png.ts）
 *
 * 原本第 3 步不存在——bucket 裡沒圖就直接 404，等於「套用範本」永遠發布不出去，
 * 因為平台從沒人手動上傳過六張主題底圖（2026-08-24 查證 richmenu-assets 是空的）。
 * 純色底圖讓「選一個主題就能發布」在任何情況下都成立，之後要美化再補真圖即可，
 * 不影響已發布的選單（換真圖只是重新整個 create 流程）。
 */
async function loadBackgroundImage(
  theme: string, bgImageUrl: string,
): Promise<{ bytes: ArrayBuffer | Buffer; contentType: string }> {
  if (bgImageUrl) {
    const res = await fetch(bgImageUrl).catch(() => null);
    if (!res?.ok)
      throw new ApiHttpError(404, '自訂底圖已無法讀取，請重新上傳底圖後再試', ERR.NOT_FOUND);
    const type = res.headers.get('content-type') ?? '';
    const contentType = type.includes('png') ? 'image/png' : 'image/jpeg';
    return { bytes: await res.arrayBuffer(), contentType };
  }

  const admin = createAdminSupabase();
  for (const [ext, contentType] of [['png', 'image/png'], ['jpg', 'image/jpeg']] as const) {
    const { data } = await admin.storage.from('richmenu-assets').download(`themes/${theme}.${ext}`);
    if (data) return { bytes: await data.arrayBuffer(), contentType };
  }

  const bg = RICH_MENU_THEME_COLORS[theme as keyof typeof RICH_MENU_THEME_COLORS]?.bg ?? '#06c755';
  return { bytes: solidColorPng(2500, 1686, bg), contentType: 'image/png' };
}

const bodySchema = z.object({ theme: z.enum(RICH_MENU_THEME_KEYS).optional() });

export const POST = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  const body = bodySchema.parse(await req.json().catch(() => ({})));

  // 憑證 + 現行 line 設定（未設定 LINE → getLineCredentials 丟 400 LINE_001）
  const { token, lineConfig } = await getLineCredentials(t.tenantId);
  const line = lineSettingsSchema.partial().parse(lineConfig);
  // 這次請求指定的主題優先（前端「一鍵套用範本」不必先呼叫 PUT 存設定再呼叫這支）；
  // 否則用店家上次存的值，最後才落回預設綠色。
  const theme = body.theme ?? line.richMenuTheme ?? 'LINE_GREEN';

  // 六格文案依業態（嚮導 → 行程/團次；診所 → 掛號/看診進度），見 MODE_PRESETS
  const { data: tenantRow } = await t.supabase.from('tenants')
    .select('business_type').eq('id', t.tenantId).maybeSingle();
  const businessType = (tenantRow?.business_type ?? 'LOCAL_SHOP') as BusinessType;

  // ③ 的圖先取——圖拿不到就不要在 LINE 端留下半成品選單
  const image = await loadBackgroundImage(theme, line.richMenuBgImageUrl ?? '');

  // ② 建立 → ③ 傳圖 → ④ 設為預設
  const richMenuId = await lineCreateRichMenu(token, buildRichMenuBody(theme, businessType));
  try {
    await lineUploadRichMenuImage(token, richMenuId, image.bytes, image.contentType);
    await lineSetDefaultRichMenu(token, richMenuId);
  } catch (e) {
    // 傳圖/設預設失敗 → 清掉剛建立的半成品，避免 LINE 端累積孤兒選單
    await lineDeleteRichMenu(token, richMenuId).catch(() => {});
    throw e;
  }

  // 換新成功後 best-effort 刪舊選單（失敗只 log，不影響結果）
  const previousId = typeof lineConfig.richMenuId === 'string' ? lineConfig.richMenuId : '';
  if (previousId && previousId !== richMenuId) {
    await lineDeleteRichMenu(token, previousId)
      .catch((e) => console.error('[rich-menu] 刪除舊選單失敗', t.tenantId, previousId, e));
  }

  // ⑤ richMenuId + 實際套用的主題記到 line jsonb（body.theme 可能覆寫了舊設定）
  const nextLine: Record<string, unknown> = { ...lineConfig, richMenuId, richMenuTheme: theme };
  delete nextLine.channelSecret;
  delete nextLine.channelAccessToken;
  const { error } = await t.supabase
    .from('tenant_settings')
    .upsert({ tenant_id: t.tenantId, line: nextLine }, { onConflict: 'tenant_id' });
  if (error) throw error;

  return ok({ richMenuId });
});
