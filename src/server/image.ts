import sharp from 'sharp';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiHttpError, ERR } from '@/server/http';

/** LINE image message 的 preview 上限；採 10^6 bytes，涵蓋兩種 MB 解讀。 */
export const LINE_PREVIEW_MAX_BYTES = 1_000_000;
export const PREVIEW_BUCKET = 'chat-images';
const PUBLIC_URL_MARKER = '/storage/v1/object/public/' + PREVIEW_BUCKET + '/';

/** 原圖路徑固定是 tenantId/UUID.ext，preview 由此規則推導，不另存 URL。 */
export function previewPathFor(path: string): string {
  const dot = path.lastIndexOf('.');
  const slash = path.lastIndexOf('/');
  return dot > slash
    ? path.slice(0, dot) + '.preview' + path.slice(dot)
    : path + '.preview';
}

/** 只接受 upload route 產生的 chat-images 原圖路徑。 */
export function isChatImagePathForTenant(path: string, tenantId: string): boolean {
  const prefix = tenantId + '/';
  if (!path.startsWith(prefix) || path.slice(prefix.length).includes('/')) return false;
  return /^[0-9a-f-]{36}\.(?:jpg|png)$/i.test(path.slice(prefix.length));
}

/** 從 Supabase public URL 反推出 bucket 內路徑；不同 host 或 bucket 一律不是本站物件。 */
export function chatImagePathFromUrl(url: string): string | null {
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!configured) return null;
  let origin: string;
  try {
    origin = new URL(configured).origin;
  } catch {
    return null;
  }
  const prefix = origin + PUBLIC_URL_MARKER;
  if (!url.startsWith(prefix)) return null;
  try {
    const path = decodeURIComponent(url.slice(prefix.length));
    return path || null;
  } catch {
    return null;
  }
}

export function chatImagePublicUrl(path: string): string {
  const origin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin;
  return origin + PUBLIC_URL_MARKER + path.split('/').map(encodeURIComponent).join('/');
}

const STEPS = [
  { width: 1024, jpegQuality: 82, palette: false },
  { width: 1024, jpegQuality: 65, palette: true },
  { width: 640, jpegQuality: 65, palette: true },
  { width: 320, jpegQuality: 60, palette: true },
] as const;

/**
 * 先用實際位元組解碼，再依原格式產出 <=1 MB preview。
 * 產不出來就拒絕上傳，絕不靜默把超大的原圖當 preview。
 */
export async function makeLinePreview(
  input: Buffer,
  contentType: string,
): Promise<{ bytes: Buffer; contentType: string }> {
  const wantPng = contentType === 'image/png';
  const source = sharp(input, { failOn: 'none' }).rotate();
  let metadata;
  try {
    metadata = await source.metadata();
  } catch {
    throw new ApiHttpError(400, '這個檔案無法解碼成圖片，請換一張再試', ERR.VALIDATION);
  }
  const expected = wantPng ? 'png' : 'jpeg';
  if (metadata.format !== expected) {
    throw new ApiHttpError(
      400,
      '檔案內容不是 ' + (wantPng ? 'PNG' : 'JPEG') + '，請重新轉檔後再上傳',
      ERR.VALIDATION,
    );
  }

  for (const step of STEPS) {
    try {
      const pipeline = source.clone().resize({
        width: step.width,
        height: step.width,
        fit: 'inside',
        withoutEnlargement: true,
      });
      const bytes = wantPng
        ? await pipeline.png({
            compressionLevel: 9,
            effort: 1,
            palette: step.palette,
            colours: step.palette ? 256 : undefined,
          }).toBuffer()
        : await pipeline.jpeg({ quality: step.jpegQuality }).toBuffer();
      if (bytes.byteLength <= LINE_PREVIEW_MAX_BYTES) return { bytes, contentType };
    } catch {
      throw new ApiHttpError(400, '這張圖片無法產生 LINE 預覽縮圖，請換一張再試', ERR.VALIDATION);
    }
  }

  throw new ApiHttpError(400, '這張圖片無法壓到 LINE 預覽圖的 1 MB 上限，請換一張再試', ERR.VALIDATION);
}

type StoredObject = {
  name: string;
  metadata?: { size?: number | string } | null;
};

/**
 * 驗證原圖與推導出的 preview 都存在，並以 Storage 實際大小決定可送的 preview。
 * 舊的 <=1 MB 原圖可暫時自用作 preview；新的 upload flow 一律會有獨立 preview。
 */
export async function resolveLinePreviewImageUrl(
  supabase: SupabaseClient,
  imageUrl: string,
): Promise<string> {
  const path = chatImagePathFromUrl(imageUrl);
  if (!path) return imageUrl;

  const slash = path.lastIndexOf('/');
  const dir = slash > 0 ? path.slice(0, slash) : '';
  const base = path.slice(slash + 1);
  const stem = base.includes('.') ? base.slice(0, base.indexOf('.')) : base;
  const previewPath = previewPathFor(path);
  const previewBase = previewPath.slice(previewPath.lastIndexOf('/') + 1);

  const { data, error } = await supabase.storage
    .from(PREVIEW_BUCKET)
    .list(dir, { search: stem, limit: 100 });
  if (error) throw error;

  const objects = (data ?? []) as unknown as StoredObject[];
  const sizeOf = (name: string) => {
    const value = objects.find((object) => object.name === name)?.metadata?.size;
    const size = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(size) ? size : undefined;
  };
  const previewSize = sizeOf(previewBase);
  if (previewSize !== undefined) {
    if (previewSize <= LINE_PREVIEW_MAX_BYTES) return chatImagePublicUrl(previewPath);
    throw new ApiHttpError(409, '這張圖片的預覽縮圖超過 LINE 的 1 MB 上限，請重新上傳', ERR.CONFLICT);
  }

  const originalSize = sizeOf(base);
  if (originalSize === undefined) {
    throw new ApiHttpError(409, '這張圖片已不存在，請重新上傳後再送出', ERR.CONFLICT);
  }
  if (originalSize <= LINE_PREVIEW_MAX_BYTES) return imageUrl;
  throw new ApiHttpError(
    409,
    '這張圖片缺少符合 LINE 規格的預覽縮圖，請重新上傳後再送出',
    ERR.CONFLICT,
  );
}
