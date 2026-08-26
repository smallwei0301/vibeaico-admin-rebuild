/**
 * src/config/rich-menu-layouts.ts — Rich Menu 版型與格線幾何（前後端共用）
 * 規格：docs/integration/06-LINE-INTEGRATION.md §6.2.4
 *
 * 之前 LAYOUT_ROWS 只寫在 rich-menu-design/page.tsx 裡，純前端顯示用。
 * issue #19 的 create-advanced / preview-advanced 要用**同一組**版型算出送給 LINE
 * 的 areas——顏色那一組（rich-menu-themes.ts）當初拆檔的理由在這裡一模一樣：
 * 前端預覽畫 7 格、後端送 6 格的話，畫面與顧客看到的東西對不起來，
 * 而那個分岔沒有任何測試會紅。
 */

/** LINE 的 rich menu 只收 2500×1686 或 2500×843。本專案的版型都 ≥2 列，一律 1686。 */
export const RICH_MENU_WIDTH = 2500;
export const RICH_MENU_HEIGHT = 1686;

/** LINE 單一 rich menu 的 area 數上限（Messaging API: max 20 areas） */
export const RICH_MENU_MAX_AREAS = 20;
/** LINE 的 action label 上限 20 字、message action text 上限 300 字 */
export const RICH_MENU_LABEL_MAX = 20;
export const RICH_MENU_TEXT_MAX = 300;
/** LINE 的 chatBarText 上限 14 字 */
export const RICH_MENU_CHATBAR_MAX = 14;

/** 版型 key → 每一列的格數 */
export const RICH_MENU_LAYOUTS = {
  '3+4': [3, 4],
  '2x3': [3, 3],
  '2+3': [2, 3],
  '2x2': [2, 2],
  '1+2': [1, 2],
  '3+4+4': [3, 4, 4],
  '4+4': [4, 4],
} as const;

export type RichMenuLayoutKey = keyof typeof RICH_MENU_LAYOUTS;
export const RICH_MENU_LAYOUT_KEYS = Object.keys(RICH_MENU_LAYOUTS) as RichMenuLayoutKey[];

export const DEFAULT_RICH_MENU_LAYOUT: RichMenuLayoutKey = '3+4';

/** 該版型共有幾格 */
export function layoutCellCount(layout: RichMenuLayoutKey): number {
  return RICH_MENU_LAYOUTS[layout].reduce((a, b) => a + b, 0);
}

export type RichMenuBounds = { x: number; y: number; width: number; height: number };

/**
 * 版型 → 每一格的像素座標（由左至右、由上至下，與頁面表格的編號順序一致）。
 *
 * ⚠️ **餘數一律補到最後一列／最後一欄。** 2500 / 3 = 833.33：三欄寫成 833/833/833
 * 只蓋到 2499，右緣會留下一條 1 px、以及更糟的——列高 1686 / 3 = 562 剛好整除，
 * 但 1686 / 4 就不整除。沒有蓋到 area 的區域顧客按下去**完全沒反應**，
 * 而那是「按鈕壞了」而不是「畫面歪了」，肉眼看不出來。
 */
export function richMenuAreasForLayout(layout: RichMenuLayoutKey): RichMenuBounds[] {
  const rows = RICH_MENU_LAYOUTS[layout];
  const rowHeight = Math.floor(RICH_MENU_HEIGHT / rows.length);
  const out: RichMenuBounds[] = [];

  rows.forEach((cols, rowIndex) => {
    const isLastRow = rowIndex === rows.length - 1;
    const y = rowHeight * rowIndex;
    const height = isLastRow ? RICH_MENU_HEIGHT - y : rowHeight;
    const colWidth = Math.floor(RICH_MENU_WIDTH / cols);

    for (let colIndex = 0; colIndex < cols; colIndex += 1) {
      const isLastCol = colIndex === cols - 1;
      const x = colWidth * colIndex;
      out.push({
        x,
        y,
        width: isLastCol ? RICH_MENU_WIDTH - x : colWidth,
        height,
      });
    }
  });

  return out;
}
