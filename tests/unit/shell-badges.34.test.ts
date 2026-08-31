import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestMock = vi.fn();

vi.mock('@/lib/api', () => ({
  adapt: <T>(_mock: () => T, real: () => Promise<T>) => real(),
  request: (path: string, init?: unknown) => requestMock(path, init),
}));

function stubShellEndpoints(overrides: Record<string, () => Promise<unknown>> = {}) {
  requestMock.mockImplementation((path?: string) => {
    if (!path) return Promise.resolve(undefined);
    const override = Object.entries(overrides).find(([prefix]) => path.startsWith(prefix));
    if (override) return override[1]();
    if (path === '/api/bookings') {
      return Promise.resolve({ content: [], totalElements: 7, totalPages: 7, number: 0, size: 1 });
    }
    if (path === '/api/product-orders/pending/count') return Promise.resolve({ count: 4 });
    if (path === '/api/chat/conversations') {
      return Promise.resolve([{ unread: 2 }, { unread: 0 }, { unread: 9 }]);
    }
    return Promise.reject(new Error(`unexpected endpoint: ${path}`));
  });
}

beforeEach(() => requestMock.mockReset());

describe('Issue #34 real shell badge aggregation', () => {
  it('uses the existing booking, product-order, and chat contracts rather than shell mock constants', async () => {
    stubShellEndpoints();
    const { sidebarCounts } = await import('@/services/shell');

    await expect(sidebarCounts()).resolves.toEqual({
      pendingBookingBadge: 7,
      pendingOrderBadge: 4,
      unreadChatBadge: 11,
    });
    expect(requestMock).toHaveBeenCalledWith('/api/bookings', { query: { status: 'PENDING', size: 1 } });
    expect(requestMock).toHaveBeenCalledWith('/api/product-orders/pending/count', undefined);
    expect(requestMock).toHaveBeenCalledWith('/api/chat/conversations', undefined);
  });

  it('keeps a failed source unknown instead of reporting it as zero', async () => {
    stubShellEndpoints({
      '/api/product-orders/pending/count': () => Promise.reject(new Error('unavailable')),
    });
    const { sidebarCounts } = await import('@/services/shell');

    await expect(sidebarCounts()).resolves.toEqual({ pendingBookingBadge: 7, unreadChatBadge: 11 });
  });
});
