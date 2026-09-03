/** #28⑥：歡迎卡片圖片上傳必須真的落到 tenant-scoped storage。 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

const BASE_URL = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';
const BUCKET = 'welcome-card-images';
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let admin: SupabaseClient;
let ownerA: AuthedApi;
let uploadedPath: string | null = null;

function pngFile(): File {
  return new File([PNG_1X1], 'welcome.png', { type: 'image/png' });
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
    if (error) console.error('[upload-welcome-card.28] 清理 storage 物件失敗：', error);
  }
});

describe('POST /api/upload welcome-card-images (#28⑥)', () => {
  it('requires auth and stores a tenant-prefixed image', async () => {
    const unauthenticated = await fetch(`${BASE_URL}/api/upload`, {
      method: 'POST',
      body: (() => {
        const form = new FormData();
        form.append('file', pngFile());
        form.append('bucket', BUCKET);
        return form;
      })(),
    });
    expect(unauthenticated.status).toBe(401);

    const form = new FormData();
    form.append('file', pngFile());
    form.append('bucket', BUCKET);
    const res = await ownerA.fetch('/api/upload', { method: 'POST', body: form });
    expect(res.status).toBe(200);

    const body = (await res.json()) as { success: boolean; data?: { url: string } };
    expect(body.success).toBe(true);
    const url = body.data?.url ?? '';
    const marker = `/object/public/${BUCKET}/`;
    expect(url).toContain(`/${BUCKET}/${SHOP_A.id}/`);
    expect(url).toContain(marker);
    uploadedPath = url.slice(url.indexOf(marker) + marker.length);

    const { data: blob, error } = await admin.storage.from(BUCKET).download(uploadedPath);
    expect(error).toBeNull();
    expect(blob).not.toBeNull();
    expect(Buffer.from(await blob!.arrayBuffer())).toEqual(PNG_1X1);
  });
});
