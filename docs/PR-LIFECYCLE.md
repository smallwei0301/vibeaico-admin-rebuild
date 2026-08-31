# PR Lifecycle 與 Janitor 規則

> 最新 Owner WIP Decision：`docs/decisions/2026-08-31-owner-multi-terra-test-serial.md`（Mode C）。
>
> `docs/decisions/2026-08-31-owner-global-wip-cap.md` 是同日較早的歷史決策；其
> 「全 repo 最多 1 Terra／最多 2 active candidates」已被最新 Owner 裁示取代。
>
> 原 PR Janitor Decision：`docs/decisions/2026-08-31-multi-agent-pr-lifecycle.md` 的 stale PR
> 清理、同 Issue 單 owner 與 fail-closed 機制繼續保留。
>
> 本文件是 `docs/AGENT-EXECUTION.md` §6 的機械化實作補充。衝突時依序採用：最新
> Owner Decision → `docs/AGENT-EXECUTION.md` → 本文件。

## 1. 目的與 Mode C 拓撲

PR Janitor 的目的仍是清除 stale（過時）、重複與已被取代的候選。施工拓撲為：

```text
不同 Issue 可各有 1 條 active TERRA_BUILD
全 repo 最多 1 條 LUNA_CLOSURE
全 repo 最多 1 條 shared TEST_VALIDATION
每 Issue 最多 1 ACTIVE implementation + 1 VALIDATION/canary
```

因此：

- 不同 Issue 的 Terra implementation PR 可以同時 active。
- 同一個中大型 Issue 只允許一位 Terra owner 與一張 ACTIVE implementation PR。
- 共用 TEST Supabase 的 migration／reset／seed／schema cache mutation／integration／E2E
  全域序列化。
- PR 歷史保留在 closed PR、commit 與 comment，不靠長期維持重複 open PR 保存。
- parked、historical、owner-gated PR 不派 agent、不盲跑 CI、不占 shared TEST。

## 2. Repo 與每個 Issue 的 PR 預算

### 全 repo

- **可以有多張不同 Issue 的 active Terra implementation PR。**
- 最多 `1` 條 repo-wide `LUNA_CLOSURE`。
- 最多 `1` 條 shared `TEST_VALIDATION`。
- 不設定 repo-wide `ACTIVE_CANDIDATE` 數量上限。

### 每個 Issue

每個 Issue 最多：

- `1` 個 lifecycle `ACTIVE` implementation candidate；
- 必要時 `1` 個短命 `VALIDATION`／canary PR。

同一 Issue 若出現第 3 張 candidate，Janitor 必須立即盤點收斂。不同 Issue 的合法 active
candidate 不互相占 quota，也不得僅因 repo 已有其他 Terra 而被標成 PARKED。

## 3. Machine-readable lifecycle metadata

新 PR 應保留：

```text
<!-- pr-lifecycle
issue: 40
state: ACTIVE
supersedes: 59,72
-->
```

欄位：

- `issue`：單一主要 Issue number。active Terra 必填，供 Guard 判斷「同 Issue 是否重複施工」。
- `state`：`ACTIVE`、`VALIDATION`、`REBUILD_REQUIRED` 或 `OWNER_GATED`。
- `supersedes`：被此 PR 明確取代的 PR number，以逗號分隔；沒有則留空。

這個 block 處理同 Issue ownership、candidate budget 與 supersession。repo-wide Closure／TEST
限制由 Agent lane metadata 與 `agent-wip-guard` 處理。兩種 metadata 都必須保留。

舊 PR 若沒有 lifecycle metadata，Janitor 可先用 title 與 branch 的 Issue 訊號盤點；無法
唯一判斷時維持 `JANITOR_REVIEW`，不得猜測，也不得把它當 active Terra 自動續工。

## 4. Janitor 分類

### ACTIVE

目前可作該 Issue 的 implementation／acceptance candidate。不同 Issue 可以同時有各自 ACTIVE。

### VALIDATION

短命 canary、驗證或環境確認 PR。不得長期承載正式 implementation ownership，也不得
繞過 shared TEST 單線。

### SUPERSEDED

舊 PR 已被同 Issue 的新 ACTIVE candidate 完整取代。歷史仍保留，但不再作 merge／
acceptance candidate。

### REBUILD_REQUIRED

main／foundation 已前進、同 Issue 已有另一個 canonical owner，或此候選需要重建後才可
驗收。**不得因為另一個不同 Issue 正在 Terra BUILD 就標 REBUILD_REQUIRED。**

### OWNER_GATED

只差 Owner、Production、正式 provider 或外部人工門檻。可保持 open，但不占 Terra
施工資源或 shared TEST queue，除非外部條件改變後重新 TRIAGE。

### JANITOR_REVIEW

疑似 stale／duplicate，但硬證據不足。Luna 壓縮差異後，必要時才交 Sol。

## 5. 何時必須跑 Janitor sweep

1. 新 candidate PR 建立；
2. PR synchronize／rebase／rebuild；
3. main 有新 merge；
4. Issue 進入 AUDIT；
5. 長程 `/goal` checkpoint；
6. 手動 `workflow_dispatch`。

Janitor sweep 是 repo-wide `LUNA_CLOSURE` 的一部分，不是第二套產品 BUILD 流程。它可以
和多個不同 Issue Terra 同時存在。

## 6. 自動關閉的 fail-closed 規則

GitHub automation 只有在全部成立時，才可自動關閉 superseded PR：

1. 新 PR lifecycle metadata 明確列出 `supersedes: <old-pr>`；
2. source 與 target 不得相同；
3. 新舊 PR 對應**同一主要 Issue**；
4. 舊 PR 仍 open；
5. source 來自同一 repository；
6. GitHub compare 證明新 head 包含舊 head，狀態為 `ahead` 或 `identical`；
7. mutation 前重新 fetch source 與 target，head／state 仍與檢查時一致；
8. 沒有 API、權限或 compare 不確定性。

任一條無法證明，就改成 `JANITOR_REVIEW`，不得自動 close。

特別注意：

- rebuild、cherry-pick、squash 或手工重建可能讓 ancestry 無法直接證明，必須由 Luna
  核對 changed files／patch coverage。
- migration、安全、付款、Auth、權限與通知有獨有差異時交 Sol。
- `supersedes` 誤填自己時回 `SELF_SUPERSESSION` 並保持 open。
- Janitor **不得因不同 Issue 同時有 Terra** 就關閉其中任何一張合法 candidate。
- Janitor 也不得為了提高吞吐而放寬 same-Issue ancestry／coverage 證據。

## 7. 關閉 SUPERSEDED PR 的標準動作

1. 在舊 PR 留下 `Superseded by PR #N` 記錄；
2. 說明它不再是 merge／acceptance candidate；
3. 關閉舊 PR；
4. 不再 rerun 舊 PR CI；
5. 不刪歷史 branch、commit 或 evidence，除非另有安全理由。

## 8. 角色責任

### Terra

- **一位 Terra 對一個中大型 Issue 負責。不同 Issue 可以有不同 Terra 同時施工。**
- 建立候選時填 lifecycle 與 lane metadata，active Terra 必須有 `issue:<number>`。
- rebuild 取代同 Issue 舊 PR 時明確列 `supersedes`。
- source／unit／typecheck／build 可平行；需要 shared TEST 時排隊，不得搶 TEST holder。
- 不得接手另一位 Terra 已 active 的同 Issue。

### Luna

- 固定擔任 repo-wide `LUNA_CLOSURE`／PR Janitor。
- 可做 open PR inventory、Issue grouping、ancestry／changed-file 核對、stale comment、
  evidence 整理與機械 closeout。
- 無法證明 patch 完整承接時，輸出最小差異包，不做產品判斷。
- 發現中大型 code 缺口時交回 Sol 為**該 Issue**建立／調整 Terra lane；不阻擋其他
  已合法 active 的不同 Issue Terra。

### Sol

只在以下情況介入：

- close-first TRIAGE，挑選可並行且 scope 不衝突的 Issue；
- 不同 Terra 的核心 file/scope ownership 衝突；
- 新舊候選有獨有 code／migration／security 差異；
- 不確定 canonical candidate；
- 高風險 DIAGNOSE 或最後 AUDIT。

Sol 不應做一般 ancestry 比對、PR 搬運、CI 輪詢或機械 closeout。

## 9. 自動化介面

- Janitor：`node scripts/agents/pr-janitor.mjs`
- 預設 dry-run；GitHub workflow 以 `--apply` 執行，但只按 §6 關閉。
- 本機／agent 可用 `npm run agent:pr-janitor -- --dry-run`。
- Hook 在 PR lifecycle event、`main` push 與手動 dispatch 執行；`pull_request_target` 只接受
  同 repo source，並 checkout trusted default-branch code。
- `agent-wip-guard` 檢查：
  - 同 Issue active Terra ≤ 1；
  - repo-wide Luna Closure ≤ 1；
  - shared TEST_VALIDATION ≤ 1；
  - 每 Issue active candidates ≤ 2；
  - parked PR synchronize 與必要 metadata。
- Guard **不再設定 repo-wide Terra 或 active-candidate 數量上限**。

## 10. 成效量測

每輪至少觀察：

```text
open_prs
active_terra_peak
active_terra_issue_count
same_issue_multi_terra_violations
shared_test_peak
shared_test_collisions
closure_sweeps
superseded_prs_closed
janitor_reviews_requiring_sol
invalid_ci_reruns
closed_issues
```

成功標準：不同 Issue 可以有效平行，`same_issue_multi_terra_violations=0`、
`shared_test_peak=1`、`shared_test_collisions=0`、stale PR 能安全收斂，且 closed Issue 持續增加。
