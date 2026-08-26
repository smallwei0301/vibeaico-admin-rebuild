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
 *   portfolio-images / staff-avatars / richmenu-assets）＋ 0017 的 chat-images
 *   （顧客訊息傳送圖片，見 src/app/api/chat/messages/route.ts）＋ 0019 的
 *   bug-report-attachments（回報問題的截圖，見 src/app/api/bug-report/route.ts）。
 * - 驗證：預設 ≤5MB，**部分 bucket 更嚴**（見 BUCKET_MAX_BYTES：richmenu-assets 1MB）；
 *   **允許的圖片格式依 bucket 而不同**，見 LINE_BOUND_BUCKETS。
 * - 路徑 {tenantId}/{randomUUID()}.{ext}——第一段資料夾 = 租戶 id，
 *   與 0008 的 RLS 檢查規則一致。
 * - 以 service role 上傳（requireTenant() 已先驗明成員身分與租戶歸屬，
 *   路徑又由伺服器端組出，不受用戶端左右）。
 * - **公開性依 bucket 而不同**，見 PRIVATE_BUCKETS：public bucket 回
 *   getPublicUrl()，private bucket 回短效簽名 URL。
 * - **LINE 聊天圖另產一張 ≤1 MB 的縮圖**（`{uuid}.preview.{ext}`），見
 *   LINE_PREVIEW_BUCKETS；`previewImageUrl` 的上限只有 1 MB，與原圖的 10 MB 不同。
 * - 回 { url, path, bucket }（private bucket 另帶 urlExpiresInSeconds；有縮圖時
 *   另帶 previewUrl / previewPath）；
 *   `path` 是 bucket 內路徑，給需要**存起來**的呼叫端用——簽名 URL 會過期，
 *   存 URL 只會存出一堆死連結（06 分冊 §8.5 第 5 條的既有技術債就是這樣來的：
 *   chat_messages 只存最終 URL，沒存 path，日後要清理得反解 URL）。
 *   既有呼叫端（services/products/portfolio/staff/rich-menu）只讀 data.url，
 *   多出來的欄位不影響它們。
 */
const ALLOWED_BUCKETS = new Set([
  'service-images',
  'product-images',
  'portfolio-images',
  'staff-avatars',
  'richmenu-assets',
  'chat-images',
  'bug-report-attachments',
]);
const MAX_BYTES = 5 * 1024 * 1024; // 5MB

/**
 * **比 5 MB 更嚴的 per-bucket 上限**（2026-08-26，14 分冊 §10 綠燈孤兒那一列）。
 *
 * 由來：`POST /api/settings/line/rich-menu/upload-bg-image` 曾經是第二支上傳端點，
 * 它有一道 1 MB 的伺服器端守門（LINE「Requirements for rich menu image」的
 * Max file size: 1 MB），但**零呼叫端**——選單設計頁走的是本端點，1 MB 只在
 * 前端 `RICH_MENU_BG_MAX_BYTES` 擋，繞過前端就能塞 5 MB 進來，直到「發布」那一刻
 * 才被 LINE 退回。那支端點本輪已刪除（它只信 `file.type`，沒有本端點的解碼比對，
 * 接上去等於把已修好的 WebP 偽裝漏洞放回來；同一件事留兩份實作也正是本專案
 * 反覆抓到的分岔缺陷），**守門搬到真的有流量的這裡**。
 *
 * ⚠️ 限制跟著「這張圖最後會流到哪裡」走，不是跟著端點走——與 LINE_BOUND_BUCKETS
 * 和 LINE_PREVIEW_BUCKETS 同一條原則。其餘 bucket 維持 5 MB。
 */
const BUCKET_MAX_BYTES: Record<string, number> = {
  'richmenu-assets': 1024 * 1024, // 1MB（LINE Rich Menu 圖片上限）
};

/**
 * **非公開**的 bucket —— 這裡的物件不得有可外連的永久網址。
 *
 * `bug-report-attachments`（0019）是目前唯一一個。理由與 `chat-images` 正好相反：
 * chat-images 被迫 public，是因為 LINE 的 image message 只收可外連的 HTTPS 網址，
 * 而「LINE 什麼時候去抓那個網址」官方沒有任何規格（06 分冊 §8.1–8.6），所以連改成
 * 簽名 URL 都不敢做；代價照實記在 §8.5：**網址即權限、無身分檢查、不分租戶、
 * 外流即失守**。
 *
 * 回報問題的截圖**沒有那個限制**（沒有第三方服務要來抓圖，只有平台端要看），
 * 而敏感度**更高**：使用者是在畫面出問題的當下按下截圖，那張圖幾乎必然含有
 * 他當時螢幕上的顧客姓名、療程紀錄或訂單明細。所以走 private bucket ＋
 * 由伺服器端現簽的短效 URL，不把一個被迫接受的隱私缺口複製到沒必要公開的地方。
 */
const PRIVATE_BUCKETS = new Set(['bug-report-attachments']);
/** private bucket 的簽名 URL 效期（秒）。只夠上傳完當下預覽用，不是拿來存的。 */
const SIGNED_URL_TTL_SECONDS = 60 * 60;

/**
 * 會被送進 LINE 的 bucket —— 這兩個的可用格式**比其他 bucket 窄**。
 *
 * LINE 的 image message 與 rich menu 圖片都只收 **JPEG / PNG**
 * （Messaging API reference「Image message」：originalContentUrl /
 * previewImageUrl 皆為 "JPEG or PNG"；查證紀錄見 06 分冊 §8）。
 *
 * 先前這裡一律放行 WebP，於是店家傳一張 WebP 進 chat-images：上傳成功、
 * chat_messages 有紀錄、畫面顯示已送出，但顧客的 LINE 顯示不出來——後端
 * 每一步都成功，錯誤只發生在 LINE 那一端，我們這邊完全無感。這正是
 * CLAUDE.md 說的「成功訊息宣稱了一件沒發生的事」。
 *
 * richmenu-assets 更隱蔽：`rich-menu/create` 的 loadBackgroundImage() 只分
 * 「含 png 就當 image/png，否則一律當 image/jpeg」，所以 WebP 會被貼上
 * image/jpeg 的標籤送給 LINE，LINE 收到名實不符的位元組直接拒絕。
 *
 * ⚠️ 不可以因此全站禁 WebP —— 其餘四個 bucket（商品圖、服務圖、作品集、
 * 員工頭像）只會出現在自家網頁上，WebP 在那裡是更好的選擇（同畫質更小），
 * 砍掉純粹是損失。限制要跟著「這張圖最後會流到哪裡」走，不是跟著上傳端點走。
 */
const LINE_BOUND_BUCKETS = new Set(['chat-images', 'richmenu-assets']);

/**
 * 需要**額外產一張 ≤1 MB 縮圖**的 bucket —— 只有 `chat-images`（issue #28 ⑬ /
 * 14 分冊 §8.15）。
 *
 * LINE 的 image message 有兩個圖片欄位，上限不同：`originalContentUrl` 10 MB、
 * `previewImageUrl` **1 MB**。本端點放行到 5 MB，所以 1–5 MB 的圖（手機原圖幾乎
 * 都在這個區間）當 preview 就已超規。縮圖在這裡一併產出，路徑是原圖路徑推導得到的
 * `{uuid}.preview.{ext}`（推導規則與理由見 src/server/image.ts）。
 *
 * ⚠️ **`richmenu-assets` 是 LINE 去向，但不需要縮圖**，兩者不可混為一談：
 * rich menu 是整張 2500×1686 的底圖，經
 * `POST /v2/bot/richmenu/{id}/content`（src/app/api/settings/line/rich-menu/create）
 * 把**位元組直接上傳給 LINE**，訊息裡根本沒有 previewImageUrl 這個欄位可指。
 * 多產一張只是白花儲存空間，還會多一個沒有任何人讀的物件。
 * 官方原文（Messaging API reference「Requirements for rich menu image」，
 * 2026-08-25 重新抓取確認）：JPEG or PNG／寬 800–2500／高 ≥250／長寬比 ≥1.45／
 * **Max file size: 1 MB**——注意那是**底圖本身**的上限，不是 preview 的概念。
 *
 * 其餘四個 bucket（商品圖、服務圖、作品集、員工頭像）只出現在自家網頁上，
 * 沒有任何東西會去讀縮圖，同樣不產。限制與加工都要跟著「這張圖最後會流到哪裡」走。
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
   * 縮圖**先產、後上傳**（issue #28 ⑬）。
   *
   * 順序是刻意的：產不出縮圖時，Storage 裡不會留下任何東西，也不會回一個
   * 「上傳成功但這張圖永遠送不出去」的半成品。這就是「產不出縮圖時怎麼辦」的答案
   * ——**擋下整次上傳，回一個說得出原因的 400**：
   *
   * - 不可以靜默退回「用原圖當 preview」：那正是本項要修的 bug，退回去等於把它
   *   原封不動放回來，而且從此沒有任何訊號會提醒任何人（CLAUDE.md「不要偽造已知」）。
   * - 不可以「原圖照上、縮圖之後再說」：使用者在上傳當下就得到成功，等到真的要送給
   *   顧客時才失敗——失敗被推遲到使用者不在場、且是對外發送的那一刻，比當場擋下嚴重得多。
   *   當場擋下，使用者還握著那個檔案，換一張就好。
   */
  const preview = LINE_PREVIEW_BUCKETS.has(bucket)
    ? await makeLinePreview(Buffer.from(await file.arrayBuffer()), file.type)
    : null;

  const path = `${t.tenantId}/${randomUUID()}.${ext}`;
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
    return ok({
      url: data.signedUrl,
      path,
      bucket,
      urlExpiresInSeconds: SIGNED_URL_TTL_SECONDS,
    });
  }

  const { data } = admin.storage.from(bucket).getPublicUrl(path);
  const previewUrl = previewPath
    ? admin.storage.from(bucket).getPublicUrl(previewPath).data.publicUrl
    : undefined;
  return ok({ url: data.publicUrl, path, bucket, previewPath: previewPath ?? undefined, previewUrl });
});
