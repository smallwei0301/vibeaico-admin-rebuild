# 17 — Reliable Notification Delivery（Outbox / Email / Telegram / Health）

> Owner Decision：2026-08-28。
> 本冊是「通知可靠送達」的 canonical 規格，處理跨業態、跨訂單領域的 delivery 基礎設施。
> 05 分冊仍負責 Email 模板與 Resend transport；06 分冊仍負責 LINE Messaging；07 分冊負責排程；09 分冊負責付費功能。若舊文件把「基本交易 Email 通知」視為付費功能，以本冊與 `docs/OWNER-DECISIONS.md` 的較新 Owner Decision 為準。

---

## 0. Owner 已裁示

1. **免費用戶至少具備 Email + Telegram 的基本交易／營運事件通知能力。**
   - Email：有有效收件信箱即可使用。
   - Telegram：屬免費能力，但使用者仍需完成 Bot 綁定；未綁定是 `NOT_CONFIGURED`，不是「送達失敗」。
   - LINE 主動 Push 仍依 06/09 分冊的額度與功能規則，不因本決策變成無限免費。
2. 通知不得只做 `void send()` 後把失敗丟進 console。所有重要業務通知必須可追蹤、可重試、可稽核。
3. 平台管理者每天必須收到前 24 小時的通知健康報告，至少包含 Email / Telegram 的成功、失敗、待重試、dead-letter、最老 pending 與受影響租戶。
4. 每日健康報告本身需寫入資料庫，並嘗試送到**平台管理者 Email + Telegram**；其中一條壞掉時仍能由另一條與後台紀錄看見。
5. 系統只宣稱供應商真的能證明的狀態：
   - Email API 接受請求 ≠ 最終進入收件匣。沒有 provider delivery webhook 證據時只能標 `ACCEPTED`，不得顯示「已送達」。
   - Telegram `sendMessage` HTTP 200 代表 Telegram 接受並建立訊息，不代表使用者已讀；不得顯示「已讀」。

---

## 1. 架構：Event 與 Delivery 分兩層

不要讓一筆 outbox row 同時扛「業務事件」與「多通道、多收件人重試」。建議兩層：

```text
業務交易
  └─ notification_outbox          一個邏輯事件
       ├─ notification_deliveries Email → 導遊
       ├─ notification_deliveries Telegram → 導遊
       ├─ notification_deliveries Email → 管理者（若事件需要）
       └─ notification_deliveries ...
```

### 1.1 `notification_outbox`

建議欄位：

```text
id
 tenant_id nullable             # 平台級告警可為 null
 event_name
 aggregate_type
 aggregate_id
 idempotency_key
 payload jsonb                  # 僅最小必要資料，不存付款 secret / 完整敏感 PII
 status = OPEN | COMPLETE | DEAD
 created_at
 completed_at
```

要求：

- 業務狀態改變與 outbox event **同一個 DB transaction** 寫入，避免「訂單已成立但通知事件根本沒留下來」。
- `(event_name, aggregate_type, aggregate_id, idempotency_key)` 有唯一性或等價冪等保護。
- payload 僅保存渲染所需 snapshot / resource reference；金流 key、LINE token、完整卡號等永不進 outbox。

### 1.2 `notification_deliveries`

一個 event 依 recipient × channel 展開 delivery rows：

```text
id
 outbox_id
 tenant_id nullable
 recipient_type = TRAVELER | GUIDE | TENANT_OWNER | PLATFORM_OWNER | STAFF
 recipient_ref
 channel = EMAIL | TELEGRAM | LINE
 destination_ref             # 優先存 mapping/ref；若必要存地址需最小化
 status = PENDING | PROCESSING | ACCEPTED | DELIVERED | RETRY | DEAD | SKIPPED
 attempt_count
 next_attempt_at
 provider_message_id nullable
 last_error_code nullable
 last_error_message nullable  # 去敏後
 last_attempt_at nullable
 accepted_at nullable
 delivered_at nullable
 created_at
 updated_at
```

`SKIPPED` 必須有可理解 reason，例如 `NOT_CONFIGURED`、`MATRIX_DISABLED`、`NO_RECIPIENT`；不可把「沒設定」算成 provider failure。

---

## 2. 派送流程

1. 業務 transaction 成功時寫 outbox event。
2. transaction commit 後，立即嘗試 fan-out + dispatch。Next.js 可用 `after()` / 等價機制做**最佳努力的即時派送**，但它不是 durability 來源。
3. 派送前原子 claim delivery row，避免兩個 worker 重送同一筆。
4. provider 成功 → 記錄 `ACCEPTED` / `DELIVERED` 與 provider id。
5. 暫時性失敗 → `RETRY` + backoff + `next_attempt_at`。
6. 永久性失敗或超過最大嘗試次數 → `DEAD`，觸發平台告警。
7. outbox 底下所有必要 delivery 終止（成功、SKIPPED、DEAD）後，event 才可結案。

建議 retry：最多 5 次，退避由共用 helper 唯一實作。429/5xx/timeout 可 retry；明確 invalid recipient、Telegram blocked 等永久錯誤直接 DEAD / invalid binding，不無限重打。

> 目前 07 分冊記錄 Vercel Hobby 的 cron 頻率限制。即時通知不能把「每天一次 cron」當主派送機制。Production 應至少靠 commit 後即時 dispatch；持久 retry worker 的頻率必須由實際 Production scheduler 能力決定。若 Production 仍只能 daily sweep，UI / SLA 必須如實揭露，不能假裝具備分鐘級重試。

---

## 3. Email（免費基本通道）

- Transport 沿用 05 分冊 Resend。
- 驗證碼 / 密碼重設屬互動式 auth email，可以保留同步送 provider 的低延遲路徑，但仍需留下 delivery audit；不可因排隊器故障讓登入流程等一天。
- auth audit 只保存 recipient hash，不能保存可重播的地址、驗證碼或 reset link；因此 inline sender 在 provider 結果寫回前 crash 時，該 `PROCESSING` row **不得**被通用 worker lease-reclaim 成 `SKIPPED` 或重寄。它保留為非重試 audit，由 stale-pending health alert 顯示，使用者可安全地重新索取驗證碼。
- 訂單、成團、取消、付款、退款、營運告警等事件 email 走 outbox。
- Resend API 成功只記 `ACCEPTED`。
- 若接 Resend webhook，`delivered / bounced / complained` 需回寫 delivery；只有收到 delivery evidence 才標 `DELIVERED`。
- bounce/complaint 不得每天重寄同一地址；應標記 recipient health 並提醒租戶修正 email。
- `RESEND_RECIPIENT_HEALTH_KEY` 是 recipient-health hash 的平台密鑰。未設定時，Email dispatcher 必須以 `RECIPIENT_HEALTH_KEY_MISSING` 暫時失敗，不得把地址當作健康而繞過已知 bounce/complaint 抑制；設定後才可查 ledger hash。

### 免費權益

09 分冊目前 `EMAIL_NOTIFICATION` 為付費功能，**此 Owner Decision 取代「基本交易 Email 必須付費」的語意**。

實作選擇：

- 基本交易／系統通知直接列為 baseline，不走 `requireFeature('EMAIL_NOTIFICATION')`。
- 若保留 `EMAIL_NOTIFICATION` feature code，僅可用於「進階 Email 自動化／額外模板／行銷類能力」；UI、catalog、i18n 必須同步更名，不能讓免費用戶看起來失去基本訂單通知。

---

## 4. Telegram（免費基本通道）

沿用 `tour-platform` 已驗證的產品概念，但在本 repo 重新依本架構實作：

- 一個平台 Telegram bot。
- 導遊／需要個人通知的使用者：後台取得一次性 `/start <code>` deep link → Telegram webhook 兌換 → 建立 subject ↔ chat id mapping。
- webhook 必須驗 `X-Telegram-Bot-Api-Secret-Token`，`update_id` 冪等。
- `sendMessage` 成功保存 provider message id。
- Telegram 403 blocked / chat not found → 將 binding 標示不可用，delivery 不無限重試；UI 提醒重新綁定。
- `getMe` 可用於 bot transport health probe，但不能代替「某個人的 chat mapping 仍可收訊息」；真正派送仍以 sendMessage 結果為準。

免費方案允許 Telegram 綁定與基本交易事件；不另用 feature gate 收費。

---

## 5. Notification Matrix

事件是否送出至少考慮：

```text
系統通道可用
  AND 免費/付費權益允許（基本 Email/Telegram 永遠 baseline）
  AND 該事件的 tenant/user notification setting 開啟
  AND recipient 已設定 / 已綁定
```

基本交易通知可以讓使用者關閉非關鍵事件，但「帳號安全、付款異常、平台風險」等不可關閉事件需在事件 catalog 明確標記 `mandatory=true`，不能靠各 route 自己猜。

---

## 6. 平台管理者每日通知健康報告

每天固定產生一份前 24 小時 digest，**即使 0 failures 也要產生**，讓「完全沒收到任何報警」不等於「系統一定正常」。

建議台北時間 09:00（`01:00 UTC`）執行，內容至少：

```text
期間
logical events 數
Email: accepted / delivered / retry / dead
Telegram: accepted / retry / dead / invalid binding
LINE（若啟用）: accepted / quota skipped / failure
oldest pending age
DEAD rows 數與 top error codes
受影響 tenant 數與清單摘要
24h synthetic transport probe 結果
```

平台 owner digest delivery：

- 寄到 platform owner / ops Email。
- 同時送 platform owner Telegram chat / ops group。
- digest 本身也寫 `notification_health_reports`（或等價 audit table），保留查詢紀錄。
- 若 digest 的 Email / Telegram 自己失敗，該失敗必須落 delivery ledger；不能因「報警通道壞了」就完全無紀錄。
- Vercel Hobby 的 daily cron 可能有 ±59 分鐘 jitter；digest 的前 24 小時窗口以 route 實際執行的時間為 cutoff，不假裝固定在精確 01:00 UTC。詳見 07 分冊。

### 即時告警

除 daily digest 外，以下至少要建立即時 platform alert event：

- 任一 critical event 進 `DEAD`。
- 同一 provider 持續認證失敗。
- pending 最老超過設定門檻。
- 短時間大量 429/5xx。

第一版閾值可先固定在 config，之後再做可調整。

---

## 7. Health / Verification

### 上線前 transport smoke

Email：
- 使用正式 `MAIL_FROM` / Resend key 對平台 owner 測試信箱寄一封。
- API accepted 要有 provider id。
- 若 delivery webhook 已接，需驗到 delivered；未接時只能把 acceptance 當作證據，不宣稱 inbox delivered。

Telegram：
- `getMe` 正常。
- webhook secret 驗證正常。
- 平台 owner / test guide 完成真實 binding。
- 對真實 chat `sendMessage` 成功，保存 message id。

### 自動化測試

- outbox 與業務交易同 transaction；rollback 時不得留下 event。
- fan-out idempotency：同一 event 重跑不多建 delivery。
- worker claim 並發安全。
- retry/backoff、max attempts、DEAD。
- Email accepted vs delivered 語意不可混淆。
- Telegram 403 invalidates binding。
- 免費租戶不需購買 `EMAIL_NOTIFICATION` 仍可收到基本 Email；Telegram 綁定後可收到基本 Telegram。
- notification setting 關閉只 skip 對應可關事件。
- daily digest 即使 0 failure 仍建立 report。
- digest 有 failure 時含 tenant/channel/error 摘要且不洩漏 secret/完整 PII。

---

## 8. 與既有分冊／Issue 的關係

- 05：保留 Email transport/templates，重要事件改由本冊 outbox delivery 呼叫。
- 06：LINE transport 不重寫；delivery ledger 可把 LINE 納入同一派送稽核。
- 07：新增 dispatch/retry sweep + daily health digest cron/scheduler。
- 09：基本 Email/Telegram 變成免費 baseline；付費功能只能包裝進階通知能力。
- 10 / GUIDE：成團、取消、尾款、退款等事件只寫 notification event，不在 domain route 直接散落三套 send code。

正式 Supabase migration、Production env / webhook、Production deploy 仍需 Owner 另行授權。
