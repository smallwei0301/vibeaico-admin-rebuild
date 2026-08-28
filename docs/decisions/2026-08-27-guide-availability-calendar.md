# 2026-08-27 Owner Decision — GUIDE 可接案時間整合到行事曆

## 已裁示

GUIDE（嚮導）模式不恢復一般店家語境的「班表」與「封鎖時段」側邊欄。

對嚮導使用者，時間管理統一收斂到 `/tenant/calendar`，使用者看到的是「可接案時間／不可接案／已占用」，而不是底層資料表名稱。

底層重用既有模型，不新增重複的 `guide_availability`：

- `shifts`：可接案時間。
- `block_times`：不可接案、私人行程、休假等例外。
- `trip_departure_staff + trip_departures`：實際已被團次占用。
- 未來外部行事曆接入後，外部 busy event 也進同一套 availability engine。

GUIDE 的行事曆 UI 文案與操作需依業態調整：不再顯示「顧客預約／員工排班」，而改為導遊自然理解的「我的行程／可接案時間／團隊行程」等語境。

建立或修改團次時，主導遊與協同導遊都必須經同一套 availability engine 驗證；前端可以先顯示可用／忙碌原因，但後端儲存前必須再次驗證，避免同時操作造成撞班。

ICS / Google Calendar / Apple Calendar 的定位是「已經被占用的事情」，因此不輸出大量「可接案」空檔。預設只輸出實際占用事件、不可接案例外，以及租戶另有啟用其他模組時的其他占用事件。

## 單導遊／多導遊 UX 後續裁示

Owner 已進一步裁示：**不做顯式 SOLO／TEAM 模式開關，改由系統依 `active && bookable` 導遊數量自動適應 UI。**

- 0 位：導向 onboarding，先建立可帶團導遊。
- 1 位：單人簡化 UX；隱藏主／協同選擇，但後端仍寫入唯一導遊的 PRIMARY assignment。
- 2 位以上：自動展開主／協同導遊與團隊篩選。
- 人員停用不刪歷史團次、訂單或業績關聯。

完整理由與未來導遊席次收費方向見 `docs/decisions/2026-08-27-guide-solo-team-auto-ui.md`。
