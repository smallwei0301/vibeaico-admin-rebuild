import { adapt, request } from '@/lib/api';

export type UploadBucket =
  | 'service-images'
  | 'product-images'
  | 'portfolio-images'
  | 'staff-avatars'
  | 'richmenu-assets'
  | 'welcome-card-images'
  /** 關鍵字回覆的附加圖片（issue #50）。LINE 會直接抓這個 public URL。 */
  | 'keyword-reply-images'
  /**
   * 顧客訊息（/tenant/chat）店家傳送的圖片（issue #15）。LINE image message 的
   * originalContentUrl / previewImageUrl 必須是外部可直接抓取的 HTTPS URL，
   * 與其他 LINE 可讀 bucket 同性質。bucket 本身由獨立 migration PR #628
   * （0128_issue_15_chat_images_bucket.sql）建立；在該 migration 套用到後端
   * 環境之前，選擇這個 bucket 上傳會拿到 500（bucket 不存在），而不是假裝成功。
   */
  | 'chat-images';

export interface UploadResult {
  url: string;
}

export interface RemoveWelcomeCardImageResult {
  removed: boolean;
}

/** Upload an image through the tenant-scoped server endpoint. */
export const uploadImage = (file: File, bucket: UploadBucket) =>
  adapt<UploadResult>(
    () => ({ url: file.name }),
    async () => {
      const form = new FormData();
      form.append('file', file);
      form.append('bucket', bucket);
      return request<UploadResult>('/api/upload', {
        method: 'POST',
        body: form,
      });
    },
  );

/** Remove a previously uploaded welcome-card image after its DB reference changes. */
export const removeWelcomeCardImage = (url: string) =>
  adapt<RemoveWelcomeCardImageResult | undefined>(
    () => undefined,
    () => request<RemoveWelcomeCardImageResult>('/api/upload', {
      method: 'DELETE',
      body: JSON.stringify({ bucket: 'welcome-card-images', url }),
    }),
  );
