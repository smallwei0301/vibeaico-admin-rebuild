// GET /api/export/customers/excel — 顧客名單匯出（04 分冊 §B-6）。
// 路徑沿用原站命名（…/excel），實際依契約產 CSV：UTF-8 加 BOM（Excel 開啟
// 中文才不會亂碼），Content-Disposition: attachment，**不走 { success, data }
// 信封**，直接回檔案（handle() 只攔錯誤，成功路徑回傳什麼就是什麼）。
//
// 欄位 = 顧客列表頁（src/app/tenant/customers/page.tsx）的顯示欄：
//   顧客資訊(姓名+LINE 顯示名稱) / 聯絡方式(電話+Email) / 會員等級 /
//   預約次數 / 累計消費 / 狀態 —— CSV 攤平成 8 欄。
// 資料源 customers_view（0007：含 membership_level_name / booking_count /
// total_spent / at_risk），含停用顧客（列表頁也會列出並標「已停用」）。
// 店家量級小：全量一次查回（不分頁）。
import { handle } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { taipeiTodayDateString } from '@/server/tz';

/** CSV 跳脫：含逗號/引號/換行時包雙引號，內部引號雙寫 */
function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const HEADERS = ['姓名', 'LINE 顯示名稱', '電話', 'Email', '會員等級', '預約次數', '累計消費', '狀態'];

export const GET = handle(async () => {
  const t = await requireTenant();

  const { data: rows, error } = await t.supabase.from('customers_view')
    .select('name, line_display_name, phone, email, membership_level_name, booking_count, total_spent, at_risk, active')
    .eq('tenant_id', t.tenantId)
    .order('created_at', { ascending: false });
  if (error) throw error;

  const lines = [HEADERS.map(csvCell).join(',')];
  for (const c of rows ?? []) {
    // 狀態文案對照列表頁 Badge：已停用 > 流失風險 > 正常
    const status = !c.active ? '已停用' : c.at_risk ? '流失風險' : '正常';
    lines.push([
      csvCell(c.name),
      csvCell(c.line_display_name),
      csvCell(c.phone),
      csvCell(c.email),
      csvCell(c.membership_level_name),
      csvCell(c.booking_count),
      csvCell(Number(c.total_spent)),
      csvCell(status),
    ].join(','));
  }

  const csv = '\uFEFF' + lines.join('\r\n') + '\r\n'; // \uFEFF = UTF-8 BOM
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="customers-${taipeiTodayDateString()}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
});
