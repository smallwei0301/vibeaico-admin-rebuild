// Issue #942 — GUIDE 首頁統計卡改用 tour_orders 口徑，連結與快速操作依 MODE_PRESETS，警示失敗不顯示 0。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MODE_PRESETS } from '@/config/modes';
import { navLabel } from '@/i18n/zh-TW/nav';
import { sumNetReceived } from '@/server/dashboard-tour';

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), 'utf8');

let businessType: string | undefined = 'GUIDE';
const tablesQueried: string[] = [];
const filters: { table: string; op: string; args: unknown[] }[] = [];

function chain(table: string, result: { data?: unknown; count?: number }) {
  const r = { data: null, count: 0, error: null, ...result };
  const q: any = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'then') return (res: (v: unknown) => void) => res(r);
      if (prop === 'maybeSingle') return async () => r;
      return (...args: unknown[]) => { filters.push({ table, op: String(prop), args }); return q; };
    },
  });
  return q;
}
const rows: Record<string, { data?: unknown; count?: number }> = {
  tour_orders: { data: [{ paid_amount: 1000, refunded_amount: 200 }, { paid_amount: 500, refunded_amount: 900 }], count: 3 },
  bookings: { data: [{ final_price: 300 }, { final_price: 200 }], count: 2 },
  customers: { count: 4 },
  push_quota_usage: { data: { used: 1 } },
  tenant_settings: { data: { line_channel_access_token_enc: 'x', business: {} } },
};
const fakeSupabase = {
  from: (table: string) => {
    tablesQueried.push(table);
    return { select: () => chain(table, rows[table] ?? { data: [] }) };
  },
};
vi.mock('@/server/tenant', () => ({
  requireTenant: async () => ({ supabase: fakeSupabase, tenantId: 't1', user: { id: 'u' }, role: 'OWNER', businessType }),
}));
vi.mock('@/server/line', () => ({ pushQuotaLimit: async () => 200 }));

beforeEach(() => { tablesQueried.length = 0; filters.length = 0; });

describe('#942 dashboard route 依業態切換資料來源', () => {
  it('GUIDE：todayBookings／pending／monthRevenue 讀 tour_orders，不讀 bookings', async () => {
    businessType = 'GUIDE';
    const { GET } = await import('@/app/api/reports/dashboard/route');
    const res = await GET(new Request('http://x/api/reports/dashboard'), {} as never);
    const body = await res.json();
    expect(tablesQueried.filter((x) => x === 'tour_orders')).toHaveLength(3);
    expect(tablesQueried).not.toContain('bookings');
    expect(body.data.todayBookings).toBe(3);
    expect(body.data.pendingBookings).toBe(3);
    // Σ max(0, paid − refunded)：800 + 0
    expect(body.data.monthRevenue).toBe(800);
    const eqs = filters.filter((f) => f.table === 'tour_orders' && f.op === 'eq').map((f) => f.args.join('='));
    expect(eqs).toContain('status=PENDING');
    expect(eqs).toContain('trip_plans.sales_mode=REQUEST');
    expect(filters.some((f) => f.op === 'neq' && f.args.join('=') === 'status=CANCELLED')).toBe(true);
  });

  it('LOCAL_SHOP：仍讀 bookings，不讀 tour_orders', async () => {
    businessType = 'LOCAL_SHOP';
    const { GET } = await import('@/app/api/reports/dashboard/route');
    const res = await GET(new Request('http://x/api/reports/dashboard'), {} as never);
    const body = await res.json();
    expect(tablesQueried.filter((x) => x === 'bookings')).toHaveLength(3);
    expect(tablesQueried).not.toContain('tour_orders');
    expect(body.data.monthRevenue).toBe(500);
  });

  it('dashboard-alerts：GUIDE 未處理預約改查 tour_orders，LOCAL_SHOP 仍查 bookings', async () => {
    const { GET } = await import('@/app/api/reports/dashboard-alerts/route');
    businessType = 'GUIDE';
    await GET(new Request('http://x/api/reports/dashboard-alerts'), {} as never);
    expect(tablesQueried).toContain('tour_orders');
    expect(tablesQueried).not.toContain('bookings');
    tablesQueried.length = 0;
    businessType = 'LOCAL_SHOP';
    await GET(new Request('http://x/api/reports/dashboard-alerts'), {} as never);
    expect(tablesQueried).toContain('bookings');
    expect(tablesQueried).not.toContain('tour_orders');
  });

  it('sumNetReceived 扣退款、負值歸零、空值為 0', () => {
    expect(sumNetReceived(null)).toBe(0);
    expect(sumNetReceived([{ paid_amount: '100', refunded_amount: '30' }, { paid_amount: 10, refunded_amount: 50 }])).toBe(70);
  });
});

describe('#942 首頁連結依 MODE_PRESETS', () => {
  const page = read('src/app/tenant/dashboard/page.tsx');

  it('GUIDE preset 指向團體訂單與行程，標籤走 navLabel', () => {
    const g = MODE_PRESETS.GUIDE;
    expect(g.ordersHref).toBe('/tenant/tour-orders');
    expect(g.catalogHref).toBe('/tenant/trips');
    expect(g.dashboardLinks.pendingQuery).toBe('?status=PENDING');
    expect(navLabel(g.dashboardLinks.ordersNavKey, 'GUIDE')).toBe('旅遊訂單');
    expect(navLabel(g.dashboardLinks.catalogNavKey, 'GUIDE')).toBe('行程與方案');
    expect(MODE_PRESETS.LOCAL_SHOP.ordersHref).toBe('/tenant/bookings');
    expect(MODE_PRESETS.CLINIC.dashboardLinks.catalogNavKey).toBe('services');
  });

  it('頁面不再寫死 bookings／services 連結，也沒有業態 if 判斷', () => {
    // 所有 /tenant/bookings 字面出現處（任何引號、含 template literal）必須恰為下列固定連結：
    // 收件匣 BOOKING_* 兩顆標頭按鈕（跟項目種類）＋今日預約卡「查看全部」（資料源為 bookings）。
    const found = (page.match(/\/tenant\/bookings[^"'`\s>}]*/g) ?? []).sort();
    expect(found).toEqual([
      '/tenant/bookings',
      '/tenant/bookings?status=CONFIRMED&paymentStatus=UNPAID',
      '/tenant/bookings?status=PENDING',
    ].sort());
    expect(page).toContain('<Link href="/tenant/bookings" className="btn btn-primary btn-sm">');
    expect(page).not.toMatch(/href: '\/tenant\/services'/);
    expect(page).not.toMatch(/businessType\s*===\s*'/);
    expect(page).toContain('ordersHref');
    expect(page).toContain('catalogHref');
  });
});

describe('#942 警示載入失敗不顯示 0', () => {
  const page = read('src/app/tenant/dashboard/page.tsx');
  it('三張警示卡不再 `?? 0`，失敗時顯示錯誤文案', () => {
    expect(page).not.toMatch(/alerts\?\.(unprocessedBookings|lowStockProducts|atRiskCustomers) \?\? 0/);
    expect(page).toContain('setAlertsFailed(true)');
    expect(page).toContain('t.errors.alertValue');
  });
});

describe('#942 收件匣一般預約按鈕維持連到預約管理', () => {
  const page = read('src/app/tenant/dashboard/page.tsx');
  it('BOOKING_REQUEST／BOOKING_PAYMENT 標頭按鈕連 /tenant/bookings，不隨 ordersHref', () => {
    expect(page).toContain('<Link href="/tenant/bookings?status=PENDING" className="btn btn-outline min-h-11 text-md">');
    expect(page).toContain('<Link href="/tenant/bookings?status=CONFIRMED&paymentStatus=UNPAID" className="btn btn-outline min-h-11 text-md">');
  });
});
