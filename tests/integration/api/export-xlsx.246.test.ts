// issue #246 —— 三處「匯出 Excel」在此之前產出的是 CSV。
//
// 這支測試刻意不只看 header：header 說 xlsx 而 body 是 CSV，正是本 issue 要修的
// 那種缺陷，只驗 Content-Type 會再一次放它過去。所以每個格式都額外驗
//   ① 前 4 bytes 是 ZIP 魔數 50 4B 03 04（xlsx 就是一個 zip 容器）
//   ② 用 exceljs 真的讀回來，表頭與資料列對得上
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A, SHOP_B } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

let admin: SupabaseClient;
let ownerA: AuthedApi;
let productA = '';
let productB = '';
const productNameA = `xlsx匯出-${Date.now().toString(36)}-A`;
const productNameB = `xlsx匯出-${Date.now().toString(36)}-B`;

/** 讀回工作表，回傳 [表頭, ...資料列]，每格保留原始型別。 */
async function readSheet(buffer: ArrayBuffer): Promise<{
  sheetName: string;
  rows: unknown[][];
  formulaCells: string[];
}> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  const rows: unknown[][] = [];
  const formulaCells: string[] = [];
  sheet.eachRow((row) => {
    const cells: unknown[] = [];
    row.eachCell({ includeEmpty: true }, (cell) => {
      // 任何被存成公式的格子都要抓出來——字串一旦被當公式，就是注入面。
      if (cell.type === ExcelJS.ValueType.Formula) formulaCells.push(String(cell.address));
      cells.push(cell.value);
    });
    rows.push(cells);
  });
  return { sheetName: sheet.name, rows, formulaCells };
}

function assertRealXlsx(bytes: Uint8Array): void {
  // xlsx 是 zip 容器；CSV 或 JSON 都不會以這四個 byte 開頭。
  expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  // 順帶排除「其實是帶 BOM 的 CSV」這個具體的舊行為。
  expect([bytes[0], bytes[1], bytes[2]]).not.toEqual([0xef, 0xbb, 0xbf]);
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
    { id: productA, tenant_id: SHOP_A.id, name: productNameA, price: 100, stock: 8, safety_stock: 0 },
    { id: productB, tenant_id: SHOP_B.id, name: productNameB, price: 100, stock: 3, safety_stock: 0 },
  ]);
  expect(productError).toBeNull();

  const { error: logError } = await admin.from('inventory_logs').insert([
    { tenant_id: SHOP_A.id, product_id: productA, delta: 10, stock_after: 10, reason: 'PURCHASE_IN:第一批進貨' },
    { tenant_id: SHOP_A.id, product_id: productA, delta: -2, stock_after: 8, reason: 'DAMAGE:破損,報廢兩件' },
    { tenant_id: SHOP_A.id, product_id: productA, delta: -1, stock_after: 7, reason: '=SUM(1,1)' },
    { tenant_id: SHOP_B.id, product_id: productB, delta: 3, stock_after: 3, reason: 'PURCHASE_IN:另一租戶資料' },
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

describe('GET /api/export/customers/excel (#246)', () => {
  it('回的是真正的 xlsx，不是換了副檔名的 CSV', async () => {
    const response = await ownerA.get('/api/export/customers/excel');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(XLSX_MIME);
    expect(response.headers.get('content-disposition')).toMatch(
      /^attachment; filename="customers-\d{4}-\d{2}-\d{2}\.xlsx"$/,
    );
    expect(response.headers.get('cache-control')).toBe('no-store');

    const buffer = await response.arrayBuffer();
    assertRealXlsx(new Uint8Array(buffer));

    // 不走 { success, data } 信封。
    expect(() => JSON.parse(new TextDecoder().decode(buffer))).toThrow();
  });

  it('表頭與資料列讀得回來，且不是空活頁簿', async () => {
    const response = await ownerA.get('/api/export/customers/excel');
    const { sheetName, rows, formulaCells } = await readSheet(await response.arrayBuffer());

    expect(sheetName).toBe('顧客名單');
    expect(rows[0]).toEqual([
      '姓名', 'LINE 顯示名稱', '電話', 'Email', '會員等級', '預約次數', '累計消費', '狀態',
    ]);
    expect(rows.length).toBeGreaterThan(1);
    expect(formulaCells).toEqual([]);

    // 種子顧客真的在裡面——排除「表頭對了但一列資料都沒有」。
    const names = rows.slice(1).map((row) => row[0]);
    expect(names).toContain('顧客 A1（測試）');

    // 換成 xlsx 之後數字欄是真的數字，不是文字。CSV 版本做不到這件事。
    const seeded = rows.slice(1).find((row) => row[0] === '顧客 A1（測試）')!;
    expect(typeof seeded[5]).toBe('number');
    expect(typeof seeded[6]).toBe('number');
    expect(['正常', '流失風險', '已停用']).toContain(seeded[7]);
  });

  it('不外洩其他租戶的顧客', async () => {
    const response = await ownerA.get('/api/export/customers/excel');
    const { rows } = await readSheet(await response.arrayBuffer());
    const names = rows.slice(1).map((row) => String(row[0] ?? ''));
    expect(names.some((name) => name.includes('顧客 B'))).toBe(false);
  });
});

describe('GET /api/export/inventory/xlsx (#246 / 14-GAP-AUDIT §8.5)', () => {
  it('§8.5 的 Excel 半邊存在，且是真正的 xlsx', async () => {
    const response = await ownerA.get(`/api/export/inventory/xlsx?productId=${productA}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(XLSX_MIME);
    expect(response.headers.get('content-disposition')).toMatch(
      /^attachment; filename="inventory-\d{4}-\d{2}-\d{2}\.xlsx"$/,
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
    assertRealXlsx(new Uint8Array(await response.arrayBuffer()));
  });

  it('欄位與 CSV 分支逐欄相同，篩選同樣生效，且不外洩其他租戶', async () => {
    const response = await ownerA.get(`/api/export/inventory/xlsx?productId=${productA}`);
    const { sheetName, rows } = await readSheet(await response.arrayBuffer());

    expect(sheetName).toBe('庫存異動');
    expect(rows[0]).toEqual([
      '時間', '商品', '異動類型', '數量', '異動前', '異動後', '原因', '操作者',
    ]);

    const body = rows.slice(1).filter((row) => row[1] === productNameA);
    expect(body).toHaveLength(3);
    expect(rows.slice(1).some((row) => row[1] === productNameB)).toBe(false);

    const damage = body.find((row) => row[2] === '損耗報廢')!;
    expect(damage).toBeTruthy();
    // 數量欄在 xlsx 是數字型別；CSV 版本這裡是字串 '-2'。
    expect(damage[3]).toBe(-2);
    expect(damage[4]).toBe(10);
    expect(damage[5]).toBe(8);
    expect(damage[6]).toBe('破損,報廢兩件');
    expect(damage[7]).toBe('系統');
  });

  it('使用者可控字串不會變成公式格', async () => {
    const response = await ownerA.get(`/api/export/inventory/xlsx?productId=${productA}&type=MANUAL`);
    const { rows, formulaCells } = await readSheet(await response.arrayBuffer());

    const body = rows.slice(1).filter((row) => row[1] === productNameA);
    expect(body).toHaveLength(1);
    // xlsx 的字串格不是公式，所以這裡是原字串——CSV 分支才需要那個 ' 前綴。
    expect(body[0][6]).toBe('=SUM(1,1)');
    expect(formulaCells).toEqual([]);
  });

  it('CSV 分支的既有契約完全沒變', async () => {
    const response = await ownerA.get(`/api/export/inventory/csv?productId=${productA}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('content-disposition')).toMatch(
      /^attachment; filename="inventory-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    // CSV 分支仍以 ' 前綴中和公式；這條與 #150 的既有斷言重複是刻意的，
    // 因為 #246 的重構讓兩個分支共用同一份攤平結果，得證明沒有波及 CSV。
    const csv = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
    expect(csv).toContain("'=SUM(1,1)");
  });

  it('白名單之外的格式仍然 400', async () => {
    const response = await ownerA.get('/api/export/inventory/excel');
    expect(response.status).toBe(400);
    expect(((await response.json()) as { success: boolean }).success).toBe(false);
  });
});
