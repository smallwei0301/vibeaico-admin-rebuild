import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ useMock: true, request: vi.fn() }));

vi.mock('@/lib/api', async (orig) => {
  const actual = await orig<typeof import('@/lib/api')>();
  return {
    ...actual,
    request: h.request,
    adapt: <T,>(mock: () => T | Promise<T>, real: () => Promise<T>) =>
      Promise.resolve(h.useMock ? mock() : real()),
  };
});

import { listCustomerTags } from '@/services/customers';
import { applyMockMode, MOCK_CUSTOMERS } from '@/mock';

const page = readFileSync(
  fileURLToPath(new URL('../../src/app/tenant/customers/page.tsx', import.meta.url)),
  'utf8',
);

describe('listCustomerTags（#877）', () => {
  beforeEach(() => { h.request.mockReset(); h.useMock = true; });

  it('real 分支呼叫 /api/customers/tags 並回傳 tags，不碰 mock', async () => {
    h.useMock = false;
    h.request.mockResolvedValue({ tags: ['VIP', '老客'] });
    expect(await listCustomerTags()).toEqual(['VIP', '老客']);
    expect(h.request).toHaveBeenCalledWith('/api/customers/tags');
  });

  it('real 分支失敗時向上拋錯（由頁面決定退成空清單）', async () => {
    h.useMock = false;
    h.request.mockRejectedValue(new Error('403'));
    await expect(listCustomerTags()).rejects.toThrow('403');
  });

  it('mock 分支在呼叫時由當下業態的 MOCK_CUSTOMERS 推導', async () => {
    applyMockMode('LOCAL_SHOP');
    const a = await listCustomerTags();
    expect(a).toEqual(Array.from(new Set(MOCK_CUSTOMERS.flatMap((c) => c.tags))));
    applyMockMode('GUIDE');
    const b = await listCustomerTags();
    expect(b).toEqual(Array.from(new Set(MOCK_CUSTOMERS.flatMap((c) => c.tags))));
    expect(b).not.toEqual(a);
    expect(h.request).not.toHaveBeenCalled();
  });
});

describe('customers page 接線（#877）', () => {
  it('不再 import MOCK_CUSTOMERS / customerTags，改呼叫 listCustomerTags', () => {
    expect(page).not.toContain('MOCK_CUSTOMERS');
    expect(page).not.toContain('customerTags');
    expect(page).toContain('listCustomerTags()');
    expect(page).toContain('tags.map');
  });
});
