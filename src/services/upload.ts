import { ApiError } from '@/lib/api';

/**
 * POST /api/upload —— 圖片上傳（07 分冊 §3）。
 *
 * 不能走 `request()`：那支固定送 `Content-Type: application/json`，而本端點收
 * multipart/form-data。所以這裡自己 fetch，但錯誤仍照 `{ success, message, code }`
 * 信封轉成 `ApiError`，呼叫端的處理方式與其他端點一致。
 *
 * 沒有 mock 分支：呼叫端自己決定 mock 模式要不要走到這裡（mock 模式不該有真的
 * 上傳，也不該假裝上傳過）。
 */
export type UploadBucket =
  | 'service-images'
  | 'product-images'
  | 'portfolio-images'
  | 'staff-avatars'
  | 'richmenu-assets'
  | 'chat-images';

export async function uploadImage(file: File, bucket: UploadBucket): Promise<string> {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';
  const form = new FormData();
  form.append('file', file);
  form.append('bucket', bucket);

  const res = await fetch(`${base}/api/upload`, {
    method: 'POST',
    body: form,
    credentials: 'include',
  });

  let body: { success?: boolean; data?: { url?: string }; message?: string; code?: string };
  try {
    body = await res.json();
  } catch {
    throw new ApiError('伺服器回應格式錯誤', undefined, res.status);
  }
  if (!res.ok || body.success === false || !body.data?.url) {
    throw new ApiError(body.message ?? '圖片上傳失敗，請稍後再試', body.code, res.status);
  }
  return body.data.url;
}
