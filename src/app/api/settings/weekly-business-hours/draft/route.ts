// POST /api/settings/weekly-business-hours/draft — 逐日營業時間的**乾跑**
//（issue #33 第 ② 筆；04 分冊 §A-1）。
//
// 原站出處：docs/specs/settings.json 的 jsApiCalls
//   `/api/settings/weekly-business-hours/draft`
// 以及 jsStrings[66]「解析逐日營業時間失敗:」。
//
// ⚠️⚠️ **「乾跑」是我方選定的語意，不是原站考據結果。**
// `docs/specs/settings.json` 只給了路徑與文案，**沒有 request / response 形狀**。
// 選它的依據只有兩點：路徑最後一段是 `draft`（草稿），以及那句「**解析**逐日
// 營業時間失敗」代表這一支會拿還沒存的輸入去算東西。原站另外三句文案是過去式
// （「已依你的營業時段自動建立 N 筆」「設定已儲存」「已保留」），單看它們會
// 讀成「這一支自己就會寫入」——完整的推論與反面證據寫在
// src/server/business-hours-blocks.ts 的檔頭與 04 分冊 §A-1。
//
// 本端點**一列都不寫**：只回報「照這份草稿存下去會發生什麼」。
//   autoBlockCount        會自動建立幾筆封鎖時段
//   conflictBookingCount  有幾筆既有預約會落在非營業時段
//   manualWeeklyBlockCount 店家手動建立的每週封鎖有幾筆（一律保留，不會被刪）
//   perDayMode            回聲，讓頁面知道該用「公休日或非營業時段」還是
//                         「非營業時段」那一句文案
//
// 真正的寫入仍走 PUT /api/settings（business 群組），auto 封鎖在那裡重建。
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { businessSettingsSchema } from '@/config/tenant-settings';
import {
  computeAutoBlocks, countConflictingBookings, countManualWeeklyBlocks,
} from '@/server/business-hours-blocks';

export const POST = handle(async (req) => {
  const t = await requireTenant();
  // 整包用 business 群組的 schema 解析（缺的欄位補預設值）——「解析逐日營業
  // 時間失敗」那句話對應的就是這裡：格式不合會被 zod 擋成 400 REQ_001。
  const business = businessSettingsSchema.parse(await req.json());

  const [conflictBookingCount, manualWeeklyBlockCount] = await Promise.all([
    countConflictingBookings(t, business),
    countManualWeeklyBlocks(t),
  ]);

  return ok({
    perDayMode: business.perDayMode,
    autoBlockCount: computeAutoBlocks(business).length,
    conflictBookingCount,
    manualWeeklyBlockCount,
  });
});
