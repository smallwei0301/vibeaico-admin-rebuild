import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { createAdminSupabase } from '@/server/supabase';
import {
  removeWelcomeCardImage,
  tenantOwnedPublicStoragePath,
  WELCOME_CARD_BUCKET,
} from '@/server/storage';

/**
 * POST /api/upload —— 頁面用圖片統一上傳端點（07 分冊 §3）。
 * multipart/form-data：`file`（圖片）+ `bucket`（目的地 bucket 名）。
 *
 * - bucket 白名單 = 0008 migration 的五個，再加上 0069 的歡迎卡片圖片 bucket。
 * - 驗證：≤5MB、image/jpeg | png | webp。
 * - 路徑 {tenantId}/{randomUUID()}.{ext}——第一段資料夾 = 租戶 id，
 *   與 0008 的 RLS 檢查規則一致。
 * - 以 service role 上傳（requireTenant() 已先驗明成員身分與租戶歸屬，
 *   路徑又由伺服器端組出，不受用戶端左右）；bucket 皆 public → 回 getPublicUrl。
 * - 回 { url }；前端 services（services/products/portfolio/staff/rich-menu）
 *   先打這支拿 url，再把 url 塞進資源 payload。
 */
const ALLOWED_BUCKETS = new Set([
  'service-images',
  'product-images',
  'portfolio-images',
  'staff-avatars',
  'richmenu-assets',
  'welcome-card-images',
]);
const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export const POST = handle(async (req) => {
  const member = await requireTenant();

  const form = await req.formData().catch(() => {
    throw new ApiHttpError(400, '請以 multipart/form-data 上傳圖片', ERR.VALIDATION);
  });
  const file = form.get('file');
  const bucket = form.get('bucket');

  if (!(file instanceof File))
    throw new ApiHttpError(400, '缺少圖片檔案（欄位名 file）', ERR.VALIDATION);
  if (typeof bucket !== 'string' || !ALLOWED_BUCKETS.has(bucket))
    throw new ApiHttpError(400, '不允許的 bucket', ERR.VALIDATION);

  // Welcome-card settings and its public assets are manager-owned. Keep the
  // historical upload permissions for the other buckets unchanged.
  const t = bucket === WELCOME_CARD_BUCKET ? await requireTenant('MANAGER') : member;

  const ext = ALLOWED_TYPES[file.type];
  if (!ext)
    throw new ApiHttpError(400, '僅支援 JPEG / PNG / WebP 圖片', ERR.VALIDATION);
  if (file.size > MAX_BYTES)
    throw new ApiHttpError(400, '圖片超過 5MB 上限，請壓縮後再上傳', ERR.VALIDATION);

  const path = `${t.tenantId}/${randomUUID()}.${ext}`;
  const admin = createAdminSupabase();
  const { error } = await admin.storage
    .from(bucket)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;

  const { data } = admin.storage.from(bucket).getPublicUrl(path);
  return ok({ url: data.publicUrl });
});

const deleteBodySchema = z.object({
  bucket: z.literal(WELCOME_CARD_BUCKET),
  url: z.string(),
});

/**
 * DELETE /api/upload —— clean up one tenant-owned welcome-card object.
 * Invalid, external, cross-tenant, or currently referenced URLs are harmless
 * no-ops; callers cannot gain arbitrary storage access or delete the image
 * another manager has just restored.
 */
export const DELETE = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  const body = deleteBodySchema.parse(await req.json());
  const path = tenantOwnedPublicStoragePath(body.url, body.bucket, t.tenantId);
  if (!path) return ok({ removed: false });

  const { data: currentRow, error: currentError } = await t.supabase
    .from('tenant_settings')
    .select('notify')
    .eq('tenant_id', t.tenantId)
    .maybeSingle();
  if (currentError) throw currentError;
  const currentNotify = currentRow?.notify as Record<string, unknown> | null | undefined;
  const currentUrl =
    typeof currentNotify?.welcomeCardImageUrl === 'string'
      ? currentNotify.welcomeCardImageUrl
      : '';
  if (currentUrl === body.url) return ok({ removed: false });

  await removeWelcomeCardImage(body.url, t.tenantId);
  return ok({ removed: true });
});
