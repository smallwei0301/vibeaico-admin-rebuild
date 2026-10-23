/**
 * LINE 圖文選單圖檔上限（無依賴，前後端皆可 import）。
 * 1 MB 取 1,000,000 而非 1,048,576（docs/integration/14-GAP-AUDIT.md：官方只寫 1 MB，取小的兩種解讀都合規）。
 * 檔案大小「達到」此值即視為超限（與 composeRichMenuImage 的 `< maxBytes` 判斷一致）。
 */
export const LINE_RICH_MENU_MAX_BYTES = 1_000_000;
