import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A, SHOP_B } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

const BASE_URL = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';

type Envelope = { success: boolean; code?: string };

let admin: SupabaseClient;
let ownerA: AuthedApi;
let productA = '';
let productB = '';
const productNameA = `庫存匯出-${Date.now().toString(36)}-A`;
const productNameB = `庫存匯出-${Date.now().toString(36)}-B`;

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quoted) {
      if (character === '"' && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        current += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      cells.push(current);
      current = '';
    } else {
      current += character;
    }
  }
  cells.push(current);
  return cells;
}

function rowsFor(csv: string, productName: string): string[][] {
  return csv
    .replace(/^\uFEFF/, '')
    .split(/\r\n/)
    .filter(Boolean)
    .map(splitCsvLine)
    .filter((row) => row[1] === productName);
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

  productA = randomUUID();
  productB = randomUUID();
  const { error: productError } = await admin.from('products').insert([
    {
      id: productA,
      tenant_id: SHOP_A.id,
      name: productNameA,
      price: 100,
      stock: 8,
      safety_stock: 0,
    },
    {
      id: productB,
      tenant_id: SHOP_B.id,
      name: productNameB,
      price: 100,
      stock: 3,
      safety_stock: 0,
    },
  ]);
  expect(productError).toBeNull();

  const { error: logError } = await admin.from('inventory_logs').insert([
    {
      tenant_id: SHOP_A.id,
      product_id: productA,
      delta: 10,
      stock_after: 10,
      reason: 'PURCHASE_IN:第一批進貨',
    },
    {
      tenant_id: SHOP_A.id,
      product_id: productA,
      delta: -2,
      stock_after: 8,
      reason: 'DAMAGE:破損,報廢兩件',
    },
    {
      tenant_id: SHOP_A.id,
      product_id: productA,
      delta: -1,
      stock_after: 7,
      reason: '=SUM(1,1)',
    },
    {
      tenant_id: SHOP_B.id,
      product_id: productB,
      delta: 3,
      stock_after: 3,
      reason: 'PURCHASE_IN:另一租戶資料',
    },
  ]);
  expect(logError).toBeNull();
});

afterAll(async () => {
  for (const productId of [productA, productB]) {
    if (!productId) continue;
    await admin.from('inventory_logs').delete().eq('product_id', productId);
    await admin.from('products').delete().eq('id', productId);
  }
});

describe('GET /api/export/inventory/csv (#150)', () => {
  it('returns an attachment with UTF-8 BOM and no JSON envelope', async () => {
    const response = await ownerA.get('/api/export/inventory/csv');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('content-disposition')).toMatch(
      /^attachment; filename="inventory-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(response.headers.get('cache-control')).toBe('no-store');

    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    const csv = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
    expect(csv.startsWith('\uFEFF時間,商品,異動類型,數量,異動前,異動後,原因,操作者')).toBe(true);
    expect(() => JSON.parse(csv)).toThrow();
  });

  it('uses the shared mapper and never leaks another tenant', async () => {
    const csv = await (await ownerA.get(`/api/export/inventory/csv?productId=${productA}`)).text();
    const rows = rowsFor(csv, productNameA);
    expect(rows).toHaveLength(3);
    expect(csv).not.toContain(productNameB);

    const damage = rows.find((row) => row[2] === '損耗報廢');
    expect(damage).toBeTruthy();
    expect(damage![3]).toBe('-2');
    expect(damage![4]).toBe('10');
    expect(damage![5]).toBe('8');
    expect(damage![6]).toBe('破損,報廢兩件');
    expect(damage![7]).toBe('系統');
  });

  it('applies current filters and neutralizes spreadsheet formulas', async () => {
    const response = await ownerA.get(
      `/api/export/inventory/csv?productId=${productA}&type=MANUAL`,
    );
    expect(response.status).toBe(200);
    const rows = rowsFor(await response.text(), productNameA);
    expect(rows).toHaveLength(1);
    expect(rows[0][2]).toBe('手動調整');
    expect(rows[0][6]).toBe("'=SUM(1,1)");
  });

  it('rejects unsupported formats and unknown types', async () => {
    const formatResponse = await ownerA.get('/api/export/inventory/excel');
    expect(formatResponse.status).toBe(400);
    expect(((await formatResponse.json()) as Envelope).success).toBe(false);

    const typeResponse = await ownerA.get('/api/export/inventory/csv?type=UNKNOWN');
    expect(typeResponse.status).toBe(400);
    expect(((await typeResponse.json()) as Envelope).success).toBe(false);
  });

  it('requires login and the INVENTORY feature', async () => {
    const unauthenticated = await fetch(`${BASE_URL}/api/export/inventory/csv`);
    expect(unauthenticated.status).toBe(401);

    const { error: disableError } = await admin
      .from('feature_subscriptions')
      .update({ active: false })
      .eq('tenant_id', SHOP_A.id)
      .eq('code', 'INVENTORY');
    expect(disableError).toBeNull();

    try {
      const response = await ownerA.get('/api/export/inventory/csv');
      expect(response.status).toBe(403);
      expect(((await response.json()) as Envelope).success).toBe(false);
    } finally {
      const { error: enableError } = await admin
        .from('feature_subscriptions')
        .update({ active: true })
        .eq('tenant_id', SHOP_A.id)
        .eq('code', 'INVENTORY');
      expect(enableError).toBeNull();
    }
  });
});
