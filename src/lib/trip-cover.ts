import { uploadImage } from '@/services/upload';
import { updateTrip } from '@/services/tours';

/** 與 `/api/upload` 的限制一致（≤5MB、jpeg/png/webp），在送出前先擋掉，省一次往返。 */
export const TRIP_COVER_MAX_BYTES = 5 * 1024 * 1024;
export const TRIP_COVER_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const TRIP_COVER_BUCKET = 'service-images' as const;

export type TripCoverFileError = 'type' | 'size';

export function validateTripCoverFile(file: { type: string; size: number }): TripCoverFileError | null {
  if (!(TRIP_COVER_ALLOWED_TYPES as readonly string[]).includes(file.type)) return 'type';
  if (file.size > TRIP_COVER_MAX_BYTES) return 'size';
  return null;
}

/** 伺服器端 PUT /trips 為 manager-only（OWNER／MANAGER）；STAFF 先上傳再 403 會留下孤兒公開檔，所以前端要先擋。 */
export function canManageTripCover(role: 'OWNER' | 'MANAGER' | 'STAFF' | null | undefined): boolean {
  return role === 'OWNER' || role === 'MANAGER';
}

/** 上傳封面並寫入行程；回傳新的公開網址。上傳或寫入任一步失敗都會 throw，不假裝成功。 */
export async function uploadTripCover(tripId: string, file: File): Promise<string> {
  const { url } = await uploadImage(file, TRIP_COVER_BUCKET);
  await updateTrip(tripId, { coverImageUrl: url });
  return url;
}

/** 移除封面：送空字串（`cover_image_url` 為 not-null 文字欄位，空字串代表未設定）。 */
export async function removeTripCover(tripId: string): Promise<void> {
  await updateTrip(tripId, { coverImageUrl: '' });
}

/** 基本資料儲存的 payload 不得帶 coverImageUrl：封面只由封面卡片自己的流程管理，避免舊值覆蓋剛換好的封面。 */
export function omitTripCover<T extends { coverImageUrl?: string }>(form: T): Omit<T, 'coverImageUrl'> {
  const { coverImageUrl: _cover, ...rest } = form;
  return rest;
}
