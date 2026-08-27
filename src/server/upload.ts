/**
 * src/server/upload.ts — 圖片上傳的**唯一**實作（07 分冊 §3、06 分冊 §6.1 / §6.2.8）
 *
 * ⚠️ 這裡的每一段原本都長在 `src/app/api/upload/route.ts` 裡。issue #19 要補
 * `POST …/rich-menu/upload-image` 與 `POST …/rich-menu/upload-cell-icon` 兩支
 * 規格上存在的端點，而 06 分冊 §6.1（2026-08-26）才剛因為「同一件事兩份實作」
 * 刪掉 `upload-bg-image`。
 *
 * 解法不是拒絕補端點，也不是複製一份：**驗證與落地邏輯抽到這裡，三支路由共用
 * 同一支函式**，`/api/upload` 自己也改成呼叫它。§6.1 反對的是第二份**實作**
 * （它逐字寫的是「短期看起來一樣、長期一定分岔，而分岔那天沒有任何測試會紅」），
 * 不是第二個路徑名。沒有第二份可以分岔的邏輯，那條規則就沒有被違反。
 *
 * ⚠️ 新增呼叫端時不要在自己的 route 裡「順便多驗一下」——那就是分岔的起點。
 * 要加限制就加在這裡，讓三支一起生效。
 */
import { randomUUID } from 'node:crypto';
import { ApiHttpError, ERR } from './http';
import { createAdminSupabase } from './supabase';
import { makeLinePreview, previewPathFor } from './image';

/**
 * bucket 白名單 = 0008 migration 的五個（service-images / product-images /
 * portfolio-images / staff-avatars / richmenu-assets）＋ 0017 的 chat-images
 * ＋ 0019 的 bug-report-attachments ＋ 0023 的 welcome-card-images。
 */
export const ALLOWED_BUCKETS = new Set([
  'service-images',
  'product-images',
  'portfolio-images',
  'staff-avatars',
  'richmenu-assets',
  'chat-images',
  'bug-report-attachments',
  'welcome-card-images',
]);

const MAX_BYTES = 5 * 1024 * 1024; // 5MB

/**
 * **比 5 MB 更嚴的 per-bucket 上限**（2026-08-26，14 分冊 §10 綠燈孤兒那一列）。
 *
 * 由來：`POST /api/settings/line/rich-menu/upload-bg-image` 曾經是第二支上傳端點，
 * 它有一道 1 MB 的伺服器端守門（LINE「Requirements for rich menu image」的
 * Max file size: 1 MB），但**零呼叫端**——選單設計頁走的是 `/api/upload`，1 MB 只在
 * 前端 `RICH_MENU_BG_MAX_BYTES` 擋，繞過前端就能塞 5 MB 進來，直到「發布」那一刻
 * 才被 LINE 退回。那支端點已刪除，**守門搬到真的有流量的這裡**。
 *
 * ⚠️ 限制跟著「這張圖最後會流到哪裡」走，不是跟著端點走——與 LINE_BOUND_BUCKETS
 * 和 LINE_PREVIEW_BUCKETS 同一條原則。所以 issue #19 新增的兩支 rich-menu 上傳端點
 * 自動吃到同一道 1 MB 守門，不必（也不得）在各自的 route 裡再寫一次。
 */
const BUCKET_MAX_BYTES: Record<string, number> = {
  'richmenu-assets': 1024 * 1024, // 1MB（LINE Rich Menu 圖片上限）
};

/**
 * **非公開**的 bucket —— 這裡的物件不得有可外連的永久網址。
 * `bug-report-attachments`（0019）是目前唯一一個：使用者是在畫面出問題的當下按下
 * 截圖，那張圖幾乎必然含有他當時螢幕上的顧客姓名、療程紀錄或訂單明細。
 */
const PRIVATE_BUCKETS = new Set(['bug-report-attachments']);
/** private bucket 的簽名 URL 效期（秒）。只夠上傳完當下預覽用，不是拿來存的。 */
const SIGNED_URL_TTL_SECONDS = 60 * 60;

/**
 * 會被送進 LINE 的 bucket —— 這三個的可用格式**比其他 bucket 窄**。
 *
 * LINE 的 image message 與 rich menu 圖片都只收 **JPEG / PNG**。先前一律放行 WebP，
 * 於是店家傳一張 WebP：上傳成功、畫面顯示已送出，但顧客的 LINE 顯示不出來——
 * 後端每一步都成功，錯誤只發生在 LINE 那一端，我們這邊完全無感。
 *
 * richmenu-assets 更隱蔽：`loadRichMenuBackground()` 只分「含 png 就當 image/png，
 * 否則一律當 image/jpeg」，所以 WebP 會被貼上 image/jpeg 的標籤送給 LINE，
 * LINE 收到名實不符的位元組直接拒絕。
 *
 * ⚠️ 不可以因此全站禁 WebP —— 其餘四個 bucket 只會出現在自家網頁上。
 */
const LINE_BOUND_BUCKETS = new Set(['chat-images', 'richmenu-assets', 'welcome-card-images']);

/**
 * 需要**額外產一張 ≤1 MB 縮圖**的 bucket —— 只有 `chat-images`（14 分冊 §8.15）。
 * ⚠️ `richmenu-assets` 是 LINE 去向，但**不需要縮圖**：rich menu 是整張 2500×1686
 * 的底圖，位元組直接上傳給 LINE，訊息裡根本沒有 previewImageUrl 這個欄位可指。
 */
const LINE_PREVIEW_BUCKETS = new Set(['chat-images']);

const WEB_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
/** LINE 只收 JPEG / PNG（見 LINE_BOUND_BUCKETS 的說明） */
const LINE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

export type UploadResult = {
  url: string;
  path: string;
  bucket: string;
  urlExpiresInSeconds?: number;
  previewPath?: string;
  previewUrl?: string;
};

/**
 * 從 `multipart/form-data` 取出 `file`，並檢查它真的是一個檔案。
 * 三支路由共用，免得各自寫一次 `instanceof File` 判斷。
 */
export async function readUploadFile(req: Request, field = 'file'): Promise<File> {
  const form = await req.formData().catch(() => {
    throw new ApiHttpError(400, '請以 multipart/form-data 上傳圖片', ERR.VALIDATION);
  });
  const file = form.get(field);
  if (!(file instanceof File))
    throw new ApiHttpError(400, `缺少圖片檔案（欄位名 ${field}）`, ERR.VALIDATION);
  return file;
}

/** 從 form 取一個字串欄位（沒有就回空字串） */
export async function readUploadForm(req: Request): Promise<FormData> {
  return req.formData().catch(() => {
    throw new ApiHttpError(400, '請以 multipart/form-data 上傳圖片', ERR.VALIDATION);
  });
}

/**
 * 驗證 → 上傳 → 回可用網址。呼叫端必須**先**跑完 `requireTenant()`：
 * 路徑第一段是租戶 id（與 0008 的 RLS 檢查規則一致），由伺服器端組出，不受用戶端左右。
 */
export async function uploadToBucket(args: {
  tenantId: string;
  file: File;
  bucket: string;
}): Promise<UploadResult> {
  const { tenantId, file, bucket } = args;

  if (!ALLOWED_BUCKETS.has(bucket))
    throw new ApiHttpError(400, '不允許的 bucket', ERR.VALIDATION);

  const lineBound = LINE_BOUND_BUCKETS.has(bucket);
  const ext = (lineBound ? LINE_TYPES : WEB_TYPES)[file.type];
  if (!ext)
    throw new ApiHttpError(
      400,
      lineBound
        ? 'LINE 只接受 JPEG 或 PNG 圖片，請轉檔後再上傳'
        : '僅支援 JPEG / PNG / WebP 圖片',
      ERR.VALIDATION,
    );

  const maxBytes = BUCKET_MAX_BYTES[bucket] ?? MAX_BYTES;
  if (file.size > maxBytes)
    throw new ApiHttpError(
      400,
      maxBytes === MAX_BYTES
        ? '圖片超過 5MB 上限，請壓縮後再上傳'
        : `圖片超過 ${Math.round(maxBytes / 1024 / 1024)}MB 上限（LINE 圖文選單圖片限制），請壓縮後再上傳`,
      ERR.VALIDATION,
    );

  /**
   * 縮圖**先產、後上傳**（issue #28 ⑬）。產不出縮圖時 Storage 裡不會留下任何東西，
   * 也不會回一個「上傳成功但這張圖永遠送不出去」的半成品。
   */
  const preview = LINE_PREVIEW_BUCKETS.has(bucket)
    ? await makeLinePreview(Buffer.from(await file.arrayBuffer()), file.type)
    : null;

  const path = `${tenantId}/${randomUUID()}.${ext}`;
  const admin = createAdminSupabase();
  const { error } = await admin.storage
    .from(bucket)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;

  let previewPath: string | null = null;
  if (preview) {
    previewPath = previewPathFor(path);
    const { error: previewError } = await admin.storage
      .from(bucket)
      .upload(previewPath, preview.bytes, { contentType: preview.contentType, upsert: false });
    if (previewError) {
      // 原圖已經上去了但縮圖沒有 → 收掉原圖，不要留下一個「送出去就會超規」的物件。
      await admin.storage.from(bucket).remove([path]);
      throw previewError;
    }
  }

  if (PRIVATE_BUCKETS.has(bucket)) {
    const { data, error: signError } = await admin.storage
      .from(bucket)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (signError) throw signError;
    return { url: data.signedUrl, path, bucket, urlExpiresInSeconds: SIGNED_URL_TTL_SECONDS };
  }

  const { data } = admin.storage.from(bucket).getPublicUrl(path);
  const previewUrl = previewPath
    ? admin.storage.from(bucket).getPublicUrl(previewPath).data.publicUrl
    : undefined;
  return { url: data.publicUrl, path, bucket, previewPath: previewPath ?? undefined, previewUrl };
}
