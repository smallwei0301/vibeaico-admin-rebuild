# GUIDE 行程完整複製

> Owner Decision：2026-09-11
> 關聯：#8、#42、`docs/integration/10-TOUR-DOMAIN.md`

## 決策

Owner 選擇：**A，保留「複製行程」功能，並做成真正、可持久化的完整複製。**

這個功能的主要情境是導遊用既有商品快速建立季節版、語言版、價格版或相似行程，例如「阿里山春季版」複製成「阿里山秋季版」，而不是重新從空白開始設定。

## 要複製的內容

一次複製應建立一個新的 Trip，並完整帶入「商品定義」層的內容：

- 行程基本資料與內容，包括名稱、簡介、完整說明、地區／分類、封面與相簿等現行 Trip 內容欄位。
- 該行程底下的全部 TripPlan 方案。
- 每個方案目前所有屬於「商品／販售規則」的設定。實作時應以當下 canonical TripPlan schema 為準，不得只照舊 migration 的歷史欄位清單硬拷貝；包含價格、人數、販售方式、散客／包團、成團門檻與截止、訂金／付款、季節價格、取消退款政策等已正式存在的方案設定。
- 該行程底下的 TripAddon 行程加購目錄。

圖片在產品語意上屬於「內容會被複製」。實作可在生命週期安全的前提下重用既有 storage reference；若既有清理規則會讓原行程刪除後破壞複本，則必須改用不會產生斷圖的素材生命週期。不得為了表面完成而產生不存在的假 URL。

## 新複本必須重設的狀態

- 新 Trip 一律為 `DRAFT`，不得因原行程已發布就直接公開。
- 名稱預設加「（複本）」；若已有同名／同 slug 複本，系統產生可預期且唯一的新名稱／slug，不要求使用者先手動解衝突。
- `midao_listing` 一律回 `NONE`，退回理由／審核 note 清空。
- Midao listing review、付費曝光／Promotion、推薦排序或其他外部發布資格不得繼承。
- 若 TripPlan 有 listing/review 類狀態，複本須回到未審核／未送審狀態，不得沿用舊方案的核准結果。
- provenance（來源標記）不得把舊行程的歷史操作者冒充成新行程操作者；由導遊本人執行複製時記為 GUIDE，由正式 platform-assisted／impersonation 流程代建時記為 PLATFORM_ASSISTED（若該欄位已落地）。

## 明確不複製

以下都是「營運／履約／交易／歷史」資料，不屬於商品模板，**一律不能複製**：

- TripDeparture 團次及 PRIMARY／ASSISTANT 人員指派。
- TourOrder 旅遊訂單與 TourOrderAddon 訂單加購快照。
- 名額占用、成團狀態、deadline snapshot、完成狀態與業績快照。
- 旅客／顧客關聯。
- 付款、訂金、尾款、退款、chargeback 或 provider transaction 紀錄。
- 評論、評分。
- Midao listing 審核歷史、付費曝光 campaign、impression／click／booking attribution 等成效資料。
- notification outbox／delivery ledger、audit log 或其他歷史稽核事件。

## 一致性與安全

- 對使用者而言，複製是一個單一動作。Trip、Plans、Addons 必須「全部成功或全部失敗」，不得留下只有 Trip 沒有方案、或只複製一半方案的半成品。
- 實作應使用單一可稽核交易邊界（例如原子 RPC 或等價 DB transaction），不能用前端連續呼叫多支 API 再假裝是一個成功動作。
- 只能複製同 tenant 的來源 Trip；跨 tenant id 必須拒絕且不得洩漏來源是否存在。
- 權限沿用行程 mutation 的現行正式規則；前端按鈕不能繞過 server-side authorization。
- 成功後必須從真實後端重讀或直接使用後端回傳的新 Trip id；不得再使用目前 `setRows()` 製造 `${trip.id}_copy` 的本地假成功。

## API／UI 方向

產品契約採單一入口：`POST /api/trips/:id/duplicate`（或 canonical API 文件最後收斂的等價 route）。回傳新 Trip id／必要摘要後，UI 重新讀取清單；若 Quick Edit 已可用，可直接引導使用者進入新複本編輯。

## Canonical 回併要求

本決策在 `main` 的 Owner Decision 優先於 Issue #8 舊的「做或移除」待決文字。實作 PR 必須同步回併 `docs/integration/10-TOUR-DOMAIN.md` 的後台管理端點與必測情境，使 canonical 最終只留一份現在式規格；不得把本 decision 檔長期當成第二套 API 規格。

本決策只裁示產品語意與施工範圍。Runtime 程式、migration、TEST／Production DDL、正式部署仍依 repo 現行治理流程與 Owner gate 執行。
