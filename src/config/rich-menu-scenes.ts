/**
 * src/config/rich-menu-scenes.ts — 情境範本（`SCENE_TEMPLATES`），前後端共用
 * 規格：docs/integration/06-LINE-INTEGRATION.md §6.2.4「create-scene 的已知規格缺口」
 *
 * 這份常數原本長在 rich-menu-design/page.tsx 裡（純顯示用）。issue #19 的
 * `POST …/create-scene` 與 `POST …/preview-scene` 要用**同一份** id → 設定的對應，
 * 否則畫面上按的那張卡與後端建立的那一份會分岔。拆檔理由同 rich-menu-themes.ts。
 *
 * ⚠️ **已知規格缺口，不得憑空補回**（docs/REBUILD-SPEC.md §9.3 第 1 點）：
 * 原站的範本庫是 inline JS 的完整資料結構，spec 只抓到**排序後的扁平字串清單**，
 * 「哪一句文案屬於哪一個範本」已經遺失。所以本檔的範本**只帶得動主題配色**，
 * 帶不動每格文案——`create-scene` 的六格一律用 MODE_PRESETS 的業態預設值。
 *
 * 這不是偷懶，是「absence of data ≠ invented data」：替「🍽️ 餐廳」範本編一組
 * 看起來很合理的餐廳文案，會讓後來的人以為那是還原出來的原站資料。
 * 擁有者 2026-08-25 已裁決用現有常數即可（issue #1 裁示總表）。
 */
import { RICH_MENU_THEME_KEYS, type RichMenuThemeKey } from './rich-menu-themes';
import { richMenuDesignPage as t } from '@/i18n/zh-TW/pages/rich-menu-design';

export type SceneTemplate = {
  id: string;
  /** 行業分類（顯示用） */
  industry: string;
  /** 範本名稱（顯示用，也是發布確認視窗裡出現的那個名字） */
  name: string;
  tagline: string;
  style: string;
  /** ⚠️ 這是範本**唯一**真的帶得動的東西 */
  theme: RichMenuThemeKey;
};

/**
 * 六張情境範本。取用順序與原本頁面上的 `SCENE_TEMPLATES` 逐字相同
 * （`t.library.industries.slice(0, 6)`），搬檔時沒有改變任何一張卡的內容——
 * 改了的話畫面會無聲地變成另外六張範本。
 */
export const SCENE_TEMPLATES: SceneTemplate[] = t.library.industries
  .slice(0, 6)
  .map((industry, i) => ({
    id: `scene_${i}`,
    industry,
    name: t.library.sceneNames[i] ?? industry,
    tagline: t.library.industryTaglines[i] ?? '',
    style: t.library.styleDescriptions[i] ?? '',
    theme: RICH_MENU_THEME_KEYS[i % RICH_MENU_THEME_KEYS.length],
  }));

export const SCENE_TEMPLATE_IDS = SCENE_TEMPLATES.map((s) => s.id);

export function findSceneTemplate(id: string): SceneTemplate | undefined {
  return SCENE_TEMPLATES.find((s) => s.id === id);
}
