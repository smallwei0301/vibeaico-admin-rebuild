# 18 — GUIDE Commerce Lifecycle（方案販售／成團／付款／簡易與進階編輯）

> Owner Decision：2026-08-28；2026-09-02 補充已成團後價格保護與 SaaS 退款責任邊界。
> 本冊是 GUIDE 商業流程的 canonical extension。10 分冊仍是 Trip/Plan/Departure/TourOrder 的基礎模型；本冊專門定義「怎麼賣、怎麼併團、什麼時候算成團、怎麼收訂金/尾款、哪些步驟自動、哪些步驟需要導遊判斷，以及方案管理 UI 分層」。

---

## 0. 已裁示摘要

1. 每個 Plan 各自選販售方式：`FIXED_DEPARTURE / INSTANT / REQUEST`；最終履約都收斂成 Departure。
2. REQUEST 旅客送出申請時**不鎖導遊時間**；導遊接受時才原子重查 availability 並建立／鎖定私人 Departure。
3. 真正支援散客併團：最低成團 4 人時，1 人可以先報名，不要求單筆訂單自己湊滿 4 人。
4. Plan 收款政策沿用 Service：`NONE / DEPOSIT_FIXED / DEPOSIT_PERCENT / FULL`，不另建旅遊專用第二套訂金設定。
5. 成團截止日到仍不足人數時，**不自動取消**；進 `REVIEW_REQUIRED`，交給導遊選「仍成團／延長募集／取消」。
6. 成團後若取消導致人數跌破原門檻，**不自動退回未成團**；進 `AT_RISK`，由導遊決定繼續或取消。
7. 成團截止預設為**出發前 7 天**，導遊可在 Plan 修改，且建立單一 Departure 時可 override；Departure 必須保存具體 deadline snapshot。
8. GUIDE 方案管理採**快速編輯 → 進階設定**分層 UI。未來平台管理者可代建方案，但導遊仍是資料 owner，可自行快速調整價格與內容。
9. 線上金流必須使用**該 GUIDE tenant 自己保存的 merchant credentials**完成 checkout → provider → callback 全鏈路；不得默默 fallback 到平台共用 merchant key。
10. 已成團後若個別旅客取消而進 `AT_RISK`，導遊若選擇**繼續出團**，剩餘旅客維持各自 TourOrder 成交價格；不得補差額或依剩餘人數重新計價。
11. Midao 的 GUIDE 商業角色是 **SaaS（訂閱式後台）＋前台曝光／上架**。取消／退款商業政策由導遊／tenant 自行設定，Midao 提供非強制建議預設與工具，不建立逐案退款仲裁引擎。

---

## 1. Plan：商品規則，不是實際履約

Plan 至少分成以下概念：

```text
販售方式 sales_mode
  FIXED_DEPARTURE  固定團次
  INSTANT          自選時間直接成立
  REQUEST          先申請再確認

團型 participation_mode
  SHARED           散客併團
  PRIVATE          私人包團

收款政策 deposit_mode
  NONE
  DEPOSIT_FIXED
  DEPOSIT_PERCENT
  FULL
```

### 人數不要再混成一個 minParticipants

真正散客併團要拆清楚：

```text
min_party_size       # 單筆訂單最少幾人，例如 1
max_party_size       # 單筆訂單最多幾人
min_to_depart        # 整個 Departure 合計至少幾人才宣布成團，例如 4
capacity             # 實際 Departure 最多收多少人，建立團次時 snapshot
```

例如「1 人可報名、4 人成團、最多 8 人」：

```text
min_party_size = 1
min_to_depart = 4
capacity = 8
```

`min_party_size` 不能再同時代表「最低成團人數」。

### 預設組合

- `FIXED_DEPARTURE + SHARED`：公開散客併團，最典型使用 `min_to_depart > 1`。
- `INSTANT`：預設 PRIVATE；旅客成交時建立私人 Departure。
- `REQUEST`：預設 PRIVATE；導遊接受後建立私人 Departure。
- 未來若要讓 INSTANT/REQUEST 也能加入公開併團，必須另外定義，不在本輪暗中開放。

---

## 2. 成團截止日

### 2.1 Plan 預設

新增等價設定：

```text
formation_deadline_days_before = 7
```

- 預設 **7 天前**。
- 導遊可依方案調整，建議 UI 範圍 `0–90` 天，並提供常用快捷 `3 / 5 / 7 / 14`。
- `0` 代表可募集到出發日；UI 應顯示風險提醒，不禁止專業使用者這樣做。

選 7 天作為預設，是因為散客團除了「人數夠不夠」外，通常還需要留出通知旅客、收尾款、確認交通／場地／協同人員的作業時間。這是產品預設，不宣稱是法規或所有業者的唯一標準。

### 2.2 Departure snapshot

建立團次時不能只保存「7」；要算成一個實際時間並 snapshot：

```text
formation_deadline_at
min_to_depart_snapshot
capacity
```

- Plan 日後改成 5 天，不回頭改已公開的舊 Departure。
- 建立／編輯單一團次時允許 override deadline。
- 若依 Plan 計算出的 deadline 已經在過去，**不得靜默存一個過期 deadline**。UI 要提示「距出發不足預設天數，請選擇新的成團截止時間」，可建議「出發前 24 小時」，但最後值由導遊確認。
- 時區使用 tenant timezone；GUIDE 預設 Asia/Taipei 時，不得用 UTC 日期直接減天造成跨日。

---

## 3. Departure：兩條狀態軸

`OPEN/CLOSED/CANCELLED` 回答「還能不能賣」。
成團狀態回答「這團是否已對旅客做出出團承諾」。兩者分開：

```text
formation_status
  COLLECTING       募集中，尚未達最低成團
  FORMED           已宣布成團
  REVIEW_REQUIRED  截止日已到但不足，待導遊決策
  AT_RISK          已成團後有效人數跌破原門檻
  FAILED           因未成團／導遊決策取消
```

因此合法狀態包括：

```text
OPEN + COLLECTING
OPEN + FORMED
CLOSED + FORMED
OPEN + REVIEW_REQUIRED
CANCELLED + FAILED
```

不得把 `FORMED` 直接等同 `CLOSED`。

### 一次性成團證據

Departure 建議保存：

```text
formed_at
formed_by = SYSTEM | GUIDE_OVERRIDE
formed_participants
formation_decided_at
formation_decided_by
```

一旦 `FORMED`，系統**不會因日後人數下降自動倒退到 COLLECTING**。

---

## 4. TourOrder：訂單狀態與付款狀態分開

不要用一個 status 同時表達「報名有效」與「錢付到哪裡」。

### 訂單狀態

```text
PENDING
CONFIRMED
COMPLETED
CANCELLED
```

### 付款狀態

```text
UNPAID
PARTIAL
PAID
REFUND_PENDING
REFUNDED
```

並保存 transaction snapshot：

```text
total_amount
upfront_required_amount
paid_amount
refunded_amount
balance_due
payment_method_id
payment_ref / transaction refs
```

Plan 日後改價、改訂金比例，不回頭重算舊訂單。

---

## 5. 哪些人算入「有效成團人數」

容量占用與成團計數是兩本帳。

### 會先占位但還不能算成團

- 剛建立、正在完成線上付款的 PENDING order。
- provider 還沒回成功 callback 的交易。
- 匯款只是旅客回報後五碼、導遊還沒確認收到。

### 可計入成團

| deposit_mode | 何時變成有效報名、計入成團 |
|---|---|
| NONE | 訂單依規則成立時立即計入；這代表導遊自己選擇承擔零預收的 no-show 風險 |
| DEPOSIT_FIXED | 訂金付款成功／匯款被導遊確認後 |
| DEPOSIT_PERCENT | 訂金付款成功／匯款被導遊確認後 |
| FULL | 全額付款成功／匯款被導遊確認後 |

線上 provider 已確認付款時，**不再要求導遊人工按「確認付款」**。
匯款因系統無法知道銀行實際入帳，才需要導遊按一次「確認收款」。

成團計數應由 qualifying TourOrders 現算或由原子 transaction 安全維護，不得由前端把列表數一數後決定。

---

## 6. 自動推進 vs 導遊人工判斷

### 系統自動

- 建立 PENDING order + 原子暫占名額。
- 線上訂金／全額 callback 成功後更新 `paid_amount/payment_status`。
- 依收款政策把 order 推到有效報名。
- 重算有效成團人數。
- 達 `min_to_depart_snapshot` 時原子 `COLLECTING → FORMED`。
- 同 transaction 建立 `GROUP_FORMED` notification event。
- 成團後計算各 order 尾款、建立付款期限與通知。
- 線上尾款成功自動 `PARTIAL → PAID`。
- 未付款 hold 過期釋放名額。
- 到 formation deadline 仍不足時 `COLLECTING → REVIEW_REQUIRED`，並通知導遊，不自動取消。
- 已 FORMED 後取消造成有效人數跌破門檻時 `FORMED → AT_RISK`，並通知導遊，不自動撤銷已成團承諾，也**不得自動重算剩餘旅客價格或新增補差額應收**。
- 整團取消後停止販售、取消有效 orders、釋放導遊時間、建立退款待辦、發取消通知。
- 導遊按「完成出團」後，系統批次把有效 TourOrders 完成、凍結業績、開啟評論資格。

### 導遊需要操作

1. 匯款：確認實際收到訂金／尾款。
2. `REVIEW_REQUIRED`：
   - **仍然成團** → `FORMED`，`formed_by=GUIDE_OVERRIDE`。
   - **延長募集** → 修改 `formation_deadline_at`，回 `COLLECTING`。
   - **取消本團** → `FAILED/CANCELLED`，進退款流程。
3. `AT_RISK`：
   - **繼續出團** → 剩餘旅客維持各自 TourOrder 成交時的 `total_amount`／付款承諾；不得補差額、不得依剩餘人數重新計價。
   - **取消整團** → 進整團取消與退款流程。
4. 實際銀行退款完成（在未接自動 Refund API 前）→ 標記已退款。
5. 行程真的執行完 → 一次按「完成出團」。

如果導遊認為剩餘人數已不足以承擔出團成本，應選擇取消整團，而不是把取消者造成的差額轉嫁給仍要參加的旅客。

不要讓導遊逐張訂單人工搬 `PENDING → CONFIRMED → PAID → COMPLETED`。

---

## 7. 成團與通知

所有重要通知只建立 logical event，delivery 交給 17 分冊：

```text
TOUR_ORDER_UPFRONT_PAID
TOUR_GROUP_PROGRESS_CHANGED
TOUR_GROUP_FORMED
TOUR_GROUP_REVIEW_REQUIRED
TOUR_GROUP_AT_RISK
TOUR_BALANCE_DUE
TOUR_BALANCE_REMINDER
TOUR_CANCELLED_NOT_FORMED
TOUR_CANCELLED_AFTER_FORMED
TOUR_REFUND_PENDING
TOUR_REFUNDED
```

`GROUP_FORMED` 必須有冪等保護，callback 重送不得讓 4/4 成團訊息寄兩次。

成團旅客通知至少包含：日期／集合時間、已付、尾款、尾款期限、付款入口。
導遊／tenant owner 通知至少包含：目前有效人數、容量、尚可售名額、待收尾款摘要。

---

## 8. 每個 GUIDE tenant 自己的金流 credentials

### 8.1 這裡的「每個導遊」指 tenant，不是每位 staff

目前多導遊團隊模型的收款 owner 是 GUIDE tenant／工作室；PRIMARY/ASSISTANT 是履約人員，不因指派不同就把錢切到不同 merchant account。

```text
Tenant A 的 ECPay key → Tenant A 的 TourOrder
Tenant B 的 ECPay key → Tenant B 的 TourOrder
```

**絕不 fallback 到平台共用 merchant key。**
若未來真的需要「同一 tenant 內不同 staff 各自收款」，那是另一個金流／會計模型，必須另行裁示。

### 8.2 啟用線上金流的驗證階梯

1. `connection_verified_at`
   - 使用該 tenant 解密後的 merchant id/key/iv 呼叫 provider 可驗證端點。
   - key 被編輯後立即清空此驗證。
2. `e2e_verified_at`
   - 使用**同一 tenant 的同一 payment_method**建立小額測試交易。
   - checkout form / redirect 使用該 tenant credentials。
   - provider callback 以 shopCode / payment_method / tenant 解析回**同一組 tenant credentials**驗簽。
   - callback 成功且更新正確測試 order 後才記 e2e verified。

Production 線上付款 method 在 e2e verification 完成前不得向旅客標成「已可正式收款」。UI 可顯示：

```text
未驗證
連線已驗證
完整收款流程已驗證
```

### 8.3 安全與跨租戶測試

- credentials 只加密存 DB，API 永遠遮罩。
- secret 空字串 = 保留原值；只要 secret/merchant/provider 任何關鍵欄位改動，就清驗證狀態。
- Tenant A 的 checkout 不得讀到 Tenant B key。
- 用 A 的 callback/signature 不得更新 B 的 order。
- callback 不接受「平台預設 key」作救援 fallback。
- provider callback 重送冪等，不能重複加 `paid_amount` 或重複成團。

---

## 9. 取消、退款與 SaaS 平台責任邊界

最新 Owner Decision：`docs/decisions/2026-09-02-guide-saas-platform-role-and-dispute-defaults.md`。
取消／退款建議範本細節：`docs/decisions/2026-08-31-guide-cancellation-policy-config.md`。

### 9.1 原則

Midao GUIDE 以 **SaaS 後台＋Midao 前台曝光／上架**為主要商業方向，不以交易抽成、爭議款處理或人工退款仲裁作為核心營收模型。

因此：

- 每個 Trip Plan 可保存自己的取消／退款政策。
- Midao 提供「使用 Midao 建議規則／自行設定／恢復建議」三種操作。
- 建議預設不是平台不可修改的商業法則；導遊可依法規與自身營運條件調整。
- 旅客下單前顯示該方案實際政策，成交時保存 policy snapshot；Plan 後改不污染舊單。
- Midao 提供退款試算、明細、附件、通知與操作紀錄，但一般商業爭議由導遊與旅客自行協商。
- 不建立「平台客服逐案核准退款金額」或自動判誰有責任的仲裁狀態機。

### 9.2 Midao 建議預設

- 旅客主動取消：建議採「已付款含訂金－實際不可退成本－金流商實際且確實不退的退款手續費」。
- 導遊／業者主動取消整團：建議全額退款，金流實際且不退費用由業者吸收。
- 未達最低成團而取消：建議全額退款。
- 天候／災害／交通中斷：優先免費改期；無法改期再建議全額退款。
- no-show、特殊票券、客製包團：由方案自訂；Midao 提供模板。
- 已成團後個別旅客取消但繼續出團：其餘旅客維持成交價格，不補差額。

### 9.3 平台固定底線

以下不是商業偏好，導遊不可關閉：

- payment/refund state 必須誠實，`REFUND_PENDING` 不可顯示成 `REFUNDED`。
- 退款／扣款不得形成負數、重複計算或超過實際已付款。
- provider 未提供可靠費用資料時，系統不得猜測或捏造費用。
- tenant/order/attachment 權限隔離不可破壞，不得建立永久公開附件 URL。
- 已成交價格、付款承諾與取消政策使用 snapshot，不得事後偷偷回寫舊單。
- 自訂政策不得繞過適用法律、強制規範或金流商規則。

### 9.4 不把退款問題變成 Owner 阻塞

一般退款比例、不可抗力、no-show、特殊票券、善意退款與例外協商，不再逐題要求 Owner 決策。產品／施工者應依上述方向提供合理建議預設並保留導遊自訂。

只有涉及新的平台責任模型，例如 Midao 代收代付、履約保證、平台代墊／賠付、交易 marketplace 或法律強制衝突時，才重新升級 Owner Decision。

---

## 10. 方案管理 UI 分層

目前 `trips/[id]` 的方案 Modal 把名稱、描述、價格、兒童價、時長、人數、販售方式、訂金、全年／季節價等全部塞在同一層。對不熟悉系統的導遊太重。

### 10.1 第一層：快速編輯（預設）

```text
方案名稱
方案內容／簡短說明
基本價格
兒童價格（有設定才顯示）
啟用／暫停販售
公開預覽摘要
```

不要在第一層出現 enum 技術名、成團演算法、季節日期矩陣等。

### 10.2 第二層：販售與進階設定

Quick Edit 底部提供清楚但不搶眼的「進階設定」入口：

```text
價格單位（每人／每團）
時長
單筆最少／最多人數
團型（散客併團／私人包團）
販售方式（固定團次／自選時間／先申請）
最低成團人數
成團截止日前 N 天（預設 7）
訂金／全額收款政策
取消／退款政策（Midao 建議／自行設定）
季節與價格 override
其他未來的進階販售規則
```

進階欄位修改若會影響已存在 Departure／TourOrder，只影響未來新建團次／新成交訂單；既有 snapshot 保持不變，UI 要明講。

### 10.3 Midao 管理者代建方案

- 平台管理者使用 #25 的正式 impersonation / platform-admin 能力進租戶建立，不共用密碼。
- 全程 audit：誰、何時、代哪個 tenant 建立／修改哪些欄位。
- 建議 Plan 保存 provenance：`source = GUIDE | PLATFORM_ASSISTED | IMPORTED`，只做來源標記，不建立第二套 Plan schema。
- UI 可顯示「Midao 協助建立」badge。
- **導遊仍可編輯自己的方案**。
- 若行程已在 Midao LISTED，修改依既有 review 機制送審。

### 10.4 不做兩套表單／兩套 schema

```text
Quick Edit ─┐
            ├─ 同一 Plan API / validation / audit
Advanced  ──┘
```

不能做 `simple_trip_plans` / `advanced_trip_plans` 或管理者專用 Plan 表。

---

## 11. 驗收核心

- `min_party_size=1, min_to_depart=4` 時 1 人可以完成有效報名。
- unpaid hold 可占名額但不算成團；required upfront payment 成功後才依政策計入。
- 4 人門檻由最後一筆付款 callback 達成時，只形成一次 `FORMED` + 一次 `GROUP_FORMED` event。
- deadline 預設 7 天；Plan 可改、Departure 可 override，既有 Departure snapshot 不被 Plan 日後修改污染。
- deadline 到 3/4 → REVIEW_REQUIRED，不自動取消／退款。
- GUIDE override 3/4 仍成團有 audit，走同一 FORM event 路徑。
- 已 FORM 4/4 後取消變 3/4 → AT_RISK，不自動反成團。
- AT_RISK 後選擇繼續出團時，剩餘 TourOrder 的 `total_amount`／`balance_due` 不增加，不建立補差額付款或通知。
- 線上收款 callback 自動推進；匯款才需要人工確認。
- Tenant A/B 用不同 merchant credentials 的 checkout/callback 交叉測試必須證明隔離。
- 每個 Plan 可切換 Midao 建議取消政策與自訂政策；成交 policy snapshot 不被 Plan 後改污染。
- `REFUND_PENDING` 到 provider／人工真的完成前不得冒充 `REFUNDED`。
- 不存在平台人工逐案核准退款才能繼續的硬依賴。
- Quick Edit 不顯示 advanced fields；進階頁仍可完整編輯，同一 API 往返一致。
- PLATFORM_ASSISTED 建立可追 audit／來源，但導遊仍可修改。

正式 Production schema / DDL / migration、真實商戶小額測試交易、Production deploy 仍需 Owner 另行明確授權。