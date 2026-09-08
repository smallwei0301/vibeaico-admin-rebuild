// issue #33 第 ③ 筆的 excel 半邊。
//
// 這一格原本標為「永久留白」，理由是「本專案沒有安裝任何 xlsx 產生器」。那個理由
// 在 #246 之後不成立了；但原本那句判斷（把 CSV 命名成 .xlsx 是謊報檔案格式）仍然
// 成立，所以這支測試沿用 #246 的作法：**不只看 header**。header 說 xlsx 而 body
// 是 CSV，正是要防的那種缺陷，只驗 Content-Type 會再一次放它過去。
//
// 每個案例都額外驗：① 前 4 bytes 是 ZIP 魔數（xlsx 就是一個 zip 容器）；
// ② 用 exceljs 真的讀回來，表頭與資料列對得上。
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A, SHOP_B } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const HEADERS = ['預約編號', '預約時間', '顧客姓名', '顧客電話', '服務', '員工', '金額', '狀態'];

let admin: SupabaseClient;
let ownerA: AuthedApi;

const stamp = Date.now().toString(36);
/** 顧客姓名是顧客自己填的 → 攻擊者可控。刻意用會被 Excel 當公式的字串。 */
const customerNameA = `=SUM(1,1)匯出${stamp}`;
const customerNameB = `他店顧客${stamp}`;
const bookingNoA = `EXP-${stamp}-A`;
const bookingNoB = `EXP-${stamp}-B`;
const createdCustomers: string[] = [];
const createdBookings: string[] = [];
const createdServices: string[] = [];

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
      if (cell.type === ExcelJS.ValueType.Formula) formulaCells.push(String(cell.address));
      cells.push(cell.value);
    });
    rows.push(cells);
  });
  return { sheetName: sheet.name, rows, formulaCells };
}

function assertRealXlsx(bytes: Uint8Array): void {
  expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  // 順帶排除「其實是帶 BOM 的 CSV」這個具體的舊行為。
  expect([bytes[0], bytes[1], bytes[2]]).not.toEqual([0xef, 0xbb, 0xbf]);
}

/**
 * `services` 上有**兩個**同租戶唯一索引（`0065_issue_128_services_order_invariants.sql`）：
 * `services_tenant_sort_order_uq (tenant_id, sort_order)` 與
 * `services_tenant_line_sort_order_uq (tenant_id, line_sort_order)`。兩欄的預設值都是
 * 0，而種子資料已經佔用了 0——任一欄不指定都會撞 23505。
 *
 * 前兩輪 CI 各紅一次就是這樣來的：第一輪只補了 `sort_order`，第二輪才被
 * `line_sort_order` 抓到。教訓是別一次猜一個約束——直接查 migration 把該表的唯一
 * 索引一次列全（`grep -n "create unique index" supabase/migrations/`）。
 *
 * 這裡兩欄都從同一個不會與種子重疊的高位起跳、逐次遞增。
 */
let nextSortOrder = 9000;

async function seedBooking(
  tenantId: string, customerName: string, bookingNo: string, price: number,
): Promise<void> {
  const customerId = randomUUID();
  const serviceId = randomUUID();
  const bookingId = randomUUID();
  createdCustomers.push(customerId);
  createdServices.push(serviceId);
  createdBookings.push(bookingId);

  const { error: cErr } = await admin.from('customers')
    .insert({ id: customerId, tenant_id: tenantId, name: customerName, phone: '0912-000-000', points: 0 });
  expect(cErr).toBeNull();
  const { error: sErr } = await admin.from('services').insert({
    id: serviceId,
    tenant_id: tenantId,
    name: `匯出用服務${stamp}`,
    price,
    duration_minutes: 60,
    sort_order: nextSortOrder,
    line_sort_order: nextSortOrder,
  });
  nextSortOrder += 1;
  expect(sErr).toBeNull();

  const start = new Date(Date.UTC(2026, 0, 15, 2, 0, 0)).toISOString(); // 台北 10:00
  const { error: bErr } = await admin.from('bookings').insert({
    id: bookingId,
    tenant_id: tenantId,
    booking_no: bookingNo,
    customer_id: customerId,
    service_id: serviceId,
    start_at: start,
    end_at: new Date(Date.parse(start) + 3600_000).toISOString(),
    duration_minutes: 60,
    price,
    final_price: price,
    status: 'CONFIRMED',
  });
  expect(bErr).toBeNull();
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

  await seedBooking(SHOP_A.id, customerNameA, bookingNoA, 1250);
  await seedBooking(SHOP_B.id, customerNameB, bookingNoB, 999);
});

afterAll(async () => {
  for (const id of createdBookings) await admin.from('bookings').delete().eq('id', id);
  for (const id of createdServices) await admin.from('services').delete().eq('id', id);
  for (const id of createdCustomers) await admin.from('customers').delete().eq('id', id);
});

describe('GET /api/export/bookings/xlsx (#33③ 的 excel 半邊)', () => {
  it('回的是真正的 xlsx，不是換了副檔名的 CSV', async () => {
    const response = await ownerA.get('/api/export/bookings/xlsx');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(XLSX_MIME);
    expect(response.headers.get('content-disposition')).toMatch(
      /^attachment; filename="bookings-\d{4}-\d{2}-\d{2}\.xlsx"$/,
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
    assertRealXlsx(new Uint8Array(await response.arrayBuffer()));
  });

  it('表頭與 CSV 分支逐欄相同，資料列讀得回來', async () => {
    const response = await ownerA.get('/api/export/bookings/xlsx');
    const { sheetName, rows } = await readSheet(await response.arrayBuffer());

    expect(sheetName).toBe('預約清單');
    expect(rows[0]).toEqual(HEADERS);

    const mine = rows.slice(1).find((row) => row[0] === bookingNoA);
    expect(mine, '找不到本輪種下的預約').toBeTruthy();
    expect(mine![1]).toBe('2026-01-15 10:00');       // 台北牆上時鐘
    expect(mine![2]).toBe(customerNameA);
    expect(mine![6]).toBe(1250);                      // 金額在 xlsx 是數字型別
    expect(mine![7]).toBe('已確認');
  });

  it('不外洩其他租戶的預約', async () => {
    const response = await ownerA.get('/api/export/bookings/xlsx');
    const { rows } = await readSheet(await response.arrayBuffer());
    expect(rows.slice(1).some((row) => row[0] === bookingNoB)).toBe(false);
    expect(rows.slice(1).some((row) => row[2] === customerNameB)).toBe(false);
  });

  it('顧客自填的字串不會變成公式格', async () => {
    const response = await ownerA.get('/api/export/bookings/xlsx');
    const { rows, formulaCells } = await readSheet(await response.arrayBuffer());
    const mine = rows.slice(1).find((row) => row[0] === bookingNoA)!;
    // xlsx 的字串格不是公式，所以這裡是原字串——CSV 分支才需要那個 ' 前綴。
    expect(mine[2]).toBe(customerNameA);
    expect(formulaCells).toEqual([]);
  });

  it('?from&to 篩選在 xlsx 分支同樣生效', async () => {
    const inside = await readSheet(
      await (await ownerA.get('/api/export/bookings/xlsx?from=2026-01-15&to=2026-01-15')).arrayBuffer(),
    );
    expect(inside.rows.slice(1).some((row) => row[0] === bookingNoA)).toBe(true);

    const outside = await readSheet(
      await (await ownerA.get('/api/export/bookings/xlsx?from=2026-02-01&to=2026-02-02')).arrayBuffer(),
    );
    expect(outside.rows.slice(1).some((row) => row[0] === bookingNoA)).toBe(false);
  });

  it('CSV 分支的既有契約完全沒變（重構沒有波及它）', async () => {
    const response = await ownerA.get('/api/export/bookings/csv');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('content-disposition')).toMatch(
      /^attachment; filename="bookings-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]], 'UTF-8 BOM 不見了').toEqual([0xef, 0xbb, 0xbf]);
    const csv = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
    // CSV 分支仍以 ' 前綴中和公式；兩分支共用同一份攤平結果，得證明沒有波及 CSV。
    expect(csv).toContain(`'${customerNameA}`);
    expect(csv).toContain(bookingNoA);
    expect(csv).not.toContain(bookingNoB);
  });

  it('白名單之外的格式 400，且不走 { success, data } 信封以外的形狀', async () => {
    const response = await ownerA.get('/api/export/bookings/excel');
    expect(response.status).toBe(400);
    expect(((await response.json()) as { success: boolean }).success).toBe(false);
  });

  it('未登入拿不到任何一種格式', async () => {
    const base = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';
    for (const format of ['csv', 'xlsx']) {
      const anonymous = await fetch(`${base}/api/export/bookings/${format}`);
      expect(anonymous.status, `${format} 未登入竟然拿得到`).toBe(401);
    }
  });
});
