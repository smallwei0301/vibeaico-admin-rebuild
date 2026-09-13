// GET /api/export/customers/excel — 顧客名單匯出（04 分冊 §B-6）。
// 路徑沿用原站命名（…/excel），**實際產出真正的 xlsx**：Content-Disposition:
// attachment，不走 { success, data } 信封，直接回檔案（handle() 只攔錯誤，
// 成功路徑回傳什麼就是什麼）。
//
// issue #246：本檔在此之前產的是帶 BOM 的 CSV，但按鈕與路徑都寫著 Excel。
// 「按了有沒有下載」那一層判準抓不到這種缺陷——它真的下載了，只是下載的東西
// 不是它宣稱的格式。14-GAP-AUDIT §8.3 裁示的 `exceljs` 於本輪落地。
// 欄位、資料源與狀態文案一字未改，只換輸出格式。
//
// 欄位 = 顧客列表頁（src/app/tenant/customers/page.tsx）的顯示欄：
//   顧客資訊(姓名+LINE 顯示名稱) / 聯絡方式(電話+Email) / 會員等級 /
//   預約次數 / 累計消費 / 狀態 —— CSV 攤平成 8 欄。
// 資料源 customers_view（0007：含 membership_level_name / booking_count /
// total_spent / at_risk），含停用顧客（列表頁也會列出並標「已停用」）。
// 店家量級小：全量一次查回（不分頁）。
import { handle } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { taipeiTodayDateString } from '@/server/tz';
import { buildXlsx, xlsxResponse, type XlsxCell } from '@/server/xlsx';

const HEADERS = ['姓名', 'LINE 顯示名稱', '電話', 'Email', '會員等級', '預約次數', '累計消費', '狀態'];

export const GET = handle(async () => {
  const t = await requireTenant();
  await requireFeature(t.tenantId, 'ADVANCED_CUSTOMER');

  const { data, error } = await t.supabase.from('customers_view')
    .select('name, line_display_name, phone, email, membership_level_name, booking_count, total_spent, at_risk, active')
    .eq('tenant_id', t.tenantId)
    .order('created_at', { ascending: false });
  if (error) throw error;

  const rows: XlsxCell[][] = [];
  for (const c of data ?? []) {
    // 狀態文案對照列表頁 Badge：已停用 > 流失風險 > 正常
    const status = !c.active ? '已停用' : c.at_risk ? '流失風險' : '正常';
    rows.push([
      c.name,
      c.line_display_name,
      c.phone,
      c.email,
      c.membership_level_name,
      // 數字欄以數字型別寫入，讓 Excel 能直接排序與加總——這是換成 xlsx
      // 之後才拿得到的東西，CSV 版本只能全部當文字。
      Number(c.booking_count ?? 0),
      Number(c.total_spent ?? 0),
      status,
    ]);
  }

  const fileName = `customers-${taipeiTodayDateString()}.xlsx`;
  return xlsxResponse(fileName, await buildXlsx('顧客名單', HEADERS, rows));
});
