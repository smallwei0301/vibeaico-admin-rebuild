# Owner Decision — 多環境 Base Freshness 與 Rebase 成本收斂

> 日期：2026-09-10
> Issue：#337
> 來源：Owner 明確要求多個 Agent／環境同時作業時，不要因無關 `main` 前進反覆 rebase、重跑 CI 或重做 Final Risk；保留真正 migration/schema/契約碰撞時的安全對齊。

## 1. 核心決策

開工仍必須先 `git fetch origin --prune`，並從當時最新 `origin/main` 建立 implementation base。

**但 branch 建立之後，`main` 的每一次前進不再自動構成 rebase 理由。**

以下情況本身都不足以要求 rebase：

- 另一個 Session 合併無關 docs；
- 另一個 Agent 合併與本 PR 無檔案／契約交集的產品功能；
- branch 只因時間經過而顯示 behind；
- Final Risk review 的 `baseSha` / `headSha` 已不是 current main/head，但 semantic `changeDigest` 仍相同。

多環境下，這些都是正常並行，不是錯誤。

## 2. PB-015 的新解讀

PB-015 的事故與核心教訓保留：**不同 base 的測試結果不能互相冒充同一份證據。**

但 PB-015 舊預防句「帶 migration 的分支一律壓成置於 main 之上的單一 commit」從本決策起被 supersede，不再是全域 invariant。

新的 invariant 是：

> 每一份 CI／migration integrity／TEST 證據都必須明確知道自己比較的 base/head；不能因 `base_revision` 缺失而偷偷 fallback 到另一個 revision，也不能拿舊 base 的結果宣稱證明新 base。

`HEAD^ == origin/main` 只可作為某次特定驗證的 branch-shape 選擇，不得再被 Agent 當成所有 migration PR 永遠必須滿足的條件。

## 3. 什麼情況真的要重新對齊

任何一項成立，才需要 rebase、merge-main、renumber 或重新建立候選：

1. **Migration ledger material change**：current main 新增／重新編號 migration，使本 PR prefix 撞號、低於現行可接受序列，或同名 migration 契約改變。
2. **實際 Git conflict**：GitHub 無法建立乾淨 merge candidate，或共同檔案發生內容衝突。
3. **Shared contract changed**：main 改到本 PR 依賴的 auth、schema、API contract、payment/booking invariant、共同型別或其他 acceptance 前提。
4. **Required CI proves integration breakage**：最新 required check 在 GitHub 合成 merge context 或指定驗證 context 中，因 main 的新內容與本 PR 組合而失敗。
5. **Final Risk semantic input changed**：PR changed-file blob / `changeDigest`、schema baseline、Final Risk policy 或最新可信 verdict 真正改變。

若只有 unrelated main advancement，以上皆不成立，**不要 rebase**。

## 4. Migration 特別規則

Migration branch 不需要為無關 docs commit 追 main，但合併前仍必須重新讀 current main 的 migration inventory。

- prefix 無碰撞、既有 migration 無被本 PR 修改／刪除、schema 前提未改 → 不為 freshness 單獨 rebase；
- prefix 被其他分支先佔 → renumber 並重新驗證相關 migration evidence；
- current main schema/migration 改變會影響本 migration → 重新對齊並重跑受影響測試；
- 已套用過 TEST/Production 的 migration 不回頭改檔，仍遵守 PB-017。

因此安全防線從「一直追最新 main」改成「合併前檢查真正會互撞的 migration truth」。

## 5. Final Risk 與 CI

依 #332 / #335：

- semantic Final Risk 綁 `changeDigest`，不綁 commit 身分；
- 純 base movement 且 digest 相同，不重派 Astra/Fable；
- required CI 與 semantic review 是兩份不同證據，新的 CI run id 不應讓舊 semantic PASS 自己失效；
- 若 content/schema/policy 真改變，才重新 Final Risk。

## 6. Branch protection 目標

#335 負責 GitHub administration steady state：

- `check` 保留 required；
- `Agent WIP Policy` 保留 required；
- `required_status_checks.strict=false`，取消「一定要追到最新 main 才可 merge」的 freshness coupling；
- 不開 force push；
- 不開 broad permanent bypass。

Branch protection 管 merge eligibility；本決策管 Agent 不要自己製造無效 rebase。兩邊必須一起收斂，否則其中一邊仍會把並行工作拖回串行。

## 7. Agent 行為

看到 `main advanced` / `branch behind` 時，Agent 第一個問題應是：

> **「main 改了什麼，是否 material to this PR？」**

不是：

> 「main 動了，所以先 rebase。」

若判定 unrelated，記錄 current main 與判斷依據後繼續；不要 force-push、不要重跑 semantic reviewer、不要把 Owner 叫回來重新蓋章。

## 8. Safety boundary

本決策不授權 Production DDL/DML、deploy、LINE webhook、付款／退款或顧客通知；不降低 tenant/auth/payment/migration collision 的內容安全標準。它只移除與內容無關的 branch freshness 成本。