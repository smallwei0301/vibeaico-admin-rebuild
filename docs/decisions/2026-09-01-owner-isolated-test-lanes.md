# Owner 裁示：隔離 TEST 路線與 B+ 雙 Terra 分階段導入

> 日期：2026-09-01
>
> 狀態：Owner 已裁示，分階段施工
>
> 追蹤 Issue：#104

## 決策

B+ 不直接從一條完整 Terra 放寬成多條完整 Terra。先把 TEST 從「共用一間考場」改成
「候選各有自己的測試環境，最後再進同一座海關」。導入順序固定為：

```text
Phase 1A  兩個本機 Supabase canary 證明 runner／資料庫／清理彼此隔離
Phase 1B  補齊 main 的 canonical migration 可重建性，讓每張 PR 跑完整 local integration／E2E
Phase 2   DB／Auth／Storage 重型 PR 使用 Supabase Preview Branch，最多 2 條付費分支
Phase 3   完整 Terra 上限由 1 提升到 2，remote canonical TEST／Sol Audit／merge 仍各自單線
```

不得跳過前一階段的驗收，直接提高 Terra 上限。

## Phase 1A：隔離基礎 canary

新增 `TEST_PROFILE`：

```text
SOURCE_ONLY             不需要資料庫整合測試
LOCAL_ISOLATED          一個 PR 對一個臨時本機 Supabase，Phase 1B 才可完整啟用
LOCAL_ISOLATED_CANARY   只驗證兩個本機環境確實互不共用
REMOTE_BRANCH_REQUIRED  Phase 2 候選，尚未代表分支已建立
SHARED_CANONICAL        最終遠端 TEST，仍使用唯一 TEST holder
```

`LOCAL_ISOLATED_CANARY` 在兩個 runner 使用相同 tenant primary key（主鍵）並保持資料同時存在。
若兩條 job 其實共用一個資料庫，第二次 insert 必定撞號；只有真正隔離，兩邊才會同時成功。
每條 job 都必須以 `supabase stop --no-backup` 清理。

Canary 綠燈只能記：

```text
ISOLATION_CANARY_GREEN
```

它不能證明完整產品測試已可本機執行，也不能取代 remote canonical TEST。

## Phase 1B：migration 可重建性

第一次 canary run 已證明兩個 local stack 能同時啟動、套用 repo migration、匯出 local key、
驗證 localhost 並清理；但完整 integration 在 seed 前置作業 fail closed（不確定就停止）：

```text
main 的 supabase/migrations 只到 0014
remote TEST migration history 已包含多個未合併候選，直到 0064 等版本
main seed 需要 trips／trip_plans／trip_departures 等後續表
fresh local database 無法只靠 current main 完整重建
```

這是 source migration drift（程式碼與資料庫更新檔不同步），不是 local slot 互相污染。

Phase 1B 必須建立「只由已合併／正式採用變更組成」的 canonical migration ledger。禁止：

- 把 remote TEST 的所有候選 schema 直接 dump 後冒充 main；
- 把 open PR 的全部 migration 無審查複製進 main；
- 把 seed 改成忽略必要表缺失；
- 讓 local workflow 讀 remote TEST secret 偷跑。

只有 current main 從空白 Postgres 可完整套 migration、跑標準 seed、integration、E2E 並清理，
才可記 `ISOLATED_GREEN`。

## Local 與 remote 證據邊界

任何要 merge／close 的 runtime 候選仍需：

```text
LOCAL_ISOLATED（前置快速證據）
→ SHARED_CANONICAL（最終遠端 TEST）
→ Sol Audit
→ merge／close Completion Truth Gate
```

Phase 1A／1B 都不改 `MAIN_TERRA max 1`。

## Phase 2 成本與安全閘門

Supabase Preview Branch 是計費資源。2026-09-01 由 Supabase live tool 查得當時費率為：

```text
US$0.01344 / 小時 / 每條 branch
```

當時 TEST project `nmwhwngojosmagjuvxol` 的 development branch 數量為 0。

真正建立 branch 前必須：

1. 重新查當下費率；
2. 取得 Owner 對費率與最多 2 條的明確成本確認；
3. 設定 lease／expiry 與刪除責任；
4. 確認 branch 不含 Production data；
5. 禁止呼叫 `merge_branch`；
6. 測試結束、PR 關閉或逾時後，重新查證 branch 已刪除。

沒有成本確認時，只能提交分類器、Skill、文件與刪除護欄，不能建立付費 branch。

## Phase 3 啟用條件

只有全部成立，才可把完整 Terra 上限改成 2：

```text
AVAILABLE_ISOLATED_TEST_SLOTS >= 2
Phase 1A 兩條 canary 都綠且清理成功
Phase 1B 完整 local integration／E2E 可重現
REMOTE_BRANCH slot／刪除護欄已驗證（重型工作需要時）
兩條候選 TEST_ENV_ID 不同
hot files／primary Issue 不重疊
remote canonical TEST max 1
Sol Audit max 1
merge max 1
```

任一隔離 slot 不健康、清理失敗、費用失控或結果與 canonical TEST 衝突，立即降回
`FULL_TERRA_MAX=1`。

即使技術上能同時啟動兩條完整 Terra，也要先以 3 個完整 Run 觀察：

- Delivery Unit 是否上升；
- weighted usage／Delivery Unit 是否下降或持平；
- 品質與安全是否沒有下降；
- carryover、Sol 重讀與 post-merge regression 是否沒有增加。

## 不變的單線

```text
REMOTE_CANONICAL_TEST max 1
SOL_AUDIT             max 1
MERGE                 max 1
```

## 安全邊界

- Production DDL／DML／migration／deploy：未另行授權，一律禁止。
- 真實付款／退款／顧客通知：禁止。
- 本機測試不得讀遠端 TEST secrets，也不得載入 `.env.local` 的 Production 設定。
- Preview Branch 只能從 TEST project 建立，不得建立在 Production project。
- 完成主張必須通過 Completion Truth Gate。
