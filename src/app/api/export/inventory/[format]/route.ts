// GET /api/export/inventory/:format?productId&type — 庫存異動匯出
// （issue #28 第 ⑤ 筆）。
//
// 為什麼是新增而不是還原：`docs/specs/inventory.json` 的 jsApiCalls 只有
// /api/inventory/logs，**原站沒有庫存匯出端點**（#28 第五輪盤點的留言已確認）。
// 但頁面上一直有一顆「匯出 CSV」鈕，它的 onClick 只跳一則
// 「異動記錄匯出成功 庫存異動_20260825.csv」——連檔名都是前端用當天日期
// 自己組的，沒有任何檔案被下載。依「補齊優先於刪除」補這一支。
//
// format：'csv' | 'excel'（同 /api/export/reports/:format 的兩個選項，
// 擁有者裁決兩者都做），其他值 400。
// **兩者產出的都是 CSV**（UTF-8 加 BOM，Excel 開啟中文不亂碼），檔名副檔名也
// 都是 .csv —— 專案沒有裝任何 xlsx 產生器，把 CSV 命名成 .xlsx 就是謊報檔案
// 格式（CLAUDE.md「Never fabricate a known」）。理由與寫法逐字對齊
// src/app/api/export/reports/[format]/route.ts，不另開一套。
//
// 慣例同其他 /api/export/*：**不走 { success, data } 信封**，直接回檔案；
// Content-Type: text/csv; charset=utf-8；Content-Disposition: attachment；
// Cache-Control: no-store。檔名是呼叫端唯一的檔名來源（前端不得自組）。
//
// 欄位與列的口徑 = /tenant/inventory 頁的表格：
//   時間 / 商品 / 異動類型 / 數量 / 異動前 / 異動後 / 原因 / 操作者
// 資料列走 src/server/inventory-log.ts 的共用 mapper（與 /api/inventory/logs
// 同一套，不複製第二份）。
//
// ?productId&type = 頁面當下的兩個篩選。匯出前的確認視窗寫著「確定要匯出
// **目前篩選**的異動記錄嗎？」，所以篩選必須真的套用。type 之所以在取回資料後
// 才過濾，是因為它在 DB 裡不是獨立欄位：reason 存「TYPE:明細」複合格式，而
// 前綴不在已知清單時要歸成 MANUAL —— 那條規則只有 mapper 知道，用 SQL 的
// like 濾會漏掉「前綴是未知字串」的那一類。店家量級小：一次查回（不分頁）。
import { z } from 'zod';
import { ApiHttpError, ERR, handle } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { taipeiTodayDateString } from '@/server/tz';
import {
  KNOWN_INVENTORY_LOG_TYPES, mapInventoryLog, type InventoryLogType,
} from '@/server/inventory-log';
import { inventoryPage } from '@/i18n/zh-TW/pages/inventory';

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 原站 reports 匯出的兩個選項；兩者內容都是 CSV（見檔頭） */
const ALLOWED_FORMATS = new Set(['csv', 'excel']);

const querySchema = z.object({
  productId: z.string().uuid().optional(),
  type: z.enum(KNOWN_INVENTORY_LOG_TYPES).optional(),
});

/** timestamptz → 台北牆上時鐘 'YYYY-MM-DD HH:mm'（同 /api/export/bookings） */
function taipeiDateTime(iso: string): string {
  const t = new Date(Date.parse(iso) + TAIPEI_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`
    + ` ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
}

/** CSV 跳脫：含逗號/引號/換行時包雙引號，內部引號雙寫（同其他 /api/export/*） */
function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const HEADERS = [
  inventoryPage.columns.time,
  inventoryPage.columns.product,
  inventoryPage.columns.type,
  inventoryPage.columns.quantity,
  inventoryPage.columns.before,
  inventoryPage.columns.after,
  inventoryPage.columns.reason,
  inventoryPage.columns.operator,
];

export const GET = handle(async (req, { params }) => {
  const t = await requireTenant();
  await requireFeature(t.tenantId, 'INVENTORY');

  const { format } = await params;
  if (!ALLOWED_FORMATS.has(format))
    throw new ApiHttpError(400, '不支援的匯出格式', ERR.VALIDATION);

  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));

  let query = t.supabase
    .from('inventory_logs')
    .select('*, products(name)')
    .eq('tenant_id', t.tenantId)
    .order('created_at', { ascending: false });
  if (q.productId) query = query.eq('product_id', q.productId);

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []).map(mapInventoryLog)
    .filter((log) => !q.type || log.type === q.type);

  const lines = [HEADERS.map(csvCell).join(',')];
  for (const log of rows) {
    lines.push([
      csvCell(taipeiDateTime(log.createdAt)),
      csvCell(log.productName),
      // 類型用畫面上同一組中文（同 /api/export/bookings 取 common.bookingStatus）
      csvCell(inventoryPage.types[log.type as InventoryLogType] ?? log.type),
      csvCell(log.quantity),
      csvCell(log.stockBefore),
      csvCell(log.stockAfter),
      csvCell(log.reason),
      // operator 在 DB 裡不存在（見 inventory-log.ts），畫面顯示「系統」，這裡同字
      csvCell(log.operator ?? inventoryPage.labels.system),
    ].join(','));
  }

  const csv = '\uFEFF' + lines.join('\r\n') + '\r\n'; // \uFEFF = UTF-8 BOM
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="inventory-${taipeiTodayDateString()}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
});
