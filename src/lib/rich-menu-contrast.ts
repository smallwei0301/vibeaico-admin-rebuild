/**
 * 圖文選單文字對比描邊（#1109）。server 合成（rich-menu-image.ts）與設定頁預覽共用，
 * 確保預覽與實際輸出用同一條規則決定描邊色。
 */

/** 描邊寬度占字高比例（約 6%；2500×1686 輸出上落在 8–12px） */
const STROKE_WIDTH_RATIO = 0.06;
const STROKE_ON_LIGHT_TEXT = 'rgba(0,0,0,0.55)';
const STROKE_ON_DARK_TEXT = 'rgba(255,255,255,0.6)';

/** WCAG 相對亮度；非 #RRGGBB 回傳 1（視為亮色）。 */
export function relativeLuminance(color: string): number {
  const m = /^#([0-9a-fA-F]{6})$/.exec(color);
  if (!m) return 1;
  const n = parseInt(m[1], 16);
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** WCAG 對比度：(L1 + 0.05) / (L2 + 0.05)，L1 為較亮者。 */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** 依字色與黑／白的實際對比度，選對比較高者當描邊（門檻約 L≈0.179）。 */
export function textStrokeFor(color: string): { stroke: string; widthRatio: number } {
  const stroke =
    contrastRatio(color, '#000000') >= contrastRatio(color, '#FFFFFF') ? STROKE_ON_LIGHT_TEXT : STROKE_ON_DARK_TEXT;
  return { stroke, widthRatio: STROKE_WIDTH_RATIO };
}
