import sharp from 'sharp';
import { ApiHttpError, ERR } from '@/server/http';
import { MODE_PRESETS } from '@/config/modes';
import { RICH_MENU_CELL_BOUNDS, resolveRichMenuBusinessType } from '@/server/rich-menu';
import { RICH_MENU_GLYPHS } from '@/server/rich-menu-glyphs.generated';

/**
 * 圖文選單底圖合成（#931）：把六格 label 畫進底圖，讓發布出去的圖片與設定頁預覽一致。
 *
 * 文字以預先產生的 SVG path 繪製（Noto Sans TC Bold 子集，見 rich-menu-glyphs.generated.ts），
 * 執行期不載入字型，serverless 環境也不會有缺字／tofu。
 */

export const RICH_MENU_WIDTH = 2500;
export const RICH_MENU_HEIGHT = 1686;
/** LINE 圖文選單圖檔上限 1MB */
const LINE_MAX_BYTES = 1024 * 1024;
const DEFAULT_TEXT_COLOR = '#FFFFFF';
/** 字高佔格高比例、字寬佔格寬上限比例 */
const TEXT_HEIGHT_RATIO = 0.2;
const TEXT_MAX_WIDTH_RATIO = 0.82;

export function normalizeTextColor(color: unknown): string {
  return typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color) ? color.toUpperCase() : DEFAULT_TEXT_COLOR;
}

/** 組出 2500×1686 的透明 SVG，六格 label 置中。找不到 glyph 的格子略過並 warn。 */
export function buildRichMenuTextSvg(businessType: unknown, textColor: unknown): string {
  const fill = normalizeTextColor(textColor);
  const cells = MODE_PRESETS[resolveRichMenuBusinessType(businessType)].richMenuCells;
  const parts: string[] = [];
  RICH_MENU_CELL_BOUNDS.forEach((b, i) => {
    const label = cells[i]?.label ?? '';
    const g = RICH_MENU_GLYPHS[label];
    if (!g) {
      console.warn('[rich-menu-image] 找不到 glyph，略過該格文字', label);
      return;
    }
    const scale = Math.min((b.h * TEXT_HEIGHT_RATIO) / g.h, (b.w * TEXT_MAX_WIDTH_RATIO) / g.w);
    const x = b.x + (b.w - g.w * scale) / 2;
    const y = b.y + (b.h - g.h * scale) / 2;
    parts.push(
      `<path transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${scale.toFixed(4)})" d="${g.d}"/>`,
    );
  });
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${RICH_MENU_WIDTH}" height="${RICH_MENU_HEIGHT}" ` +
    `viewBox="0 0 ${RICH_MENU_WIDTH} ${RICH_MENU_HEIGHT}">` +
    `<g fill="${fill}" stroke="rgba(0,0,0,0.25)" stroke-width="2" paint-order="stroke" stroke-linejoin="round">` +
    `${parts.join('')}</g></svg>`
  );
}

export async function composeRichMenuImage(opts: {
  bytes: ArrayBuffer | Uint8Array | Buffer;
  contentType: string;
  businessType?: unknown;
  textColor?: unknown;
  noOverlay?: boolean;
  /** 測試注入用；預設 LINE 的 1MB 上限 */
  maxBytes?: number;
}): Promise<{ bytes: Buffer; contentType: string }> {
  const input = Buffer.isBuffer(opts.bytes) ? opts.bytes : Buffer.from(opts.bytes as ArrayBuffer);
  if (opts.noOverlay) return { bytes: input, contentType: opts.contentType };

  const overlay = Buffer.from(buildRichMenuTextSvg(opts.businessType, opts.textColor));
  const maxBytes = opts.maxBytes ?? LINE_MAX_BYTES;
  let base: Buffer;
  try {
    // failOn: 'none'：店家上傳的小尺寸 PNG 常有 libspng 嚴格檢查會拒讀的瑕疵（#931 正式站回歸）
    base = await sharp(input, { failOn: 'none' })
      .flatten({ background: '#FFFFFF' })
      .resize(RICH_MENU_WIDTH, RICH_MENU_HEIGHT, { fit: 'cover' })
      .composite([{ input: overlay, top: 0, left: 0 }])
      .toBuffer();
  } catch (e) {
    if (e instanceof ApiHttpError) throw e;
    console.warn('[rich-menu-image] 底圖無法解碼', e instanceof Error ? e.message : e);
    throw new ApiHttpError(400, '底圖無法讀取，請重新上傳 JPG 或 PNG 底圖後再試', ERR.VALIDATION);
  }

  let out: Buffer = Buffer.alloc(0);
  for (const quality of [90, 85, 80, 75, 70, 65, 60]) {
    out = await sharp(base).jpeg({ quality, mozjpeg: true }).toBuffer();
    if (out.length < maxBytes) break;
  }
  if (out.length >= maxBytes) {
    throw new ApiHttpError(400, '選單圖片壓縮後仍超過 LINE 的 1MB 上限，請改用較簡單或較小的底圖', ERR.VALIDATION);
  }
  return { bytes: out, contentType: 'image/jpeg' };
}
