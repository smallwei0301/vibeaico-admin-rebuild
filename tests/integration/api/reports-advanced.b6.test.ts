/**
 * B-6 進階報表與匯出整合測試
 * -----------------------------------------------------------------------------
 * 12 分冊 §4「Phase 5 / 5.5」矩陣：
 *   `tests/integration/api/reports-advanced.b6.test.ts` —
 *   「（2026-08-24 補列——原矩陣漏了 B-6，結果零測試也算通過 DoD 第 1 條）
 *    `/api/reports/summary` 正例、`/api/export/*` 各格式表頭/筆數、
 *    advanced/top-* 端點」
 * 契約出處：docs/integration/04-API-CONTRACTS.md §B-6。實作：
 * src/app/api/reports/{summary,advanced,top-services,top-products,top-staff}/route.ts、
 * src/app/api/export/{bookings,customers/excel,reports/[format]}/route.ts。
 *
 * 期望值怎麼來（重要，別改成弱斷言）：
 * 每一條都用 **service role 直查資料庫、在測試裡自行聚合** 當神諭（oracle），
 * 台北日界線的時窗算術也在本檔獨立實作（不 import src/server/tz.ts），這樣受測
 * 程式和期望值不會共用同一份實作。這是 reports.a5.test.ts 已經踩過的坑的沿用：
 * seed 的 start_at 是相對「seed 執行當下」的 now±N 小時，寫死數字會隨著跑測試
 * 的時刻（台北 19:00 之後）落到不同的「今天／本月」而假紅。
 *
 * 主要區間刻意用 **顯式的 from/to（今天 ±2 天）**，讓四筆種子預約必然落在區間內，
 * 與「本月」的月底邊界脫鉤；另外保留一條不帶參數的案例驗預設區間＝本月。
 *
 * 清理紀律：本檔**只讀**，不寫入任何資料列，因此不需要清理。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A, SHOP_B } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';
import type { StaffPerformance } from '@/lib/types';

const BASE = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };
const readJson = async <T = unknown>(res: Response): Promise<Envelope<T>> =>
  (await res.json()) as Envelope<T>;

/**
 * 讀 CSV 回應：BOM 必須看**原始位元組**。
 * `res.text()` 走 WHATWG 的 UTF-8 解碼，規格要求把開頭的 BOM 吃掉，所以
 * `(await res.text()).startsWith('﻿')` 永遠是 false——那樣寫驗到的是
 * fetch 的解碼行為，不是端點有沒有輸出 BOM。（本檔第一次實跑就是這樣紅的。）
 */
async function readCsv(res: Response): Promise<{ bom: boolean; text: string }> {
  const buf = Buffer.from(await res.arrayBuffer());
  const bom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  return { bom, text: buf.subarray(bom ? 3 : 0).toString('utf8') };
}

/* ------------------------------------------------ 台北時窗（本檔獨立實作） */

/** UTC 瞬間 → 台北牆上時鐘的 'YYYY-MM-DD' */
function taipeiYmd(ms: number): string {
  const t = new Date(ms + TAIPEI_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`;
}

/** 'YYYY-MM-DD'（台北）當天 00:00 的 UTC 毫秒；offsetDays 可位移天數 */
function taipeiDayStartMs(ymd: string, offsetDays = 0): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d + offsetDays) - TAIPEI_OFFSET_MS;
}

/** 當前台北月份的 [起, 迄) UTC 毫秒（對照各端點缺省區間＝本月） */
function taipeiMonthRangeMs(): { fromMs: number; toMs: number } {
  const t = new Date(Date.now() + TAIPEI_OFFSET_MS);
  const y = t.getUTCFullYear();
  const m = t.getUTCMonth();
  return {
    fromMs: Date.UTC(y, m, 1) - TAIPEI_OFFSET_MS,
    toMs: Date.UTC(y, m + 1, 1) - TAIPEI_OFFSET_MS,
  };
}

/* ------------------------------------------------------------ 神諭（oracle） */

type BookingRow = {
  customer_id: string; service_id: string; staff_id: string | null;
  status: string; final_price: number; start_at: string;
};

let admin: SupabaseClient;
let ownerA: AuthedApi;

/** 主要區間：今天 ±2 天（台北），四筆種子預約必然全部落在其中 */
let FROM = '';
let TO = '';
let fromMs = 0;
let toMs = 0;
const range = () => `from=${FROM}&to=${TO}`;

async function bookingsIn(fromMsArg: number, toMsArg: number): Promise<BookingRow[]> {
  const { data, error } = await admin.from('bookings')
    .select('customer_id, service_id, staff_id, status, final_price, start_at')
    .eq('tenant_id', SHOP_A.id)
    .gte('start_at', new Date(fromMsArg).toISOString())
    .lt('start_at', new Date(toMsArg).toISOString());
  expect(error).toBeNull();
  return ((data ?? []) as any[]).map((b) => ({ ...b, final_price: Number(b.final_price) }));
}

async function serviceNames(): Promise<Map<string, string>> {
  const { data, error } = await admin.from('services').select('id, name').eq('tenant_id', SHOP_A.id);
  expect(error).toBeNull();
  return new Map((data ?? []).map((s: any) => [s.id, s.name]));
}

async function activeCustomerCount(): Promise<number> {
  const { count, error } = await admin.from('customers')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', SHOP_A.id).eq('active', true);
  expect(error).toBeNull();
  return count ?? 0;
}

async function newCustomersIn(fromMsArg: number, toMsArg: number): Promise<number> {
  const { count, error } = await admin.from('customers')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', SHOP_A.id).eq('active', true)
    .gte('created_at', new Date(fromMsArg).toISOString())
    .lt('created_at', new Date(toMsArg).toISOString());
  expect(error).toBeNull();
  return count ?? 0;
}

/** summary 四格的期望值（口徑：營收/完成只算 COMPLETED） */
async function summaryOracle(a: number, b: number) {
  const rows = await bookingsIn(a, b);
  const completed = rows.filter((r) => r.status === 'COMPLETED');
  return {
    totalBookings: rows.length,
    totalRevenue: completed.reduce((s, r) => s + r.final_price, 0),
    completedBookings: completed.length,
    newCustomers: await newCustomersIn(a, b),
  };
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);

  const today = taipeiYmd(Date.now());
  FROM = taipeiYmd(taipeiDayStartMs(today, -2));
  TO = taipeiYmd(taipeiDayStartMs(today, 2));
  fromMs = taipeiDayStartMs(FROM);
  toMs = taipeiDayStartMs(TO, 1);              // 含 to 當天 → 半開區間 +1 天

  // 前提：種子的四筆預約真的落在這個區間裡（不成立的話下面的斷言驗不到東西）
  const rows = await bookingsIn(fromMs, toMs);
  expect(rows.length).toBeGreaterThanOrEqual(4);
});

describe('GET /api/reports/summary（04 §B-6）', () => {
  it('顯式區間：totalBookings／totalRevenue／completedBookings／newCustomers 與直查資料庫現算相符', async () => {
    const expected = await summaryOracle(fromMs, toMs);
    const res = await ownerA.get(`/api/reports/summary?${range()}`);
    expect(res.status).toBe(200);
    const body = await readJson<typeof expected>(res);
    expect(body.success).toBe(true);
    expect(body.data).toEqual(expected);

    // 神諭不是空的（否則 toEqual 兩邊都是 0，等於什麼都沒驗）
    expect(expected.totalBookings).toBeGreaterThanOrEqual(4);
    expect(expected.completedBookings).toBeGreaterThanOrEqual(1);
    expect(expected.totalRevenue).toBeGreaterThan(0);
  });

  it('不帶參數 → 預設區間＝本月（台北日界線）', async () => {
    const month = taipeiMonthRangeMs();
    const expected = await summaryOracle(month.fromMs, month.toMs);
    const res = await ownerA.get('/api/reports/summary');
    expect(res.status).toBe(200);
    expect((await readJson(res)).data).toEqual(expected);
  });

  it('區間內完全沒有預約（過去的一天）→ 四格皆 0，不是 404 也不是捏造值', async () => {
    const longAgo = taipeiYmd(Date.now() - 400 * DAY_MS);
    const res = await ownerA.get(`/api/reports/summary?from=${longAgo}&to=${longAgo}`);
    expect(res.status).toBe(200);
    expect((await readJson(res)).data).toEqual({
      totalBookings: 0, totalRevenue: 0, completedBookings: 0, newCustomers: 0,
    });
  });

  it('from 格式錯誤 → 400 REQ_001', async () => {
    const res = await ownerA.get('/api/reports/summary?from=2026/08/01');
    expect(res.status).toBe(400);
    expect((await readJson(res)).code).toBe('REQ_001');
  });

  it('未登入 → 401 AUTH_001', async () => {
    const res = await fetch(`${BASE}/api/reports/summary`);
    expect(res.status).toBe(401);
    expect((await readJson(res)).code).toBe('AUTH_001');
  });
});

describe('GET /api/reports/advanced（04 §B-6）', () => {
  it('totalCustomers／activeCustomers／avgVisitCycle／avgCustomerValue／serviceTrends 與直查現算相符', async () => {
    const rows = await bookingsIn(fromMs, toMs);
    const prevRows = await bookingsIn(fromMs - (toMs - fromMs), fromMs);
    const names = await serviceNames();

    // 活躍顧客 / 營收 / 回訪週期（COMPLETED 口徑）
    const visits = new Map<string, number[]>();
    let revenue = 0;
    for (const r of rows) {
      if (r.status !== 'COMPLETED') continue;
      revenue += r.final_price;
      visits.set(r.customer_id, [...(visits.get(r.customer_id) ?? []), Date.parse(r.start_at)]);
    }
    const activeCustomers = visits.size;
    let cycleSum = 0;
    let cycleCount = 0;
    for (const v of visits.values()) {
      if (v.length < 2) continue;
      v.sort((a, b) => a - b);
      cycleSum += (v[v.length - 1] - v[0]) / (v.length - 1) / DAY_MS;
      cycleCount += 1;
    }

    // 服務趨勢（不分狀態的預約數；growth 對比前一個等長區間）
    const curr = new Map<string, number>();
    for (const r of rows) curr.set(r.service_id, (curr.get(r.service_id) ?? 0) + 1);
    const prev = new Map<string, number>();
    for (const r of prevRows) prev.set(r.service_id, (prev.get(r.service_id) ?? 0) + 1);
    const serviceTrends = [...curr.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, bookings]) => {
        const p = prev.get(id) ?? 0;
        return {
          name: names.get(id),
          bookings,
          growth: p > 0 ? Math.round(((bookings - p) / p) * 1000) / 10 : bookings > 0 ? 100 : 0,
        };
      });

    const expected = {
      totalCustomers: await activeCustomerCount(),
      activeCustomers,
      avgVisitCycle: cycleCount > 0 ? Math.round(cycleSum / cycleCount) : 0,
      avgCustomerValue: activeCustomers > 0 ? Math.round(revenue / activeCustomers) : 0,
      serviceTrends,
    };

    const res = await ownerA.get(`/api/reports/advanced?${range()}`);
    expect(res.status).toBe(200);
    expect((await readJson(res)).data).toEqual(expected);

    expect(expected.totalCustomers).toBeGreaterThanOrEqual(3);
    expect(expected.serviceTrends.length).toBeGreaterThanOrEqual(1);
  });

  it('未登入 → 401 AUTH_001', async () => {
    const res = await fetch(`${BASE}/api/reports/advanced`);
    expect(res.status).toBe(401);
    expect((await readJson(res)).code).toBe('AUTH_001');
  });
});

describe('GET /api/reports/top-services（04 §B-6）', () => {
  it('依預約數排序取前 5；revenue 只計 COMPLETED', async () => {
    const rows = await bookingsIn(fromMs, toMs);
    const names = await serviceNames();
    const agg = new Map<string, { name: string; bookings: number; revenue: number }>();
    for (const r of rows) {
      const cur = agg.get(r.service_id) ?? { name: names.get(r.service_id)!, bookings: 0, revenue: 0 };
      cur.bookings += 1;
      if (r.status === 'COMPLETED') cur.revenue += r.final_price;
      agg.set(r.service_id, cur);
    }
    const expected = [...agg.values()]
      .sort((a, b) => b.bookings - a.bookings || b.revenue - a.revenue)
      .slice(0, 5);

    const res = await ownerA.get(`/api/reports/top-services?${range()}`);
    expect(res.status).toBe(200);
    expect((await readJson(res)).data).toEqual(expected);
    expect(expected.length).toBeGreaterThanOrEqual(1);
    expect(expected.some((s) => s.revenue > 0)).toBe(true);
  });
});

describe('GET /api/reports/top-products（04 §B-6）', () => {
  it('種子沒有已完成的商品訂單 → 回空陣列（誠實的「沒有資料」，不是捏造的名次）', async () => {
    const { data: items, error } = await admin.from('product_order_items')
      .select('product_id, product_orders!inner(status, created_at)')
      .eq('tenant_id', SHOP_A.id)
      .eq('product_orders.status', 'COMPLETED')
      .gte('product_orders.created_at', new Date(fromMs).toISOString())
      .lt('product_orders.created_at', new Date(toMs).toISOString());
    expect(error).toBeNull();
    expect(items ?? []).toHaveLength(0);          // 前提：確認資料庫真的沒有

    const res = await ownerA.get(`/api/reports/top-products?${range()}`);
    expect(res.status).toBe(200);
    expect((await readJson(res)).data).toEqual([]);
  });
});

describe('GET /api/reports/top-staff（04 §B-6）', () => {
  it('依營收排序取前 5；bookingCount 計全狀態、revenue 只計 COMPLETED', async () => {
    const rows = await bookingsIn(fromMs, toMs);
    const { data: staffRows, error } = await admin.from('staff')
      .select('id, name').eq('tenant_id', SHOP_A.id).eq('active', true);
    expect(error).toBeNull();

    const agg = new Map<string, { bookingCount: number; completed: number; revenue: number }>();
    for (const s of staffRows ?? []) agg.set(s.id, { bookingCount: 0, completed: 0, revenue: 0 });
    for (const r of rows) {
      if (!r.staff_id) continue;
      const a = agg.get(r.staff_id);
      if (!a) continue;
      a.bookingCount += 1;
      if (r.status === 'COMPLETED') { a.completed += 1; a.revenue += r.final_price; }
    }
    const expected: StaffPerformance[] = (staffRows ?? [])
      .map((s: any) => {
        const a = agg.get(s.id)!;
        return {
          staffId: s.id,
          staffName: s.name,
          bookingCount: a.bookingCount,
          completionRate: a.bookingCount > 0
            ? Math.round((a.completed / a.bookingCount) * 1000) / 10 : 0,
          revenue: a.revenue,
        };
      })
      .sort((a, b) => b.revenue - a.revenue || b.bookingCount - a.bookingCount)
      .slice(0, 5);

    const res = await ownerA.get(`/api/reports/top-staff?${range()}`);
    expect(res.status).toBe(200);
    expect((await readJson(res)).data).toEqual(expected);
    expect(expected.some((s) => s.bookingCount > 0)).toBe(true);
  });
});

describe('GET /api/export/bookings（04 §B-6，CSV 不走信封）', () => {
  it('表頭八欄、資料筆數等於資料庫筆數、UTF-8 BOM 與 attachment 標頭', async () => {
    const res = await ownerA.get('/api/export/bookings');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="bookings-\d{4}-\d{2}-\d{2}\.csv"/);
    expect(res.headers.get('cache-control')).toBe('no-store');

    const { bom, text: csv } = await readCsv(res);
    expect(bom).toBe(true);                          // UTF-8 BOM：Excel 開中文不亂碼
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('預約編號,預約時間,顧客姓名,顧客電話,服務,員工,金額,狀態');

    const { count, error } = await admin.from('bookings')
      .select('id', { count: 'exact', head: true }).eq('tenant_id', SHOP_A.id);
    expect(error).toBeNull();
    expect(lines.length - 1).toBe(count);                 // 表頭之外＝資料筆數
    expect(count).toBeGreaterThanOrEqual(4);

    // 狀態欄用的是頁面上那組中文，不是 DB 的英文 enum
    expect(csv).toContain('已完成');
  });

  it('帶 from/to → 只匯出區間內的筆數', async () => {
    const res = await ownerA.get(`/api/export/bookings?${range()}`);
    expect(res.status).toBe(200);
    const lines = (await readCsv(res)).text.trim().split('\r\n');
    expect(lines.length - 1).toBe((await bookingsIn(fromMs, toMs)).length);
  });

  it('未登入 → 401 AUTH_001', async () => {
    const res = await fetch(`${BASE}/api/export/bookings`);
    expect(res.status).toBe(401);
    expect((await readJson(res)).code).toBe('AUTH_001');
  });
});

describe('GET /api/export/customers/excel（04 §B-6）', () => {
  it('表頭八欄、筆數等於該店顧客數（含停用），檔名為 .csv 而非謊報 .xlsx', async () => {
    const res = await ownerA.get('/api/export/customers/excel');
    expect(res.status).toBe(200);
    // 路徑叫 excel 是沿用原站命名，但本專案沒有裝任何 xlsx 產生器——
    // 把 CSV 命名成 .xlsx 就是謊報格式（CLAUDE.md「不要製造假的已知」）。
    expect(res.headers.get('content-disposition')).toMatch(/filename="customers-\d{4}-\d{2}-\d{2}\.csv"/);
    expect(res.headers.get('content-type')).toContain('text/csv');

    const { bom, text: csv } = await readCsv(res);
    expect(bom).toBe(true);
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('姓名,LINE 顯示名稱,電話,Email,會員等級,預約次數,累計消費,狀態');

    const { count, error } = await admin.from('customers')
      .select('id', { count: 'exact', head: true }).eq('tenant_id', SHOP_A.id);
    expect(error).toBeNull();
    expect(lines.length - 1).toBe(count);
    expect(count).toBeGreaterThanOrEqual(3);
  });

  it('B 店匯出只有自己的顧客（跨租戶隔離）', async () => {
    const ownerB = await loginAs(SHOP_B.owner.email, SHOP_B.owner.password);
    const csv = await (await ownerB.get('/api/export/customers/excel')).text();
    expect(csv).not.toContain('顧客 A1（測試）');
  });
});

describe('GET /api/export/reports/:format（原站端點；csv 與 excel 內容相同）', () => {
  const SECTION_TITLES = ['營運報表', '營運總覽', '每日趨勢', '預約時段分布', '熱門服務 TOP 5', '熱門商品 TOP 10'];

  it('csv：五個區塊表頭齊全、統計區間正確、每日趨勢逐日補 0（區間天數）', async () => {
    const res = await ownerA.get(`/api/export/reports/csv?${range()}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toMatch(/filename="reports-\d{4}-\d{2}-\d{2}\.csv"/);

    const { bom, text: csv } = await readCsv(res);
    expect(bom).toBe(true);
    for (const title of SECTION_TITLES) expect(csv).toContain(title);
    expect(csv).toContain(`統計區間,${FROM} ~ ${TO}`);
    expect(csv).toContain('項目,數值');
    expect(csv).toContain('日期,預約數,營收');
    expect(csv).toContain('時段,預約數,尖峰');
    expect(csv).toContain('排名,服務名稱,預約數,營收');
    expect(csv).toContain('排名,商品名稱,銷售數量,營收');

    // 營運總覽四格與 /api/reports/summary 同一套口徑
    const expected = await summaryOracle(fromMs, toMs);
    expect(csv).toContain(`總預約數,${expected.totalBookings}`);
    expect(csv).toContain(`總營收,${expected.totalRevenue}`);
    expect(csv).toContain(`已完成預約,${expected.completedBookings}`);
    expect(csv).toContain(`新客戶,${expected.newCustomers}`);

    // 每日趨勢：逐日一列（含 0 的日子），列數 = 區間天數
    const lines = csv.trim().split('\r\n');
    const dailyStart = lines.indexOf('日期,預約數,營收') + 1;
    let dailyRows = 0;
    while (lines[dailyStart + dailyRows] && lines[dailyStart + dailyRows] !== '') dailyRows += 1;
    expect(dailyRows).toBe(Math.round((toMs - fromMs) / DAY_MS));
  });

  it('excel：與 csv 同樣的內容（本專案不產生真正的 xlsx，副檔名也誠實地是 .csv）', async () => {
    const csv = await (await ownerA.get(`/api/export/reports/csv?${range()}`)).text();
    const excel = await (await ownerA.get(`/api/export/reports/excel?${range()}`)).text();
    expect(excel).toBe(csv);
  });

  it('不支援的格式（pdf）→ 400 REQ_001', async () => {
    const res = await ownerA.get('/api/export/reports/pdf');
    expect(res.status).toBe(400);
    expect((await readJson(res)).code).toBe('REQ_001');
  });

  it('區間內完全沒有預約 → 時段分布留白而不是補一排 0', async () => {
    const longAgo = taipeiYmd(Date.now() - 400 * DAY_MS);
    const csv = await (await ownerA.get(`/api/export/reports/csv?from=${longAgo}&to=${longAgo}`)).text();
    expect(csv).toContain('（此區間無預約）');
  });

  it('未登入 → 401 AUTH_001', async () => {
    const res = await fetch(`${BASE}/api/export/reports/csv`);
    expect(res.status).toBe(401);
    expect((await readJson(res)).code).toBe('AUTH_001');
  });
});
