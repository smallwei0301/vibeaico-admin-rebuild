import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { createAdminSupabase } from '@/server/supabase';
import { brandingSettingsSchema } from '@/config/tenant-settings';
import { tenantOwnedPublicStoragePath } from '@/server/storage';
import { BANNER_VIDEO_BUCKET } from '@/server/banner-video';

/**
 * DELETE /api/settings/shop-page/banner-video — Issue #22 Part A。
 *
 * 順序刻意仿照 `removeWelcomeCardImage()`（`src/server/storage.ts`）：
 * **先清 DB 參照，再刪 Storage 物件**——但這裡的「先清」是指同一個請求裡先做
 * DB 寫入，DB 寫入本身若失敗會直接 500、不會往下砍 Storage；DB 寫入成功後才
 * 嘗試砍 Storage，若 Storage 刪除失敗則整個請求丟出例外（`handle()` 轉成
 * 500，`success:false`）——**絕不會在 Storage 真的刪不掉的情況下回
 * `success:true`**，這是「誠實失敗」而不是「假裝乾淨」。
 *
 * 沒有 bannerVideoUrl 或 URL 不屬於自己租戶時，視為沒有東西可刪，直接
 * `{removed:false}`（成功、但沒有動作），不是錯誤。
 */
export const DELETE = handle(async () => {
  const t = await requireTenant('MANAGER');

  const { data: row, error } = await t.supabase
    .from('tenant_settings')
    .select('branding')
    .eq('tenant_id', t.tenantId)
    .maybeSingle();
  if (error) throw error;

  const current = brandingSettingsSchema.parse(row?.branding ?? {});
  if (!current.bannerVideoUrl) return ok({ removed: false });

  const path = tenantOwnedPublicStoragePath(current.bannerVideoUrl, BANNER_VIDEO_BUCKET, t.tenantId);
  if (!path) {
    // 不屬於本租戶／格式不對的網址不是「找不到就當沒發生」——但也不該讓一支
    // DELETE 端點去動別的租戶的 Storage 物件；清空這裡看得到的參照即可。
    const merged = brandingSettingsSchema.parse({ ...current, bannerVideoUrl: '' });
    const { error: clearError } = await t.supabase
      .from('tenant_settings')
      .upsert({ tenant_id: t.tenantId, branding: merged }, { onConflict: 'tenant_id' });
    if (clearError) throw clearError;
    return ok({ removed: false });
  }

  const merged = brandingSettingsSchema.parse({ ...current, bannerVideoUrl: '' });
  const { error: clearError } = await t.supabase
    .from('tenant_settings')
    .upsert({ tenant_id: t.tenantId, branding: merged }, { onConflict: 'tenant_id' });
  if (clearError) throw clearError;

  const admin = createAdminSupabase();
  const { error: removeError } = await admin.storage.from(BANNER_VIDEO_BUCKET).remove([path]);
  if (removeError) {
    // ⚠️ DB 參照已經清空，但 Storage 物件可能還在——這裡刻意不吞掉錯誤、
    // 不假裝成功。前端會看到 success:false，可以引導使用者重試刪除。
    throw new ApiHttpError(
      502,
      `影片參照已移除，但實體檔案刪除失敗：${removeError.message}`,
      ERR.INTERNAL,
    );
  }

  await admin
    .from('banner_video_pending_uploads')
    .update({ confirmed_at: new Date().toISOString() })
    .eq('tenant_id', t.tenantId)
    .eq('storage_path', path);

  return ok({ removed: true });
});
