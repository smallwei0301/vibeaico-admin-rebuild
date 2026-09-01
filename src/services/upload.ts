import { ApiError } from '@/lib/api';

/** POST /api/upload 支援的圖片 bucket。 */
export type UploadBucket =
  | 'service-images'
  | 'product-images'
  | 'portfolio-images'
  | 'staff-avatars'
  | 'richmenu-assets'
  | 'chat-images';

export type UploadedImage = {
  url: string;
  path: string;
  bucket: UploadBucket;
  previewPath?: string;
  previewUrl?: string;
  storageRef?: {
    bucket: 'chat-images';
    path: string;
    previewPath: string;
  };
};

/** multipart 上傳；不能使用固定送 JSON 的 request()。 */
async function postImage(file: File, bucket: UploadBucket): Promise<UploadedImage> {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';
  const form = new FormData();
  form.append('file', file);
  form.append('bucket', bucket);

  const res = await fetch(`${base}/api/upload`, {
    method: 'POST',
    body: form,
    credentials: 'include',
  });

  let body: { success?: boolean; data?: UploadedImage; message?: string; code?: string };
  try {
    body = await res.json();
  } catch {
    throw new ApiError('伺服器回應格式錯誤', undefined, res.status);
  }
  if (!res.ok || body.success === false || !body.data?.url || !body.data.path) {
    throw new ApiError(body.message ?? '圖片上傳失敗，請稍後再試', body.code, res.status);
  }
  return body.data;
}

export async function uploadImage(file: File, bucket: UploadBucket): Promise<string> {
  return (await postImage(file, bucket)).url;
}

/** chat-images 必須有 server 產出的獨立 preview，缺少時視為錯誤而不送出。 */
export async function uploadChatImage(
  file: File,
): Promise<UploadedImage & {
  previewUrl: string;
  previewPath: string;
  storageRef: { bucket: 'chat-images'; path: string; previewPath: string };
}> {
  const result = await postImage(file, 'chat-images');
  if (!result.previewUrl || !result.previewPath || !result.storageRef) {
    throw new ApiError('圖片預覽產生失敗，請換一張再試', 'REQ_001', 400);
  }
  return result as UploadedImage & {
    previewUrl: string;
    previewPath: string;
    storageRef: { bucket: 'chat-images'; path: string; previewPath: string };
  };
}
