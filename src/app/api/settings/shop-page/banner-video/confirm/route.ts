import { z } from 'zod';
import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { createAdminSupabase } from '@/server/supabase';
import { brandingSettingsSchema } from '@/config/tenant-settings';
import {
  BANNER_VIDEO_BUCKET,
  isPathOwnedByTenant,
  verifyUploadedObject,
} from '@/server/banner-video';

/**
 * POST /api/settings/shop-page/banner-video/confirm — Issue #22 Part A。
 * body = `{path: string}`（presign 回傳的那個 `path`，逐字回傳，不接受其他值）。
 *
 * 三層租戶隔離（缺一都可能是 A 店 confirm 到 B 店影片的洞）：
 *   1. `isPathOwnedByTenant()`：path 前綴必須是呼叫端自己的 tenantId。
 *   2. `banner_video_pending_uploads` 查詢條件是
 *      `tenant_id = t.tenantId and storage_path = path`——B 店的 path 在 A 店
 *      的租戶下查不到列，就算 ①被繞過也擋在這裡。
 *   3. Storage 本身的路徑也含 tenantId 前綴，`.list()` 查的是同一個 tenantId
 *      資料夾，不會列到別的租戶物件。
 *
 * ⚠️ 核心安全動作：**重新向 Storage 要一次真實 metadata**（`.list()` 回傳的
 * `size`／`mimetype`），不是相信用戶端「我上傳完了、格式是 xxx」——這正是
 * `src/server/banner-video.ts` 檔頭強調的「confirm 才是真正的安全邊界」。
 * 只有真的驗證通過才寫入 `branding.bannerVideoUrl`。
 */
const bodySchema = z.object({ path: z.string().min(1) });

export const POST = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  const { path } = bodySchema.parse(await req.json());

  if (!isPathOwnedByTenant(path, t.tenantId)) {
    throw new ApiHttpError(403, '無權操作此物件', ERR.FORBIDDEN);
  }

  const admin = createAdminSupabase();

  const { data: pendingRow, error: pendingError } = await admin
    .from('banner_video_pending_uploads')
    .select('id')
    .eq('tenant_id', t.tenantId)
    .eq('storage_path', path)
    .maybeSingle();
  if (pendingError) throw pendingError;
  if (!pendingRow) {
    throw new ApiHttpError(404, '找不到對應的上傳請求，請重新上傳', ERR.NOT_FOUND);
  }

  const lastSlash = path.lastIndexOf('/');
  const dir = path.slice(0, lastSlash);
  const filename = path.slice(lastSlash + 1);

  const { data: listing, error: listError } = await admin.storage
    .from(BANNER_VIDEO_BUCKET)
    .list(dir, { search: filename, limit: 1 });
  if (listError) throw listError;

  const entry = listing?.find((f) => f.name === filename) ?? null;
  const objectInfo = entry?.metadata
    ? { size: entry.metadata.size as number, mimetype: entry.metadata.mimetype as string }
    : null;

  const verificationError = verifyUploadedObject(objectInfo);
  if (verificationError === 'NOT_FOUND') {
    throw new ApiHttpError(404, '尚未偵測到已上傳的檔案，請確認上傳是否完成', ERR.NOT_FOUND);
  }
  if (verificationError === 'MIME_MISMATCH') {
    throw new ApiHttpError(400, '上傳的檔案格式不符（僅支援 MP4 / WebM）', ERR.VALIDATION);
  }
  if (verificationError === 'SIZE_MISMATCH') {
    throw new ApiHttpError(400, '上傳的檔案大小超過限制', ERR.VALIDATION);
  }

  const { data: publicUrlData } = admin.storage.from(BANNER_VIDEO_BUCKET).getPublicUrl(path);
  const url = publicUrlData.publicUrl;

  const { data: row, error: settingsError } = await t.supabase
    .from('tenant_settings')
    .select('branding')
    .eq('tenant_id', t.tenantId)
    .maybeSingle();
  if (settingsError) throw settingsError;

  const current = brandingSettingsSchema.parse(row?.branding ?? {});
  const previousUrl = current.bannerVideoUrl;
  const merged = brandingSettingsSchema.parse({ ...current, bannerVideoUrl: url });

  const { error: upsertError } = await t.supabase
    .from('tenant_settings')
    .upsert({ tenant_id: t.tenantId, branding: merged }, { onConflict: 'tenant_id' });
  if (upsertError) throw upsertError;

  // ⚠️ 這裡再收窄一次 tenant_id（`pendingRow` 已經是上面 tenant_id 收窄查詢找到
  // 的列，理論上多此一舉）：`docs/integration/21-PLATFORM-ADMIN-IMPERSONATION.md`
  // §2.4 的原始碼鎖要求代登入可達路徑的每一段述句都自帶 tenant_id 收窄——代登入
  // 下這條路徑用的是 service role，RLS 不會兜底，沒有第二道防線，不能靠「這個 id
  // 反正只可能是自己租戶的」這種跨述句推論。
  const { error: confirmedError } = await admin
    .from('banner_video_pending_uploads')
    .update({ confirmed_at: new Date().toISOString() })
    .eq('id', pendingRow.id)
    .eq('tenant_id', t.tenantId);
  if (confirmedError) throw confirmedError;

  // 換掉舊影片時盡量清掉舊物件；這是 best-effort（不影響本次確認結果）——
  // 真正「刪不掉就不能宣稱成功」的誠實失敗語意留給專責的 DELETE 端點，
  // 這裡只是避免正常替換情境下留下孤兒檔案。
  if (previousUrl && previousUrl !== url) {
    const previousPath = previousUrl.startsWith(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BANNER_VIDEO_BUCKET}/`,
    )
      ? previousUrl.split(`/storage/v1/object/public/${BANNER_VIDEO_BUCKET}/`)[1]
      : null;
    if (previousPath && previousPath.startsWith(`${t.tenantId}/`)) {
      const { error: removeError } = await admin.storage
        .from(BANNER_VIDEO_BUCKET)
        .remove([decodeURIComponent(previousPath)]);
      if (removeError) {
        console.error('[banner-video] confirm: best-effort 清理舊影片失敗', removeError);
      }
    }
  }

  return ok(merged);
});
