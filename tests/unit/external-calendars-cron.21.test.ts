/**
 * tests/unit/external-calendars-cron.21.test.ts
 * -----------------------------------------------------------------------------
 * 守 `GET /api/cron/external-calendars-sync`（Issue #21）：CRON_SECRET 才放行；
 * 單一訂閱失敗（無論是 syncExternalCalendar 回傳 ok:false，或意外丟例外）都
 * 不得中斷其他訂閱的處理，統計數字誠實反映成功/失敗筆數。
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

const listMock = vi.fn(async () => [
  { id: 'sub-1', tenantId: 't1', icsUrl: 'https://a.example/x.ics' },
  { id: 'sub-2', tenantId: 't2', icsUrl: 'https://b.example/y.ics' },
  { id: 'sub-3', tenantId: 't3', icsUrl: 'https://c.example/z.ics' },
]);
const syncMock = vi.fn();

vi.mock('@/server/external-calendar-sync', () => ({
  listActiveExternalCalendars: () => listMock(),
  syncExternalCalendar: (_admin: any, sub: any) => syncMock(sub),
}));
vi.mock('@/server/supabase', () => ({
  createAdminSupabase: () => ({}),
}));

import { GET } from '@/app/api/cron/external-calendars-sync/route';

const ORIGINAL_SECRET = process.env.CRON_SECRET;

function makeRequest(auth?: string) {
  return new Request('http://localhost/api/cron/external-calendars-sync', {
    headers: auth ? { authorization: auth } : {},
  });
}

describe('GET /api/cron/external-calendars-sync（issue #21）', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'test-secret';
    listMock.mockClear();
    syncMock.mockReset();
  });

  afterAll(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = ORIGINAL_SECRET;
  });

  it('沒有 Authorization header → 401，不執行同步', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(listMock).not.toHaveBeenCalled();
  });

  it('錯誤的 secret → 401', async () => {
    const res = await GET(makeRequest('Bearer wrong'));
    expect(res.status).toBe(401);
  });

  it('單一訂閱回傳 ok:false 不中斷其他訂閱：統計數字正確', async () => {
    syncMock
      .mockResolvedValueOnce({ ok: true, eventCount: 3 })
      .mockResolvedValueOnce({ ok: false, error: 'provider down' })
      .mockResolvedValueOnce({ ok: true, eventCount: 1 });

    const res = await GET(makeRequest('Bearer test-secret'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(syncMock).toHaveBeenCalledTimes(3);
    expect(body).toMatchObject({ success: true, total: 3, succeeded: 2, failed: 1 });
    expect(body.errors).toEqual([{ id: 'sub-2', error: 'provider down' }]);
  });

  it('單一訂閱意外丟例外（不是回傳 ok:false）一樣不中斷其他訂閱', async () => {
    syncMock
      .mockResolvedValueOnce({ ok: true, eventCount: 2 })
      .mockRejectedValueOnce(new Error('unexpected crash'))
      .mockResolvedValueOnce({ ok: true, eventCount: 5 });

    const res = await GET(makeRequest('Bearer test-secret'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(syncMock).toHaveBeenCalledTimes(3);
    expect(body).toMatchObject({ total: 3, succeeded: 2, failed: 1 });
    expect(body.errors[0]).toMatchObject({ id: 'sub-2', error: 'unexpected crash' });
  });

  it('列出訂閱清單本身失敗 → 500（迴圈都還沒開始）', async () => {
    listMock.mockRejectedValueOnce(new Error('db unavailable'));
    const res = await GET(makeRequest('Bearer test-secret'));
    expect(res.status).toBe(500);
    expect(syncMock).not.toHaveBeenCalled();
  });

  it('沒有任何 active 訂閱：正常回 200，succeeded/failed 皆為 0', async () => {
    listMock.mockResolvedValueOnce([]);
    const res = await GET(makeRequest('Bearer test-secret'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ total: 0, succeeded: 0, failed: 0, errors: [] });
  });
});
