/**
 * tests/unit/banner-video-cleanup-cron.22.test.ts
 * -----------------------------------------------------------------------------
 * 守 `GET /api/cron/banner-video-uploads-cleanup`（Issue #22 Part A）：
 * `CRON_SECRET` 才放行，其餘一律 401；清理成功回 200 附統計；清理失敗回 500
 * （不吞成看起來成功），同 `promotion-events-cleanup` 的既有慣例
 * （tests/unit/promotion-events.23.test.ts）。
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

const cleanupMock = vi.fn(async () => ({ deletedRows: 0, storageErrors: 0, cutoffIso: '2026-09-14T00:00:00.000Z' }));

vi.mock('@/server/banner-video', () => ({
  cleanupOrphanedBannerVideoUploads: () => cleanupMock(),
}));

import { GET } from '@/app/api/cron/banner-video-uploads-cleanup/route';

const ORIGINAL_SECRET = process.env.CRON_SECRET;

function makeRequest(auth?: string) {
  return new Request('http://localhost/api/cron/banner-video-uploads-cleanup', {
    headers: auth ? { authorization: auth } : {},
  });
}

describe('GET /api/cron/banner-video-uploads-cleanup（issue #22）', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'test-secret';
    cleanupMock.mockClear();
  });

  afterAll(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = ORIGINAL_SECRET;
  });

  it('沒有 Authorization header → 401，不執行清理', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(cleanupMock).not.toHaveBeenCalled();
  });

  it('錯誤的 secret → 401', async () => {
    const res = await GET(makeRequest('Bearer wrong-secret'));
    expect(res.status).toBe(401);
    expect(cleanupMock).not.toHaveBeenCalled();
  });

  it('正確的 secret → 200，回傳清理統計', async () => {
    cleanupMock.mockResolvedValueOnce({ deletedRows: 3, storageErrors: 1, cutoffIso: '2026-09-14T00:00:00.000Z' });
    const res = await GET(makeRequest('Bearer test-secret'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({
      success: true,
      deletedRows: 3,
      storageErrors: 1,
      cutoffIso: '2026-09-14T00:00:00.000Z',
    });
  });

  it('清理本身丟例外 → 500，不吞成看起來成功', async () => {
    cleanupMock.mockRejectedValueOnce(new Error('db unavailable'));
    const res = await GET(makeRequest('Bearer test-secret'));
    expect(res.status).toBe(500);
  });
});
