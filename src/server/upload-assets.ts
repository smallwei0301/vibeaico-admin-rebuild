import { randomUUID } from 'node:crypto';
import { ApiHttpError, ERR } from '@/server/http';

export const IMAGE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export type TenantStorageRef = {
  bucket: string;
  path: string;
  url: string;
};

export function validateImageUpload(
  file: { contentType: string; size: number },
  options: { allowWebp: boolean } = { allowWebp: true },
): { extension: string } {
  const extension = IMAGE_EXTENSIONS[file.contentType];
  if (!extension || (!options.allowWebp && extension === 'webp')) {
    const formats = options.allowWebp ? 'JPEG / PNG / WebP' : 'JPEG / PNG';
    throw new ApiHttpError(400, `僅支援 ${formats} 圖片`, ERR.VALIDATION);
  }
  if (file.size > IMAGE_UPLOAD_MAX_BYTES) {
    throw new ApiHttpError(400, '圖片超過 5MB 上限，請壓縮後再上傳', ERR.VALIDATION);
  }
  return { extension };
}

export function buildTenantAssetPath(
  tenantId: string,
  extension: string,
  createId: () => string = randomUUID,
): string {
  return `${tenantId}/${createId()}.${extension}`;
}

export function validateImageBytes(bytes: Uint8Array, extension: string): void {
  const startsWith = (signature: number[]) =>
    signature.every((byte, index) => bytes[index] === byte);
  const valid = extension === 'jpg'
    ? startsWith([0xff, 0xd8, 0xff])
    : extension === 'png'
      ? startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      : extension === 'webp'
        ? startsWith([0x52, 0x49, 0x46, 0x46])
          && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
        : false;
  if (!valid) {
    throw new ApiHttpError(400, '圖片內容與宣告格式不一致', ERR.VALIDATION);
  }
}

/**
 * 驗 storage reference 是目前租戶在指定 bucket 的 public object，而非只有
 * 「看起來像圖片」的任意 URL。物件是否存在仍須由呼叫端用 Storage API 查證。
 */
export function validateTenantStorageRef(
  value: TenantStorageRef,
  tenantId: string,
  allowedBuckets: ReadonlySet<string>,
  trustedOrigin: string,
): TenantStorageRef {
  if (!allowedBuckets.has(value.bucket)) {
    throw new ApiHttpError(400, '不允許的 bucket', ERR.VALIDATION);
  }
  if (!value.path.startsWith(`${tenantId}/`) || value.path.slice(tenantId.length + 1).includes('/')) {
    throw new ApiHttpError(400, '圖片不屬於目前租戶', ERR.VALIDATION);
  }

  let url: URL;
  try {
    url = new URL(value.url);
  } catch {
    throw new ApiHttpError(400, '圖片 URL 與 Storage 位置不一致', ERR.VALIDATION);
  }
  const expectedPath = `/storage/v1/object/public/${value.bucket}/${value.path}`;
  let decodedPath = '';
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    throw new ApiHttpError(400, '圖片 URL 與 Storage 位置不一致', ERR.VALIDATION);
  }
  if (url.protocol !== 'https:' || url.origin !== trustedOrigin || decodedPath !== expectedPath) {
    throw new ApiHttpError(400, '圖片 URL 與 Storage 位置不一致', ERR.VALIDATION);
  }
  return value;
}
