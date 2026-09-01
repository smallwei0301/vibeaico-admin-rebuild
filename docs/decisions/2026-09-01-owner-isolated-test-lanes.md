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
Phase 1  每張 PR 使用本機 Supabase 隔離測試
         + 現有遠端 TEST 保留為最終 canonical 驗收

Phase 2  DB／Auth／Storage 重型 PR 使用 Supabase Preview Branch
         + 同時最多 2 條付費分支

Phase 3  完整 Terra 上限由 1 提升到 2
         + remote canonical TEST／Sol Audit／merge 仍各自單線
```

不得跳過前一階段的驗收，直接提高 Terra 上限。

## Phase 1 立即生效範圍

新增 `TEST_PROFILE`：

```text
SOURCE_ONLY             不需要資料庫整合測試
LOCAL_ISOLATED          一個 PR 對一個臨時本機 Supabase
LOCAL_ISOLATED_CANARY   僅供測試基礎設施，平行啟動兩個獨立 runner
REMOTE_BRANCH_REQUIRED  Phase 2 候選，尚未代表分支已建立
SHARED_CANONICAL        最終遠端 TEST，仍使用唯一 TEST holder
```

`LOCAL_ISOLATED` 綠燈只代表：

```text
ISOLATED_GREEN
```

不能寫成：

```text
CANONICAL_GREEN
```

任何要 merge／close 的 runtime 候選，仍需現有遠端 `TEST_VALIDATION`、Sol Audit 與完成事實
閘門。Phase 1 不改 `MAIN_TERRA max 1`。

## Phase 2 成本與安全閘門

Supabase Preview Branch 是計費資源。2026-09-01 由 Supabase live tool 查得目前費率為：

```text
US$0.01344 / 小時 / 每條 branch
```

目前 TEST project `nmwhwngojosmagjuvxol` 的 development branch 數量為 0。

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
LOCAL_ISOLATED canary 兩條都綠且清理成功
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

以下永遠先保持單線，除非 Owner 另有新裁示：

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
