/**
 * POST /api/upload 整合測試 — Phase 7（07 分冊 §3 統一圖片上傳端點）。
 * 實作：src/app/api/upload/route.ts。案例矩陣（本次任務指定）：
 *   未登入 401；白名單外 bucket 400；壞 MIME 400；>5MB 400；缺 file 欄位 400；
 *   正例 png → 200 回 { url } 且 url 含 {tenantId}/ 前綴（0008 storage RLS 的
 *   「第一段資料夾 = 租戶 id」規則）。
 *
 * 契約細節（route.ts）：
 *   - bucket 白名單 = 0008 migration 五個 bucket；其他 → 400 REQ_001。
 *   - MIME 僅 image/jpeg|png|webp；超過 5MB → 400 REQ_001。
 *   - 驗證順序：requireTenant（401/403）→ form 解析 → file → bucket → MIME → 大小。
 *   - 成功：service role 上傳 {tenantId}/{uuid}.{ext}，回 public URL。
 *
 * 清理：正例上傳的 storage 物件，afterAll 以 service role remove（從回傳 url
 * 取出 bucket 內路徑）。其他案例都被 400/401 擋下，不落地任何物件。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

const BASE_URL = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };

/** 1×1 透明 PNG（合法檔頭，正例與「只差一個條件」的反例共用） */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const BUCKET = 'service-images'; // 白名單第一個（0008）

let admin: SupabaseClient;
let ownerA: AuthedApi;
/** 正例上傳成功後記下 bucket 內路徑，afterAll 清掉 */
let uploadedPath: string | null = null;

function makeForm(opts: { file?: File | null; bucket?: string }): FormData {
  const form = new FormData();
  if (opts.file) form.append('file', opts.file);
  if (opts.bucket !== undefined) form.append('bucket', opts.bucket);
  return form;
}

function pngFile(name = 'test.png', bytes: BlobPart = PNG_1X1 as unknown as BlobPart): File {
  return new File([bytes], name, { type: 'image/png' });
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
});

afterAll(async () => {
  if (uploadedPath) {
    const { error } = await admin.storage.from(BUCKET).remove([uploadedPath]);
    if (error) console.error('[upload.07] 清理 storage 物件失敗：', uploadedPath, error);
  }
});

describe('POST /api/upload（07 §3）', () => {
  it('未登入 → 401 AUTH_001', async () => {
    const res = await fetch(`${BASE_URL}/api/upload`, {
      method: 'POST',
      body: makeForm({ file: pngFile(), bucket: BUCKET }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as Envelope;
    expect(body.success).toBe(false);
    expect(body.code).toBe('AUTH_001');
  });

  it('白名單外 bucket → 400 REQ_001', async () => {
    const res = await ownerA.fetch('/api/upload', {
      method: 'POST',
      body: makeForm({ file: pngFile(), bucket: 'not-a-real-bucket' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Envelope;
    expect(body.success).toBe(false);
    expect(body.code).toBe('REQ_001');
  });

  it('缺 file 欄位 → 400 REQ_001', async () => {
    const res = await ownerA.fetch('/api/upload', {
      method: 'POST',
      body: makeForm({ bucket: BUCKET }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as Envelope).code).toBe('REQ_001');
  });

  it('白名單外 MIME（text/plain）→ 400 REQ_001', async () => {
    const evil = new File(['not an image'], 'evil.txt', { type: 'text/plain' });
    const res = await ownerA.fetch('/api/upload', {
      method: 'POST',
      body: makeForm({ file: evil, bucket: BUCKET }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as Envelope).code).toBe('REQ_001');
  });

  it('>5MB → 400 REQ_001', async () => {
    // 5MB + 1 byte，MIME 合法 → 只有大小這一個條件超標
    const big = pngFile('big.png', new Uint8Array(5 * 1024 * 1024 + 1));
    const res = await ownerA.fetch('/api/upload', {
      method: 'POST',
      body: makeForm({ file: big, bucket: BUCKET }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as Envelope).code).toBe('REQ_001');
  });

  it('正例：png → 200 回 { url }，url 含 {tenantId}/ 前綴，物件真的存在', async () => {
    const res = await ownerA.fetch('/api/upload', {
      method: 'POST',
      body: makeForm({ file: pngFile(), bucket: BUCKET }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Envelope<{ url: string }>;
    expect(body.success).toBe(true);
    const url = body.data!.url;
    expect(typeof url).toBe('string');
    // 路徑規則 {tenantId}/{uuid}.png（0008 RLS：第一段資料夾 = 租戶 id）
    expect(url).toContain(`/${BUCKET}/${SHOP_A.id}/`);
    expect(url.endsWith('.png')).toBe(true);

    // 從 public URL 取出 bucket 內路徑，service role 驗證物件確實落地
    const marker = `/object/public/${BUCKET}/`;
    const idx = url.indexOf(marker);
    expect(idx).toBeGreaterThan(-1);
    uploadedPath = url.slice(idx + marker.length);
    const { data: blob, error } = await admin.storage.from(BUCKET).download(uploadedPath);
    expect(error).toBeNull();
    expect(blob).not.toBeNull();
    expect((await blob!.arrayBuffer()).byteLength).toBe(PNG_1X1.byteLength);
  });
});
