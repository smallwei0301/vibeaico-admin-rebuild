/**
 * 行程圖庫張數上限。來源：後台行程編輯頁（src/app/tenant/trips/[id]/page.tsx）原本宣告的 GALLERY_MAX = 8，
 * 現在由該頁、公開詳情 loader 與寫入端 schema（#748）共用同一個值。
 * 公開 loader 仍在輸出邊界套用此上限，作為對歷史超量資料的第二道防線。
 */
export const MAX_PUBLIC_GALLERY_IMAGES = 8;

/** 寫入端（tripCreateSchema／tripUpdateSchema）使用的語意別名；與公開上限是同一個值，不得另寫第二個 8。 */
export const MAX_TRIP_GALLERY_IMAGES = MAX_PUBLIC_GALLERY_IMAGES;
