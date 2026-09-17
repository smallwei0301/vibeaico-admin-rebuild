/**
 * tests/unit/keyword-reply-image-cleanup.50.test.ts
 * -----------------------------------------------------------------------------
 * 守 `PUT /api/settings/line/keyword-replies/:id` 換圖／移除圖片時的孤兒清理
 * （GitHub issue #50 item B）。#264 把「上傳、儲存、回讀、webhook 圖片回覆」全接好
 * 之後，唯一沒接的一段是：換圖或移除圖片時，`keyword-reply-images` 裡的舊物件
 * 永遠不會被刪——它會安靜地永遠留在 Storage 裡，是「看起來能動、其實在漏」的
 * 那種 bug。
 *
 * 四條斷言對應 issue 要求：
 * (a) 換圖 → 對「舊」路徑發出刪除呼叫（不是新路徑、不是隨便一個路徑）。
 * (b) 移除圖片（imageUrl 清空）→ 同樣刪舊物件。
 * (c) Storage 刪除失敗 → best-effort，儲存仍然成功（不得因此讓 PUT 失敗）。
 * (d) 與圖片無關的儲存（content 沒變、或整包沒動 imageUrl）→ 完全不呼叫刪除。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const TENANT_ID = 'tenant-a';
const SUPABASE_ORIGIN = 'https://storage.example';
const BUCKET = 'keyword-reply-images';

const oldUrl = (name: string) =>
  `${SUPABASE_ORIGIN}/storage/v1/object/public/${BUCKET}/${TENANT_ID}/${name}`;

let existingContent: Record<string, unknown> | null = null;
let existingRowMissing = false;

const removeMock = vi.fn(async (_paths: string[]) => ({ error: null as { message: string } | null }));
const storageFromMock = vi.fn((_bucket: string) => ({ remove: removeMock }));

function fakeSessionSupabase() {
  return {
    from: (table: string) => {
      if (table !== 'keyword_replies') throw new Error(`unexpected table: ${table}`);
      return {
        select: (cols: string) => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => {
                if (existingRowMissing) return { data: null, error: null };
                if (cols === 'content') return { data: { content: existingContent ?? {} }, error: null };
                return { data: { id: 'kw_1' }, error: null };
              },
            }),
          }),
        }),
        update: (_payload: Record<string, unknown>) => ({
          eq: () => ({
            eq: () => ({
              select: () => ({
                maybeSingle: async () => ({ data: { id: 'kw_1' }, error: null }),
              }),
            }),
          }),
        }),
      };
    },
  };
}

const fakeAdminSupabase = { storage: { from: storageFromMock } };

vi.mock('@/server/supabase', () => ({
  createAdminSupabase: () => fakeAdminSupabase,
}));

vi.mock('@/server/tenant', () => ({
  requireTenant: async () => ({ supabase: fakeSessionSupabase(), tenantId: TENANT_ID, user: { id: 'u1' } }),
}));

vi.mock('@/server/features', () => ({
  requireFeature: async () => undefined,
}));

vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ get: () => undefined }),
}));

const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

import { PUT } from '@/app/api/settings/line/keyword-replies/[id]/route';

function makePutRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/settings/line/keyword-replies/kw_1', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

const params = () => Promise.resolve({ id: 'kw_1' });

describe('PUT keyword-replies/:id — 換圖／移除圖片時清舊 Storage 物件（#50 item B）', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_ORIGIN;
    existingContent = null;
    existingRowMissing = false;
    removeMock.mockClear();
    storageFromMock.mockClear();
    removeMock.mockResolvedValue({ error: null });
  });

  it('(a) 換圖：對「舊」物件路徑發出刪除，不是新路徑', async () => {
    existingContent = { text: 'hi', imageUrl: oldUrl('old.png') };
    const res = await PUT(
      makePutRequest({ content: { text: 'hi', imageUrl: oldUrl('new.png') } }),
      { params: params() },
    );
    expect(res.status).toBe(200);
    expect(storageFromMock).toHaveBeenCalledWith(BUCKET);
    expect(removeMock).toHaveBeenCalledTimes(1);
    expect(removeMock).toHaveBeenCalledWith([`${TENANT_ID}/old.png`]);
  });

  it('(b) 移除圖片（新 content 沒有 imageUrl）：一樣刪掉舊物件', async () => {
    existingContent = { text: 'hi', imageUrl: oldUrl('old.png') };
    const res = await PUT(
      makePutRequest({ content: { text: 'hi' } }),
      { params: params() },
    );
    expect(res.status).toBe(200);
    expect(removeMock).toHaveBeenCalledWith([`${TENANT_ID}/old.png`]);
  });

  it('(c) Storage 刪除失敗：best-effort，儲存仍然成功（不得讓 PUT 失敗）', async () => {
    existingContent = { text: 'hi', imageUrl: oldUrl('old.png') };
    removeMock.mockResolvedValueOnce({ error: { message: 'storage unavailable' } });
    const res = await PUT(
      makePutRequest({ content: { text: 'hi', imageUrl: oldUrl('new.png') } }),
      { params: params() },
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(removeMock).toHaveBeenCalledTimes(1);
  });

  it('(c-2) Storage 刪除拋出例外：一樣不影響儲存結果', async () => {
    existingContent = { text: 'hi', imageUrl: oldUrl('old.png') };
    removeMock.mockRejectedValueOnce(new Error('network down'));
    const res = await PUT(
      makePutRequest({ content: { text: 'hi', imageUrl: oldUrl('new.png') } }),
      { params: params() },
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('(d) 與圖片無關的儲存（content 不變）：完全不呼叫刪除', async () => {
    existingContent = { text: 'hi', imageUrl: oldUrl('same.png') };
    const res = await PUT(
      makePutRequest({ content: { text: 'hi', imageUrl: oldUrl('same.png') } }),
      { params: params() },
    );
    expect(res.status).toBe(200);
    expect(removeMock).not.toHaveBeenCalled();
  });

  it('(d-2) 完全不動 content（只改 sortOrder）：不查也不刪圖片', async () => {
    existingContent = { text: 'hi', imageUrl: oldUrl('same.png') };
    const res = await PUT(
      makePutRequest({ sortOrder: 3 }),
      { params: params() },
    );
    expect(res.status).toBe(200);
    expect(removeMock).not.toHaveBeenCalled();
  });

  it('同一物件的不同別名寫法（多一段 query string）：canonical 相同 → 不誤刪仍在用的物件', async () => {
    existingContent = { text: 'hi', imageUrl: oldUrl('same.png') };
    const res = await PUT(
      makePutRequest({ content: { text: 'hi', imageUrl: `${oldUrl('same.png')}?v=2` } }),
      { params: params() },
    );
    expect(res.status).toBe(200);
    expect(removeMock).not.toHaveBeenCalled();
  });

  it('舊圖是空字串（原本就沒有圖）：換成新圖不會誤刪任何東西', async () => {
    existingContent = { text: 'hi' };
    const res = await PUT(
      makePutRequest({ content: { text: 'hi', imageUrl: oldUrl('first.png') } }),
      { params: params() },
    );
    expect(res.status).toBe(200);
    expect(removeMock).not.toHaveBeenCalled();
  });
});
