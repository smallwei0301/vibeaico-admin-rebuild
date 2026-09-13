# Issue #104 Phase 1A 初始探測報告

> 報告時間：2026-09-01 UTC
>
> 初始 exact head：`154c123827137ac38206c794cbf8a657528f04cd`
>
> PR：#105

## 目的

確認兩個 GitHub-hosted runner 能否同時建立各自的本機 Supabase，而不使用或重設 remote
TEST project `nmwhwngojosmagjuvxol`。

## 工作流程

- Source CI：Run `33519646654`
- Local isolated workflow：Run `33519646707`
- Matrix slots：`local-isolated-a`、`local-isolated-b`

## 已證明

兩個 slot 都各自完成：

```text
獨立 GitHub runner
Supabase CLI 2.116.0 安裝
PostgreSQL 17 local stack 啟動
current repo migrations 套用
local API／anon／service-role 匯出
TEST_SUPABASE_URL = http://127.0.0.1:54321 驗證
supabase stop --no-backup 成功
```

兩個 job 同時執行，沒有使用 remote TEST secret，也沒有 remote Supabase mutation。

## 未通過

### Source typecheck

`decideLocalIsolatedTest` 的 JavaScript 型別推導遺漏 `eventName` optional default，造成單元測試
物件的 TypeScript `TS2353`。這是新 policy helper 的程式錯，已在下一個真實提交修正。

### Full integration

兩個 slot 均在標準 seed 階段 fail closed，尚未執行任何 integration test file：

```text
repo migrations applied: 0001 ... 0014
required table missing: trip_plans
seed error: trip_plans seed is required before trip_departures
```

Remote TEST migration history則已有大量後續候選 migration（直到 `0064` 等），但多數來源仍在
open PR。這表示 current main 的 migration source 無法重建 remote TEST schema。

分類：

```text
ISOLATION_STACK_STARTED = true
LOCAL_URL_VERIFIED      = true
LOCAL_CLEANUP_VERIFIED  = true
ISOLATION_CANARY_GREEN  = not yet run at this head
MIGRATION_LEDGER_STATUS = INCOMPLETE
FULL_LOCAL_SUITE        = blocked before test execution
```

## 決策

不把 seed 改成忽略必要表，也不把 remote TEST 所有未合併 migration 直接複製進 main。

Phase 1 改為：

```text
1A  使用兩個 slot 同時插入相同固定主鍵，專門驗證資料庫隔離與清理
1B  追溯已合併／正式採用 schema，補齊 canonical migration ledger，再跑完整 local integration／E2E
```

## 安全

- Production：未操作
- Remote TEST：未操作
- Paid Supabase Branch：未建立
- 真實付款／退款／顧客通知：未操作

本報告是初始失敗證據，不得改寫成成功報告。後續 exact-head 結果另行追加，不覆蓋本紀錄。
