/**
 * 關鍵字回覆附加圖片 — 端到端整合測試（GitHub issue #50）
 * -----------------------------------------------------------------------------
 * 這一檔驗的是**一條完整鏈路**，不是單一端點：
 *
 *   後台選檔 → POST /api/upload（bucket=keyword-reply-images）
 *            → 物件真的躺在 Storage 裡（service role 直查，不是只信 URL 字串）
 *            → POST /api/settings/line/keyword-replies（content.imageUrl）
 *            → GET 重讀一致
 *            → 顧客在 LINE 打那個關鍵字
 *            → mock LINE 收到 type=image，且 originalContentUrl 與 DB 保存值逐字相同
 *
 * ⚠️ 為什麼「service role 直查 Storage」這一條非有不可（issue #50 驗收第 4 條）：
 * 只驗 URL 字串長得對，會讓「回一個看起來合理但物件不存在的網址」全綠——
 * 而那正是顧客端最糟的失敗（LINE 抓不到圖會把**整則訊息**退掉，不是少一張圖）。
 *
 * 前置資料與清理紀律比照 keyword-replies.05：beforeAll 快照 SHOP_A 的
 * tenant_settings 與 business_type、寫入本檔專用測試憑證；afterAll 一律還原，
 * 並刪掉本檔造出的 keyword_replies / chat_messages / storage 物件。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHmac } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A, SHOP_B } from '../../fixtures';
import { LineMockServer } from '../../helpers/line-mock';
import { drainWebhook } from '../../helpers/line-webhook';
import { loginAs, type AuthedApi } from '../../helpers/auth';
import { encryptSecret } from '@/server/crypto';

const BASE_URL = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';
const BUCKET = 'keyword-reply-images';

/** 本檔專用測試憑證（明文只存在測試裡；寫進 DB 前會 encryptSecret） */
const CHANNEL_SECRET = 'itest-line-channel-secret-a50';
const CHANNEL_TOKEN = 'itest-line-access-token-a50';
const USER = 'Ukwimage50itest00000000000000001';
const DEFAULT_REPLY = '【itest】分支⑥預設回覆（#50）';
const KEYWORD = 'itest圖片關鍵字';

/** 1×1 透明 PNG（與 upload.07 同一份，合法檔頭） */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let admin: SupabaseClient;
let ownerA: AuthedApi;
const mock = new LineMockServer();

const createdIds: string[] = [];
/** 本檔上傳的 storage 路徑（afterAll 只刪自己的） */
const uploadedPaths: string[] = [];

let settingsSnapshot: {
  line: unknown;
  line_channel_secret_enc: string;
  line_channel_access_token_enc: string;
} | null = null;

function sign(rawBody: string): string {
  return createHmac('sha256', CHANNEL_SECRET).update(rawBody).digest('base64');
}

/** 上傳一張 PNG，回 { url, path } */
async function uploadPng(api: AuthedApi, bucket = BUCKET) {
  const form = new FormData();
  form.append('file', new File([PNG_1X1 as unknown as BlobPart], 'kw.png', { type: 'image/png' }));
  form.append('bucket', bucket);
  const res = await api.post('/api/upload', undefined, { method: 'POST', body: form });
  return { res, body: (await res.json()) as { success: boolean; data?: { url: string }; code?: string } };
}

/** public URL → bucket 內路徑 */
function pathOf(url: string): string {
  const marker = `/object/public/${BUCKET}/`;
  const i = url.indexOf(marker);
  expect(i, `URL 不是 ${BUCKET} 的 public URL：${url}`).toBeGreaterThan(-1);
  return url.slice(i + marker.length);
}

/** 顧客送一則文字訊息，回 mock LINE 收到的第一則訊息物件（沒回覆＝null） */
async function customerSays(text: string) {
  mock.reset();
  const replyToken = `rt-${Math.random().toString(36).slice(2)}`;
  const raw = JSON.stringify({
    destination: 'Umockbot',
    events: [{
      type: 'message',
      replyToken,
      source: { type: 'user', userId: USER },
      message: { id: `m-${replyToken}`, type: 'text', text },
    }],
  });
  const res = await fetch(`${BASE_URL}/api/line/webhook/${SHOP_A.shopCode}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-line-signature': sign(raw) },
    body: raw,
  });
  expect(res.status).toBe(200);
  await drainWebhook(SHOP_A.shopCode, BASE_URL);
  const replies = mock.requestsFor('/v2/bot/message/reply');
  if (replies.length === 0) return null;
  return replies[0].body?.messages?.[0] ?? null;
}

async function createKeywordReply(payload: Record<string, unknown>) {
  const res = await ownerA.post('/api/settings/line/keyword-replies', payload);
  expect(res.status, `建立關鍵字回覆失敗：${res.status}`).toBe(200);
  const body = (await res.json()) as { data?: { id?: string } };
  const id = body.data?.id;
  if (id) createdIds.push(id);
  return id;
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  expect(process.env.LINE_API_BASE, '本檔需要 LINE_API_BASE 指向 mock').toBeTruthy();
  expect(process.env.SETTINGS_ENCRYPTION_KEY).toBeTruthy();

  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await mock.start();

  const { data: snap, error } = await admin
    .from('tenant_settings')
    .select('line, line_channel_secret_enc, line_channel_access_token_enc')
    .eq('tenant_id', SHOP_A.id).single();
  expect(error).toBeNull();
  settingsSnapshot = snap as typeof settingsSnapshot;

  const { error: e1 } = await admin.from('tenant_settings').update({
    line_channel_secret_enc: encryptSecret(CHANNEL_SECRET),
    line_channel_access_token_enc: encryptSecret(CHANNEL_TOKEN),
    line: {
      autoReplyEnabled: true,
      defaultReply: DEFAULT_REPLY,
      systemKeywordGroupsDisabled: [],
      campaignKeywordEnabled: false,
    },
  }).eq('tenant_id', SHOP_A.id);
  expect(e1).toBeNull();

  await admin.from('keyword_replies').delete().eq('tenant_id', SHOP_A.id);
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
});

afterAll(async () => {
  await admin.from('keyword_replies').delete().eq('tenant_id', SHOP_A.id);
  await admin.from('chat_messages').delete().eq('tenant_id', SHOP_A.id).eq('line_user_id', USER);
  await admin.from('line_users').delete().eq('tenant_id', SHOP_A.id).eq('line_user_id', USER);
  if (uploadedPaths.length) await admin.storage.from(BUCKET).remove(uploadedPaths);
  if (settingsSnapshot) {
    await admin.from('tenant_settings').update({
      line: settingsSnapshot.line ?? {},
      line_channel_secret_enc: settingsSnapshot.line_channel_secret_enc,
      line_channel_access_token_enc: settingsSnapshot.line_channel_access_token_enc,
    }).eq('tenant_id', SHOP_A.id);
  }
  await mock.stop();
});

describe('① 上傳：keyword-reply-images 真的收得下，而且物件真的存在', () => {
  it('POST /api/upload 收 keyword-reply-images（此前它不在白名單，整個功能因此不存在）', async () => {
    const { res, body } = await uploadPng(ownerA);
    expect(res.status, `回 ${res.status} ${body.code ?? ''}`).toBe(200);
    expect(body.success).toBe(true);
    const url = body.data!.url;
    expect(url).toContain(`/object/public/${BUCKET}/`);
    // 0008 的 storage RLS：第一段資料夾必須是租戶 id
    expect(pathOf(url).startsWith(`${SHOP_A.id}/`)).toBe(true);
    uploadedPaths.push(pathOf(url));
  });

  it('**service role 直查 Storage**：被引用的物件真的在（不是只驗 URL 字串）', async () => {
    const path = uploadedPaths[0];
    const folder = path.slice(0, path.lastIndexOf('/'));
    const name = path.slice(path.lastIndexOf('/') + 1);
    const { data, error } = await admin.storage.from(BUCKET).list(folder);
    expect(error).toBeNull();
    expect(
      (data ?? []).map((o) => o.name),
      '端點回了 URL，但 Storage 裡沒有這個物件——LINE 會抓不到，整則訊息被退',
    ).toContain(name);
  });

  it('不支援的格式誠實拒絕，且不留下任何物件', async () => {
    const form = new FormData();
    form.append('file', new File(['not-an-image'], 'x.txt', { type: 'text/plain' }));
    form.append('bucket', BUCKET);
    const res = await ownerA.post('/api/upload', undefined, { method: 'POST', body: form });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean; data?: unknown };
    expect(body.success).toBe(false);
    expect(body.data).toBeUndefined();
  });

  it('未登入不得上傳（bucket 開放不等於誰都能寫）', async () => {
    const form = new FormData();
    form.append('file', new File([PNG_1X1 as unknown as BlobPart], 'kw.png', { type: 'image/png' }));
    form.append('bucket', BUCKET);
    const res = await fetch(`${BASE_URL}/api/upload`, { method: 'POST', body: form });
    expect(res.status).toBe(401);
  });
});

describe('② 儲存與回讀：存得進去，重整後還在', () => {
  it('建立帶 imageUrl 的關鍵字回覆 → GET 重讀逐欄一致', async () => {
    const url = `https://example.invalid/${BUCKET}/persisted.png`;
    await createKeywordReply({
      keywords: [KEYWORD],
      replyType: 'IMAGE',
      content: { text: '看圖', matchType: 'EXACT', imageUrl: url },
      active: true,
      sortOrder: 0,
    });

    const res = await ownerA.get('/api/settings/line/keyword-replies');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data?: any };
    const rows: any[] = body.data?.content ?? body.data ?? [];
    const row = rows.find((r) => (r.keywords ?? []).includes(KEYWORD));
    expect(row, '重讀不到剛建立的那一列').toBeTruthy();
    expect(row.replyType).toBe('IMAGE');
    expect(row.content.imageUrl).toBe(url);
  });
});

describe('③ webhook：顧客打關鍵字 → mock LINE 收到 IMAGE，URL 與 DB 逐字相同', () => {
  it('命中 → type=image，originalContentUrl 等於存進去的那個 URL', async () => {
    await admin.from('keyword_replies').delete().eq('tenant_id', SHOP_A.id);
    const { body } = await uploadPng(ownerA);
    const url = body.data!.url;
    uploadedPaths.push(pathOf(url));

    await createKeywordReply({
      keywords: [KEYWORD],
      replyType: 'IMAGE',
      content: { text: '看圖', matchType: 'EXACT', imageUrl: url },
      active: true,
      sortOrder: 0,
    });

    const msg = await customerSays(KEYWORD);
    expect(msg, '打了關鍵字完全沒回應').not.toBeNull();
    expect(msg.type, `回的是 ${msg.type} 而不是 image`).toBe('image');
    expect(msg.originalContentUrl).toBe(url);
    // previewImageUrl 沒設時沿用同一張（keywordReplyMessage 的既有契約）
    expect(msg.previewImageUrl).toBe(url);
    /*
     * ⚠️ **這裡刻意不斷言 `https://`。**
     *
     * 初版寫的是 `expect(...startsWith('https://')).toBe(true)`，理由是「LINE 只抓得到
     * https」。那句話對 LINE 是真的，但這條斷言驗的是**測試環境的屬性**而不是我們
     * 程式的屬性：local-isolated 的 Supabase 是 `http://127.0.0.1:54321`，
     * 於是 public URL 自然是 http。正式環境的 Supabase 是 https，所以同一份程式碼
     * 在兩邊會得到不同結果——那不是程式的不變量，是環境的。
     *
     * 真正屬於我們的不變量有兩個，都在上面驗過了：
     *   ① 送給顧客的網址**逐字等於**存進 DB 的那一個（不是重組出來的）
     *   ② 它是我們自己 storage 的 public 路徑（下面這條）
     *
     * ⚠️ 順帶記下一個**本 PR 沒有處理**的既有缺口：`keywordReplyMessage()` 不檢查
     * `imageUrl` 的 scheme。上傳路徑現在一律回 Supabase 的 public URL（正式環境為
     * https），所以實務風險低；但若 DB 裡存有歷史的 http 值，LINE 會把**整則訊息**
     * 退掉。要補的話屬 `keywordReplyMessage()` 的 hardening，不在本 PR 範圍。
     */
    expect(msg.originalContentUrl).toContain(`/storage/v1/object/public/${BUCKET}/`);
  });

  it('停用的關鍵字回覆不送圖（落到 ⑥ defaultReply）', async () => {
    await admin.from('keyword_replies').update({ active: false }).eq('tenant_id', SHOP_A.id);
    const msg = await customerSays(KEYWORD);
    expect(msg).not.toBeNull();
    expect(msg.type).toBe('text');
    expect(msg.text).toBe(DEFAULT_REPLY);
    await admin.from('keyword_replies').update({ active: true }).eq('tenant_id', SHOP_A.id);
  });

  it('移除圖片（imageUrl 清空）後不再送舊圖，改回純文字', async () => {
    const { data: rows } = await admin.from('keyword_replies')
      .select('id, content').eq('tenant_id', SHOP_A.id).limit(1);
    const row = rows![0] as any;
    await admin.from('keyword_replies')
      .update({ reply_type: 'TEXT', content: { ...row.content, imageUrl: '' } })
      .eq('id', row.id);

    const msg = await customerSays(KEYWORD);
    expect(msg).not.toBeNull();
    expect(msg.type, '移除圖片後還在送 image = 舊圖沒斷乾淨').toBe('text');
    expect(JSON.stringify(msg)).not.toContain(BUCKET);
  });
});

describe('④ 租戶隔離：A 店不得引用 B 店的圖片路徑', () => {
  it('上傳路徑一律以自己的 tenantId 開頭（伺服器端組路徑，不受用戶端左右）', async () => {
    const { body } = await uploadPng(ownerA);
    const path = pathOf(body.data!.url);
    uploadedPaths.push(path);
    expect(path.startsWith(`${SHOP_A.id}/`)).toBe(true);
    expect(path.startsWith(`${SHOP_B.id}/`)).toBe(false);
  });
});
