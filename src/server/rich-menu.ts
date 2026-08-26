/**
 * src/server/rich-menu.ts — 進階選單設計器的**唯一**組裝與發布處
 * 規格：docs/integration/06-LINE-INTEGRATION.md §6.2（issue #19）
 *
 * ⚠️ 全專案只有這一支檔案會把「一份設計」變成「LINE 上的一張選單」。
 * create-advanced / create-custom / create-scene / restore-previous 四支端點
 * 都呼叫本檔的 `publishRichMenu()`——四支各寫一份三代輪替與回滾，
 * 短期看起來一樣、長期一定分岔，而分岔那天沒有任何測試會紅
 * （本專案反覆抓到的缺陷家族，見 flex-menu.ts 檔頭）。
 *
 * 預覽端點**不得**呼叫本檔的 `publishRichMenu()`，只能用 `buildRichMenuPayload()`
 * 與 `previewImageDataUrl()`。§6.2.5 把這件事列為硬性條件：預覽與發布共用同一段
 * 組裝程式碼，只要順手把發布叫下去，畫面上看起來一模一樣，而顧客的選單被換掉了。
 */
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiHttpError, ERR } from './http';
import { solidColorPng } from './png';
import { createAdminSupabase } from './supabase';
import { richMenuCellAction, type LineMessage } from './flex-menu';
import {
  lineCreateRichMenu, lineUploadRichMenuImage, lineSetDefaultRichMenu, lineDeleteRichMenu,
} from './line';
import { RICH_MENU_THEME_KEYS, RICH_MENU_THEME_COLORS } from '@/config/rich-menu-themes';
import {
  RICH_MENU_WIDTH, RICH_MENU_HEIGHT, RICH_MENU_MAX_AREAS, RICH_MENU_LABEL_MAX,
  RICH_MENU_TEXT_MAX, RICH_MENU_CHATBAR_MAX, RICH_MENU_LAYOUT_KEYS,
  DEFAULT_RICH_MENU_LAYOUT, richMenuAreasForLayout, layoutCellCount,
  type RichMenuLayoutKey, type RichMenuBounds,
} from '@/config/rich-menu-layouts';
import { isAllowedFlexLinkUrl } from '@/config/tenant-settings';
import { MODE_PRESETS, type BusinessType } from '@/config/modes';

/* ------------------------------------------------------------------ 型別 */

export type DesignKind = 'DRAFT' | 'PUBLISHED' | 'RESTORE_POINT';

export type DesignRow = {
  kind: DesignKind;
  config: Record<string, unknown>;
  line_rich_menu_id: string;
  updated_at: string;
};

/* ------------------------------------------------------------------ schema */

/**
 * 每格的設定。`action` 的四個值與頁面下拉一致；送給 LINE 的形狀由
 * `richMenuCellAction()` 決定（§6 的單一事實來源要求，不在這裡自己組 action 物件）。
 */
export const richMenuCellSchema = z.object({
  label: z.string().trim().max(RICH_MENU_LABEL_MAX, `按鈕名稱最多 ${RICH_MENU_LABEL_MAX} 字`).default(''),
  action: z.enum(['SEND_TEXT', 'OPEN_URL', 'OPEN_URL_AD', 'FLEX_POPUP']).default('SEND_TEXT'),
  value: z.string().trim().max(RICH_MENU_TEXT_MAX, `內容最多 ${RICH_MENU_TEXT_MAX} 字`).default(''),
  /** upload-cell-icon 回傳的網址。⚠️ 存得到、但不會合成進底圖，見 §6.2.8 */
  icon: z.string().trim().default(''),
});
export type RichMenuCellInput = z.infer<typeof richMenuCellSchema>;

export const richMenuDesignSchema = z.object({
  theme: z.enum(RICH_MENU_THEME_KEYS).default('LINE_GREEN'),
  layout: z.enum(RICH_MENU_LAYOUT_KEYS as [RichMenuLayoutKey, ...RichMenuLayoutKey[]])
    .default(DEFAULT_RICH_MENU_LAYOUT),
  cells: z.array(richMenuCellSchema).max(RICH_MENU_MAX_AREAS).default([]),
  bgImageUrl: z.string().trim().default(''),
  chatBarText: z.string().trim().max(RICH_MENU_CHATBAR_MAX, `選單列文字最多 ${RICH_MENU_CHATBAR_MAX} 字`)
    .default('選單'),
  name: z.string().trim().max(300).default(''),
});
export type RichMenuDesign = z.infer<typeof richMenuDesignSchema>;

/** create-custom：呼叫端自己給座標，不套格線 */
export const richMenuCustomAreaSchema = richMenuCellSchema.extend({
  bounds: z.object({
    x: z.number().int().min(0).max(RICH_MENU_WIDTH),
    y: z.number().int().min(0).max(RICH_MENU_HEIGHT),
    width: z.number().int().min(1).max(RICH_MENU_WIDTH),
    height: z.number().int().min(1).max(RICH_MENU_HEIGHT),
  }),
});
export type RichMenuCustomArea = z.infer<typeof richMenuCustomAreaSchema>;

export const richMenuCustomSchema = z.object({
  areas: z.array(richMenuCustomAreaSchema).min(1).max(RICH_MENU_MAX_AREAS),
  theme: z.enum(RICH_MENU_THEME_KEYS).default('LINE_GREEN'),
  bgImageUrl: z.string().trim().default(''),
  chatBarText: z.string().trim().max(RICH_MENU_CHATBAR_MAX).default('選單'),
  name: z.string().trim().max(300).default(''),
});

/* ------------------------------------------------------- 每格 → LINE areas */

/**
 * 一格設定 → LINE 的 action 物件。
 *
 * `OPEN_URL` / `OPEN_URL_AD` 走 `isAllowedFlexLinkUrl()` 的白名單
 * （§6.1 / 14 分冊 §8.20-b，與 Flex 卡片連結**共用同一支判斷**）。
 * 不在白名單 → 400 當場退回，而不是靜靜退成 message action：
 * 這是**寫入路徑**，店家還在畫面前面，看得到錯在哪一格、改得掉。
 * （讀取路徑才「先搶救再放棄」，兩者刻意不同調，理由見 flex-menu.ts。）
 */
function cellToAction(cell: RichMenuCellInput, index: number): LineMessage {
  if (cell.action === 'OPEN_URL' || cell.action === 'OPEN_URL_AD') {
    if (!isAllowedFlexLinkUrl(cell.value))
      throw new ApiHttpError(400, `第 ${index + 1} 格的連結網址不是可用的格式`, ERR.VALIDATION);
    // ⚠️ action 物件一律由 flex-menu.ts 產生（單一事實來源；有守門測試釘住）
    return richMenuCellAction({
      label: cell.label || cell.value.slice(0, RICH_MENU_LABEL_MAX),
      text: cell.value,
      action: 'OPEN_URL',
      uri: cell.value,
    });
  }
  if (cell.action === 'SEND_TEXT' && !cell.value)
    throw new ApiHttpError(400, `第 ${index + 1} 格還沒有填要送出的文字`, ERR.VALIDATION);
  // SEND_TEXT / FLEX_POPUP 一律經 richMenuCellAction()：FLEX_POPUP 的格子送出
  // FLEX_POPUP_TRIGGER_TEXT，與顧客自己打「選單」走同一條路徑（issue #6）。
  return richMenuCellAction({
    label: cell.label || cell.value,
    text: cell.value,
    action: cell.action === 'FLEX_POPUP' ? 'FLEX_POPUP' : 'SEND_TEXT',
  });
}

/**
 * 設計 → 送給 `POST /v2/bot/richmenu` 的完整 body。
 *
 * 格子不足版型格數時，缺的那幾格用**業態預設**（MODE_PRESETS.richMenuCells）補，
 * 而不是留空：LINE 不接受沒有 action 的 area，留空等於整包被退；補一格顧客按得動
 * 的預設按鈕，比讓整次發布失敗好，而且補的那幾格文字保證有 handler 認得。
 */
export function buildRichMenuPayload(
  design: RichMenuDesign,
  businessType: BusinessType,
): { size: { width: number; height: number }; selected: boolean; name: string;
     chatBarText: string; areas: { bounds: RichMenuBounds; action: LineMessage }[] } {
  const bounds = richMenuAreasForLayout(design.layout);
  const presets = MODE_PRESETS[businessType].richMenuCells;

  const areas = bounds.map((b, i) => {
    const cell = design.cells[i];
    const filled: RichMenuCellInput = cell && (cell.value || cell.label)
      ? cell
      : {
          label: presets[i % presets.length].label,
          action: 'SEND_TEXT',
          value: presets[i % presets.length].text,
          icon: '',
        };
    return { bounds: b, action: cellToAction(filled, i) };
  });

  return {
    size: { width: RICH_MENU_WIDTH, height: RICH_MENU_HEIGHT },
    selected: true,
    name: (design.name || `vibeai-${design.theme.toLowerCase()}`).slice(0, 300),
    chatBarText: design.chatBarText || '選單',
    areas,
  };
}

/** create-custom 的 body → LINE payload（座標由呼叫端給，不套格線） */
export function buildCustomRichMenuPayload(
  body: z.infer<typeof richMenuCustomSchema>,
) {
  const areas = body.areas.map((a, i) => {
    if (a.bounds.x + a.bounds.width > RICH_MENU_WIDTH || a.bounds.y + a.bounds.height > RICH_MENU_HEIGHT)
      throw new ApiHttpError(400, `第 ${i + 1} 個區塊超出選單範圍（${RICH_MENU_WIDTH}×${RICH_MENU_HEIGHT}）`, ERR.VALIDATION);
    return { bounds: a.bounds, action: cellToAction(a, i) };
  });
  return {
    size: { width: RICH_MENU_WIDTH, height: RICH_MENU_HEIGHT },
    selected: true,
    name: (body.name || `vibeai-custom`).slice(0, 300),
    chatBarText: body.chatBarText || '選單',
    areas,
  };
}

/* ------------------------------------------------------------------ 底圖 */

/**
 * 取得底圖 bytes + contentType。優先順序與基本 `create` 端點**完全相同**
 * （這一段原本只寫在 create/route.ts 裡，issue #19 搬過來讓五支端點共用，
 *  兩份實作分岔的話會出現「基本發布看得到自訂底圖、進階發布看不到」）：
 *   1. 店家自傳底圖（`/api/upload` 存進 richmenu-assets bucket 的 public URL）
 *   2. richmenu-assets bucket 裡預先上架的主題圖檔 themes/{THEME}.png|jpg
 *   3. 現生成一張該主題色的純色 PNG（src/server/png.ts）
 */
export async function loadRichMenuBackground(
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
  return { bytes: solidColorPng(RICH_MENU_WIDTH, RICH_MENU_HEIGHT, bg), contentType: 'image/png' };
}

/**
 * 預覽用的底圖縮圖 data URL（§6.2.5）。
 *
 * ⚠️ 這張圖是**純色**——沒有店名、沒有格子文字、沒有格線，因為 `create` 真的上傳給
 * LINE 的就是這樣一張圖（png.ts 只會產純色矩形，本專案沒有裝任何影像合成套件）。
 * 尺寸刻意縮到 500×337 而不是 2500×1686：預覽不需要原尺寸，塞原尺寸只是讓
 * response 變大。顏色與比例都與真的會被上傳的那一張一致。
 */
export const PREVIEW_WIDTH = 500;
export const PREVIEW_HEIGHT = 337;

export function previewImageDataUrl(theme: string): string {
  const bg = RICH_MENU_THEME_COLORS[theme as keyof typeof RICH_MENU_THEME_COLORS]?.bg ?? '#06c755';
  const png = solidColorPng(PREVIEW_WIDTH, PREVIEW_HEIGHT, bg);
  return `data:image/png;base64,${png.toString('base64')}`;
}

/* -------------------------------------------------------- 設計列的讀寫 */

export async function readDesign(
  supabase: SupabaseClient, tenantId: string, kind: DesignKind,
): Promise<DesignRow | null> {
  const { data } = await supabase
    .from('rich_menu_designs')
    .select('kind, config, line_rich_menu_id, updated_at')
    .eq('tenant_id', tenantId).eq('kind', kind).maybeSingle();
  return (data as DesignRow | null) ?? null;
}

/**
 * ⚠️ `upsert` 的 `{ error }` 一律要丟出去（§6.2.3 第二列）。
 * 不丟的話畫面會顯示「已發布」而 DB 沒有那一列，下一次發布會拿錯的東西當還原點。
 */
export async function writeDesign(
  supabase: SupabaseClient, tenantId: string, kind: DesignKind,
  config: Record<string, unknown>, lineRichMenuId: string,
): Promise<string> {
  const updatedAt = new Date().toISOString();
  const { error } = await supabase.from('rich_menu_designs').upsert(
    { tenant_id: tenantId, kind, config, line_rich_menu_id: lineRichMenuId, updated_at: updatedAt },
    { onConflict: 'tenant_id,kind' },
  );
  if (error) throw error;
  return updatedAt;
}

/* --------------------------------------------------------------- 發布 */

export type PublishResult = { richMenuId: string };

/**
 * 建立並發布一張 rich menu，含 §6.2.2 的三代輪替與 §6.2.3 的兩種孤兒回滾。
 *
 * ```
 * 發布前：  RESTORE_POINT = A(舊舊)   PUBLISHED = B(現行, LINE 上是預設)
 * 發布後：  RESTORE_POINT = B         PUBLISHED = C(新)
 * LINE 端： A 的選單被刪除            B 的選單保留但不再是預設    C 設為預設
 * ```
 *
 * **B 的選單刻意不刪**——留著，`restore-previous` 只要把它切回預設即可，
 * 還原到的是位元組完全相同的那一張，不必重新上傳底圖。
 * 這與基本 `create` 端點（換新後 best-effort 刪舊）**行為不同**，是刻意的。
 */
export async function publishRichMenu(args: {
  supabase: SupabaseClient;
  tenantId: string;
  token: string;
  payload: unknown;
  /** 存進 rich_menu_designs.config 的那一份設計（還原時要靠它重建） */
  config: Record<string, unknown>;
  theme: string;
  bgImageUrl: string;
  /** tenant_settings.line 的原文，發布成功後要把 richMenuId 寫回去 */
  lineConfig: Record<string, unknown>;
}): Promise<PublishResult> {
  const { supabase, tenantId, token, payload, config, theme, bgImageUrl, lineConfig } = args;

  const previousPublished = await readDesign(supabase, tenantId, 'PUBLISHED');
  const previousRestore = await readDesign(supabase, tenantId, 'RESTORE_POINT');

  // 圖先取——圖拿不到就不要在 LINE 端留下半成品選單（與基本 create 同一條理由）
  const image = await loadRichMenuBackground(theme, bgImageUrl);

  // ① 建立 → ② 傳圖 → ③ 設為預設
  const richMenuId = await lineCreateRichMenu(token, payload);
  try {
    await lineUploadRichMenuImage(token, richMenuId, image.bytes, image.contentType);
    await lineSetDefaultRichMenu(token, richMenuId);
  } catch (e) {
    // 孤兒（一）：LINE 建了但沒圖／沒設成預設 → 清掉半成品再把原錯誤丟出去
    await lineDeleteRichMenu(token, richMenuId).catch(() => {});
    throw e;
  }

  // ④ DB 寫入。任何一筆失敗都要回滾 LINE 端，否則顧客看到的與後台顯示的不一致
  try {
    if (previousPublished) {
      await writeDesign(
        supabase, tenantId, 'RESTORE_POINT',
        previousPublished.config, previousPublished.line_rich_menu_id,
      );
    }
    await writeDesign(supabase, tenantId, 'PUBLISHED', config, richMenuId);

    const nextLine: Record<string, unknown> = { ...lineConfig, richMenuId, richMenuTheme: theme };
    delete nextLine.channelSecret;
    delete nextLine.channelAccessToken;
    const { error } = await supabase
      .from('tenant_settings')
      .upsert({ tenant_id: tenantId, line: nextLine }, { onConflict: 'tenant_id' });
    if (error) throw error;
  } catch (e) {
    // 孤兒（二）：LINE 全成功但 DB 沒寫成 → 把預設選單切回舊的、刪掉剛建立的那一張。
    // 不做的話 DB 說還是舊的、LINE 端卻已經換成新的，而畫面會顯示「已發布」。
    if (previousPublished?.line_rich_menu_id) {
      await lineSetDefaultRichMenu(token, previousPublished.line_rich_menu_id).catch(() => {});
    }
    await lineDeleteRichMenu(token, richMenuId).catch(() => {});
    throw e;
  }

  // ⑤ 三代前的那一張（A）已經不可能被還原到，刪掉免得在 LINE 端無限累積。
  //    失敗只 log：它不影響任何人看到的畫面，為它回滾一次成功的發布是更糟的選擇。
  const staleId = previousRestore?.line_rich_menu_id;
  if (staleId && staleId !== richMenuId && staleId !== previousPublished?.line_rich_menu_id) {
    await lineDeleteRichMenu(token, staleId)
      .catch((e) => console.error('[rich-menu] 刪除三代前的選單失敗', tenantId, staleId, e));
  }

  return { richMenuId };
}

/* ------------------------------------------------------------ 版型工具 */

export { layoutCellCount };
