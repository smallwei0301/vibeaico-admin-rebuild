import sharp from 'sharp';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiHttpError, ERR } from '@/server/http';

/**
 * src/server/image.ts —— LINE image message 的 `previewImageUrl` 縮圖（issue #28 ⑬ / 14 分冊 §8.15）。
 *
 * ## 為什麼需要這個檔
 *
 * LINE 的 image message 有**兩個**圖片欄位，上限不同（官方原文，2026-08-25 重新
 * 抓取 https://developers.line.biz/en/reference/messaging-api/index.html.md 確認）：
 *
 * | 欄位 | 格式 | 上限 |
 * |---|---|---|
 * | `originalContentUrl` | JPEG or PNG | **10 MB** |
 * | `previewImageUrl`    | JPEG or PNG | **1 MB** |
 *
 * `/api/upload` 的 MAX_BYTES 是 5 MB，而 chat / marketing 兩處都把同一個 URL 同時
 * 塞進兩個欄位 → **1–5 MB 的圖（手機拍的照片幾乎都在這個區間）已超出 preview 規格**。
 *
 * 擁有者裁決（14 分冊 §8.15）：**上傳時同時產一張 ≤1 MB 的縮圖**，preview 指向縮圖、
 * original 指向原圖。**不採用**「把上傳上限壓到 1 MB」——LINE 本來支援到 10 MB，
 * 壓下去等於店家不能傳手機原圖，是用刪除代替補齊。
 *
 * ## 1 MB 取 1,000,000 而不是 1,048,576
 *
 * 官方只寫「1 MB」，沒說是 10^6 還是 2^20。取小的那個：兩種解讀下都合規。
 * 差的那 48 KB 對縮圖畫質毫無影響，拿來換掉一個「看規格看法不同就超規」的風險很划算。
 *
 * ## 縮圖存哪裡：可推導，不另外記一筆
 *
 * `{tenantId}/{uuid}.jpg` → `{tenantId}/{uuid}.preview.jpg`（同 bucket、同資料夾、
 * 同副檔名）。三個理由：
 * 1. **不在 DB 加欄位存縮圖 URL**。issue #30 已經示範過正確作法：存 path 不存 URL，
 *    因為簽名 URL 會過期。縮圖的位置比 path 更該是**推導**出來的——多一筆記錄就多一個
 *    會跟事實不一致的地方。而且 `marketing_pushes.content` 是既有的 jsonb 契約，
 *    多塞一個欄位等於舊資料全部沒有它，反而製造兩種形狀。
 * 2. **第一段資料夾必須是 tenantId**（0008/0017 的 storage RLS 就是這樣檢查的），
 *    所以不能用 `previews/{tenantId}/…` 這種前綴。
 * 3. 上傳路徑固定是 `{uuid}.{ext}`（uuid 不含 `.`），所以 `{uuid}.preview.{ext}`
 *    不可能跟另一次上傳撞名，也一眼看得出誰是誰的縮圖。
 *
 * ## 縮圖維持與原圖相同的格式
 *
 * png→png、jpeg→jpeg。不是美學堅持，是為了讓上面那條推導成立：副檔名一旦可能改變，
 * 「從原圖 path 推出縮圖 path」就要多帶一個「縮圖到底是什麼格式」的未知數，
 * 那就等於又回到「要另外記一筆」。壓不下 1 MB 時改用縮小尺寸與量化，不改格式。
 */

/** LINE `previewImageUrl` 的檔案大小上限（見上方「1 MB 取 1,000,000」）。 */
export const LINE_PREVIEW_MAX_BYTES = 1_000_000;

/** 目前唯一需要 preview 縮圖的 bucket（見 /api/upload 的 LINE_PREVIEW_BUCKETS 註解）。 */
export const PREVIEW_BUCKET = 'chat-images';

/** Supabase public bucket 的固定路徑段，用來從 public URL 反推 bucket 內 path。 */
const PUBLIC_URL_MARKER = `/storage/v1/object/public/${PREVIEW_BUCKET}/`;

/**
 * `{tenantId}/{uuid}.jpg` → `{tenantId}/{uuid}.preview.jpg`。
 * 沒有副檔名時（不該發生，上傳端點一定給副檔名）就直接接在後面，仍然是可推導的。
 */
export function previewPathFor(path: string): string {
  const dot = path.lastIndexOf('.');
  const slash = path.lastIndexOf('/');
  if (dot <= slash) return `${path}.preview`;
  return `${path.slice(0, dot)}.preview${path.slice(dot)}`;
}

/** `previewPathFor` 的反向：不是縮圖路徑回 null。清理工具要用。 */
export function originalPathFor(previewPath: string): string | null {
  const m = /^(.*)\.preview(\.[^./]+)?$/.exec(previewPath);
  if (!m) return null;
  return `${m[1]}${m[2] ?? ''}`;
}

/**
 * 從 chat-images 的 public URL 取出 bucket 內 path；不是我們託管的網址回 null。
 *
 * 判定條件刻意包含 origin：光比對 `/object/public/chat-images/` 這一段，別人網站上
 * 一條長得像的路徑就會被當成我們的物件，於是推導出一個根本不存在的縮圖網址送給 LINE。
 */
export function chatImagePathFromUrl(url: string): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  let origin: string;
  try {
    origin = new URL(base).origin;
  } catch {
    return null;
  }
  if (!url.startsWith(`${origin}${PUBLIC_URL_MARKER}`)) return null;
  const path = url.slice(origin.length + PUBLIC_URL_MARKER.length);
  return path ? decodeURIComponent(path) : null;
}

/** bucket 內 path → public URL（與 supabase-js getPublicUrl 同形狀）。 */
export function chatImagePublicUrl(path: string): string {
  const origin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin;
  return `${origin}${PUBLIC_URL_MARKER}${path.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * 縮圖階梯：由大到小，取**第一個** ≤1 MB 的結果。
 *
 * 1024px 是給 LINE 聊天室氣泡看的縮圖，再大沒有意義；真要看細節的人會點開，
 * 那時拿到的是 `originalContentUrl` 的原圖。後面幾階只在照片特別難壓時才會用到
 * （量化調色盤／降尺寸），寧可縮圖糊一點，也不要送一張超規的 preview。
 */
const STEPS: { width: number; jpegQuality: number; png: { palette: boolean; colours?: number } }[] = [
  { width: 1024, jpegQuality: 82, png: { palette: false } },
  { width: 1024, jpegQuality: 65, png: { palette: true, colours: 256 } },
  { width: 640, jpegQuality: 65, png: { palette: true, colours: 128 } },
  { width: 320, jpegQuality: 60, png: { palette: true, colours: 128 } },
];

/**
 * PNG 量化的 `effort` 固定壓到 1（sharp 預設 7）。**這是量出來的，不是猜的**
 * （scripts/verify/line-preview-sizes.cjs，2026-08-25 沙箱輸出）：同一張 1024px 的圖，
 *   effort=7 → 748262 bytes / 4968ms
 *   effort=1 → 750334 bytes /  364ms
 * 慢 13 倍只換到 0.3% 的檔案大小。上傳是使用者在等的同步請求，多卡 5 秒不划算。
 */
const PNG_QUANTISE_EFFORT = 1;

/**
 * 產生一張 ≤`LINE_PREVIEW_MAX_BYTES` 的縮圖。
 *
 * **產不出來就丟例外，絕不回原圖。** 呼叫端（/api/upload）因此會擋下整次上傳。
 * 理由寫在 upload route 的註解裡：靜默退回原圖 = 超規的情況無聲地回來，而且完全沒有訊號
 * ——正是 CLAUDE.md「不要偽造已知」那一節在講的東西。
 *
 * 順帶一提，`sharp` 解得開 = 位元組真的是 JPEG/PNG。先前 `/api/upload` 只信任
 * `file.type`（用戶端可以隨便填），所以一張改名的 WebP 可以偽裝成 image/jpeg
 * 一路送到 LINE 才失敗。這裡多了一道真實解碼，順手把那個洞補起來。
 */
export async function makeLinePreview(
  input: Buffer,
  contentType: string,
): Promise<{ bytes: Buffer; contentType: string }> {
  const wantPng = contentType === 'image/png';

  /**
   * `failOn: 'none'` —— 解碼要跟瀏覽器一樣寬容，**不可以比改動前更嚴格**。
   *
   * 這是實測改出來的：`tests/integration/api/chat-image.15.test.ts` 的 1×1 PNG 夾具
   * 其實是**截斷的**（IHDR 宣告 colour type 6／RGBA，1×1 應該有 5 bytes 的掃描列資料，
   * 它的 IDAT 只 inflate 出 3 bytes）。libpng 與瀏覽器會補齊照顯示，sharp 底層的
   * libspng 在預設的 failOn='warning'（連 'error' 也一樣）會直接丟
   * `pngload_buffer: libspng read error`。
   *
   * 用嚴格模式的話，這種「別人都讀得出來、只有我們讀不出來」的檔案會被擋在上傳門口
   * ——那是拿本項（產縮圖）當理由去砍掉一個本來可用的能力，正是擁有者一再指出的
   * 「用刪除代替補齊」。這裡要擋的是**產不出縮圖**，不是**檔案不夠完美**。
   * 真的完全解不開的位元組仍然會在下面的 metadata() 丟例外。
   */
  const src = sharp(input, { failOn: 'none' })
    // 手機拍的照片靠 EXIF Orientation 決定正向；縮圖會丟掉 EXIF，不先轉正的話
    // 縮圖會跟原圖轉向不一致（同一張圖在聊天列表是躺的、點開是站的）。
    .rotate();

  let meta;
  try {
    meta = await src.metadata();
  } catch {
    throw new ApiHttpError(
      400,
      '這個檔案無法解碼成圖片（可能已毀損或不是真正的 JPEG / PNG），請換一張再試',
      ERR.VALIDATION,
    );
  }
  if (meta.format !== (wantPng ? 'png' : 'jpeg'))
    throw new ApiHttpError(
      400,
      `檔案內容不是 ${wantPng ? 'PNG' : 'JPEG'}（實際為 ${meta.format ?? '未知格式'}），請重新轉檔後再上傳`,
      ERR.VALIDATION,
    );

  for (const step of STEPS) {
    const pipe = src
      .clone()
      .resize({ width: step.width, height: step.width, fit: 'inside', withoutEnlargement: true });
    let out: Buffer;
    try {
      out = wantPng
        ? await pipe
            .png({ compressionLevel: 9, effort: PNG_QUANTISE_EFFORT, ...step.png })
            .toBuffer()
        : await pipe.jpeg({ quality: step.jpegQuality }).toBuffer();
    } catch {
      throw new ApiHttpError(
        400,
        '這張圖片無法產生 LINE 需要的預覽縮圖，請換一張再試',
        ERR.VALIDATION,
      );
    }
    if (out.byteLength <= LINE_PREVIEW_MAX_BYTES) return { bytes: out, contentType };
  }

  // 320px + 量化後仍 >1 MB 幾乎不可能發生；真的發生就是這張圖有我們沒想到的性質，
  // 那更不該靜默用原圖頂替（原圖只會更大）。擋下來，讓人看得見。
  throw new ApiHttpError(
    400,
    '這張圖片無法壓到 LINE 預覽圖的 1 MB 上限，請換一張再試',
    ERR.VALIDATION,
  );
}

type StoredObject = { name: string; metadata: { size?: number } | null };

/**
 * 送 LINE 前決定 `previewImageUrl`。**每一種結果都是量到的，不是猜的。**
 *
 * 1. 網址不是我們託管的 chat-images 物件（marketing 那頁的圖片網址是店家自己貼的
 *    外部網址）→ 我們沒上傳過它、量不到大小、也無從產縮圖。**照 LINE 官方原文**
 *    「Depending on the situation of a user device, the image of the
 *    `originalContentUrl` property may be used as the preview image.」用原圖當
 *    preview 是合法寫法。這不是「產不出縮圖的退路」，是另一種一開始就沒有縮圖可言的情形。
 * 2. 是我們的物件、縮圖在 → 用縮圖（順便**現場量一次**大小，不是相信上傳當時的承諾）。
 * 3. 是我們的物件、縮圖不在、但原圖本身 ≤1 MB → 原圖就是一張合規的 preview，直接用。
 *    （這條涵蓋本次改動之前上傳的舊圖。）
 * 4. 是我們的物件、縮圖不在、原圖 >1 MB → **擋下來**。這是唯一一種「本來該有縮圖卻沒有」
 *    的狀況，靜默用原圖頂替就等於把 issue #28 ⑬ 這個 bug 原封不動放回來，而且沒有任何訊號。
 * 5. 是我們的物件但整個 uuid 都查不到 → 圖已被刪，送出去只會讓顧客看到破圖並白白吃掉
 *    推播額度。擋下來。
 */
export async function resolveLinePreviewImageUrl(
  supabase: SupabaseClient,
  imageUrl: string,
): Promise<string> {
  const path = chatImagePathFromUrl(imageUrl);
  if (!path) return imageUrl; // ① 外部網址

  const slash = path.lastIndexOf('/');
  const dir = slash > 0 ? path.slice(0, slash) : '';
  const base = path.slice(slash + 1);
  const stem = base.includes('.') ? base.slice(0, base.indexOf('.')) : base;
  const previewPath = previewPathFor(path);
  const previewBase = previewPath.slice(previewPath.lastIndexOf('/') + 1);

  const { data, error } = await supabase.storage
    .from(PREVIEW_BUCKET)
    .list(dir, { search: stem, limit: 100 });
  if (error) throw error;
  const rows = (data ?? []) as unknown as StoredObject[];
  const sizeOf = (name: string) => rows.find((r) => r.name === name)?.metadata?.size;

  const previewSize = sizeOf(previewBase);
  if (typeof previewSize === 'number') {
    if (previewSize <= LINE_PREVIEW_MAX_BYTES) return chatImagePublicUrl(previewPath); // ②
    throw new ApiHttpError(
      409,
      '這張圖片的預覽縮圖超過 LINE 的 1 MB 上限，請重新上傳圖片後再送出',
      ERR.CONFLICT,
    );
  }

  const originalSize = sizeOf(base);
  if (typeof originalSize !== 'number')
    throw new ApiHttpError(409, '這張圖片已不存在，請重新上傳後再送出', ERR.CONFLICT); // ⑤
  if (originalSize <= LINE_PREVIEW_MAX_BYTES) return imageUrl; // ③

  throw new ApiHttpError(
    409,
    '這張圖片缺少符合 LINE 規格的預覽縮圖（1 MB 上限），請重新上傳後再送出',
    ERR.CONFLICT,
  ); // ④
}
