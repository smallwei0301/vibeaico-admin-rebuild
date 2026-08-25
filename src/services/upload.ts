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
  | 'chat-images'
  /** 回報問題的截圖（0019；**private** bucket，url 是短效簽名 URL，見下方 UploadResult） */
  | 'bug-report-attachments';

/** `POST /api/upload` 的回應（route.ts 的 ok({...})）。 */
export type UploadResult = {
  /**
   * 可直接放進 `<img src>` 的網址。
   *
   * ⚠️ **public bucket 是永久網址，private bucket 是短效簽名 URL**
   * （`urlExpiresInSeconds` 秒後失效）。所以 private bucket 的 url
   * **不可以存進資料庫**——存下去只會存出一堆死連結。要保存請存 `path`。
   */
  url: string;
  /** bucket 內路徑 `{tenantId}/{uuid}.{ext}`；要存進資料庫的是這個。 */
  path: string;
  bucket: UploadBucket;
  /** 只有 private bucket 會帶：url 的效期（秒）。 */
  urlExpiresInSeconds?: number;
};

/**
 * 上傳一個檔案，拿回 `{ url, path, bucket }`。
 *
 * 需要把上傳結果**存起來**的呼叫端請用這支（例如回報問題的截圖：`bug_reports`
 * 存的是 `attachment_path`，不是會過期的簽名 URL）。只要顯示、且 bucket 是
 * public 的呼叫端可以繼續用 `uploadImage()`。
 */
export async function uploadFile(file: File, bucket: UploadBucket): Promise<UploadResult> {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';
  const form = new FormData();
  form.append('file', file);
  form.append('bucket', bucket);

  const res = await fetch(`${base}/api/upload`, {
    method: 'POST',
    body: form,
    credentials: 'include',
  });

  let body: {
    success?: boolean;
    data?: Partial<UploadResult>;
    message?: string;
    code?: string;
  };
  try {
    body = await res.json();
  } catch {
    throw new ApiError('伺服器回應格式錯誤', undefined, res.status);
  }
  if (!res.ok || body.success === false || !body.data?.url || !body.data?.path) {
    throw new ApiError(body.message ?? '圖片上傳失敗，請稍後再試', body.code, res.status);
  }
  return {
    url: body.data.url,
    path: body.data.path,
    bucket,
    urlExpiresInSeconds: body.data.urlExpiresInSeconds,
  };
}

/** 只要網址的呼叫端（services / products / portfolio / staff / rich-menu）。 */
export async function uploadImage(file: File, bucket: UploadBucket): Promise<string> {
  return (await uploadFile(file, bucket)).url;
}
