/**
 * 回報問題的截圖上傳 —— 端到端整合測試（GitHub issue #30 / 14 分冊 §8.14）
 * -----------------------------------------------------------------------------
 * issue #28 ① 把 modal 的四個文字欄位接真了（tests/integration/api/bug-report.28.test.ts），
 * 但截圖欄位當時只做到誠實化：`bug_reports` 沒有附件欄位、Storage 白名單沒有可用的
 * bucket、`/api/bug-report` 契約沒有附件。migration 0019 補齊三塊，這一檔驗它真的通了。
 *
 * 驗收的核心刻意**不是**「attachment_path 有值」——那種斷言在「存了一個指向空氣的
 * 路徑」時也會綠，正是 CLAUDE.md「Never fabricate a known」說的那種假的已知。
 * 這裡一路驗到底：
 *   /api/upload → 回 { url, path } → /api/bug-report → service role 直查
 *   bug_reports.attachment_path → **拿那個路徑回頭問 Storage，物件真的在**
 *   → 用簽名 URL 把位元組抓下來，長度與上傳的檔案相符。
 *
 * ⚠️ 為什麼「物件真的在」不是一句 `select … from storage.objects`：
 *    PostgREST 只暴露 public / graphql_public 兩個 schema
 *    （實測回 PGRST106「Only the following schemas are exposed: public, graphql_public」），
 *    所以測試端無法用 supabase-js 直接 select storage.objects。這裡改走 Storage API 的
 *    `list()`／簽名 URL——那兩支在伺服器端讀的就是 storage.objects 這張表，
 *    而且比 select 更強：list() 證明列存在，簽名 URL 下載證明位元組也在。
 *    （直接 select storage.objects 需要 Management API token，CI 的 .env.test 沒有，
 *      見 14 分冊 §6.4 衍生第 3 條同樣的限制。）
 *
 * bucket 公開性：`bug-report-attachments` 是 **private**（0019，`public = false`）。
 * 與 `chat-images` 被 LINE 逼成 public 不同（06 分冊 §8.5），回報截圖沒有第三方
 * 要來抓圖，而敏感度更高（使用者在畫面出問題的當下截圖，幾乎必然含當時螢幕上的
 * 顧客資料）。下面有一條專門驗「public URL 打不開、簽名 URL 打得開」。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A, SHOP_B } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };
type UploadData = { url: string; path: string; bucket: string; urlExpiresInSeconds?: number };

const BUCKET = 'bug-report-attachments';

/** 1×1 透明 PNG（合法檔頭） */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
/** 最小合法 WebP（RIFF….WEBPVP8 ）—— 用來證明這個 bucket **不是** LINE 去向、仍收 WebP */
const WEBP_1X1 = Buffer.from(
  'UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==',
  'base64',
);

const suffix = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

let admin: SupabaseClient;
let ownerA: AuthedApi;
let ownerB: AuthedApi;

/** 本檔上傳過的所有物件路徑，afterAll 一併清掉（reset-db 不管 storage） */
const uploaded: string[] = [];
const reportIds: string[] = [];

function form(file: File, bucket = BUCKET): FormData {
  const f = new FormData();
  f.append('file', file);
  f.append('bucket', bucket);
  return f;
}

const pngFile = (name = 'shot.png', bytes: BlobPart = PNG_1X1 as unknown as BlobPart) =>
  new File([bytes], name, { type: 'image/png' });

/** 走 Storage API 讀 storage.objects：回傳該路徑對應的那一列（不存在 → null） */
async function storageObject(path: string) {
  const slash = path.lastIndexOf('/');
  const dir = path.slice(0, slash);
  const name = path.slice(slash + 1);
  const { data, error } = await admin.storage.from(BUCKET).list(dir, { search: name, limit: 100 });
  if (error) throw error;
  return (data ?? []).find((o) => o.name === name) ?? null;
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
  ownerB = await loginAs(SHOP_B.owner.email, SHOP_B.owner.password);
});

afterAll(async () => {
  if (reportIds.length) await admin.from('bug_reports').delete().in('id', reportIds);
  if (uploaded.length) {
    const { error } = await admin.storage.from(BUCKET).remove(uploaded);
    if (error) console.error('[bug-report-attachment.30] 清理 storage 物件失敗：', error);
  }
});

describe('POST /api/upload — bug-report-attachments bucket（0019）', () => {
  it('PNG → 200，回 { url, path }，且 path 在本租戶資料夾下', async () => {
    const res = await ownerA.fetch('/api/upload', { method: 'POST', body: form(pngFile()) });
    const body = (await res.json()) as Envelope<UploadData>;
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data!.path).toMatch(new RegExp(`^${SHOP_A.id}/[0-9a-f-]{36}\\.png$`));
    expect(body.data!.bucket).toBe(BUCKET);
    uploaded.push(body.data!.path);
  });

  it('WebP → 200（這個 bucket **不是** LINE 去向，不得跟著砍掉 WebP）', async () => {
    // 反向的不可回歸：commit 11a174d 為了 LINE 把 chat-images / richmenu-assets 限成
    // JPEG/PNG，回報截圖不會變成 LINE image message，把它一起限制只是無謂的損失。
    const webp = new File([WEBP_1X1 as unknown as BlobPart], 'shot.webp', { type: 'image/webp' });
    const res = await ownerA.fetch('/api/upload', { method: 'POST', body: form(webp) });
    const body = (await res.json()) as Envelope<UploadData>;
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data!.path.endsWith('.webp')).toBe(true);
    uploaded.push(body.data!.path);
  });

  it('格式被拒：text/plain → 400 REQ_001', async () => {
    const evil = new File(['not an image'], 'evil.txt', { type: 'text/plain' });
    const res = await ownerA.fetch('/api/upload', { method: 'POST', body: form(evil) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as Envelope).code).toBe('REQ_001');
  });

  it('大小被拒：5MB + 1 byte → 400 REQ_001', async () => {
    const big = pngFile('big.png', new Uint8Array(5 * 1024 * 1024 + 1));
    const res = await ownerA.fetch('/api/upload', { method: 'POST', body: form(big) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as Envelope).code).toBe('REQ_001');
  });

  it('bucket 是 private：public URL 打不開，只有簽名 URL 打得開', async () => {
    const res = await ownerA.fetch('/api/upload', { method: 'POST', body: form(pngFile()) });
    const { data } = (await res.json()) as Envelope<UploadData>;
    uploaded.push(data!.path);

    // 端點回的是簽名 URL（帶 token），而且真的抓得到位元組
    expect(data!.url).toContain('token=');
    expect(data!.urlExpiresInSeconds).toBeGreaterThan(0);
    const signed = await fetch(data!.url);
    expect(signed.status).toBe(200);
    expect((await signed.arrayBuffer()).byteLength).toBe(PNG_1X1.byteLength);

    // 同一個物件的 public 形式必須打不開 —— 這就是與 chat-images 的差別所在
    const publicUrl = admin.storage.from(BUCKET).getPublicUrl(data!.path).data.publicUrl;
    const pub = await fetch(publicUrl);
    expect(pub.status, `public URL 竟然開得起來：${publicUrl}`).not.toBe(200);
  });
});

describe('POST /api/bug-report + 截圖（issue #30 驗收核心）', () => {
  it('上傳截圖 → 送出回報 → bug_reports.attachment_path 指向的物件真的存在於 storage', async () => {
    const s = suffix();

    // 1) 上傳
    const upRes = await ownerA.fetch('/api/upload', { method: 'POST', body: form(pngFile()) });
    const up = (await upRes.json()) as Envelope<UploadData>;
    expect(upRes.status, JSON.stringify(up)).toBe(200);
    const path = up.data!.path;
    uploaded.push(path);

    // 2) 送出回報（附上 path，不是簽名 URL）
    const payload = {
      category: 'BUG',
      subject: `附圖標題-${s}`,
      content: `附圖說明-${s}`,
      contactEmail: `shot-${s}@example.test`,
      pageUrl: `https://example.test/tenant/services?probe=${s}`,
      attachmentPath: path,
    };
    const res = await ownerA.post('/api/bug-report', payload);
    const body = (await res.json()) as Envelope<{ id: string }>;
    expect(res.status, JSON.stringify(body)).toBe(200);
    const reportId = body.data!.id;
    reportIds.push(reportId);

    // 3) service role 直查 bug_reports
    const { data: row, error } = await admin
      .from('bug_reports')
      .select('tenant_id, subject, content, contact_email, attachment_path')
      .eq('id', reportId)
      .single();
    expect(error).toBeNull();
    expect(row!.attachment_path).toBe(path);
    // 既有四欄不得因為多了附件而壞掉
    expect(row!.subject).toBe(payload.subject);
    expect(row!.content).toBe(payload.content);
    expect(row!.contact_email).toBe(payload.contactEmail);
    expect(row!.tenant_id).toBe(SHOP_A.id);

    // 4) **欄位指向的物件真的在 storage**（不是只看欄位有值）
    const obj = await storageObject(row!.attachment_path);
    expect(obj, `storage 裡找不到 ${row!.attachment_path}`).not.toBeNull();
    expect(obj!.name).toBe(path.slice(path.lastIndexOf('/') + 1));

    // 5) 位元組也在：簽名 URL 抓下來與上傳的檔案一樣大
    const { data: signed, error: signErr } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(row!.attachment_path, 60);
    expect(signErr).toBeNull();
    const got = await fetch(signed!.signedUrl);
    expect(got.status).toBe(200);
    expect((await got.arrayBuffer()).byteLength).toBe(PNG_1X1.byteLength);
  });

  it('不附截圖仍可正常送出（issue #28 的既有行為不得壞掉）：attachment_path 存空字串', async () => {
    const s = suffix();
    const res = await ownerA.post('/api/bug-report', {
      category: 'OTHER',
      subject: `無附圖-${s}`,
      content: `無附圖說明-${s}`,
    });
    const body = (await res.json()) as Envelope<{ id: string }>;
    expect(res.status, JSON.stringify(body)).toBe(200);
    const reportId = body.data!.id;
    reportIds.push(reportId);

    const { data: row } = await admin
      .from('bug_reports')
      .select('subject, content, attachment_path')
      .eq('id', reportId)
      .single();
    expect(row!.subject).toBe(`無附圖-${s}`);
    expect(row!.content).toBe(`無附圖說明-${s}`);
    // 空字串＝沒附截圖。不是 null、也不是某個假路徑
    expect(row!.attachment_path).toBe('');
  });

  it('路徑指向不存在的物件 → 400，且不會留下一筆指向空氣的回報', async () => {
    const s = suffix();
    const ghost = `${SHOP_A.id}/00000000-0000-4000-8000-00000000dead.png`;
    const res = await ownerA.post('/api/bug-report', {
      subject: `幽靈附件-${s}`,
      content: `幽靈附件說明-${s}`,
      attachmentPath: ghost,
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as Envelope).code).toBe('REQ_001');

    const { data: rows } = await admin
      .from('bug_reports')
      .select('id')
      .eq('subject', `幽靈附件-${s}`);
    expect(rows ?? []).toHaveLength(0);
  });

  it('路徑指向別家店的物件 → 400（附件不得跨租戶）', async () => {
    const s = suffix();
    // B 店真的上傳一個物件（所以「物件存在」不是被拒的原因，租戶歸屬才是）
    const upRes = await ownerB.fetch('/api/upload', { method: 'POST', body: form(pngFile()) });
    const up = (await upRes.json()) as Envelope<UploadData>;
    expect(upRes.status, JSON.stringify(up)).toBe(200);
    expect(up.data!.path.startsWith(`${SHOP_B.id}/`)).toBe(true);
    uploaded.push(up.data!.path);

    const res = await ownerA.post('/api/bug-report', {
      subject: `跨租戶附件-${s}`,
      content: `跨租戶附件說明-${s}`,
      attachmentPath: up.data!.path,
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as Envelope).code).toBe('REQ_001');

    const { data: rows } = await admin
      .from('bug_reports')
      .select('id')
      .eq('subject', `跨租戶附件-${s}`);
    expect(rows ?? []).toHaveLength(0);
  });
});
