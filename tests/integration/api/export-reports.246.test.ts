/**
 * 營運報表匯出回歸：#246 reopen repair。
 *
 * Retained baseline 來自歷史 export-reports.15.test.ts；本版把當年
 * 「excel 也誠實回 CSV」的暫時行為升級為真正 xlsx，其餘資料口徑保持不變。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import ExcelJS from 'exceljs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

const BASE_URL = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

let admin: SupabaseClient;
let ownerA: AuthedApi;

function taipeiToday(): string {
  const t = new Date(Date.now() + TAIPEI_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`;
}

function taipeiDayMs(ymd: string, offsetDays = 0): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d + offsetDays) - TAIPEI_OFFSET_MS;
}

const to = taipeiToday();
const from = (() => {
  const ms = taipeiDayMs(to) - 6 * DAY_MS;
  const t = new Date(ms + TAIPEI_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`;
})();

async function summaryOracle() {
  const fromIso = new Date(taipeiDayMs(from)).toISOString();
  const toIso = new Date(taipeiDayMs(to, 1)).toISOString();

  const { data: bookings, error: bookingError } = await admin
    .from('bookings')
    .select('status, final_price')
    .eq('tenant_id', SHOP_A.id)
    .gte('start_at', fromIso)
    .lt('start_at', toIso);
  expect(bookingError).toBeNull();

  const { count: newCustomers, error: customerError } = await admin
    .from('customers')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', SHOP_A.id)
    .eq('active', true)
    .gte('created_at', fromIso)
    .lt('created_at', toIso);
  expect(customerError).toBeNull();

  let totalRevenue = 0;
  let completedBookings = 0;
  for (const booking of bookings ?? []) {
    if (booking.status === 'COMPLETED') {
      completedBookings += 1;
      totalRevenue += Number(booking.final_price);
    }
  }

  return {
    totalBookings: (bookings ?? []).length,
    totalRevenue,
    completedBookings,
    newCustomers: newCustomers ?? 0,
  };
}

function valueOf(csv: string, label: string): string {
  const line = csv.split(/\r?\n/).find((candidate) => candidate.startsWith(`${label},`));
  expect(line, `CSV 找不到「${label}」列`).toBeTruthy();
  return line!.slice(label.length + 1);
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  admin = createClient(
    process.env.TEST_SUPABASE_URL!,
    process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
});

describe('GET /api/export/reports/:format (#246)', () => {
  it('csv is a real report attachment with BOM and no JSON envelope', async () => {
    const res = await ownerA.get(`/api/export/reports/csv?from=${from}&to=${to}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toMatch(
      /^attachment; filename="reports-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(res.headers.get('cache-control')).toBe('no-store');

    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    const csv = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
    expect(csv.startsWith('\uFEFF營運報表')).toBe(true);
    expect(() => JSON.parse(csv)).toThrow();
  });

  it('csv contains the five report sections, not customer or booking-list exports', async () => {
    const res = await ownerA.get(`/api/export/reports/csv?from=${from}&to=${to}`);
    const csv = await res.text();

    for (const section of [
      '營運總覽',
      '每日趨勢',
      '預約時段分布',
      '熱門服務 TOP 5',
      '熱門商品 TOP 10',
    ]) {
      expect(csv).toContain(section);
    }
    expect(csv).toContain(`統計區間,${from} ~ ${to}`);
    expect(csv).not.toContain('LINE 顯示名稱');
    expect(csv).not.toContain('預約編號');
  });

  it('summary values match an independent service-role DB oracle', async () => {
    const oracle = await summaryOracle();
    const res = await ownerA.get(`/api/export/reports/csv?from=${from}&to=${to}`);
    const csv = await res.text();

    expect(valueOf(csv, '總預約數')).toBe(String(oracle.totalBookings));
    expect(valueOf(csv, '總營收')).toBe(String(oracle.totalRevenue));
    expect(valueOf(csv, '已完成預約')).toBe(String(oracle.completedBookings));
    expect(valueOf(csv, '新客戶')).toBe(String(oracle.newCustomers));
  });

  it('daily trend contains exactly seven rows for a seven-day range', async () => {
    const res = await ownerA.get(`/api/export/reports/csv?from=${from}&to=${to}`);
    const csv = await res.text();
    const lines = csv.split(/\r?\n/);
    const start = lines.findIndex((line) => line === '日期,預約數,營收');
    expect(start).toBeGreaterThan(-1);
    const dayRows: string[] = [];
    for (let i = start + 1; i < lines.length && lines[i] !== ''; i += 1) dayRows.push(lines[i]);
    expect(dayRows).toHaveLength(7);
    expect(dayRows[0]).toMatch(/^\d{2}\/\d{2},\d+,\d+$/);
  });

  it('excel returns a real xlsx carrying the same report sections', async () => {
    const res = await ownerA.get(`/api/export/reports/excel?from=${from}&to=${to}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(res.headers.get('content-disposition')).toMatch(
      /^attachment; filename="reports-\d{4}-\d{2}-\d{2}\.xlsx"$/,
    );

    const bytes = Buffer.from(await res.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect([bytes[0], bytes[1], bytes[2]]).not.toEqual([0xef, 0xbb, 0xbf]);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    );
    const sheet = workbook.worksheets[0];
    expect(sheet.name).toBe('營運報表');

    const textCells: string[] = [];
    const formulaCells: unknown[] = [];
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        if (cell.value && typeof cell.value === 'object' && 'formula' in cell.value) {
          formulaCells.push(cell.value);
        }
        textCells.push(String(cell.value ?? ''));
      });
    });
    for (const section of [
      '營運總覽',
      '每日趨勢',
      '預約時段分布',
      '熱門服務 TOP 5',
      '熱門商品 TOP 10',
    ]) {
      expect(textCells).toContain(section);
    }
    expect(textCells).not.toContain('LINE 顯示名稱');
    expect(textCells).not.toContain('預約編號');
    expect(formulaCells).toEqual([]);
  });

  it('unsupported format is rejected with 400', async () => {
    const res = await ownerA.get(`/api/export/reports/pdf?from=${from}&to=${to}`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(false);
  });

  it('unauthenticated report export is rejected with 401', async () => {
    const res = await fetch(`${BASE_URL}/api/export/reports/csv`);
    expect(res.status).toBe(401);
  });
});
