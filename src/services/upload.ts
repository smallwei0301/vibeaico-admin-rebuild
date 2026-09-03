import { adapt, request } from '@/lib/api';

export type UploadBucket =
  | 'service-images'
  | 'product-images'
  | 'portfolio-images'
  | 'staff-avatars'
  | 'richmenu-assets'
  | 'welcome-card-images';

export interface UploadResult {
  url: string;
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
  adapt<void>(
    () => undefined,
    () => request<void>('/api/upload', {
      method: 'DELETE',
      body: JSON.stringify({ bucket: 'welcome-card-images', url }),
    }),
  );
