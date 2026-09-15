/**
 * tests/unit/external-calendar-sync.21.test.ts
 * -----------------------------------------------------------------------------
 * 守 `src/server/external-calendar-sync.ts`（Issue #21「Sync」驗收）：
 * 成功時原子替換快取＋更新 last_synced_at；失敗時 last_sync_status='ERROR'
 * 並保留舊快取（完全不呼叫替換 rpc）；never-synced 起始狀態誠實反映。
 */
import { describe, it, expect, vi } from 'vitest';

const fetchTextMock = vi.fn(async (_url: string) => 'BEGIN:VCALENDAR');
vi.mock('@/server/ssrf-guard', () => ({
  fetchTextWithSsrfGuard: (url: string) => fetchTextMock(url),
  SsrfBlockedError: class SsrfBlockedError extends Error {},
}));

const parseIcsMock = vi.fn((_text: string) => [
  { uid: 'e1', title: 'Event 1', startAt: '2026-09-01T00:00:00.000Z', endAt: '2026-09-01T01:00:00.000Z', allDay: false },
]);
vi.mock('@/server/ics-parser', () => ({
  parseIcs: (text: string) => parseIcsMock(text),
}));

import { syncExternalCalendar, listActiveExternalCalendars } from '@/server/external-calendar-sync';

const SUB = { id: 'sub-1', tenantId: 'tenant-a', icsUrl: 'https://example.com/basic.ics' };

function makeAdmin(overrides: Partial<{ rpcImpl: (name: string, args: any) => Promise<{ error: any }> }> = {}) {
  const rpc = vi.fn(overrides.rpcImpl ?? (async () => ({ error: null })));
  return {
    rpc,
    from: vi.fn(),
  } as any;
}

describe('syncExternalCalendar（issue #21）', () => {
  it('成功：抓取＋解析成功 → 呼叫 sync_replace_external_calendar_events，回傳 eventCount', async () => {
    fetchTextMock.mockResolvedValueOnce('BEGIN:VCALENDAR');
    const admin = makeAdmin();
    const result = await syncExternalCalendar(admin, SUB);
    expect(result).toEqual({ ok: true, eventCount: 1 });
    expect(admin.rpc).toHaveBeenCalledWith('sync_replace_external_calendar_events', {
      p_external_calendar_id: SUB.id,
      p_tenant_id: SUB.tenantId,
      p_events: [{ uid: 'e1', title: 'Event 1', start_at: '2026-09-01T00:00:00.000Z', end_at: '2026-09-01T01:00:00.000Z', all_day: false }],
    });
    // 成功路徑絕不呼叫失敗記錄 rpc。
    expect(admin.rpc).not.toHaveBeenCalledWith('mark_external_calendar_sync_error', expect.anything());
  });

  it('provider 抓取失敗 → ERROR，完全不呼叫替換快取的 rpc（保留舊快取）', async () => {
    fetchTextMock.mockRejectedValueOnce(new Error('連線逾時'));
    const admin = makeAdmin();
    const result = await syncExternalCalendar(admin, SUB);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('連線逾時');
    expect(admin.rpc).toHaveBeenCalledWith('mark_external_calendar_sync_error', {
      p_external_calendar_id: SUB.id,
      p_tenant_id: SUB.tenantId,
      p_error: expect.stringContaining('連線逾時'),
    });
    expect(admin.rpc).not.toHaveBeenCalledWith('sync_replace_external_calendar_events', expect.anything());
  });

  it('解析失敗 → ERROR，同樣不碰快取表', async () => {
    fetchTextMock.mockResolvedValueOnce('garbage');
    parseIcsMock.mockImplementationOnce(() => { throw new Error('壞掉的 ICS'); });
    const admin = makeAdmin();
    const result = await syncExternalCalendar(admin, SUB);
    expect(result.ok).toBe(false);
    expect(admin.rpc).toHaveBeenCalledWith('mark_external_calendar_sync_error', expect.objectContaining({
      p_error: expect.stringContaining('壞掉的 ICS'),
    }));
    expect(admin.rpc).not.toHaveBeenCalledWith('sync_replace_external_calendar_events', expect.anything());
  });

  it('替換快取的 rpc 本身回傳錯誤 → 走失敗記錄路徑', async () => {
    fetchTextMock.mockResolvedValueOnce('BEGIN:VCALENDAR');
    const admin = makeAdmin({
      rpcImpl: async (name: string) => {
        if (name === 'sync_replace_external_calendar_events') return { error: { message: 'db down' } };
        return { error: null };
      },
    });
    const result = await syncExternalCalendar(admin, SUB);
    expect(result.ok).toBe(false);
    expect(admin.rpc).toHaveBeenCalledWith('mark_external_calendar_sync_error', expect.objectContaining({
      p_error: expect.stringContaining('db down'),
    }));
  });
});

describe('listActiveExternalCalendars（issue #21）', () => {
  it('只選 active=true，跨租戶一次列出', async () => {
    const eq = vi.fn(async () => ({
      data: [{ id: 's1', tenant_id: 't1', ics_url: 'https://a.example/x.ics' }],
      error: null,
    }));
    const select = vi.fn(() => ({ eq }));
    const admin = { from: vi.fn(() => ({ select })) } as any;
    const rows = await listActiveExternalCalendars(admin);
    expect(admin.from).toHaveBeenCalledWith('external_calendars');
    expect(eq).toHaveBeenCalledWith('active', true);
    expect(rows).toEqual([{ id: 's1', tenantId: 't1', icsUrl: 'https://a.example/x.ics' }]);
  });

  it('查詢本身失敗 → 丟例外（呼叫端 cron route 自己負責 isolate）', async () => {
    const eq = vi.fn(async () => ({ data: null, error: { message: 'boom' } }));
    const select = vi.fn(() => ({ eq }));
    const admin = { from: vi.fn(() => ({ select })) } as any;
    await expect(listActiveExternalCalendars(admin)).rejects.toBeTruthy();
  });
});
