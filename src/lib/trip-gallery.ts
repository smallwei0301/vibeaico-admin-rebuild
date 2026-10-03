/**
 * 行程圖庫張數上限。來源：後台行程編輯頁（src/app/tenant/trips/[id]/page.tsx）原本宣告的 GALLERY_MAX = 8，
 * 現在由該頁與公開詳情 loader 共用同一個常數。寫入端 schema 沒有長度上限（另案追蹤），
 * 所以公開 loader 在輸出邊界套用此上限。
 */
export const MAX_PUBLIC_GALLERY_IMAGES = 8;
