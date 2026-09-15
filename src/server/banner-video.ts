/**
 * src/server/banner-video.ts — banner video 兩階段上傳共用邏輯（Issue #22 Part A）
 * -----------------------------------------------------------------------------
 * `presign → 直傳 Storage → confirm` 三支端點與孤兒清理 cron 共用這裡的常數與
 * 純函式，路由檔（`src/app/api/settings/shop-page/banner-video/**`、
 * `src/app/api/cron/banner-video-uploads-cleanup/route.ts`）只做 HTTP 層的事
 * （auth、zod 驗證、組回應），驗證與清理邏輯集中在這裡方便單元測試不碰真 DB／
 * 真 Storage。
 *
 * ⚠️ 「presign 時的 MIME/大小檢查」與「confirm 時的二次驗證」是兩件事，
 *    不能只做一邊：
 *      - presign 只看得到**用戶端宣稱**的 contentType／size——瀏覽器 <input
 *        type=file> 給的 file.type／file.size 本來就可以被偽造（不是真的上傳
 *        流量，只是一個 fetch 請求）。所以 presign 的檢查只是提早擋掉明顯不對
 *        的請求，**不是**安全邊界本身。
 *      - confirm 时必須用 service-role Storage 呼叫**重新讀一次物件的真實
 *        metadata**（實際 size／mimetype），比對是否仍在允許範圍內，這才是
 *        真正的安全邊界——不能只信任戶端說「我上傳完了」。
 */
import { randomUUID } from 'node:crypto';
import { createAdminSupabase } from '@/server/supabase';

export const BANNER_VIDEO_BUCKET = 'banner-videos';

export const BANNER_VIDEO_MAX_BYTES = 50 * 1024 * 1024; // 50 MiB

export const BANNER_VIDEO_ALLOWED_TYPES: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

/** presign 端點未通過驗證時的錯誤原因，供 route 對應到各自的錯誤訊息／代碼。 */
export type PresignValidationError = 'INVALID_MIME' | 'TOO_LARGE';

/**
 * presign 當下的第一道（不完整）檢查：用戶端宣稱的 contentType／sizeBytes。
 * 回傳 null 代表通過；否則回傳未通過的原因。fail closed——看不懂的一律當作
 * 不通過，不是「不確定就放行」。
 */
export function validatePresignRequest(params: {
  contentType: string;
  sizeBytes: number;
}): PresignValidationError | null {
  if (!(params.contentType in BANNER_VIDEO_ALLOWED_TYPES)) return 'INVALID_MIME';
  if (!Number.isFinite(params.sizeBytes) || params.sizeBytes <= 0) return 'TOO_LARGE';
  if (params.sizeBytes > BANNER_VIDEO_MAX_BYTES) return 'TOO_LARGE';
  return null;
}

/**
 * 伺服器端組出的租戶隔離路徑——用戶端**無法**影響這個路徑（只能觸發請求，
 * 收到的是伺服器已經決定好的 path），比照 `/api/upload` 既有慣例
 * （`{tenantId}/{randomUUID()}.{ext}`），這裡多一層 `banner-video/` 子資料夾
 * 純粹是命名空間整理，租戶邊界仍然是**第一段**（`storage.foldername(name))[1]`
 * 若日後要接 RLS policy 也對得上既有慣例）。
 */
export function buildBannerVideoStoragePath(tenantId: string, contentType: string): string {
  const ext = BANNER_VIDEO_ALLOWED_TYPES[contentType];
  if (!ext) throw new Error(`unsupported contentType for banner video: ${contentType}`);
  return `${tenantId}/banner-video/${randomUUID()}.${ext}`;
}

/** confirm 端點要求 storage_path 必須落在呼叫端租戶自己的資料夾下（防禦性重複檢查）。 */
export function isPathOwnedByTenant(path: string, tenantId: string): boolean {
  return path.startsWith(`${tenantId}/banner-video/`);
}

export type ConfirmVerificationError =
  | 'NOT_FOUND'
  | 'MIME_MISMATCH'
  | 'SIZE_MISMATCH';

/**
 * confirm 的核心驗證：拿 Storage 回報的**真實** metadata（不是用戶端說的）
 * 比對是否仍在允許範圍內。`objectInfo` 由呼叫端（route）先打 Storage API 拿到，
 * 這裡只做純邏輯判斷，方便單元測試餵各種假 metadata。
 */
export function verifyUploadedObject(
  objectInfo: { size: number; mimetype: string } | null,
): ConfirmVerificationError | null {
  if (!objectInfo) return 'NOT_FOUND';
  if (!(objectInfo.mimetype in BANNER_VIDEO_ALLOWED_TYPES)) return 'MIME_MISMATCH';
  if (objectInfo.size <= 0 || objectInfo.size > BANNER_VIDEO_MAX_BYTES) return 'SIZE_MISMATCH';
  return null;
}

/**
 * 孤兒清理的保留視窗——presign 過但超過這個時間仍未 confirm 的物件視為孤兒。
 * 24 小時的理由見 0114 migration 檔頭：遠短於「無限累積」，又足夠寬容一次
 * 使用者操作階段的中斷（分頁沒關、之後才回來完成上傳）。
 */
export const BANNER_VIDEO_ORPHAN_RETENTION_HOURS = 24;

export function orphanCutoffIso(now: Date = new Date()): string {
  return new Date(
    now.getTime() - BANNER_VIDEO_ORPHAN_RETENTION_HOURS * 60 * 60 * 1000,
  ).toISOString();
}

/**
 * 孤兒清理（cron 專用，bounded：只動超過保留視窗且從未 confirm 的列，見上）。
 * 每一列 best-effort 刪 Storage 物件（刪不掉只 log，不中止整批），然後不論
 * Storage 刪除是否成功都刪掉這張追蹤列本身——這張表只是「presign 過但可能沒
 * 上傳完成」的暫時記帳，不是需要保留失敗紀錄的稽核表；同一物件下一輪不會再被
 * 這支 cron 看到（`confirmed_at is null` 的列已經被刪掉了），可接受的權衡是
 * 「真的刪不掉的 Storage 物件變成沒有追蹤列的孤兒」——與 `page_view_events`
 * cleanup 對 bounded cron 的一貫立場一致：失敗只 log，不讓 cron 卡死。
 */
export async function cleanupOrphanedBannerVideoUploads(
  now: Date = new Date(),
): Promise<{ deletedRows: number; storageErrors: number; cutoffIso: string }> {
  const cutoffIso = orphanCutoffIso(now);
  const admin = createAdminSupabase();

  const { data: rows, error } = await admin
    .from('banner_video_pending_uploads')
    .select('id, storage_path')
    .is('confirmed_at', null)
    .lt('created_at', cutoffIso);
  if (error) throw error;

  let storageErrors = 0;
  for (const row of rows ?? []) {
    const { error: removeError } = await admin.storage
      .from(BANNER_VIDEO_BUCKET)
      .remove([row.storage_path]);
    if (removeError) {
      storageErrors += 1;
      console.error('[banner-video] cleanup: 刪除孤兒物件失敗', {
        path: row.storage_path,
        message: removeError.message,
      });
    }
  }

  const ids = (rows ?? []).map((r) => r.id);
  if (ids.length === 0) return { deletedRows: 0, storageErrors, cutoffIso };

  const { error: deleteError } = await admin
    .from('banner_video_pending_uploads')
    .delete()
    .in('id', ids);
  if (deleteError) throw deleteError;

  return { deletedRows: ids.length, storageErrors, cutoffIso };
}
