/**
 * Issue #50 item B：keyword reply 換圖／移除圖片後，安全清理舊 Storage 物件。
 *
 * 核心安全規則：刪除是不可逆的，所以「不確定」時必須選擇不刪。
 * 除了基本換圖／移除圖片，也特別覆蓋 Final Risk 找到的共享圖片風險：
 * - 另一筆回覆仍引用同一 URL → 不刪
 * - 另一筆用 query string 等別名引用同一物件 → canonical 相同，不刪
 * - 共享引用落在分頁第 2 頁 → 仍找得到，不刪
 * - 引用掃描查詢失敗 → fail closed，不刪，但本次 PUT 儲存仍成功
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT_ID = 'tenant-a';
const SUPABASE_ORIGIN = 'https://storage.example';
const BUCKET = 'keyword-reply-images';

const oldUrl = (name: string) =>
  `${SUPABASE_ORIGIN}/storage/v1/object/public/${BUCKET}/${TENANT_ID}/${name}`;

let existingContent: Record<string, unknown> | null = null;
let existingRowMissing = false;
let otherContents: Array<Record<string, unknown>> = [];
let referenceScanError = false;
let referenceRangeCalls: Array<[number, number]> = [];

const removeMock = vi.fn(async (_paths: string[]) => ({ error: null as { message: string } | null }));
const storageFromMock = vi.fn((_bucket: string) => ({ remove: removeMock }));

function fakeSessionSupabase() {
  return {
    from: (table: string) => {
      if (table !== 'keyword_replies') throw new Error(`unexpected table: ${table}`);
      return {
        select: (cols: string) => {
          const builder: any = {
            eq: (_field: string, _value: unknown) => builder,
            neq: (_field: string, _value: unknown) => builder,
            order: (_field: string, _options: unknown) => builder,
            range: async (from: number, to: number) => {
              referenceRangeCalls.push([from, to]);
              if (referenceScanError) {
                return { data: null, error: { message: 'reference scan unavailable' } };
              }
              const data = otherContents.slice(from, to + 1).map((content, index) => ({
                id: `other-${from + index}`,
                content,
              }));
              return { data, error: null };
            },
            maybeSingle: async () => {
              if (existingRowMissing) return { data: null, error: null };
              if (cols === 'content') return { data: { content: existingContent ?? {} }, error: null };
              return { data: { id: 'kw_1' }, error: null };
            },
          };
          return builder;
        },
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
  requireTenant: async () => ({
    supabase: fakeSessionSupabase(),
    tenantId: TENANT_ID,
    user: { id: 'u1' },
  }),
}));

vi.mock('@/server/features', () => ({
  requireFeature: async () => undefined,
}));

vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ get: () => undefined }),
}));

import { PUT } from '@/app/api/settings/line/keyword-replies/[id]/route';

function makePutRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/settings/line/keyword-replies/kw_1', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

const params = () => Promise.resolve({ id: 'kw_1' });

describe('PUT keyword-replies/:id — 換圖／移除圖片安全清理（#50 item B）', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_ORIGIN;
    existingContent = null;
    existingRowMissing = false;
    otherContents = [];
    referenceScanError = false;
    referenceRangeCalls = [];
    removeMock.mockClear();
    storageFromMock.mockClear();
    removeMock.mockResolvedValue({ error: null });
  });

  it('換圖：沒有其他引用時，刪除舊物件而不是新物件', async () => {
    existingContent = { text: 'hi', imageUrl: oldUrl('old.png') };
    const res = await PUT(
      makePutRequest({ content: { text: 'hi', imageUrl: oldUrl('new.png') } }),
      { params: params() },
    );

    expect(res.status).toBe(200);
    expect(referenceRangeCalls).toEqual([[0, 199]]);
    expect(storageFromMock).toHaveBeenCalledWith(BUCKET);
    expect(removeMock).toHaveBeenCalledTimes(1);
    expect(removeMock).toHaveBeenCalledWith([`${TENANT_ID}/old.png`]);
  });

  it('移除圖片：沒有其他引用時，一樣刪除舊物件', async () => {
    existingContent = { text: 'hi', imageUrl: oldUrl('old.png') };
    const res = await PUT(
      makePutRequest({ content: { text: 'hi' } }),
      { params: params() },
    );

    expect(res.status).toBe(200);
    expect(removeMock).toHaveBeenCalledWith([`${TENANT_ID}/old.png`]);
  });

  it('Storage remove 回傳錯誤：best-effort，PUT 仍成功', async () => {
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

  it('Storage remove 拋例外：best-effort，PUT 仍成功', async () => {
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

  it('content 不變：不掃描其他回覆，也不刪圖片', async () => {
    existingContent = { text: 'hi', imageUrl: oldUrl('same.png') };
    const res = await PUT(
      makePutRequest({ content: { text: 'hi', imageUrl: oldUrl('same.png') } }),
      { params: params() },
    );

    expect(res.status).toBe(200);
    expect(referenceRangeCalls).toEqual([]);
    expect(removeMock).not.toHaveBeenCalled();
  });

  it('同一物件只多 query string：canonical 相同，不誤刪', async () => {
    existingContent = { text: 'hi', imageUrl: oldUrl('same.png') };
    const res = await PUT(
      makePutRequest({ content: { text: 'hi', imageUrl: `${oldUrl('same.png')}?v=2` } }),
      { params: params() },
    );

    expect(res.status).toBe(200);
    expect(referenceRangeCalls).toEqual([]);
    expect(removeMock).not.toHaveBeenCalled();
  });

  it('舊回覆原本沒有圖：新增新圖不會誤刪任何物件', async () => {
    existingContent = { text: 'hi' };
    const res = await PUT(
      makePutRequest({ content: { text: 'hi', imageUrl: oldUrl('first.png') } }),
      { params: params() },
    );

    expect(res.status).toBe(200);
    expect(removeMock).not.toHaveBeenCalled();
  });

  it('另一筆回覆仍引用相同舊圖：本列換圖後不得刪共用物件', async () => {
    existingContent = { text: 'first', imageUrl: oldUrl('shared.png') };
    otherContents = [{ text: 'second', imageUrl: oldUrl('shared.png') }];

    const res = await PUT(
      makePutRequest({ content: { text: 'first', imageUrl: oldUrl('new.png') } }),
      { params: params() },
    );

    expect(res.status).toBe(200);
    expect(referenceRangeCalls).toEqual([[0, 199]]);
    expect(removeMock).not.toHaveBeenCalled();
  });

  it('另一筆用 URL 別名引用同一物件：canonical 相同，仍不得刪', async () => {
    existingContent = { text: 'first', imageUrl: oldUrl('shared.png') };
    otherContents = [{ text: 'second', imageUrl: `${oldUrl('shared.png')}?cache=2#preview` }];

    const res = await PUT(
      makePutRequest({ content: { text: 'first', imageUrl: oldUrl('new.png') } }),
      { params: params() },
    );

    expect(res.status).toBe(200);
    expect(removeMock).not.toHaveBeenCalled();
  });

  it('共用引用在第 2 頁：必須繼續掃完，不能只看前 200 筆就刪', async () => {
    existingContent = { text: 'first', imageUrl: oldUrl('shared.png') };
    otherContents = Array.from({ length: 200 }, (_, index) => ({
      text: `row-${index}`,
      imageUrl: oldUrl(`other-${index}.png`),
    }));
    otherContents.push({ text: 'shared-on-page-2', imageUrl: oldUrl('shared.png') });

    const res = await PUT(
      makePutRequest({ content: { text: 'first', imageUrl: oldUrl('new.png') } }),
      { params: params() },
    );

    expect(res.status).toBe(200);
    expect(referenceRangeCalls).toEqual([[0, 199], [200, 399]]);
    expect(removeMock).not.toHaveBeenCalled();
  });

  it('引用掃描失敗：fail closed，儲存成功但不做不可逆刪除', async () => {
    existingContent = { text: 'first', imageUrl: oldUrl('old.png') };
    referenceScanError = true;

    const res = await PUT(
      makePutRequest({ content: { text: 'first', imageUrl: oldUrl('new.png') } }),
      { params: params() },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(removeMock).not.toHaveBeenCalled();
  });
});
