/**
 * Issue #47（Codex P2）：推播額度上限單一真相。
 * 儀表板 pushQuotaTotal、dashboard-alerts 的 pushQuotaExhausted、發送端 consumePushQuota
 * 必須共用同一個上限（EXTRA_PUSH 生效 700，否則 200）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const TENANT_ID = 'tenant-a';
let extraActive = false;
let used = 0;
const upsertMock = vi.fn(async (_p: Record<string, unknown>) => ({ error: null }));

/** 可 await 的萬用 query chain；依 table 回傳預先設定的結果。 */
function chain(result: { data?: unknown; count?: number; error?: null }) {
  const r = { data: null, count: 0, error: null, ...result };
  const q: any = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'then') return (res: (v: unknown) => void) => res(r);
      if (prop === 'maybeSingle') return async () => r;
      return () => q;
    },
  });
  return q;
}

function fakeFrom(table: string) {
  switch (table) {
    case 'push_quota_usage':
      return { select: () => chain({ data: { used } }), upsert: upsertMock };
    case 'feature_subscriptions':
      return { select: () => chain({ data: [] }) };
    case 'tenant_settings':
      return { select: () => chain({ data: { line_channel_access_token_enc: 'x', business: {} } }) };
    case 'bookings':
    case 'customers':
    case 'customers_view':
      return { select: () => chain({ data: [], count: 0 }) };
    case 'products':
      return { select: () => chain({ data: [] }) };
    default:
      throw new Error(`unexpected table: ${table}`);
  }
}
const fakeSupabase = { from: fakeFrom };

vi.mock('@/server/tenant', () => ({
  requireTenant: async () => ({ supabase: fakeSupabase, tenantId: TENANT_ID, user: { id: 'u' }, role: 'OWNER' }),
}));
vi.mock('@/server/supabase', () => ({ createAdminSupabase: () => fakeSupabase }));
vi.mock('@/server/features', () => ({
  isFeatureActive: async (_tenantId: string, code: string) => code === 'EXTRA_PUSH' && extraActive,
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [] }) }));

import { GET as getDashboard } from '@/app/api/reports/dashboard/route';
import { GET as getAlerts } from '@/app/api/reports/dashboard-alerts/route';
import { consumePushQuota, pushQuotaLimit } from '@/server/line';

const ctx = { params: Promise.resolve({}) };
const call = async (h: any, path: string) =>
  (await h(new Request(`http://localhost${path}`), ctx).then((r: Response) => r.json())).data;

beforeEach(() => {
  extraActive = false;
  used = 0;
  upsertMock.mockClear();
});

describe('pushQuotaLimit', () => {
  it('200 without EXTRA_PUSH, 700 with it', async () => {
    expect(await pushQuotaLimit(TENANT_ID)).toBe(200);
    extraActive = true;
    expect(await pushQuotaLimit(TENANT_ID)).toBe(700);
  });
});

describe('GET /api/reports/dashboard pushQuotaTotal', () => {
  it('200 when EXTRA_PUSH is not active', async () => {
    used = 150;
    const d = await call(getDashboard, '/api/reports/dashboard');
    expect(d.pushQuotaTotal).toBe(200);
    expect(d.pushQuotaUsed).toBe(150);
  });
  it('700 when EXTRA_PUSH is active', async () => {
    extraActive = true;
    used = 150;
    expect((await call(getDashboard, '/api/reports/dashboard')).pushQuotaTotal).toBe(700);
  });
});

describe('GET /api/reports/dashboard-alerts pushQuotaExhausted', () => {
  it('without EXTRA_PUSH: exhausted at 200', async () => {
    used = 200;
    expect((await call(getAlerts, '/api/reports/dashboard-alerts')).pushQuotaExhausted).toBe(true);
  });
  it('with EXTRA_PUSH: 200 used is NOT exhausted, 700 is', async () => {
    extraActive = true;
    used = 200;
    expect((await call(getAlerts, '/api/reports/dashboard-alerts')).pushQuotaExhausted).toBe(false);
    used = 699;
    expect((await call(getAlerts, '/api/reports/dashboard-alerts')).pushQuotaExhausted).toBe(false);
    used = 700;
    expect((await call(getAlerts, '/api/reports/dashboard-alerts')).pushQuotaExhausted).toBe(true);
  });
});

describe('consumePushQuota keeps its 200 / 700 semantics', () => {
  it('free: blocks past 200', async () => {
    used = 199;
    expect(await consumePushQuota(TENANT_ID, 1)).toBe(true);
    used = 200;
    expect(await consumePushQuota(TENANT_ID, 1)).toBe(false);
  });
  it('EXTRA_PUSH: allows up to 700', async () => {
    extraActive = true;
    used = 650;
    expect(await consumePushQuota(TENANT_ID, 50)).toBe(true);
    used = 651;
    expect(await consumePushQuota(TENANT_ID, 50)).toBe(false);
  });
});
