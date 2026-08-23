import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';

/**
 * POST /api/settings/line/rich-menu/upload-bg-image —— Rich Menu 底圖上傳
 * （06 分冊 §6：multipart 收圖 → 存 richmenu-assets bucket → 回 URL）。
 *
 * - 欄位名 `file`；只收 image/jpeg、image/png（LINE Rich Menu 圖片格式限制）。
 * - 上限 1MB：MVP 的 create 端點會把這張圖**原樣**上傳給 LINE
 *   （/v2/bot/richmenu/{id}/content 的平台限制就是 1MB），先在這裡擋掉。
 * - 存放路徑 {tenantId}/…，符合 0008 bucket RLS（第一段必須是自己租戶 id）；
 *   用帶 session 的 client 上傳，RLS 把關。bucket 為 public → 回 publicUrl。
 * - 回傳 { url }；前端存進 line.richMenuBgImageUrl（PUT /api/settings/line）。
 */
const MAX_BYTES = 1024 * 1024; // 1MB（LINE Rich Menu 圖片上限）
const ALLOWED: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png' };

export const POST = handle(async (req) => {
  const t = await requireTenant('MANAGER');

  const form = await req.formData().catch(() => {
    throw new ApiHttpError(400, '請以 multipart/form-data 上傳圖片', ERR.VALIDATION);
  });
  const file = form.get('file');
  if (!(file instanceof File))
    throw new ApiHttpError(400, '缺少圖片檔案（欄位名 file）', ERR.VALIDATION);

  const ext = ALLOWED[file.type];
  if (!ext)
    throw new ApiHttpError(400, '僅支援 JPEG / PNG 圖片', ERR.VALIDATION);
  if (file.size > MAX_BYTES)
    throw new ApiHttpError(400, '圖片超過 1MB 上限（LINE Rich Menu 限制），請壓縮後再上傳', ERR.VALIDATION);

  const path = `${t.tenantId}/richmenu-bg-${Date.now()}.${ext}`;
  const { error } = await t.supabase.storage
    .from('richmenu-assets')
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;

  const { data } = t.supabase.storage.from('richmenu-assets').getPublicUrl(path);
  return ok({ url: data.publicUrl });
});
