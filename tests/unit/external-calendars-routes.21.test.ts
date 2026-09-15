/**
 * tests/unit/external-calendars-routes.21.test.ts
 * -----------------------------------------------------------------------------
 * 守 `GET/POST /api/external-calendars`、`DELETE /api/external-calendars/:id`
 * （Issue #21）：租戶邊界一律來自 `requireTenant()`，不信任 client 傳來的
 * tenantId；建立時誠實回報 never-synced 起始狀態（不 fabricate 假的同步時間）；
 * 刪除時跨租戶（別人的 id）視為找不到，不會誤刪。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const TENANT_ID = 'tenant-a';

let calendarRows: Record<string, unknown>[] = [];
const insertMock = vi.fn(async (payload: Record<string, unknown>) => {
  const row = { id: `ec_${calendarRows.length + 1}`, ...payload };
  calendarRows.push(row);
  return { data: { id: row.id }, error: null };
});
const staffLookupResult = { data: null as { id: string } | null, error: null as any };
const deleteEqCalls: [string, string][] = [];

function fakeSessionSupabase() {
  return {
    from: (table: string) => {
      if (table === 'external_calendars') {
        return {
          select: (_cols: string) => ({
            eq: (col: string, val: string) => {
              // Support both list (.order at end) and ownership-check (.maybeSingle) chains.
              const filtered = () => calendarRows.filter((r) => (r as any)[col] === val);
              return {
                eq: (col2: string, val2: string) => ({
                  maybeSingle: async () => {
                    const row = calendarRows.find((r) => (r as any)[col] === val && (r as any)[col2] === val2);
                    return { data: row ? { id: (row as any).id } : null, error: null };
                  },
                }),
                order: async () => ({ data: filtered(), error: null }),
              };
            },
          }),
          insert: (payload: Record<string, unknown>) => ({
            select: () => ({ single: () => insertMock(payload) }),
          }),
          delete: () => ({
            eq: (col: string, val: string) => ({
              eq: (col2: string, val2: string) => {
                deleteEqCalls.push([col, val]);
                calendarRows = calendarRows.filter((r) => !((r as any)[col] === val && (r as any)[col2] === val2));
                return Promise.resolve({ error: null });
              },
            }),
          }),
        };
      }
      if (table === 'staff') {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => staffLookupResult }) }) }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

vi.mock('@/server/tenant', () => ({
  requireTenant: async () => ({ supabase: fakeSessionSupabase(), tenantId: TENANT_ID, user: { id: 'u1' } }),
}));
vi.mock('next/headers', () => ({ cookies: () => Promise.resolve({ get: () => undefined }) }));

import { GET, POST } from '@/app/api/external-calendars/route';
import { DELETE } from '@/app/api/external-calendars/[id]/route';

function makeReq(method: string, body?: unknown) {
  return new Request('http://localhost/api/external-calendars', {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

describe('POST /api/external-calendars（issue #21）', () => {
  beforeEach(() => {
    calendarRows = [];
    insertMock.mockClear();
  });

  it('建立成功：tenant_id 一律取自 session，忽略 body 裡任何 tenantId 欄位', async () => {
    const res = await POST(makeReq('POST', { name: 'Booking.com', icsUrl: 'https://x.example/a.ics', tenantId: 'evil-tenant' } as any));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(calendarRows).toHaveLength(1);
    expect(calendarRows[0]).toMatchObject({ tenant_id: TENANT_ID, name: 'Booking.com', active: true });
    // 誠實起始狀態：不寫入任何 last_synced_at/last_sync_status——交給資料表預設值。
    expect(calendarRows[0]).not.toHaveProperty('last_synced_at');
    expect(calendarRows[0]).not.toHaveProperty('last_sync_status');
  });

  it('缺 name → 400', async () => {
    const res = await POST(makeReq('POST', { icsUrl: 'https://x.example/a.ics' }));
    expect(res.status).toBe(400);
  });

  it('不合法的 icsUrl（非 http(s)）→ 400', async () => {
    const res = await POST(makeReq('POST', { name: 'X', icsUrl: 'file:///etc/passwd' }));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/external-calendars（issue #21，tenant isolation）', () => {
  beforeEach(() => {
    calendarRows = [
      { id: 'ec_a', tenant_id: TENANT_ID, staff_id: null, name: 'Mine', ics_url: 'https://x.example/a.ics', last_synced_at: null, last_sync_status: 'NEVER_SYNCED', last_sync_error: null, active: true, created_at: '2026-01-01' },
      { id: 'ec_b', tenant_id: 'tenant-b', staff_id: null, name: 'Not mine', ics_url: 'https://x.example/b.ics', last_synced_at: null, last_sync_status: 'NEVER_SYNCED', last_sync_error: null, active: true, created_at: '2026-01-01' },
    ];
  });

  it('只回自己租戶的列，不會看到另一個租戶的訂閱', async () => {
    const res = await GET(makeReq('GET'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe('ec_a');
  });
});

describe('DELETE /api/external-calendars/:id（issue #21，tenant isolation）', () => {
  beforeEach(() => {
    calendarRows = [
      { id: 'ec_mine', tenant_id: TENANT_ID, name: 'Mine' },
      { id: 'ec_theirs', tenant_id: 'tenant-b', name: 'Not mine' },
    ];
    deleteEqCalls.length = 0;
  });

  it('刪除自己租戶的列成功', async () => {
    const res = await DELETE(new Request('http://localhost/api/external-calendars/ec_mine', { method: 'DELETE' }), {
      params: Promise.resolve({ id: 'ec_mine' }),
    });
    expect(res.status).toBe(200);
    expect(calendarRows.find((r) => r.id === 'ec_mine')).toBeUndefined();
  });

  it('別的租戶的 id 視為找不到，不會誤刪', async () => {
    const res = await DELETE(new Request('http://localhost/api/external-calendars/ec_theirs', { method: 'DELETE' }), {
      params: Promise.resolve({ id: 'ec_theirs' }),
    });
    expect(res.status).toBe(404);
    // 仍然存在——沒有被跨租戶刪掉。
    expect(calendarRows.find((r) => r.id === 'ec_theirs')).toBeDefined();
  });

  it('不存在的 id → 404', async () => {
    const res = await DELETE(new Request('http://localhost/api/external-calendars/nope', { method: 'DELETE' }), {
      params: Promise.resolve({ id: 'nope' }),
    });
    expect(res.status).toBe(404);
  });
});
