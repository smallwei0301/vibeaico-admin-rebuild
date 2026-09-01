/**
 * Inventory export acceptance — #28 item ⑤.
 *
 * This suite is intentionally not run during the bounded source slice while the
 * repository shared TEST integration lane is held by another PR. It is included
 * for the serialized exact-head TEST gate and cleans up every row it creates.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { SHOP_A } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

const BASE_URL = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';
type Envelope = { success: boolean; message?: string; code?: string };

let admin: SupabaseClient;
let ownerA: AuthedApi;
let productId: string;
let otherProductId: string;
const productName = `庫存匯出測試商品-${Date.now().toString(36)}`;
const otherProductName = `庫存匯出對照商品-${Date.now().toString(36)}`;

const LOG_ROWS = [
  { reason: 'PURCHASE_IN:第一批進貨', delta: 10, stock_after: 10, label: '進貨入庫', detail: '第一批進貨' },
  { reason: 'DAMAGE:破損,報廢兩件', delta: -2, stock_after: 8, label: '損耗報廢', detail: '破損,報廢兩件' },
  { reason: '沒有前綴的隨手備註', delta: -1, stock_after: 7, label: '手動調整', detail: '沒有前綴的隨手備註' },
];

async function insertProduct(name: string): Promise<string> {
  const id = randomUUID();
  const { error } = await admin.from('products').insert({
    id, tenant_id: SHOP_A.id, name, price: 100, stock: 7, safety_stock: 0,
  });
  expect(error).toBeNull();
  return id;
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') { current += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else current += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { cells.push(current); current = ''; }
    else current += char;
  }
  cells.push(current);
  return cells;
}

function rowsOf(csv: string, name: string): string[][] {
  return csv.split(/\r\n/).filter(Boolean).map(splitCsvLine).filter((cells) => cells[1] === name);
}

beforeAll(async () => {
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
  productId = await insertProduct(productName);
  otherProductId = await insertProduct(otherProductName);

  const { error } = await admin.from('inventory_logs').insert([
    ...LOG_ROWS.map((row) => ({
      tenant_id: SHOP_A.id, product_id: productId,
      delta: row.delta, stock_after: row.stock_after, reason: row.reason,
    })),
    {
      tenant_id: SHOP_A.id, product_id: otherProductId,
      delta: 5, stock_after: 5, reason: 'PURCHASE_IN:對照商品進貨',
    },
  ]);
  expect(error).toBeNull();
});

afterAll(async () => {
  for (const id of [productId, otherProductId]) {
    if (!id) continue;
    await admin.from('inventory_logs').delete().eq('product_id', id);
    await admin.from('products').delete().eq('id', id);
  }
});

describe('GET /api/export/inventory/:format', () => {
  it('returns a BOM CSV attachment without a success envelope', async () => {
    const res = await ownerA.get('/api/export/inventory/csv');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toMatch(
      /^attachment; filename="inventory-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(res.headers.get('cache-control')).toBe('no-store');

    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    const csv = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
    expect(csv.startsWith('\uFEFF時間,商品,異動類型,數量,異動前,異動後,原因,操作者')).toBe(true);
    expect(() => JSON.parse(csv)).toThrow();
  });

  it('uses the inventory table shape and shared mapper semantics', async () => {
    const csv = await (await ownerA.get('/api/export/inventory/csv')).text();
    const rows = rowsOf(csv, productName);
    expect(rows).toHaveLength(LOG_ROWS.length);
    for (const expected of LOG_ROWS) {
      const row = rows.find((cells) => cells[2] === expected.label);
      expect(row).toBeTruthy();
      expect(row![0]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
      expect(row![3]).toBe(String(expected.delta));
      expect(row![4]).toBe(String(expected.stock_after - expected.delta));
      expect(row![5]).toBe(String(expected.stock_after));
      expect(row![6]).toBe(expected.detail);
      expect(row![7]).toBe('系統');
    }
  });

  it('applies product and type filters, including unknown prefixes as MANUAL', async () => {
    const productCsv = await (await ownerA.get(
      `/api/export/inventory/csv?productId=${productId}`,
    )).text();
    expect(rowsOf(productCsv, productName)).toHaveLength(LOG_ROWS.length);
    expect(productCsv).not.toContain(otherProductName);

    const damageCsv = await (await ownerA.get(
      `/api/export/inventory/csv?productId=${productId}&type=DAMAGE`,
    )).text();
    expect(rowsOf(damageCsv, productName)).toHaveLength(1);
    expect(rowsOf(damageCsv, productName)[0][2]).toBe('損耗報廢');

    const manualCsv = await (await ownerA.get(
      `/api/export/inventory/csv?productId=${productId}&type=MANUAL`,
    )).text();
    expect(rowsOf(manualCsv, productName)[0][6]).toBe('沒有前綴的隨手備註');
  });

  it('keeps excel honest as a CSV and rejects invalid format/type', async () => {
    const excel = await ownerA.get('/api/export/inventory/excel');
    expect(excel.status).toBe(200);
    expect(excel.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(excel.headers.get('content-disposition')).toContain('.csv"');
    expect(excel.headers.get('content-disposition')).not.toContain('.xlsx');

    const invalidFormat = await ownerA.get('/api/export/inventory/pdf');
    expect(invalidFormat.status).toBe(400);
    expect((await invalidFormat.json() as Envelope).code).toBe('REQ_001');

    const invalidType = await ownerA.get('/api/export/inventory/csv?type=NOT_A_TYPE');
    expect(invalidType.status).toBe(400);
    expect((await invalidType.json() as Envelope).success).toBe(false);
  });

  it('requires authentication', async () => {
    const res = await fetch(`${BASE_URL}/api/export/inventory/csv`);
    expect(res.status).toBe(401);
    expect((await res.json() as Envelope).code).toBe('AUTH_001');
  });
});
