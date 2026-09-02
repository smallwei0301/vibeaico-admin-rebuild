# GUIDE SaaS 方案權益與加購模型

> Owner Direction：2026-09-02
> 關聯：#48、#118、#120、09-FEATURE-STORE、13-BUSINESS-MODES、19-GUIDE-PRODUCT-EXPERIENCE

## 1. 問題

現有 `09-FEATURE-STORE.md` 延續舊後台的 micro-feature（單項功能）模式：大量功能以 49／99／249 點每月逐項購買，另有 LITE／PRO bundle（套裝）。

這個模式不能直接成為新的 GUIDE 商業主體，否則會形成：

> 已經付 SaaS 月費 → 排班再付一次 → 報表再付一次 → Email 再付一次 → 每個功能都像投幣機。

Owner 最新方向是 **GUIDE SaaS 後台費用＋Midao 前台曝光／推廣** 為主要營收，因此 GUIDE 要改成 plan entitlement（方案權益：付某個 SaaS 方案後自然取得的一組能力）為主。

## 2. GUIDE 與舊 Feature Store 分流

- `09-FEATURE-STORE.md` 舊功能商店先保留，避免 LOCAL_SHOP／CLINIC 既有商業模型被本次 GUIDE 施工破壞。
- GUIDE 不把 22 張單項功能卡全部原封不動搬到新介面。
- GUIDE 的「方案／加購」頁應優先呈現目前 SaaS 方案、導遊席次、用量與少量真正加購項。
- 底層可暫時重用 `feature_subscriptions`／feature code 作相容層，但產品真相必須是「方案權益＋少量 add-on（加購）」，而不是 UI 到處判斷某張 49 點功能卡買了沒有。

## 3. 三層產品架構，不先定正式價格

### 3.1 永久體驗方案

Owner 選擇：**A，永久體驗方案＋累積有效訂單上限。**

Owner 2026-09-02 補充選擇：**C，累積有效訂單上限為 30 張。**

目的：讓導遊真的把一條接案流程跑起來，再決定是否付費；**不採註冊後 14／30 天倒數失效**。

至少保留：

- 1 位 active+bookable 導遊席次。
- 基本 Trip／TripPlan／Departure 管理。
- 基本旅客自助預約與 TourOrder 處理。
- 已成立訂單的付款／退款／取消處理。
- 行動收件匣基本待辦。
- 基本顧客資料。
- LINE 連線與必要設定入口。
- 基本 Email + Telegram 交易／安全通知。
- 資料查看與匯出底線。

永久體驗方案以「**累積 30 張有效訂單**」作主要升級門檻：

- 在累積 30 張尚未用完前，可持續接受新的有效預約，不因註冊時間經過而失效。
- 第 30 張有效訂單可以正常成立；達到 30 張後，停止建立會產生第 31 張有效訂單的新預約，不把整間後台鎖死。
- 已成立／付款中／待退款／已成團的既有訂單仍可完整處理。
- 既有付款、退款、通知、安全、資料查看與匯出仍可使用。
- 升級 SaaS 後立即恢復接受新預約，不搬移資料、不要求重建租戶。
- 系統應在接近 30 張上限時提前顯示白話提醒，不等旅客送出最後一步才突然失敗。

「有效訂單」必須是可由正式 TourOrder／付款／成立狀態客觀判定的訂單；草稿、失敗 checkout、測試交易、被系統判定無效的重複資料不得消耗免費額度。確切 qualifying 規則在施工時需與 #12／#41 的訂單生命週期一致，不能由前端自己數卡片。

30 張是**累積型門檻，不按月重置**。取消／退款後是否回補免費額度不得用前端自行減計；施工時要依「曾經真正成立的有效訂單」定義做可稽核計數，避免先成立再取消反覆洗免費額度。

### 3.2 個人 SaaS

適合一位導遊自己接案與帶團。

產品原則：**一個人正常營運所需的日常能力應完整，而不是再拆成十幾張小額加購卡。**

建議包含：

- 1 位 active+bookable 導遊。
- 完整 GUIDE Trip／Plan／Departure／TourOrder 日常流程。
- LINE-first 自助預約。
- 行事曆、可接案與防撞。
- 行動收件匣。
- 訂金／尾款／現場收款／退款工具。
- 基本通知與提醒。
- GUIDE 基本營運報表。
- 旅客管理與履約紀錄。
- Quick / Advanced Plan 編輯。

個人版不應出現「月費已付，但要看基本報表再買 BASIC_REPORT 99 點」這種雙重收費感。

### 3.3 團隊 SaaS

核心差異優先放在 **active+bookable guide seats（可接案導遊席次）**，而不是另一套 TEAM 模式或把同一功能重做一次。

建議：

- 2+ 位導遊席次，依正式方案採階梯。
- PRIMARY／ASSISTANT 指派。
- 團隊可用時間與衝突管理。
- 團隊篩選、業績／C+ 歸屬。
- 團隊營運報表與權限能力。
- 其他真正需要多人協作才有意義的能力。

若團隊降級，歷史人員／訂單／業績不可消失；只限制超額 active+bookable 席次與新的多人操作。

## 4. 哪些能力不可再做 GUIDE 單項付費閘門

以下屬 GUIDE 基礎交易、安全或付費 SaaS 的完整日常能力，不應以舊 Feature Store 單項購買作主要體驗：

- 基本 Email／Telegram 交易與安全通知。
- TourOrder 建立、查看、取消、退款與既有訂單處理。
- Payment/refund truthful state（真實付款／退款狀態）。
- GUIDE 必要 availability（可接案）／行事曆能力。
- 一位導遊正常使用所需的人員基礎。
- 已購 SaaS 對應的基本 GUIDE 報表。
- 資料安全、audit、匯出／讀取既有資料。

`EMAIL_NOTIFICATION` 若保留 feature code，只能代表進階 Email 自動化／模板／行銷，不得再拿來擋基本交易通知。

`BASIC_REPORT` 對 GUIDE 不應作為個人 SaaS 之外再單買的基本報表閘門；若未來有「進階分析」可另定新 entitlement，不用舊名稱混淆。

`SHIFT_MANAGEMENT` 對 GUIDE 的必要可接案與防撞能力，不應要求單獨購買；GUIDE 時間模型已由 10／13／37 定義。

## 5. 真正適合保留為 add-on（加購）的類型

GUIDE 額外加購應有清楚理由，優先保留這些類型：

### 5.1 外部成本／用量型

- 額外 LINE Push 額度。
- AI Assistant／AI 自動化的額外使用量。
- 未來明確有第三方單位成本的訊息、AI、儲存或媒體能力。

這些可以按額度／方案加購，因為平台確實會隨使用量增加成本。

### 5.2 Midao 額外價值型

- Midao 付費曝光／推廣，依 #118。
- 平台代建行程。
- 平台協助營運／內容整理等服務。

這些是 SaaS 之外的獨立服務，不應假裝是「解鎖後台基本功能」。

### 5.3 非核心模組

點數、會員、票券、商品銷售、進階行銷等 P2／跨業態能力，可保留 optional module（選配模組）或未來納入更高方案；不需要現在一次決定全部正式價格。

## 6. GUIDE UI：從「功能商店」改成「方案與加購」

GUIDE 模式建議不要以 22 張功能卡作首頁。

在五大入口下：

`更多 → 方案與加購`

第一屏回答：

```text
目前方案
永久體驗版
1 / 1 位可接案導遊
累積有效訂單：X / 30
[查看方案]

可加購
LINE 額外推播
AI 使用量
Midao 曝光／推廣
平台協助代建
```

如果某個能力是目前 SaaS 方案已包含，UI 顯示「方案已包含」，不要再顯示購買價格按鈕。

## 7. 權益判定的技術方向

現有 `isFeatureActive(tenantId, code)` 只查 `feature_subscriptions`，長期不足以表達 GUIDE SaaS。

建議收斂成等價的 entitlement evaluator（權益判定器）：

```text
isEntitled(tenant, capability)
  = baseline capability
  OR current SaaS plan entitlement
  OR explicit add-on / grant
```

實作可分階段：

1. 先建立共用 evaluator，內部仍可讀現有 feature rows。
2. GUIDE route／API 不再自己直接判某張 feature card。
3. 加入 subscription plan / entitlement source 後，舊 feature subscription 只作 legacy/add-on/grant 相容。
4. LOCAL_SHOP／CLINIC 在其商業模型未重構前維持既有行為。

不要為 GUIDE 再複製一套 `guide_features` 平行表，造成兩套功能真相。

## 8. 舊訂閱與既有使用者相容

重構時不可讓已經持有 feature subscription 的租戶突然失權：

- 既有 active subscription／GRANTED 權益先被 evaluator 接受。
- 對 GUIDE 若新 SaaS 方案已包含同能力，UI 顯示「方案已包含」，不重複收費。
- 舊單項訂閱的續訂／退場政策在正式 monetization migration（商業化遷移）前另做相容規則，不直接刪 row。
- 不自動扣點、不自動把舊點數轉成新月費，除非 Owner 後續明確決定。

## 9. 與 Midao 曝光分離

SaaS entitlement 不等於 listing／promotion：

- SaaS：能不能使用 GUIDE 後台能力。
- `midao_listing`：行程是否有自然上架資格。
- promotion/campaign：是否購買額外曝光。
- platform-assisted：是否購買代建／營運服務。

四者資料與帳單語意分離，未來可以 bundle（組合包），但 bundle 只能授予多個既有權益，不能把四種真相混成一個 status。

## 10. 目前 Owner gate

以下數字／發布動作仍不自行決定：

- 個人／團隊正式月費／年費。
- 團隊席次階梯／超額席次價格。
- AI／LINE 額外額度價格。
- 是否仍保留點數錢包作某些 add-on 的支付方式。
- 舊 Feature Store 訂閱如何轉換／折抵新 SaaS。
- Production subscription billing（正式訂閱扣款）啟用。

在價格未拍板前，可以完成 capability matrix（能力矩陣）、entitlement evaluator、GUIDE UI 原型與相容測試；不得啟動 Production 真實訂閱扣款。