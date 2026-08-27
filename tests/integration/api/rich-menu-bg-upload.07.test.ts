/**
 * 選單設計頁「背景圖上傳」的完整鏈路整合測試 —— issue #7 (乙) 最後一列，
 * 同時關閉 08 分冊 Phase 7 的重開項（`/api/upload` 沒有任何真實用戶）。
 *
 * 這一列的驗收原文是：「Playwright 上傳測試圖 → **bucket 出現檔案（service role 查
 * storage.objects）** → 發布用該圖成功」。本檔負責後兩段——也就是「上傳回 200」
 * 之外真正該證明的兩件事：
 *
 *   ① 檔案**真的在 bucket 裡**：不看端點回應自己說的 url，改用 service role
 *      直查 `storage.objects`（透過 storage API 的 list()，服務端讀的就是那張表），
 *      比對 name / bucket_id / metadata.size。端點回一個網址是很容易的，
 *      物件有沒有落地是另一回事。
 *   ② **發布真的用到那張圖**：`/api/settings/line/rich-menu/create` 的
 *      loadBackgroundImage() 讀的是 `tenant_settings.line.richMenuBgImageUrl`，
 *      **不是**發布請求的 body。所以本檔把上傳→存設定→發布整條走一遍，最後比對
 *      mock LINE 在 `/v2/bot/richmenu/{id}/content` 收到的**位元組**與我們上傳的
 *      那張圖逐位元組相同。少了這一段，「上傳成功」與「顧客看到那張圖」之間
 *      還隔著一個沒人驗過的假設。
 *
 * 頁面那一段（按鈕 → uploadImage → saveLineSettings 的順序與 await-first）由
 * tests/unit/honest-not-built-rich-menu-design.test.ts 的
 * 「背景圖上傳真的接上 /api/upload，且結果有寫進 tenant_settings（否則發布用不到）」
 * 釘住；兩者合起來才是完整的 handler → service → endpoint 鏈路。
 *
 * ⚠️ `richmenu-assets` 在 `/api/upload` 的 LINE_BOUND_BUCKETS 裡＝**只收 JPEG/PNG，
 * 不收 WebP**（LINE 的圖片限制）。本檔特地拿一張合法 WebP 驗這條窄規則真的生效——
 * 用一般 bucket 的規則（放行 WebP）測會全綠，卻放過真正的 bug。
 *
 * 清理：本檔上傳的 storage 物件 afterAll 以 service role remove；
 * tenant_settings 還原快照。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';
import { LineMockServer } from '../../helpers/line-mock';
import { encryptSecret } from '@/server/crypto';

const BASE_URL = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';
const BUCKET = 'richmenu-assets';

const CHANNEL_SECRET = 'itest-bg07-channel-secret';
const CHANNEL_TOKEN = 'itest-bg07-access-token';

/**
 * 測試底圖：一張**內容獨一無二**的 PNG（不是共用的 1×1 透明圖）。
 * 用獨一無二的位元組才驗得出「LINE 收到的就是我們上傳的那一張」——
 * 拿 1×1 透明圖的話，跟 create route 的純色 PNG 退路長得太像，
 * 比對通過也說明不了是哪一條路徑產生的。
 *
 * 這是一張 2×2 的 PNG，四個像素顏色各異；base64 由 zlib 壓過的原始 IDAT 組成。
 */
const BG_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP8z8Dwn4GB4T8TAwMDAwAqHwMBnkE1zwAAAABJRU5ErkJggg==',
  'base64',
);

/** 合法的最小 WebP（RIFF....WEBPVP8L…）—— 驗 LINE_BOUND_BUCKETS 只收 jpg/png */
const WEBP = Buffer.from(
  'UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==',
  'base64',
);

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };
type UploadData = { url: string; path: string };

type SettingsSnapshot = {
  line: unknown;
  line_channel_secret_enc: string | null;
  line_channel_access_token_enc: string | null;
};

let admin: SupabaseClient;
let ownerA: AuthedApi;
const mock = new LineMockServer();
let settingsSnapshot: SettingsSnapshot | null = null;
/** 本檔上傳成功的 bucket 內路徑，afterAll 全部清掉 */
const uploadedPaths: string[] = [];

/** 上傳一個檔案到 /api/upload（multipart），回原始回應 */
async function upload(file: File, bucket = BUCKET): Promise<Response> {
  const form = new FormData();
  form.append('file', file);
  form.append('bucket', bucket);
  return ownerA.fetch('/api/upload', { method: 'POST', body: form });
}

/**
 * service role 直查 `storage.objects`：以 storage API 的 list() 讀該租戶資料夾。
 * list() 在 server 端就是對 `storage.objects` 做 select（bucket_id + name 前綴），
 * 回的 metadata 也是那張表的欄位，所以這是「直查那張表」而不是問端點。
 */
async function objectsInTenantFolder() {
  const { data, error } = await admin.storage.from(BUCKET).list(SHOP_A.id, { limit: 100 });
  expect(error).toBeNull();
  return (data ?? []) as { name: string; metadata: { size: number; mimetype: string } }[];
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  expect(process.env.SETTINGS_ENCRYPTION_KEY).toBeTruthy();
  if (!process.env.LINE_API_BASE || !process.env.LINE_DATA_API_BASE) {
    throw new Error(
      '缺少 LINE_API_BASE / LINE_DATA_API_BASE：Rich Menu 傳圖走 api-data.line.me，' +
      '兩個都要指到 tests/helpers/line-mock.ts 的本地假 LINE server（.env.test）。',
    );
  }

  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
  await mock.start();

  const { data: snap, error: e0 } = await admin.from('tenant_settings')
    .select('line, line_channel_secret_enc, line_channel_access_token_enc')
    .eq('tenant_id', SHOP_A.id).single();
  expect(e0).toBeNull();
  settingsSnapshot = snap as SettingsSnapshot;
  const { error: e1 } = await admin.from('tenant_settings').update({
    line_channel_secret_enc: encryptSecret(CHANNEL_SECRET),
    line_channel_access_token_enc: encryptSecret(CHANNEL_TOKEN),
  }).eq('tenant_id', SHOP_A.id);
  expect(e1).toBeNull();
});

afterAll(async () => {
  if (uploadedPaths.length) await admin.storage.from(BUCKET).remove(uploadedPaths);
  if (settingsSnapshot) {
    await admin.from('tenant_settings').update({
      line: settingsSnapshot.line,
      line_channel_secret_enc: settingsSnapshot.line_channel_secret_enc,
      line_channel_access_token_enc: settingsSnapshot.line_channel_access_token_enc,
    }).eq('tenant_id', SHOP_A.id);
  }
  await mock.stop();
});

beforeEach(() => { mock.reset(); });

/* ========================================================================== */

describe('/api/upload 的 richmenu-assets bucket（LINE 綁定 bucket 的窄規則）', () => {
  it('上傳 PNG → 200，且 service role 直查 storage.objects 時該物件真的在 bucket 裡', async () => {
    const before = await objectsInTenantFolder();

    const res = await upload(new File([BG_PNG], 'bg.png', { type: 'image/png' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Envelope<UploadData>;
    expect(body.success).toBe(true);
    const { url, path } = body.data!;
    uploadedPaths.push(path);

    // 路徑第一段必須是租戶 id（0008 storage RLS 的規則）
    expect(path.startsWith(`${SHOP_A.id}/`)).toBe(true);
    expect(url).toContain(path);

    // ★「上傳回 200」不等於「檔案在 bucket 裡」——這一段才是證據
    const after = await objectsInTenantFolder();
    expect(after.length).toBe(before.length + 1);
    const objectName = path.slice(`${SHOP_A.id}/`.length);
    const found = after.find((o) => o.name === objectName);
    expect(found, `storage.objects 裡找不到 ${path}`).toBeTruthy();
    expect(found!.metadata.mimetype).toBe('image/png');
    expect(found!.metadata.size).toBe(BG_PNG.byteLength);

    // 而且真的下載得回同一份位元組（不是只有一列 metadata）
    const { data: blob, error } = await admin.storage.from(BUCKET).download(path);
    expect(error).toBeNull();
    expect(Buffer.from(await blob!.arrayBuffer()).equals(BG_PNG)).toBe(true);
  });

  it('上傳 WebP → 400，且 bucket 裡不會多出任何物件（LINE 只收 JPEG/PNG）', async () => {
    const before = await objectsInTenantFolder();

    const res = await upload(new File([WEBP], 'bg.webp', { type: 'image/webp' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as Envelope;
    expect(body.success).toBe(false);
    expect(body.message).toContain('LINE 只接受 JPEG 或 PNG');

    // 被擋下就不該留下半成品
    expect((await objectsInTenantFolder()).length).toBe(before.length);
  });

  it('同一張 WebP 換到一般 bucket（product-images）→ 200：窄規則只綁在 LINE 去向的 bucket', async () => {
    const res = await upload(
      new File([WEBP], 'bg.webp', { type: 'image/webp' }), 'product-images',
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Envelope<UploadData>;
    const { path } = body.data!;
    const { error } = await admin.storage.from('product-images').remove([path]);
    expect(error).toBeNull();
  });
});

describe('上傳的底圖真的被發布出去（08 分冊 Phase 7 重開項：/api/upload 的第一個 Rich Menu 用戶）', () => {
  it('上傳 → 存進 line.richMenuBgImageUrl → 發布：LINE 收到的位元組就是我們上傳的那張圖', async () => {
    // ① 上傳（= 頁面的「上傳圖片」按鈕會做的事）
    const upRes = await upload(new File([BG_PNG], 'publish-bg.png', { type: 'image/png' }));
    expect(upRes.status).toBe(200);
    const { url, path } = ((await upRes.json()) as Envelope<UploadData>).data!;
    uploadedPaths.push(path);

    // ② 存進租戶設定（= 頁面接著呼叫的 saveLineSettings）
    const saveRes = await ownerA.put('/api/settings/line', { richMenuBgImageUrl: url });
    expect(saveRes.status).toBe(200);
    // 直查 DB 確認真的落地——這一步是「發布會用到這張圖」成立的唯一原因
    const { data: row } = await admin.from('tenant_settings')
      .select('line').eq('tenant_id', SHOP_A.id).single();
    expect((row!.line as Record<string, unknown>).richMenuBgImageUrl).toBe(url);

    // ③ 發布
    const pubRes = await ownerA.post('/api/settings/line/rich-menu/create', { theme: 'LINE_GREEN' });
    expect(pubRes.status).toBe(200);

    // ④ mock LINE 在傳圖那一步收到的位元組 === 我們上傳的那張圖
    const contentCalls = mock.requests.filter((r) => /^\/v2\/bot\/richmenu\/.+\/content$/.test(r.path));
    expect(contentCalls).toHaveLength(1);
    expect(contentCalls[0].headers['content-type']).toBe('image/png');
    expect(
      contentCalls[0].rawBuffer.equals(BG_PNG),
      'LINE 收到的底圖不是我們上傳的那一張（多半是落回主題色 PNG 退路了）',
    ).toBe(true);
  });

  it('清空 richMenuBgImageUrl 後再發布 → LINE 收到的不再是那張圖（退回主題底圖）', async () => {
    const saveRes = await ownerA.put('/api/settings/line', { richMenuBgImageUrl: '' });
    expect(saveRes.status).toBe(200);

    const pubRes = await ownerA.post('/api/settings/line/rich-menu/create', { theme: 'LINE_GREEN' });
    expect(pubRes.status).toBe(200);

    const contentCalls = mock.requests.filter((r) => /^\/v2\/bot\/richmenu\/.+\/content$/.test(r.path));
    expect(contentCalls).toHaveLength(1);
    // 這一條在防「不管設定是什麼都送同一張」——沒有它，上一條可能只是巧合
    expect(contentCalls[0].rawBuffer.equals(BG_PNG)).toBe(false);
    // 退路仍然是一張合法 PNG（不是 404、也不是空的）
    expect(contentCalls[0].rawBuffer.subarray(0, 8))
      .toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });
});
