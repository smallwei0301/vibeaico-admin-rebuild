import { randomUUID } from 'node:crypto';
import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { createAdminSupabase } from '@/server/supabase';

/**
 * POST /api/upload —— 頁面用圖片統一上傳端點（07 分冊 §3）。
 * multipart/form-data：`file`（圖片）+ `bucket`（目的地 bucket 名）。
 *
 * - bucket 白名單 = 0008 migration 的五個（service-images / product-images /
 *   portfolio-images / staff-avatars / richmenu-assets）＋ 0017 的 chat-images
 *   （顧客訊息傳送圖片，見 src/app/api/chat/messages/route.ts）＋ 0019 的
 *   bug-report-attachments（回報問題的截圖，見 src/app/api/bug-report/route.ts）。
 * - 驗證：≤5MB；**允許的圖片格式依 bucket 而不同**，見 LINE_BOUND_BUCKETS。
 * - 路徑 {tenantId}/{randomUUID()}.{ext}——第一段資料夾 = 租戶 id，
 *   與 0008 的 RLS 檢查規則一致。
 * - 以 service role 上傳（requireTenant() 已先驗明成員身分與租戶歸屬，
 *   路徑又由伺服器端組出，不受用戶端左右）。
 * - **公開性依 bucket 而不同**，見 PRIVATE_BUCKETS：public bucket 回
 *   getPublicUrl()，private bucket 回短效簽名 URL。
 * - 回 { url, path, bucket }（private bucket 另帶 urlExpiresInSeconds）；
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
  if (file.size > MAX_BYTES)
    throw new ApiHttpError(400, '圖片超過 5MB 上限，請壓縮後再上傳', ERR.VALIDATION);

  const path = `${t.tenantId}/${randomUUID()}.${ext}`;
  const admin = createAdminSupabase();
  const { error } = await admin.storage
    .from(bucket)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;

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
  return ok({ url: data.publicUrl, path, bucket });
});
