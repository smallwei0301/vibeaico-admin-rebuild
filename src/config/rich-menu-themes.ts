/**
 * src/config/rich-menu-themes.ts — Rich Menu 主題配色（資料值，非後台佈景 token）
 *
 * 之前 bg/fg hex 只寫在 rich-menu-design/page.tsx 的 THEMES 常數裡，前端專用。
 * 現在後端（POST /api/settings/line/rich-menu/create）在找不到店家自傳底圖、
 * 也找不到 richmenu-assets bucket 裡的主題圖檔時，需要用同一組顏色現生成一張
 * 純色底圖（見 src/server/png.ts）——顏色來源必須和前端預覽一致，否則發布出去
 * 的選單顏色會跟使用者在畫面上看到的預覽對不起來，因此拆成這個前後端共用檔。
 */
export const RICH_MENU_THEME_KEYS = [
  'BOUTIQUE', 'LINE_GREEN', 'OCEAN_BLUE', 'ROYAL_PURPLE', 'SUNSET_ORANGE', 'DARK',
] as const;

export type RichMenuThemeKey = (typeof RICH_MENU_THEME_KEYS)[number];

export const RICH_MENU_THEME_COLORS: Record<RichMenuThemeKey, { bg: string; fg: string; advanced: boolean }> = {
  BOUTIQUE: { bg: '#8b6f47', fg: '#ffffff', advanced: true },
  LINE_GREEN: { bg: '#06c755', fg: '#ffffff', advanced: false },
  OCEAN_BLUE: { bg: '#2196f3', fg: '#ffffff', advanced: true },
  ROYAL_PURPLE: { bg: '#7b1fa2', fg: '#ffffff', advanced: true },
  SUNSET_ORANGE: { bg: '#ff7043', fg: '#ffffff', advanced: true },
  DARK: { bg: '#212121', fg: '#ffffff', advanced: true },
};
