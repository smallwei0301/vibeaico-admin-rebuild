import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { readUploadForm, uploadToBucket } from '@/server/upload';

/**
 * POST /api/upload —— 頁面用圖片統一上傳端點（07 分冊 §3）。
 * multipart/form-data：`file`（圖片）+ `bucket`（目的地 bucket 名）。
 *
 * ⚠️ **驗證與落地邏輯全部在 `src/server/upload.ts`**（issue #19 抽出）。
 * 本檔只負責「解析請求 → 驗身分 → 交給 uploadToBucket()」。
 * 規格上還有兩支 rich-menu 專用的上傳端點（`…/rich-menu/upload-image`、
 * `…/rich-menu/upload-cell-icon`），它們呼叫的是**同一支** uploadToBucket()——
 * 06 分冊 §6.1 刪掉 `upload-bg-image` 的理由是「同一件事兩份實作」，
 * 抽成共用函式之後就沒有第二份可以分岔（§6.2.8）。
 *
 * 回 { url, path, bucket }（private bucket 另帶 urlExpiresInSeconds；有縮圖時
 * 另帶 previewUrl / previewPath）。`path` 是 bucket 內路徑，給需要**存起來**的
 * 呼叫端用——簽名 URL 會過期，存 URL 只會存出一堆死連結。
 */
export const POST = handle(async (req) => {
  const t = await requireTenant();

  const form = await readUploadForm(req);
  const file = form.get('file');
  const bucket = form.get('bucket');

  if (!(file instanceof File))
    throw new ApiHttpError(400, '缺少圖片檔案（欄位名 file）', ERR.VALIDATION);
  if (typeof bucket !== 'string')
    throw new ApiHttpError(400, '不允許的 bucket', ERR.VALIDATION);

  return ok(await uploadToBucket({ tenantId: t.tenantId, file, bucket }));
});
