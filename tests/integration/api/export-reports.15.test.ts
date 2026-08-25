/**
 * 營運報表匯出整合測試 — GitHub issue #15（修復-7）第 ③ 項。
 *
 * 修改前：reports 頁的 runExport() 把 xlsx 選項導到 /api/export/customers/excel
 * （顧客名單）、csv 選項導到 /api/export/bookings（預約列表），卻 toast
 * 「匯出成功：營運報表_日期.xlsx」——**檔名宣稱是報表，內容不是**。
 *
 * 補齊：GET /api/export/reports/:format（原站端點，見 docs/specs/reports.json
 * 的 jsApiCalls），匯出的是 reports 頁畫面上的統計。
 *
 * 本檔驗證：
 *   ① Content-Type / Content-Disposition / UTF-8 BOM（慣例同其他 /api/export/*）
 *   ② 內容是**報表統計**而不是顧客名單或預約列表：五個區塊標題都在，
 *      營運總覽的四個數字與「以 service role 直查 seed 資料獨立算出的期望值」相符
 *   ③ format 只收 csv / excel，其他值 400
 *   ④ 未登入 → 401（跟其他匯出端點一樣要租戶身分）
 *
 * 期望值採獨立神諭（oracle）：不 import src/server/tz.ts，測試自己用固定 +08:00
 * 算台北日界線，再直查 bookings/customers 得出應有的數字（同 reports.a5 的作法）。
 * 清理紀律：本檔只讀，不寫入任何資料，不需要清理。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

const BASE_URL = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

let admin: SupabaseClient;
let ownerA: AuthedApi;

/** 台北時區的今天（YYYY-MM-DD），用來組固定的 ?from&to 區間 */
function taipeiToday(): string {
  const t = new Date(Date.now() + TAIPEI_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`;
}

function taipeiDayMs(ymd: string, offsetDays = 0): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d + offsetDays) - TAIPEI_OFFSET_MS;
}

/** 測試區間：今天往前 6 天 ~ 今天（含），共 7 天 */
const to = taipeiToday();
const from = (() => {
  const ms = taipeiDayMs(to) - 6 * DAY_MS;
  const t = new Date(ms + TAIPEI_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`;
})();

/** 獨立神諭：直查 DB 算出這個區間應有的營運總覽四格 */
async function summaryOracle() {
  const fromIso = new Date(taipeiDayMs(from)).toISOString();
  const toIso = new Date(taipeiDayMs(to, 1)).toISOString();

  const { data: bookings, error: e1 } = await admin
    .from('bookings')
    .select('status, final_price')
    .eq('tenant_id', SHOP_A.id)
    .gte('start_at', fromIso)
    .lt('start_at', toIso);
  expect(e1).toBeNull();

  const { count: newCustomers, error: e2 } = await admin
    .from('customers')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', SHOP_A.id)
    .eq('active', true)
    .gte('created_at', fromIso)
    .lt('created_at', toIso);
  expect(e2).toBeNull();

  let totalRevenue = 0;
  let completedBookings = 0;
  for (const b of bookings ?? []) {
    if (b.status === 'COMPLETED') {
      completedBookings += 1;
      totalRevenue += Number(b.final_price);
    }
  }
  return {
    totalBookings: (bookings ?? []).length,
    totalRevenue,
    completedBookings,
    newCustomers: newCustomers ?? 0,
  };
}

/** 從 CSV 取「第一欄 = label」那一列的第二欄 */
function valueOf(csv: string, label: string): string {
  const line = csv.split(/\r?\n/).find((l) => l.startsWith(`${label},`));
  expect(line, `CSV 找不到「${label}」列`).toBeTruthy();
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

describe('GET /api/export/reports/:format（issue #15 ③）', () => {
  it('csv：回 text/csv + attachment 檔名 + UTF-8 BOM，不走 { success, data } 信封', async () => {
    const res = await ownerA.get(`/api/export/reports/csv?from=${from}&to=${to}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toMatch(
      /^attachment; filename="reports-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(res.headers.get('cache-control')).toBe('no-store');

    // BOM 必須驗**位元組**：Response.text() 依 WHATWG 規範會把開頭的 BOM 吃掉，
    // 用 charCodeAt(0) 永遠看不到它（第一次寫這條斷言就是這樣假紅的）。
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM

    // ignoreBOM: true —— 預設的 TextDecoder 也會吃掉 BOM，這裡要留著才驗得到
    const csv = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
    expect(csv.startsWith('\uFEFF營運報表')).toBe(true);
    expect(() => JSON.parse(csv)).toThrow(); // 不是信封，是檔案
  });

  it('內容是「報表統計」而不是顧客名單／預約列表：五個區塊都在', async () => {
    const res = await ownerA.get(`/api/export/reports/csv?from=${from}&to=${to}`);
    const csv = await res.text();

    for (const section of ['營運總覽', '每日趨勢', '預約時段分布', '熱門服務 TOP 5', '熱門商品 TOP 10']) {
      expect(csv, `CSV 缺少區塊「${section}」`).toContain(section);
    }
    expect(csv).toContain(`統計區間,${from} ~ ${to}`);

    // 反向確認：不是顧客名單（customers/excel 的表頭）也不是預約列表（bookings 的表頭）
    expect(csv).not.toContain('LINE 顯示名稱');
    expect(csv).not.toContain('預約編號');
  });

  it('營運總覽四格＝以 service role 直查資料獨立算出的期望值', async () => {
    const oracle = await summaryOracle();
    const res = await ownerA.get(`/api/export/reports/csv?from=${from}&to=${to}`);
    const csv = await res.text();

    expect(valueOf(csv, '總預約數')).toBe(String(oracle.totalBookings));
    expect(valueOf(csv, '總營收')).toBe(String(oracle.totalRevenue));
    expect(valueOf(csv, '已完成預約')).toBe(String(oracle.completedBookings));
    expect(valueOf(csv, '新客戶')).toBe(String(oracle.newCustomers));
  });

  it('每日趨勢逐日補 0：區間 7 天就有 7 列', async () => {
    const res = await ownerA.get(`/api/export/reports/csv?from=${from}&to=${to}`);
    const csv = await res.text();
    const lines = csv.split(/\r?\n/);
    const start = lines.findIndex((l) => l === '日期,預約數,營收');
    expect(start).toBeGreaterThan(-1);
    const dayRows: string[] = [];
    for (let i = start + 1; i < lines.length && lines[i] !== ''; i += 1) dayRows.push(lines[i]);
    expect(dayRows).toHaveLength(7);
    expect(dayRows[0]).toMatch(/^\d{2}\/\d{2},\d+,\d+$/);
  });

  it('excel 也可下載（原站的兩個選項）；內容同樣是 CSV、檔名副檔名誠實為 .csv', async () => {
    const res = await ownerA.get(`/api/export/reports/excel?from=${from}&to=${to}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toContain('.csv"');
    expect(res.headers.get('content-disposition')).not.toContain('.xlsx');
    expect(await res.text()).toContain('營運總覽');
  });

  it('不支援的 format → 400', async () => {
    const res = await ownerA.get(`/api/export/reports/pdf?from=${from}&to=${to}`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean; message?: string };
    expect(body.success).toBe(false);
  });

  it('未登入 → 401', async () => {
    const res = await fetch(`${BASE_URL}/api/export/reports/csv`);
    expect(res.status).toBe(401);
  });
});
