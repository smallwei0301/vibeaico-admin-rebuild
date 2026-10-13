import { uploadImage } from '@/services/upload';
import {
  TRIP_COVER_ALLOWED_TYPES,
  TRIP_COVER_MAX_BYTES,
  canManageTripCover,
  validateTripCoverFile,
} from '@/lib/trip-cover';
import type { TripCoverFileError } from '@/lib/trip-cover';

/**
 * 行銷推播／活動圖片（LINE image message 需要外部可直接抓取的 https 網址）。
 * 沿用既有的 public、帶 tenant 前綴、已在 /api/upload 白名單內的 bucket，不新增 bucket／migration。
 */
export const MESSAGE_IMAGE_BUCKET = 'keyword-reply-images' as const;
export const MESSAGE_IMAGE_MAX_BYTES = TRIP_COVER_MAX_BYTES;
export const MESSAGE_IMAGE_ALLOWED_TYPES = TRIP_COVER_ALLOWED_TYPES;

export type MessageImageFileError = TripCoverFileError;

/** 與 `/api/upload` 限制一致（≤5MB、jpeg/png/webp），送出前先擋。 */
export const validateMessageImageFile: (file: { type: string; size: number }) => MessageImageFileError | null =
  validateTripCoverFile;

/** POST/PUT /api/marketing/pushes 與 /api/campaigns 皆為 manager-only；STAFF 先上傳再 403 會留下孤兒公開檔，前端要先擋。 */
export const canManageMarketing: (role: 'OWNER' | 'MANAGER' | 'STAFF' | null | undefined) => boolean =
  canManageTripCover;

/** 上傳並回傳公開網址；失敗直接 throw，不假裝成功。 */
export async function uploadMessageImage(file: File): Promise<string> {
  const { url } = await uploadImage(file, MESSAGE_IMAGE_BUCKET);
  return url;
}

/**
 * LINE image message 只收 https 網址；send route 會靜默略過非 https（只送文字）。
 * 表單送出前先擋，避免「存了卻沒發出圖片」的假成功。
 * 空字串視為未設定（可）。mock 模式的上傳回傳 blob: 網址（僅 demo 預覽），放行。
 */
export function isLineSendableImageUrl(url: string, opts: { mock?: boolean } = {}): boolean {
  const v = url.trim();
  if (!v) return true;
  if (/^https:\/\//i.test(v)) return true;
  return Boolean(opts.mock) && /^blob:/i.test(v);
}
