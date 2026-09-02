import sharp from 'sharp';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiHttpError, ERR } from '@/server/http';

/** LINE image message 的 preview 上限；採 10^6 bytes，涵蓋兩種 MB 解讀。 */
export const LINE_PREVIEW_MAX_BYTES = 1_000_000;
export const PREVIEW_BUCKET = 'chat-images';
export const CHAT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export type ChatImageStorageRef = {
  bucket: typeof PREVIEW_BUCKET;
  path: string;
  previewPath: string;
};
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

export function isChatImageStorageRefForTenant(
  ref: ChatImageStorageRef,
  tenantId: string,
): boolean {
  if (ref.bucket !== PREVIEW_BUCKET || !isChatImagePathForTenant(ref.path, tenantId)) {
    return false;
  }

  return ref.previewPath === previewPathFor(ref.path);
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

async function downloadAndVerifyChatImage(
  supabase: SupabaseClient,
  path: string,
  maxBytes: number,
  expectedFormat: 'jpeg' | 'png',
): Promise<void> {
  const { data, error } = await supabase.storage.from(PREVIEW_BUCKET).download(path);
  if (error || !data) {
    throw new ApiHttpError(409, '圖片儲存物件不存在或尚未準備完成', ERR.CONFLICT);
  }

  const bytes = Buffer.from(await data.arrayBuffer());
  if (bytes.byteLength > maxBytes) {
    throw new ApiHttpError(413, '圖片超過允許大小', ERR.VALIDATION);
  }

  try {
    const metadata = await sharp(bytes).metadata();
    if (metadata.format !== expectedFormat) throw new Error('unexpected image format');
  } catch {
    throw new ApiHttpError(400, '圖片必須是有效的 JPEG 或 PNG', ERR.VALIDATION);
  }
}

/**
 * 只接受 upload route 回傳的 tenant-scoped storage ref，並在送 LINE 前重新驗證
 * Storage 內的兩個物件。URL 永遠由 server 依 verified ref 產生，client 不能指定。
 */
export async function resolveChatImageStorageRef(
  supabase: SupabaseClient,
  tenantId: string,
  ref: ChatImageStorageRef,
): Promise<{ originalUrl: string; previewUrl: string; storageRef: ChatImageStorageRef }> {
  if (!isChatImageStorageRefForTenant(ref, tenantId)) {
    throw new ApiHttpError(400, '圖片 storage ref 無效', ERR.VALIDATION);
  }

  const expectedFormat = ref.path.endsWith('.png') ? 'png' : 'jpeg';
  await downloadAndVerifyChatImage(supabase, ref.path, CHAT_IMAGE_MAX_BYTES, expectedFormat);
  await downloadAndVerifyChatImage(supabase, ref.previewPath, LINE_PREVIEW_MAX_BYTES, expectedFormat);

  const storage = supabase.storage.from(PREVIEW_BUCKET);
  return {
    originalUrl: storage.getPublicUrl(ref.path).data.publicUrl,
    previewUrl: storage.getPublicUrl(ref.previewPath).data.publicUrl,
    storageRef: ref,
  };
}
