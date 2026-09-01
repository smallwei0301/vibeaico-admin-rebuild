import { randomUUID } from 'node:crypto';
import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { createAdminSupabase } from '@/server/supabase';
import { makeLinePreview, previewPathFor } from '@/server/image';

/**
 * POST /api/upload —— 頁面用圖片統一上傳端點（07 分冊 §3）。
 * multipart/form-data：`file`（圖片）+ `bucket`（目的地 bucket 名）。
 *
 * - bucket 白名單 = 0008 migration 的五個（service-images / product-images /
 *   portfolio-images / staff-avatars / richmenu-assets）＋0017 的 chat-images。
 * - 驗證：≤5MB、一般頁面支援 JPEG / PNG / WebP；chat-images 只接受
 *   JPEG / PNG，並以實際位元組解碼確認格式。
 * - 路徑 {tenantId}/{randomUUID()}.{ext}——第一段資料夾 = 租戶 id，
 *   與 0008 的 RLS 檢查規則一致。
 * - 以 service role 上傳（requireTenant() 已先驗明成員身分與租戶歸屬，
 *   路徑又由伺服器端組出，不受用戶端左右）；bucket 皆 public → 回 getPublicUrl。
 * - 一般 bucket 回 { url }；chat-images 另回 { path, previewPath, previewUrl }。
 *   preview 是真正產出的 ≤1MB 縮圖，不把原圖網址假裝成 preview。
 */
const ALLOWED_BUCKETS = new Set([
  'service-images',
  'product-images',
  'portfolio-images',
  'staff-avatars',
  'richmenu-assets',
  'chat-images',
]);
const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const CHAT_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

export const POST = handle(async (req) => {
  const t = await requireTenant();

  const form = await req.formData().catch(() => {
    throw new ApiHttpError(400, '請以 multipart/form-data 上傳圖片', ERR.VALIDATION);
  });
  const file = form.get('file');
  const bucket = form.get('bucket');

  if (!(file instanceof File))
    throw new ApiHttpError(400, '缺少圖片檔案（欄位名 file）', ERR.VALIDATION);
  if (typeof bucket !== 'string' || !ALLOWED_BUCKETS.has(bucket))
    throw new ApiHttpError(400, '不允許的 bucket', ERR.VALIDATION);

  const isChatImage = bucket === 'chat-images';
  const ext = (isChatImage ? CHAT_IMAGE_TYPES : ALLOWED_TYPES)[file.type];
  if (!ext) {
    throw new ApiHttpError(
      400,
      isChatImage ? 'LINE 圖片只支援 JPEG / PNG' : '僅支援 JPEG / PNG / WebP 圖片',
      ERR.VALIDATION,
    );
  }
  if (file.size > MAX_BYTES)
    throw new ApiHttpError(400, '圖片超過 5MB 上限，請壓縮後再上傳', ERR.VALIDATION);

  // 先產 preview 再寫入 Storage；解碼失敗時不留下原圖半成品。
  const preview = isChatImage
    ? await makeLinePreview(Buffer.from(await file.arrayBuffer()), file.type)
    : null;
  const path = `${t.tenantId}/${randomUUID()}.${ext}`;
  const admin = createAdminSupabase();
  const { error } = await admin.storage
    .from(bucket)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;

  let previewPath: string | undefined;
  if (preview) {
    previewPath = previewPathFor(path);
    const { error: previewError } = await admin.storage
      .from(bucket)
      .upload(previewPath, preview.bytes, { contentType: preview.contentType, upsert: false });
    if (previewError) {
      const { error: cleanupError } = await admin.storage.from(bucket).remove([path]);
      if (cleanupError) console.error('[upload] chat image cleanup failed', cleanupError);
      throw previewError;
    }
  }

  const { data } = admin.storage.from(bucket).getPublicUrl(path);
  return ok({
    url: data.publicUrl,
    path,
    bucket,
    ...(previewPath
      ? {
          previewPath,
          previewUrl: admin.storage.from(bucket).getPublicUrl(previewPath).data.publicUrl,
        }
      : {}),
  });
});
