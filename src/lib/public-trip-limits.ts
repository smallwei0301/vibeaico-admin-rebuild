/**
 * 公開行程詳情的輸出上限。寫入端 schema 沒有長度上限（另案追蹤，併入 #748），後台 UI 也沒有對應的
 * maxLength 可沿用，所以公開 loader 在輸出邊界套用這些上限（與圖庫張數上限
 * MAX_PUBLIC_GALLERY_IMAGES 同一個處理方式）。獨立成檔而不改名 trip-gallery.ts：避免動到後台行程頁
 * 已共用的圖庫常數匯入，影響範圍最小。
 */
/** 長文字欄位（description）。 */
export const MAX_PUBLIC_LONG_TEXT_CHARS = 5000;
/** 短文字欄位（tagline、summary、safetyNotice／notes）。 */
export const MAX_PUBLIC_SHORT_TEXT_CHARS = 2000;
/** 單行欄位（title、location、meetingPoint）與陣列每一項。 */
export const MAX_PUBLIC_LIST_ITEM_CHARS = 300;
/** 陣列欄位（inclusions、exclusions、notices）最多項數。 */
export const MAX_PUBLIC_LIST_ITEMS = 20;

/** 以字元（code point）為單位截斷，不會切斷 surrogate pair；截斷處不加標記。 */
export function truncateChars(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max).join('');
}

/** 陣列：每項截斷、濾掉空字串後最多保留 MAX_PUBLIC_LIST_ITEMS 項。 */
export function limitPublicList(items: string[]): string[] {
  return items
    .map((item) => truncateChars(item, MAX_PUBLIC_LIST_ITEM_CHARS))
    .filter(Boolean)
    .slice(0, MAX_PUBLIC_LIST_ITEMS);
}
