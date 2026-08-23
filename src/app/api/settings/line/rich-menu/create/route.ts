import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { createAdminSupabase } from '@/server/supabase';
import { lineSettingsSchema } from '@/config/tenant-settings';
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
/** 六格的 message action 文字（對應 webhook 內建指令與關鍵字，06 §3/§6） */
const CELL_TEXTS = ['預約', '我的預約', '服務項目', '會員卡', '優惠', '聯絡我們'];

function buildRichMenuBody(theme: string) {
  return {
    size: { width: 2500, height: 1686 },
    selected: true,
    name: `vibeai-${theme.toLowerCase()}`,
    chatBarText: '選單',
    areas: CELLS.map((c, i) => ({
      bounds: { x: c.x, y: c.y, width: c.w, height: c.h },
      action: { type: 'message', label: CELL_TEXTS[i], text: CELL_TEXTS[i] },
    })),
  };
}

/** 取得底圖 bytes + contentType；拿不到 → 丟 4xx 明確 message */
async function loadBackgroundImage(
  theme: string, bgImageUrl: string,
): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  // 店家自傳底圖（upload-bg-image 存進 bucket 的 public URL）優先
  if (bgImageUrl) {
    const res = await fetch(bgImageUrl).catch(() => null);
    if (!res?.ok)
      throw new ApiHttpError(404, '自訂底圖已無法讀取，請重新上傳底圖後再試', ERR.NOT_FOUND);
    const type = res.headers.get('content-type') ?? '';
    const contentType = type.includes('png') ? 'image/png' : 'image/jpeg';
    return { bytes: await res.arrayBuffer(), contentType };
  }

  // 主題底圖：richmenu-assets bucket 的 themes/{THEME}.png|jpg（0008 已建 bucket）
  const admin = createAdminSupabase();
  for (const [ext, contentType] of [['png', 'image/png'], ['jpg', 'image/jpeg']] as const) {
    const { data } = await admin.storage.from('richmenu-assets').download(`themes/${theme}.${ext}`);
    if (data) return { bytes: await data.arrayBuffer(), contentType };
  }
  throw new ApiHttpError(
    404,
    `主題底圖尚未上架（richmenu-assets/themes/${theme}.png），請先於後台上傳自訂底圖，或聯絡平台補上主題圖檔`,
    ERR.NOT_FOUND,
  );
}

export const POST = handle(async () => {
  const t = await requireTenant('MANAGER');

  // 憑證 + 現行 line 設定（未設定 LINE → getLineCredentials 丟 400 LINE_001）
  const { token, lineConfig } = await getLineCredentials(t.tenantId);
  const line = lineSettingsSchema.partial().parse(lineConfig);
  const theme = line.richMenuTheme ?? 'LINE_GREEN';

  // ③ 的圖先取——圖拿不到就不要在 LINE 端留下半成品選單
  const image = await loadBackgroundImage(theme, line.richMenuBgImageUrl ?? '');

  // ② 建立 → ③ 傳圖 → ④ 設為預設
  const richMenuId = await lineCreateRichMenu(token, buildRichMenuBody(theme));
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

  // ⑤ richMenuId 記到 line jsonb
  const nextLine: Record<string, unknown> = { ...lineConfig, richMenuId };
  delete nextLine.channelSecret;
  delete nextLine.channelAccessToken;
  const { error } = await t.supabase
    .from('tenant_settings')
    .upsert({ tenant_id: t.tenantId, line: nextLine }, { onConflict: 'tenant_id' });
  if (error) throw error;

  return ok({ richMenuId });
});
