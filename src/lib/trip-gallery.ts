import { publicStringList, safePublicHttpsUrl } from '@/lib/public-url';

/**
 * 行程圖庫張數上限。來源：後台行程編輯頁（src/app/tenant/trips/[id]/page.tsx）原本宣告的 GALLERY_MAX = 8，
 * 現在由該頁、公開詳情 loader 與寫入端 schema（#748）共用同一個值。
 * 公開 loader 仍在輸出邊界套用此上限，作為對歷史超量資料的第二道防線。
 */
export const MAX_PUBLIC_GALLERY_IMAGES = 8;

/** 寫入端（tripCreateSchema／tripUpdateSchema）使用的語意別名；與公開上限是同一個值，不得另寫第二個 8。 */
export const MAX_TRIP_GALLERY_IMAGES = MAX_PUBLIC_GALLERY_IMAGES;

/** 兩份相簿是否逐張、同順序相同（順序也算變更，因為首張可能作為封面候選）。 */
export function sameGallery(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  const x = a ?? [];
  const y = b ?? [];
  return x.length === y.length && x.every((u, i) => u === y[i]);
}

/**
 * 編輯頁儲存用：相簿與載入時相同就把 `galleryUrls` 拿掉，payload 不再帶 `gallery`。
 * PUT 是 partial，server 不會清空未送欄位；這樣舊資料若已超過寫入上限（歷史超量），
 * 只改標題等其他欄位不會被 `gallery` 的 max 驗證擋成 400。相簿真的被改動時才送完整陣列。
 */
export function omitUnchangedGallery<T extends { galleryUrls?: string[] }>(
  form: T,
  original: { galleryUrls?: string[] } | null | undefined,
): T {
  if (!sameGallery(form.galleryUrls, original?.galleryUrls)) return form;
  const { galleryUrls: _unchanged, ...rest } = form;
  return rest as T;
}

/**
 * 公開詳情 loader 的相簿輸出：先濾掉非字串／非 https／含帳密／過長的 URL，再截到上限。
 * 公開頁與「複製行程」共用這一個函式，兩邊的相簿才會逐張相同。
 */
export function publicGalleryUrls(value: unknown): string[] {
  return publicStringList(value)
    .map(safePublicHttpsUrl).filter(Boolean)
    .slice(0, MAX_PUBLIC_GALLERY_IMAGES);
}

/**
 * 複製行程用：保存「原始 trim 後字串」，只用 safePublicHttpsUrl 判斷是否保留，
 * 順序同公開 loader（publicStringList → 過濾 → 截上限）。
 * 不能存正規化後的 URL：非 ASCII 字元經 percent-encoding 會膨脹、可能超過長度上限，
 * 複本公開頁輸出時再正規化就會被丟掉。複本保存原始字串、公開頁輸出時才正規化，
 * 因此 publicGalleryUrls(複本) 與 publicGalleryUrls(原行程) 逐張相同，且輸出不超過寫入端 gallery max。
 */
export function clampGalleryForCopy(urls: string[] | undefined): string[] | undefined {
  return urls
    ? publicStringList(urls).filter((u) => safePublicHttpsUrl(u) !== '').slice(0, MAX_TRIP_GALLERY_IMAGES)
    : urls;
}
