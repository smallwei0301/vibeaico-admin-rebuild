/**
 * 庫存異動匯出整合測試 — GitHub issue #28 第 ⑤ 筆。
 *
 * 修改前：`/tenant/inventory` 的「匯出 CSV」鈕 onClick 只跳一則
 * 「異動記錄匯出成功 庫存異動_20260825.csv」——`/api/export/` 底下根本沒有
 * inventory 這一支，沒有任何檔案被下載，而那個檔名是前端用當天日期自己組的。
 *
 * 補齊：`GET /api/export/inventory/:format`（擁有者裁決 CSV / Excel 兩者都做，
 * 照 issue #15 的 reports 匯出慣例）。
 *
 * 本檔驗證：
 *   ① 慣例：Content-Type / Content-Disposition / **位元組層級的 UTF-8 BOM** /
 *      Cache-Control，且**不走 `{ success, data }` 信封**
 *   ② 內容口徑與 /tenant/inventory 頁一致：表頭八欄、類型是畫面上的中文、
 *      異動前＝stock_after - delta、reason 的「TYPE:明細」複合格式拆回明細、
 *      operator 顯示「系統」——期望值以 service role 直查自己插入的列獨立算出
 *   ③ 篩選：?productId 與 ?type 真的套用（確認視窗寫「匯出目前篩選的異動記錄」）
 *   ④ format 只收 csv / excel，其他值 400；type 不在已知清單 → 400
 *   ⑤ 未登入 → 401；未訂閱 INVENTORY → 403（與 /api/inventory/logs 同一道閘門）
 *
 * ⚠️ BOM 一律驗**位元組**：`Response.text()` 依 WHATWG 規範會把開頭的 BOM 吃掉，
 * `text.startsWith('﻿')` 永遠是 false，那條斷言量的是 fetch 不是端點
 * （本專案踩過兩次，見 export-reports.15 的同一段註解）。
 *
 * 清理紀律：本檔自建一個商品與三列 inventory_logs，afterAll 依 FK 方向清掉
 * （inventory_logs → products）。seed 沒有任何 products，所以不會動到別人的資料。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { SHOP_A } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

const BASE_URL = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };

let admin: SupabaseClient;
let ownerA: AuthedApi;

/** 本檔自建的商品與另一個「不該被匯出」的對照商品 */
let productId: string;
let otherProductId: string;
const productName = `庫存匯出測試商品-${Date.now().toString(36)}`;
const otherProductName = `庫存匯出對照商品-${Date.now().toString(36)}`;

/**
 * 三列異動，刻意涵蓋 mapper 的三種情況：
 *   - 已知前綴、有明細（PURCHASE_IN:…）
 *   - 已知前綴、有明細且**含逗號**（驗 CSV 跳脫）
 *   - **未知前綴**（沒有冒號）→ 依 mapper 規則整串當 reason、類型歸 MANUAL
 */
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

/** CSV 一列切成欄（本檔的資料只有一個含逗號的欄位，走簡單的引號狀態機即可） */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { cells.push(cur); cur = ''; }
    else cur += c;
  }
  cells.push(cur);
  return cells;
}

/** 取出「屬於本檔那個商品」的資料列 */
function rowsOf(csv: string, name: string): string[][] {
  return csv.split(/\r\n/).filter(Boolean).map(splitCsvLine).filter((c) => c[1] === name);
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);

  productId = await insertProduct(productName);
  otherProductId = await insertProduct(otherProductName);

  const { error } = await admin.from('inventory_logs').insert([
    ...LOG_ROWS.map((r) => ({
      tenant_id: SHOP_A.id, product_id: productId,
      delta: r.delta, stock_after: r.stock_after, reason: r.reason,
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

describe('GET /api/export/inventory/:format（issue #28 ⑤）', () => {
  it('csv：回 text/csv + attachment 檔名 + UTF-8 BOM，不走 { success, data } 信封', async () => {
    const res = await ownerA.get('/api/export/inventory/csv');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toMatch(
      /^attachment; filename="inventory-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(res.headers.get('cache-control')).toBe('no-store');

    // BOM 必須驗**位元組**：Response.text() 會把開頭的 BOM 吃掉，
    // `text.startsWith('﻿')` 永遠是 false（量到的是 fetch，不是端點）。
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM

    // ignoreBOM: true —— 預設的 TextDecoder 也會吃掉 BOM，這裡要留著才驗得到
    const csv = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
    expect(csv.startsWith('﻿時間,商品,異動類型,數量,異動前,異動後,原因,操作者')).toBe(true);
    expect(() => JSON.parse(csv)).toThrow(); // 不是信封，是檔案
  });

  it('內容口徑＝庫存異動頁的表格：類型中文、異動前推算、reason 拆回明細、操作者「系統」', async () => {
    const csv = await (await ownerA.get('/api/export/inventory/csv')).text();
    const rows = rowsOf(csv, productName);
    expect(rows).toHaveLength(LOG_ROWS.length);

    for (const expected of LOG_ROWS) {
      const row = rows.find((c) => c[2] === expected.label);
      expect(row, `找不到類型「${expected.label}」那一列`).toBeTruthy();
      expect(row![0]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/); // 台北牆上時鐘
      expect(row![3]).toBe(String(expected.delta));
      expect(row![4]).toBe(String(expected.stock_after - expected.delta)); // 異動前＝推算
      expect(row![5]).toBe(String(expected.stock_after));
      expect(row![6]).toBe(expected.detail);
      expect(row![7]).toBe('系統'); // operator 在 DB 不存在，與畫面同字
    }
  });

  it('?productId 只匯出該商品；對照商品的異動不在檔案裡', async () => {
    const csv = await (await ownerA.get(`/api/export/inventory/csv?productId=${productId}`)).text();
    expect(rowsOf(csv, productName)).toHaveLength(LOG_ROWS.length);
    expect(csv).not.toContain(otherProductName);
  });

  it('?type=DAMAGE 只匯出該類型（確認視窗說的「目前篩選」是真的）', async () => {
    const csv = await (await ownerA.get(`/api/export/inventory/csv?productId=${productId}&type=DAMAGE`)).text();
    const rows = rowsOf(csv, productName);
    expect(rows).toHaveLength(1);
    expect(rows[0][2]).toBe('損耗報廢');
    expect(csv).not.toContain('第一批進貨');
  });

  it('?type=MANUAL 也涵蓋「前綴不是已知類型」的那一列（SQL like 濾不到的那類）', async () => {
    const csv = await (await ownerA.get(`/api/export/inventory/csv?productId=${productId}&type=MANUAL`)).text();
    const rows = rowsOf(csv, productName);
    expect(rows).toHaveLength(1);
    expect(rows[0][6]).toBe('沒有前綴的隨手備註');
  });

  it('excel 也可下載（兩個選項）；內容同樣是 CSV、檔名副檔名誠實為 .csv', async () => {
    const res = await ownerA.get('/api/export/inventory/excel');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toContain('.csv"');
    expect(res.headers.get('content-disposition')).not.toContain('.xlsx');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    // 明確與真 xlsx（zip 檔頭 50 4B 03 04）區分：這不是 xlsx，也沒有假裝是
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).not.toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it('不支援的 format → 400 REQ_001（錯誤路徑仍走信封）', async () => {
    const res = await ownerA.get('/api/export/inventory/pdf');
    expect(res.status).toBe(400);
    const body = (await res.json()) as Envelope;
    expect(body.success).toBe(false);
    expect(body.code).toBe('REQ_001');
  });

  it('type 不在已知清單 → 400（不是靜默匯出全部）', async () => {
    const res = await ownerA.get('/api/export/inventory/csv?type=NOT_A_TYPE');
    expect(res.status).toBe(400);
    expect(((await res.json()) as Envelope).success).toBe(false);
  });

  it('未登入 → 401 AUTH_001', async () => {
    const res = await fetch(`${BASE_URL}/api/export/inventory/csv`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as Envelope;
    expect(body.success).toBe(false);
    expect(body.code).toBe('AUTH_001');
  });

  it('未訂閱 INVENTORY → 403（與 /api/inventory/logs 同一道閘門）', async () => {
    const { error: offError } = await admin.from('feature_subscriptions')
      .update({ active: false })
      .eq('tenant_id', SHOP_A.id).eq('code', 'INVENTORY');
    expect(offError).toBeNull();
    try {
      const res = await ownerA.get('/api/export/inventory/csv');
      expect(res.status).toBe(403);
      expect(((await res.json()) as Envelope).success).toBe(false);
    } finally {
      const { error: onError } = await admin.from('feature_subscriptions')
        .update({ active: true })
        .eq('tenant_id', SHOP_A.id).eq('code', 'INVENTORY');
      expect(onError).toBeNull();
    }
  });
});
