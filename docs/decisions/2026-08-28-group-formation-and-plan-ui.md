# 2026-08-28 Owner Decision — 散客成團生命週期與方案管理分層

## 散客成團

Owner 採「真正散客併團」：單筆訂單最少人數與整團最低成團人數必須拆開。例：1 人可報名、4 人成團、最多 8 人，不得再用一個 `minParticipants` 同時表示兩種規則。

- `min_party_size`：單筆訂單最少人數。
- `min_to_depart`：整個 Departure 的最低成團人數。
- `capacity`：團次最大容量。

容量占用與有效成團計數分開。線上付款成功後由系統自動計入；匯款只有在導遊確認實際入帳後才計入。Plan 的 `NONE / DEPOSIT_FIXED / DEPOSIT_PERCENT / FULL` 收款政策沿用 Service，不另外建立旅遊專用訂金系統。

## 成團截止日

- Plan 預設：**出發前 7 天**。
- 導遊可自行調整，第一版 UI 允許 `0–90` 天，常用快捷建議 `3 / 5 / 7 / 14`。
- 建立 Departure 時把規則算成具體 `formation_deadline_at` snapshot，單一團次可 override。
- Plan 日後修改不回頭改既有團次的 deadline / min-to-depart snapshot。
- 若短期開團導致預設 deadline 已在過去，不得靜默保存過期值；要求導遊重新選，UI 可建議出發前 24 小時。

截止仍不足時不自動取消，改進 `REVIEW_REQUIRED`，導遊三選一：仍然成團、延長募集、取消本團。已經宣布成團後若人數因取消跌破門檻，不自動反成團，改進 `AT_RISK`，由導遊決定繼續或取消。

## 自動化原則

客觀可判斷的事情由系統自動：付款 callback、有效人數計算、達門檻成團、成團通知、尾款計算／提醒、逾期 hold 釋放。只有「系統真的不知道」或「需要商業判斷」的事情才交給導遊，例如確認匯款、截止不足決策、已成團後人數不足決策、尚未串自動退款時確認退款完成、行程真正完成。

## 方案管理 UI

GUIDE 的 Trip Plan 不再把所有欄位塞在同一個長 Modal。採兩層 UI，但仍共用同一個 Plan schema / API / validation：

### 第一層：快速編輯

預設讓不熟悉系統的導遊只看到：

- 方案名稱
- 方案內容／簡短說明
- 基本價格
- 兒童價格（有使用時）
- 啟用／暫停販售
- 公開預覽摘要

### 第二層：進階設定

由「進階設定」進入獨立 page / drawer：

- 每人／每團計價
- 時長
- 單筆最少／最多人數
- 散客併團／私人包團
- 固定團次／自選時間／先申請
- 最低成團人數
- 成團截止日前 N 天
- 訂金／全額政策
- 季節與價格 override
- 後續進階販售規則

進階規則修改只影響未來新建 Departure，已存在團次遵守 snapshot；UI 必須明說。

## Midao 協助代建

未來平台提供代建方案服務時，使用正式 platform-admin / impersonation 能力，不共用導遊密碼，且全程 audit。建議 Plan 保存來源標記 `GUIDE | PLATFORM_ASSISTED | IMPORTED`，只用於 provenance／badge，不建立管理者專用 Plan schema，也不鎖住導遊的編輯權。

Midao 協助建立後，導遊仍可使用快速編輯調整自己的價格與內容；若已 LISTED，修改仍遵守既有 review 流程。

## Canonical

完整規格：`docs/integration/18-GUIDE-COMMERCE-LIFECYCLE.md`。