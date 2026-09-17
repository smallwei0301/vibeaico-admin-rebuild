import { createAdminSupabase } from './supabase';
import { tenantOwnedPublicStoragePath } from './storage';

/**
 * src/server/storage-cleanup.ts — 共用「換圖／移除圖片時刪舊 Storage 物件」的
 * best-effort 清理邏輯（Issue #50 item B）。
 * -----------------------------------------------------------------------------
 * #50 的驗收標準明確要求「先搜尋是否已有共用 Storage cleanup Issue，若沒有，
 * 建立一張 bounded 共用 cleanup Issue 並由 #50 連結，不為 keyword image 私造
 * 第七套清理框架」。搜尋結果沒有既有的共用 Issue，因此新開了 #<PLACEHOLDER>
 * （PR body / commit 會補上實際編號），本檔就是那張 Issue 描述的「bounded 共用
 * 清理框架」的第一塊：一個純函式，任何 `{tenantId}/...` public Storage bucket
 * 換圖／移除圖片時都可以呼叫，不綁死在 keyword-reply-images 一個 bucket 上。
 *
 * #50 這一輪只把 keyword-reply-images 接上（唯一需要的呼叫端），其餘既有
 * bucket（service/product/portfolio/staff/richmenu images）沿用各自現況、
 * 之後由共用 Issue 逐一補接，不在本檔／本 PR 一次做完。
 *
 * 刻意不重用 `removeWelcomeCardImage()`（`src/server/storage.ts`）那一套
 * ——那個路徑靠 DB RPC（`retire_welcome_card_image`）做「這個 URL 是否仍被
 * 引用」的序列化鎖，因為歡迎卡片圖片沒有版本歷史、一次只有一個現值。
 * keyword_replies 的 PUT 已經是「先讀舊 content → UPDATE 新 content」的單列
 * 操作，UPDATE 本身已经序列化這一列的寫入，不需要另一層 RPC 鎖；而且題目
 * 明講「best-effort，刪不掉只記 log、不能讓 save 失敗」，複雜度應該對應
 * 這個風險等級，不是抄一套更重的機制。
 */

/** keyword-reply 附加圖片使用的 bucket（`/api/upload` 白名單同名）。 */
export const KEYWORD_REPLY_IMAGES_BUCKET = 'keyword-reply-images';

/**
 * Best-effort 刪除一個「由 `/api/upload` 產生、租戶自己名下」的 Storage 物件。
 *
 * 保證：
 * - 空字串／非本站 public URL／不是這個租戶第一段路徑 → 直接 no-op（沿用
 *   `tenantOwnedPublicStoragePath()` 既有的保守判斷，見 `storage.ts` 檔頭註解）。
 * - Storage 刪除失敗（網路、權限、物件已經不存在…）→ 只 log，**絕不 throw**。
 *   呼叫端不需要 try/catch；這個函式對呼叫端而言永遠「成功」。
 *   理由：換圖／移除圖片的使用者故事裡，「儲存成功」比「舊圖立刻消失」重要
 *   ——孤兒物件是可回收的（共用清理 Issue 之後補），儲存失敗不是。
 */
export async function deleteTenantStorageObjectBestEffort(params: {
  bucket: string;
  url: string;
  tenantId: string;
}): Promise<void> {
  const { bucket, url, tenantId } = params;
  if (!url) return;

  const path = tenantOwnedPublicStoragePath(url, bucket, tenantId);
  if (!path) return;

  try {
    const admin = createAdminSupabase();
    const { error } = await admin.storage.from(bucket).remove([path]);
    if (error) {
      console.error('[storage-cleanup] 刪除舊 Storage 物件失敗（best-effort，不影響儲存結果）', {
        bucket,
        path,
        message: error.message,
      });
    }
  } catch (err) {
    console.error('[storage-cleanup] 刪除舊 Storage 物件時拋出例外（best-effort，不影響儲存結果）', {
      bucket,
      path,
      err,
    });
  }
}
