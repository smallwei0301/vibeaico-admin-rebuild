/** Issue #15：報表匯出必須是報表內容，而不是顧客名單或預約列表。 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };
const BASE_URL = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';
const OFFSET = 8 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

let admin: SupabaseClient;
let ownerA: AuthedApi;

function dayMs(date: string, offsetDays = 0) {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d + offsetDays) - OFFSET;
}

function taipeiToday() {
  const now = new Date(Date.now() + OFFSET);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
}

const to = taipeiToday();
const from = (() => {
  const d = new Date(dayMs(to) - 6 * DAY + OFFSET);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
})();

async function summaryOracle() {
  const fromIso = new Date(dayMs(from)).toISOString();
  const toIso = new Date(dayMs(to, 1)).toISOString();
  const [{ data: bookings, error: bookingError }, { count, error: customerError }] = await Promise.all([
    admin.from('bookings').select('status, final_price')
      .eq('tenant_id', SHOP_A.id).gte('start_at', fromIso).lt('start_at', toIso),
    admin.from('customers').select('id', { count: 'exact', head: true })
      .eq('tenant_id', SHOP_A.id).eq('active', true).gte('created_at', fromIso).lt('created_at', toIso),
  ]);
  expect(bookingError).toBeNull();
  expect(customerError).toBeNull();
  let revenue = 0;
  let completed = 0;
  for (const booking of bookings ?? []) {
    if (booking.status === 'COMPLETED') {
      completed += 1;
      revenue += Number(booking.final_price);
    }
  }
  return { total: bookings?.length ?? 0, revenue, completed, customers: count ?? 0 };
}

function valueOf(csv: string, label: string) {
  const line = csv.split(/\r?\n/).find((value) => value.startsWith(`${label},`));
  expect(line, `CSV 找不到 ${label}`).toBeTruthy();
  return line!.slice(label.length + 1);
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
});

describe('GET /api/export/reports/:format', () => {
  it('csv：回真實報表 CSV、BOM 與附件檔名', async () => {
    const res = await ownerA.get(`/api/export/reports/csv?from=${from}&to=${to}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="reports-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('內容是五個報表區塊，且總覽數值與獨立 oracle 一致', async () => {
    const res = await ownerA.get(`/api/export/reports/csv?from=${from}&to=${to}`);
    const csv = await res.text();
    for (const section of ['營運總覽', '每日趨勢', '預約時段分布', '熱門服務 TOP 5', '熱門商品 TOP 10']) {
      expect(csv).toContain(section);
    }
    expect(csv).toContain(`統計區間,${from} ~ ${to}`);
    expect(csv).not.toContain('LINE 顯示名稱');
    expect(csv).not.toContain('預約編號');
    const oracle = await summaryOracle();
    expect(valueOf(csv, '總預約數')).toBe(String(oracle.total));
    expect(valueOf(csv, '總營收')).toBe(String(oracle.revenue));
    expect(valueOf(csv, '已完成預約')).toBe(String(oracle.completed));
    expect(valueOf(csv, '新客戶')).toBe(String(oracle.customers));
  });

  it('excel 選項仍回 CSV；不支援格式 400；未登入 401', async () => {
    const excel = await ownerA.get(`/api/export/reports/excel?from=${from}&to=${to}`);
    expect(excel.status).toBe(200);
    expect(excel.headers.get('content-disposition')).toContain('.csv"');
    expect(excel.headers.get('content-disposition')).not.toContain('.xlsx');
    expect(await excel.text()).toContain('營運總覽');

    const invalid = await ownerA.get('/api/export/reports/pdf');
    expect(invalid.status).toBe(400);
    expect((await invalid.json() as Envelope).success).toBe(false);

    const unauthenticated = await fetch(`${BASE_URL}/api/export/reports/csv`);
    expect(unauthenticated.status).toBe(401);
  });
});
