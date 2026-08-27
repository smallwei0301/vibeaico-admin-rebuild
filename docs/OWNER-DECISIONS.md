# Owner Decisions — current index

> 本檔是跨領域 Owner 決策索引，讓 agent 在開工前快速知道哪些題目已經裁示，避免重複詢問。
> 正式領域規格仍以各 `docs/integration/**` canonical 文件為準；Issue 負責施工範圍與驗收。
> 最後更新：2026-08-27。

## 2026-08-27 已裁示

| Issue | 主題 | Owner 決策 | 後續實作重點 |
|---|---|---|---|
| #14 | LINE 平台狀態 | 採真實檢查 | Dashboard 真的呼叫 LINE `/v2/bot/info`，加短期快取；LINE 查詢失敗只顯示狀態異常，不拖垮後台。 |
| #17 / #37 | 加購 | 0 元允許、負數禁止；業績採 C+ | 指定人員就歸該人；未指定繼承原預約／團次主導遊；可明確選「不計個人業績」。旅遊團次細節已回併 `10-TOUR-DOMAIN.md`。 |
| #18 | LINE 老闆通知 | 最多 3 位，不按第 4 位人頭加價；每位可有獨立事件開關；旅客自行取消要通知 | 新增接收者時用合理預設。真正會消耗／加購的是 LINE 推播額度，不是接收者席次。 |
| #20 | 看診號碼 | 取消後號碼當日作廢，不重新發給其他病患 | 例如 8 號取消，下一位不可再次拿 8 號；保留稽核與現場辨識的一致性。 |
| #24 | 推薦碼 | 不設有效期限 | MVP 不自行發明 30/90 天；有效推薦碼長期可用。原站的「已過期」狀態在沒有新規則前不得自行套期限。 |
| #25 | Midao 管理者代登入租戶 | 要做，作為正式平台能力 | 從 Midao 管理者後台進入指定租戶協助查看／修改。僅 platform admin；全程 audit；租戶可查紀錄；不可取得租戶密碼或共用密碼。 |
| #26 | 第三方登入 | 現在就做 Google + LINE Login | 平台層 OAuth，與每租戶 LINE Messaging API 完全分離；需要平台 Google/LINE Login 憑證與 redirect allowlist。 |
| #37 / Phase 8 | 團次人員 | 方案不綁導遊，團次綁 PRIMARY 主導遊＋ASSISTANT 協同導遊 | 一般預約與團次雙向防撞；主／協同都占用時間；加購 C+。canonical：`docs/integration/10-TOUR-DOMAIN.md`。 |
| #37 / #10 / GUIDE | GUIDE 時間管理 | 不顯示一般店家「班表／封鎖時段」側邊欄；統一在行事曆呈現「可接案／不可接案／已占用」 | 底層重用 `shifts + block_times + trip_departure_staff`，不另建 `guide_availability`。ICS 不輸出大量可接案空檔，只輸出實際占用與不可接案例外。單導遊／多導遊 UI 切換方式尚待下一輪裁示。 |
| repo governance | 文件治理 | 已定案的規格／架構／Owner Decision 直接進 `main`；程式仍走 branch→PR→CI | 見 `docs/DOCUMENTATION-GOVERNANCE.md`。 |

## 執行規則

1. 上表已裁示的題目，不得再次當作人工決策阻擋，除非發現新的規格衝突或安全風險。
2. 若 Issue body 還殘留舊的「人工介入點」，以本索引、對應 Owner Decision comment 與較新的 canonical 文件為準。
3. 實作時要把對應決策回併該領域 canonical 文件，不能永久只靠本索引。
4. Production DDL／DML、正式部署與會改變 runtime 的 Production merge，仍需 Owner 另行明確授權。
