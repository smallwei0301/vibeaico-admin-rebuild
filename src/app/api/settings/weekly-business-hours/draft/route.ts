// POST /api/settings/weekly-business-hours/draft — 逐日營業時間的**乾跑**：
// 拿還沒存檔的 business 設定算出影響筆數，**一列都不寫**。
//
// ⚠️ 「乾跑」是我方選定的語意，不是原站考據結果。完整的依據與反面證據寫在
// src/server/business-hours-blocks.ts 檔頭，以及 docs/integration/04-API-CONTRACTS.md §A-1.2。
// 真正的寫入走 PUT /api/settings（帶 business 群組時重建自動封鎖）。
//
// response: { perDayMode, autoBlockCount, conflictBookingCount, manualWeeklyBlockCount }
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { businessSettingsSchema } from '@/config/tenant-settings';
import { measureBusinessHoursImpact } from '@/server/business-hours-blocks';

export const POST = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  const business = businessSettingsSchema.parse(await req.json());
  const impact = await measureBusinessHoursImpact(t.supabase, t.tenantId, business);
  return ok(impact);
});
