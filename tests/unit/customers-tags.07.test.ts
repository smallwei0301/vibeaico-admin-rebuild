import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const requestMock = vi.fn();

vi.mock('@/lib/api', () => ({
  adapt: <T>(_mock: () => T, real: () => Promise<T>) => real(),
  request: (path: string, init?: unknown) => requestMock(path, init),
}));

describe('customer tag options use the real API in real mode', () => {
  it('listCustomerTags reads the distinct tags from GET /api/customers/tags', async () => {
    requestMock.mockResolvedValue({ tags: ['VIP', '企業'] });

    const { listCustomerTags } = await import('@/services/customers');

    await expect(listCustomerTags()).resolves.toEqual(['VIP', '企業']);
    expect(requestMock.mock.calls[0]?.[0]).toBe('/api/customers/tags');
  });

  it('customers page does not derive filter options from MOCK_CUSTOMERS', () => {
    const page = readFileSync('src/app/tenant/customers/page.tsx', 'utf8');

    expect(page).not.toContain("import { MOCK_CUSTOMERS } from '@/mock';");
    expect(page).toContain('listCustomerTags');
  });
});
