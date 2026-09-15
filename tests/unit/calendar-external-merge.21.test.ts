/**
 * tests/unit/calendar-external-merge.21.test.ts
 * -----------------------------------------------------------------------------
 * 守 `GET /api/calendar` 併入 EXTERNAL 事件（Issue #21「Contract/storage」
 * 「真正合併 EXTERNAL events」與「Security／tenant isolation」）：
 *   - external_calendar_events 快取表的列會出現在合併陣列裡，type='EXTERNAL'。
 *   - 查詢一律帶 `tenant_id = t.tenantId`（session 解析出來的），不會把別的
 *     租戶的快取事件混進來——這裡直接斷言查詢用的是 mock 回傳的、已經照
 *     tenant_id 過濾過的資料，並確認 `.eq('tenant_id', …)` 真的被呼叫。
 */
import { describe, it, expect, vi } from 'vitest';

const TENANT_ID = 'tenant-a';

function makeQuery(result: { data: unknown; error: unknown }, spy?: (method: string, args: unknown[]) => void) {
  const builder: any = {};
  for (const method of ['select', 'eq', 'in', 'lt', 'gt', 'order']) {
    builder[method] = (...args: unknown[]) => { spy?.(method, args); return builder; };
  }
  builder.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

const eqCalls: [string, unknown][] = [];

function fakeSessionSupabase() {
  return {
    from: (table: string) => {
      if (table === 'bookings_view') return makeQuery({ data: [], error: null });
      if (table === 'block_times') return makeQuery({ data: [], error: null });
      if (table === 'external_calendar_events') {
        return makeQuery(
          {
            data: [
              { id: 'evt-1', title: '外部事件 A', start_at: '2026-09-01T09:00:00.000Z', end_at: '2026-09-01T10:00:00.000Z', all_day: false },
            ],
            error: null,
          },
          (method, args) => { if (method === 'eq') eqCalls.push(args as [string, unknown]); },
        );
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

vi.mock('@/server/tenant', () => ({
  requireTenant: async () => ({ supabase: fakeSessionSupabase(), tenantId: TENANT_ID, user: { id: 'u1' } }),
}));
vi.mock('next/headers', () => ({ cookies: () => Promise.resolve({ get: () => undefined }) }));

import { GET } from '@/app/api/calendar/route';

function makeReq(from: string, to: string) {
  return new Request(`http://localhost/api/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
}

describe('GET /api/calendar — EXTERNAL 事件合併（issue #21）', () => {
  it('回傳的 events 陣列包含快取表的 EXTERNAL 事件', async () => {
    const res = await GET(makeReq('2026-09-01T00:00:00.000Z', '2026-09-02T00:00:00.000Z'), {} as any);
    const body = await res.json();
    expect(res.status).toBe(200);
    const external = body.data.events.filter((e: any) => e.type === 'EXTERNAL');
    expect(external).toHaveLength(1);
    expect(external[0]).toMatchObject({
      id: 'external:evt-1',
      type: 'EXTERNAL',
      title: '外部事件 A',
      start: '2026-09-01T09:00:00.000Z',
      end: '2026-09-01T10:00:00.000Z',
    });
  });

  it('查詢快取表時真的用 session 解析出的 tenantId 做過濾（不信任 client 輸入）', async () => {
    eqCalls.length = 0;
    await GET(makeReq('2026-09-01T00:00:00.000Z', '2026-09-02T00:00:00.000Z'), {} as any);
    expect(eqCalls).toContainEqual(['tenant_id', TENANT_ID]);
  });
});
