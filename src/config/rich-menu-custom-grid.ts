/**
 * 自訂行列格線的座標計算。
 *
 * 原站 DOM 留下了 1–4 行、1–5 列與「每格可獨立設定功能」；沒有留下把行列送往
 * create-custom 的座標演算法。本專案選擇把畫布等分，並把餘數補到最後一行／列，
 * 讓 area 完整覆蓋 LINE 2500×1686 的可點擊範圍。這是實作選擇，不是還原宣稱。
 */
import { RICH_MENU_HEIGHT, RICH_MENU_WIDTH, type RichMenuBounds } from './rich-menu-layouts';

export const CUSTOM_GRID_MIN_ROWS = 1;
export const CUSTOM_GRID_MAX_ROWS = 4;
export const CUSTOM_GRID_MIN_COLUMNS = 1;
export const CUSTOM_GRID_MAX_COLUMNS = 5;

/** 行優先、由左至右建立等分 area；最後一行／列承接整數除法餘數。 */
export function customGridBounds(rows: number, columns: number): RichMenuBounds[] {
  if (!Number.isInteger(rows) || rows < CUSTOM_GRID_MIN_ROWS || rows > CUSTOM_GRID_MAX_ROWS)
    throw new RangeError(`行數必須介於 ${CUSTOM_GRID_MIN_ROWS} 到 ${CUSTOM_GRID_MAX_ROWS}`);
  if (!Number.isInteger(columns) || columns < CUSTOM_GRID_MIN_COLUMNS || columns > CUSTOM_GRID_MAX_COLUMNS)
    throw new RangeError(`列數必須介於 ${CUSTOM_GRID_MIN_COLUMNS} 到 ${CUSTOM_GRID_MAX_COLUMNS}`);

  const rowHeight = Math.floor(RICH_MENU_HEIGHT / rows);
  const columnWidth = Math.floor(RICH_MENU_WIDTH / columns);
  const areas: RichMenuBounds[] = [];

  for (let row = 0; row < rows; row += 1) {
    const y = row * rowHeight;
    const height = row === rows - 1 ? RICH_MENU_HEIGHT - y : rowHeight;
    for (let column = 0; column < columns; column += 1) {
      const x = column * columnWidth;
      areas.push({
        x,
        y,
        width: column === columns - 1 ? RICH_MENU_WIDTH - x : columnWidth,
        height,
      });
    }
  }
  return areas;
}
