/**
 * 公開行程詳情的輸出上限，同時也是行程寫入端 schema 的上限（#748）：
 * tripCreateSchema／tripUpdateSchema 以相同的可見上限擋下新的超量寫入（description、notes、includes、
 * exclusions、notices），歷史超量資料不清理、不遷移。公開 loader 仍在輸出邊界套用這些上限，
 * 作為對歷史資料的第二道防線（與圖庫張數上限 MAX_PUBLIC_GALLERY_IMAGES 同一個處理方式）。
 * 獨立成檔而不改名 trip-gallery.ts：避免動到後台行程頁已共用的圖庫常數匯入，影響範圍最小。
 */
/** 長文字欄位（description）。 */
export const MAX_PUBLIC_LONG_TEXT_CHARS = 5000;
/** 短文字欄位（tagline、summary、safetyNotice／notes）。 */
export const MAX_PUBLIC_SHORT_TEXT_CHARS = 2000;
/** 單行欄位（title、location、meetingPoint）與陣列每一項。 */
export const MAX_PUBLIC_LIST_ITEM_CHARS = 300;
/** 陣列欄位（inclusions、exclusions、notices）最多項數。 */
export const MAX_PUBLIC_LIST_ITEMS = 20;


/**
 * #785：「原始」大小上限（儲存安全天花板）。可見上限（trim、忽略空白項）不看空白，
 * 所以另設原始上限，避免靠空白／空項塞出超大 payload。與可見上限同時成立；
 * 通過者原樣保存，不做寫入前正規化。
 */
/** 清單欄位（exclusions、notices、includes 拆行後）原始項數上限（含空白項）。 */
export const MAX_TRIP_LIST_RAW_ITEMS = 200;
/** 清單每一項原始（未 trim）code point 上限。 */
export const MAX_TRIP_LIST_ITEM_RAW_CHARS = 3000;
/** includes 原始字串整體 code point 上限。 */
export const MAX_TRIP_INCLUDES_RAW_CHARS = 20000;

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
