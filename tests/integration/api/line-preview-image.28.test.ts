/**
 * `previewImageUrl` ≤1 MB 縮圖 —— 整合測試（GitHub issue #28 ⑬ / 14 分冊 §8.15）
 * -----------------------------------------------------------------------------
 * 修改前：`/api/chat/messages` 與 `/api/marketing/pushes/:id/send` 都把**同一個 URL**
 * 同時當 `originalContentUrl` 與 `previewImageUrl`。但 LINE 對這兩個欄位的上限不同
 * （原圖 10 MB、**preview 1 MB**；官方原文見 06 分冊 §8.4），而 `/api/upload` 放行到
 * 5 MB —— **1–5 MB 的圖（手機拍的照片幾乎都在這個區間）當 preview 就已超規**。
 *
 * 本檔驗證補齊後的真實鏈路，且**每一條大小斷言都是量真的物件**（service role 直查
 * storage.objects 的 metadata.size ＋ 實際下載量 byteLength），不是「URL 長得對」：
 *
 *   1. POST /api/upload（bucket=chat-images，>1 MB 的 JPEG）
 *        → 原圖 + `{uuid}.preview.jpg` 兩個物件，縮圖實際 ≤1,000,000 bytes
 *   2. 原圖**逐 byte 與上傳的檔案相同**（畫質沒有因為這次改動下降）
 *   3. POST /api/chat/messages → LINE 收到的 previewImageUrl **指向縮圖**，
 *      而且用「LINE 實際收到的那個網址」回頭量物件大小 ≤1 MB
 *   4. POST /api/marketing/pushes/:id/send **一併修**（不是只修 chat）
 *   5. 縮圖不見了且原圖 >1 MB → **409 擋下**、零推播、額度不變
 *      （證明沒有靜默退回「用原圖當 preview」）
 *   6. 店家自己貼的外部網址 → 我們沒託管、量不到，用原圖當 preview（LINE 官方允許）
 *   7. 宣稱 image/jpeg 但不是圖片的位元組 → 400，且 Storage **一個物件都沒留下**
 *
 * 手法沿用 chat-image.15.test.ts：mock LINE 綁 LINE_API_BASE 的固定 port；
 * SHOP_A 的 LINE 憑證由 beforeAll 以 encryptSecret 寫入、afterAll 還原快照。
 * 清理紀律：本檔建立的 line_users / chat_messages / marketing_pushes、上傳的
 * Storage 物件（含縮圖）、push_quota_usage 當月列全部在 afterAll 還原。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHmac } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { SHOP_A } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';
import { LineMockServer } from '../../helpers/line-mock';
import { drainWebhook } from '../../helpers/line-webhook';
import { encryptSecret } from '@/server/crypto';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };
type UploadData = { url: string; path: string; previewUrl?: string; previewPath?: string };

const BASE_URL = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';
const BUCKET = 'chat-images';
/** 與 src/server/image.ts 的 LINE_PREVIEW_MAX_BYTES 一致（官方「1 MB」取 10^6，兩種解讀都合規） */
const MAX_PREVIEW_BYTES = 1_000_000;

const CHANNEL_SECRET = 'itest-line-secret-28-preview';
const CHANNEL_TOKEN = 'itest-line-token-28-preview';
const USER_PREVIEW = 'Upreview28itest00000000000000000001';

let admin: SupabaseClient;
let ownerA: AuthedApi;
const mock = new LineMockServer();

let settingsSnapshot: {
  line: unknown;
  line_channel_secret_enc: string;
  line_channel_access_token_enc: string;
} | null = null;
let quotaRowExistedAtStart = false;
let quotaUsedAtStart = 0;

/** 本檔上傳到 chat-images 的物件路徑（含縮圖），afterAll 清掉 */
const uploadedPaths: string[] = [];
const createdPushIds: string[] = [];

/** >1 MB 的 JPEG（2400×1800 隨機雜訊 ≈ 4 MB，正是手機原圖的量級） */
let bigJpeg: Buffer;
/** 案例 1–4 共用的那次上傳 */
let uploaded: UploadData;

function sign(secret: string, rawBody: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('base64');
}

function taipeiMonthKey(): string {
  const t = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function quotaUsed(): Promise<number> {
  const { data, error } = await admin
    .from('push_quota_usage')
    .select('used')
    .eq('tenant_id', SHOP_A.id)
    .eq('month', taipeiMonthKey())
    .maybeSingle();
  expect(error).toBeNull();
  return (data as { used: number } | null)?.used ?? 0;
}

/** public URL → bucket 內路徑（測試端只做字串還原，不依賴受測程式的推導函式） */
function pathFromUrl(url: string): string {
  const marker = `/object/public/${BUCKET}/`;
  const idx = url.indexOf(marker);
  expect(idx, `不是 ${BUCKET} 的 public URL：${url}`).toBeGreaterThan(-1);
  return url.slice(idx + marker.length);
}

/** service role 直查 storage.objects 的 metadata.size（不是看 URL 長得對） */
async function storedSize(path: string): Promise<number | null> {
  const slash = path.lastIndexOf('/');
  const dir = path.slice(0, slash);
  const base = path.slice(slash + 1);
  const { data, error } = await admin.storage.from(BUCKET).list(dir, { search: base, limit: 100 });
  expect(error).toBeNull();
  const row = (data ?? []).find((r) => r.name === base) as
    | { name: string; metadata: { size?: number } | null }
    | undefined;
  return row?.metadata?.size ?? null;
}

/** 實際把物件下載回來量 byteLength（metadata 之外的第二個量法） */
async function downloadBytes(path: string): Promise<Buffer> {
  const { data, error } = await admin.storage.from(BUCKET).download(path);
  expect(error, `下載失敗：${path}`).toBeNull();
  return Buffer.from(await data!.arrayBuffer());
}

async function listTenantObjectNames(): Promise<string[]> {
  const { data, error } = await admin.storage.from(BUCKET).list(SHOP_A.id, { limit: 1000 });
  expect(error).toBeNull();
  return (data ?? []).map((r) => r.name).sort();
}

async function uploadJpeg(bytes: Buffer, name: string): Promise<Response> {
  const form = new FormData();
  form.append('file', new File([bytes], name, { type: 'image/jpeg' }), name);
  form.append('bucket', BUCKET);
  return ownerA.fetch('/api/upload', { method: 'POST', body: form });
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  expect(process.env.LINE_API_BASE).toBeTruthy();

  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
  await mock.start();

  // 隨機雜訊 = 最難壓的素材；真實照片只會比它更小（不拿好壓的圖給自己放水）
  const w = 2400;
  const h = 1800;
  const raw = Buffer.alloc(w * h * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (Math.random() * 256) | 0;
  bigJpeg = await sharp(raw, { raw: { width: w, height: h, channels: 3 } })
    .jpeg({ quality: 95 })
    .toBuffer();
  expect(bigJpeg.byteLength).toBeGreaterThan(MAX_PREVIEW_BYTES);
  expect(bigJpeg.byteLength).toBeLessThan(5 * 1024 * 1024);

  const { data: snap, error: e0 } = await admin
    .from('tenant_settings')
    .select('line, line_channel_secret_enc, line_channel_access_token_enc')
    .eq('tenant_id', SHOP_A.id)
    .single();
  expect(e0).toBeNull();
  settingsSnapshot = snap as typeof settingsSnapshot;
  const { error: e1 } = await admin
    .from('tenant_settings')
    .update({
      line_channel_secret_enc: encryptSecret(CHANNEL_SECRET),
      line_channel_access_token_enc: encryptSecret(CHANNEL_TOKEN),
    })
    .eq('tenant_id', SHOP_A.id);
  expect(e1).toBeNull();

  const { data: q, error: e2 } = await admin
    .from('push_quota_usage')
    .select('used')
    .eq('tenant_id', SHOP_A.id)
    .eq('month', taipeiMonthKey())
    .maybeSingle();
  expect(e2).toBeNull();
  quotaRowExistedAtStart = q != null;
  quotaUsedAtStart = (q as { used: number } | null)?.used ?? 0;

  // 顧客加好友（webhook follow）→ line_users followed=true，鏈路從真入口建立
  const raw2 = JSON.stringify({
    events: [
      { type: 'follow', replyToken: 'rt-28-preview', source: { type: 'user', userId: USER_PREVIEW } },
    ],
  });
  const res = await fetch(`${BASE_URL}/api/line/webhook/${SHOP_A.shopCode}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-line-signature': sign(CHANNEL_SECRET, raw2) },
    body: raw2,
  });
  expect(res.status).toBe(200);
  // issue #31：webhook 回 200 後事件才在 after() 裡處理（06 §3.1）——這裡的
  // follow 是後續案例的前置（line_users 要存在），必須等背景處理真的跑完。
  await drainWebhook(SHOP_A.shopCode, BASE_URL);
});

afterAll(async () => {
  await admin.from('chat_messages').delete().eq('tenant_id', SHOP_A.id).eq('line_user_id', USER_PREVIEW);
  await admin.from('line_users').delete().eq('tenant_id', SHOP_A.id).eq('line_user_id', USER_PREVIEW);
  for (const id of createdPushIds) {
    await admin.from('marketing_pushes').delete().eq('tenant_id', SHOP_A.id).eq('id', id);
  }
  if (uploadedPaths.length) await admin.storage.from(BUCKET).remove(uploadedPaths);

  if (quotaRowExistedAtStart) {
    await admin
      .from('push_quota_usage')
      .upsert(
        { tenant_id: SHOP_A.id, month: taipeiMonthKey(), used: quotaUsedAtStart },
        { onConflict: 'tenant_id,month' },
      );
  } else {
    await admin
      .from('push_quota_usage')
      .delete()
      .eq('tenant_id', SHOP_A.id)
      .eq('month', taipeiMonthKey());
  }

  if (settingsSnapshot) {
    await admin
      .from('tenant_settings')
      .update({
        line: settingsSnapshot.line ?? {},
        line_channel_secret_enc: settingsSnapshot.line_channel_secret_enc,
        line_channel_access_token_enc: settingsSnapshot.line_channel_access_token_enc,
      })
      .eq('tenant_id', SHOP_A.id);
  }
  await mock.stop();
});

describe('POST /api/upload — chat-images 一併產 ≤1 MB 縮圖（issue #28 ⑬）', () => {
  it('上傳 4 MB 的 JPEG → 回 previewUrl/previewPath，縮圖路徑由原圖路徑推導', async () => {
    const res = await uploadJpeg(bigJpeg, 'photo.jpg');
    const body = (await res.json()) as Envelope<UploadData>;
    expect(res.status, JSON.stringify(body)).toBe(200);
    uploaded = body.data!;
    uploadedPaths.push(uploaded.path);
    if (uploaded.previewPath) uploadedPaths.push(uploaded.previewPath);

    expect(uploaded.path).toMatch(new RegExp(`^${SHOP_A.id}/[0-9a-f-]+\\.jpg$`));
    // 可推導：縮圖 = 原圖路徑插入 .preview，同資料夾（第一段仍是 tenantId → RLS 規則不變）
    expect(uploaded.previewPath).toBe(uploaded.path.replace(/\.jpg$/, '.preview.jpg'));
    expect(uploaded.previewUrl).toBe(uploaded.url.replace(/\.jpg$/, '.preview.jpg'));
    expect(uploaded.previewUrl).not.toBe(uploaded.url);
  });

  it('縮圖物件的**實際大小** ≤1,000,000 bytes（metadata.size 與下載量測兩種量法一致）', async () => {
    const previewPath = uploaded.previewPath!;
    const metaSize = await storedSize(previewPath);
    expect(metaSize, 'storage.objects 查無縮圖').not.toBeNull();
    expect(metaSize!).toBeLessThanOrEqual(MAX_PREVIEW_BYTES);

    const bytes = await downloadBytes(previewPath);
    expect(bytes.byteLength).toBe(metaSize);
    expect(bytes.byteLength).toBeLessThanOrEqual(MAX_PREVIEW_BYTES);
    expect(bytes.byteLength).toBeGreaterThan(0);

    // 是一張真的、解得開的 JPEG，不是被截斷的位元組
    const meta = await sharp(bytes).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(1024);
  });

  it('原圖沒有被縮圖取代：逐 byte 與上傳的檔案相同、尺寸仍是 2400×1800', async () => {
    const bytes = await downloadBytes(uploaded.path);
    expect(bytes.byteLength).toBe(bigJpeg.byteLength);
    expect(Buffer.compare(bytes, bigJpeg)).toBe(0);
    const meta = await sharp(bytes).metadata();
    expect([meta.width, meta.height]).toEqual([2400, 1800]);
    // 原圖本來就超過 preview 的上限——這正是本項要修的情境
    expect(bytes.byteLength).toBeGreaterThan(MAX_PREVIEW_BYTES);
  });

  it('宣稱 image/jpeg 但不是圖片 → 400，且 Storage 一個物件都沒留下（不留半成品）', async () => {
    const before = await listTenantObjectNames();
    const res = await uploadJpeg(Buffer.from('definitely not a jpeg '.repeat(200)), 'fake.jpg');
    const body = (await res.json()) as Envelope;
    expect(res.status, JSON.stringify(body)).toBe(400);
    expect(body.code).toBe('REQ_001');
    expect(await listTenantObjectNames()).toEqual(before);
  });
});

describe('POST /api/chat/messages — previewImageUrl 指向縮圖（issue #28 ⑬）', () => {
  it('送圖 → LINE 收到的 preview ≠ original，且 preview 指向的物件實際 ≤1 MB', async () => {
    mock.reset();
    const before = await quotaUsed();

    const res = await ownerA.post('/api/chat/messages', {
      lineUserId: USER_PREVIEW,
      imageUrl: uploaded.url,
    });
    const body = (await res.json()) as Envelope<{ messageType: string; imageUrl: string }>;
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data!.messageType).toBe('image');
    // DB 存的仍是原圖網址（縮圖位置一律推導，不另外記一筆）
    expect(body.data!.imageUrl).toBe(uploaded.url);

    const pushes = mock.requestsFor('/v2/bot/message/push');
    expect(pushes).toHaveLength(1);
    const msg = pushes[0].body.messages[0];
    expect(msg.type).toBe('image');
    expect(msg.originalContentUrl).toBe(uploaded.url);
    expect(msg.previewImageUrl).toBe(uploaded.previewUrl);
    expect(msg.previewImageUrl).not.toBe(msg.originalContentUrl);

    // ★ 關鍵斷言：拿 **LINE 實際收到的那個網址** 回頭量物件大小
    const previewBytes = await downloadBytes(pathFromUrl(msg.previewImageUrl));
    expect(previewBytes.byteLength).toBeLessThanOrEqual(MAX_PREVIEW_BYTES);
    // 而 originalContentUrl 指的仍是超過 1 MB 的原圖（沒有被縮圖頂替）
    const originalBytes = await downloadBytes(pathFromUrl(msg.originalContentUrl));
    expect(originalBytes.byteLength).toBeGreaterThan(MAX_PREVIEW_BYTES);
    expect(Buffer.compare(originalBytes, bigJpeg)).toBe(0);

    expect(await quotaUsed()).toBe(before + 1);
  });

  it('店家自己貼的外部網址 → 我們沒託管、量不到，用原圖當 preview（LINE 官方允許）', async () => {
    mock.reset();
    const external = 'https://example.test/itest-28/outside.jpg';
    const res = await ownerA.post('/api/chat/messages', {
      lineUserId: USER_PREVIEW,
      imageUrl: external,
    });
    expect(res.status).toBe(200);
    const msg = mock.requestsFor('/v2/bot/message/push')[0].body.messages[0];
    expect(msg.originalContentUrl).toBe(external);
    expect(msg.previewImageUrl).toBe(external);
  });

  it('縮圖不見了且原圖 >1 MB → 409 擋下、零推播、額度不變（沒有靜默退回原圖）', async () => {
    // 另傳一張，只刪掉它的縮圖，模擬「本該有縮圖卻沒有」
    const res0 = await uploadJpeg(bigJpeg, 'orphan.jpg');
    const up = ((await res0.json()) as Envelope<UploadData>).data!;
    uploadedPaths.push(up.path);
    const { error: rmErr } = await admin.storage.from(BUCKET).remove([up.previewPath!]);
    expect(rmErr).toBeNull();
    expect(await storedSize(up.previewPath!)).toBeNull();

    mock.reset();
    const before = await quotaUsed();
    const res = await ownerA.post('/api/chat/messages', {
      lineUserId: USER_PREVIEW,
      imageUrl: up.url,
    });
    const body = (await res.json()) as Envelope;
    expect(res.status, JSON.stringify(body)).toBe(409);
    expect(body.code).toBe('REQ_003');
    expect(body.message).toContain('縮圖');
    expect(mock.requests).toHaveLength(0);
    expect(await quotaUsed()).toBe(before);
  });
});

describe('POST /api/marketing/pushes/:id/send — 一併修，不是只修 chat（issue #28 ⑬）', () => {
  it('推播的 image message：preview 指向縮圖，且該物件實際 ≤1 MB', async () => {
    const created = await ownerA.post('/api/marketing/pushes', {
      title: 'itest-28 preview',
      content: '縮圖測試',
      imageUrl: uploaded.url,
      targetType: 'CUSTOM',
      targetValue: USER_PREVIEW,
    });
    const createdBody = (await created.json()) as Envelope<{ id: string }>;
    expect(created.status, JSON.stringify(createdBody)).toBe(200);
    const pushId = createdBody.data!.id;
    createdPushIds.push(pushId);

    mock.reset();
    const res = await ownerA.post(`/api/marketing/pushes/${pushId}/send`);
    const body = (await res.json()) as Envelope<{ sentCount: number }>;
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data!.sentCount).toBe(1);

    const calls = mock.requestsFor('/v2/bot/message/multicast');
    expect(calls).toHaveLength(1);
    const image = calls[0].body.messages.find((m: any) => m.type === 'image');
    expect(image, JSON.stringify(calls[0].body.messages)).toBeTruthy();
    expect(image.originalContentUrl).toBe(uploaded.url);
    expect(image.previewImageUrl).toBe(uploaded.previewUrl);
    expect(image.previewImageUrl).not.toBe(image.originalContentUrl);

    const previewBytes = await downloadBytes(pathFromUrl(image.previewImageUrl));
    expect(previewBytes.byteLength).toBeLessThanOrEqual(MAX_PREVIEW_BYTES);
  });

  it('店家貼的外部網址仍照送（marketing 那頁的圖片欄位本來就是自由輸入）', async () => {
    const external = 'https://example.test/itest-28/campaign.jpg';
    const created = await ownerA.post('/api/marketing/pushes', {
      title: 'itest-28 external',
      content: '外部圖',
      imageUrl: external,
      targetType: 'CUSTOM',
      targetValue: USER_PREVIEW,
    });
    const pushId = ((await created.json()) as Envelope<{ id: string }>).data!.id;
    createdPushIds.push(pushId);

    mock.reset();
    const res = await ownerA.post(`/api/marketing/pushes/${pushId}/send`);
    expect(res.status, await res.clone().text()).toBe(200);
    const image = mock
      .requestsFor('/v2/bot/message/multicast')[0]
      .body.messages.find((m: any) => m.type === 'image');
    expect(image.originalContentUrl).toBe(external);
    expect(image.previewImageUrl).toBe(external);
  });
});
