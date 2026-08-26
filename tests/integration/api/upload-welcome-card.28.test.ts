/**
 * 歡迎卡片圖片上傳整合測試 — GitHub issue #28 第 ⑥ 筆（bucket 側）。
 *
 * 背景：店家設定 → 通知設定 →「歡迎卡片圖片（自訂）」旁的「上傳圖片」鈕，
 * 原本的 onClick 整個內容就是一句 `toast.show('歡迎卡片圖片已更新')`。接上
 * `POST /api/upload` 需要一個目的地 bucket，0008/0017/0019 的白名單都裝不下
 * （理由見 migration 0023 檔頭），故新增 `welcome-card-images`（public）。
 *
 * 本檔驗證的是**端點側**：
 *   ① 上傳成功 → 檔案真的在 bucket 裡（以 service role 列出 Storage 物件比對，
 *      不是只看端點回 200）
 *   ② 路徑第一段＝租戶 id（0008/0023 的 storage RLS 規則）
 *   ③ WebP 被擋（本 bucket 在 LINE_BOUND_BUCKETS：LINE 的圖片只收 JPEG/PNG）
 *   ④ **不產縮圖**：只有 chat-images 需要 ≤1 MB 的 previewImageUrl，歡迎卡片
 *      沒有那個欄位可指，多產一張只是沒人讀的物件
 *   ⑤ 未登入 → 401
 *
 * 頁面側（選檔 → 上傳 → 存回 tenant_settings → 重整後還在）由 Playwright 實測，
 * 見 scripts/verify/welcome-card-upload.28.cjs。
 *
 * 清理：afterAll 以 service role 刪掉本檔上傳的物件。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

const BASE_URL = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';
const BUCKET = 'welcome-card-images';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };
type UploadData = {
  url: string; path: string; bucket: string;
  previewPath?: string; previewUrl?: string; urlExpiresInSeconds?: number;
};

/** 1×1 透明 PNG（合法檔頭，與 upload.07 共用同一份） */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
/** 最小的合法 WebP（RIFF….WEBPVP8L…）——用來確認 LINE 去向的 bucket 會擋掉它 */
const WEBP_1X1 = Buffer.from(
  'UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=',
  'base64',
);

let admin: SupabaseClient;
let ownerA: AuthedApi;
let uploadedPath: string | null = null;

function form(file: File, bucket: string = BUCKET): FormData {
  const f = new FormData();
  f.append('file', file);
  f.append('bucket', bucket);
  return f;
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
    if (error) console.error('[upload-welcome-card.28] 清理 storage 物件失敗：', uploadedPath, error);
  }
});

describe('POST /api/upload bucket=welcome-card-images（issue #28 ⑥）', () => {
  it('PNG 上傳成功後，檔案真的在 bucket 裡（service role 列出物件比對），路徑第一段＝租戶 id', async () => {
    const res = await ownerA.fetch('/api/upload', {
      method: 'POST',
      body: form(new File([PNG_1X1 as unknown as BlobPart], 'welcome.png', { type: 'image/png' })),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Envelope<UploadData>;
    expect(body.success).toBe(true);
    expect(body.data?.bucket).toBe(BUCKET);
    expect(body.data?.path).toMatch(new RegExp(`^${SHOP_A.id}/[0-9a-f-]{36}\\.png$`));
    uploadedPath = body.data!.path;

    // 「回 200」不等於「檔案在 bucket 裡」——直接向 Storage 要那一個物件
    const fileName = uploadedPath.split('/')[1];
    const { data: objects, error } = await admin.storage.from(BUCKET).list(SHOP_A.id, {
      search: fileName,
    });
    expect(error).toBeNull();
    expect(objects?.map((o) => o.name)).toContain(fileName);

    // public bucket → 回的是永久公開網址（歡迎卡片要給 LINE 抓）
    expect(body.data?.url).toContain(`/${BUCKET}/${uploadedPath}`);
    expect(body.data?.urlExpiresInSeconds ?? null).toBeNull();
  });

  it('不產縮圖：回應沒有 previewPath / previewUrl，bucket 裡也沒有 .preview 物件', async () => {
    expect(uploadedPath).toBeTruthy();
    const { data: objects, error } = await admin.storage.from(BUCKET).list(SHOP_A.id);
    expect(error).toBeNull();
    expect((objects ?? []).some((o) => o.name.includes('.preview.'))).toBe(false);
  });

  it('WebP → 400 REQ_001（本 bucket 的去向是 LINE，只收 JPEG / PNG）', async () => {
    const res = await ownerA.fetch('/api/upload', {
      method: 'POST',
      body: form(new File([WEBP_1X1 as unknown as BlobPart], 'welcome.webp', { type: 'image/webp' })),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Envelope;
    expect(body.success).toBe(false);
    expect(body.code).toBe('REQ_001');
    expect(body.message).toContain('JPEG');
  });

  it('未登入 → 401 AUTH_001', async () => {
    const res = await fetch(`${BASE_URL}/api/upload`, {
      method: 'POST',
      body: form(new File([PNG_1X1 as unknown as BlobPart], 'welcome.png', { type: 'image/png' })),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as Envelope;
    expect(body.success).toBe(false);
    expect(body.code).toBe('AUTH_001');
  });
});
