# PR Lifecycle 與 Janitor 規則

> 最新 Owner WIP Decision：`docs/decisions/2026-08-31-owner-global-wip-cap.md`。
>
> 原 PR Janitor Decision：`docs/decisions/2026-08-31-multi-agent-pr-lifecycle.md`，其 stale PR
> 清理與 fail-closed 機制仍保留，但「不同 Issue 可多 Terra 平行」已被較新 Owner 裁示取代。
>
> 本文件是 `docs/AGENT-EXECUTION.md` §6 的機械化實作補充。衝突時依序採用：最新
> Owner Decision → `docs/AGENT-EXECUTION.md` → 本文件。

## 1. 目的與全域上限

PR Janitor 的目的仍是清除 stale（過時）與重複候選，但施工拓撲已改為：

```text
全 repo 最多 1 條 active TERRA_BUILD
固定 1 條 LUNA_CLOSURE
最多 1 條 shared TEST_VALIDATION
最多 2 張 ACTIVE_CANDIDATE PR
```

因此：

- 不同 Issue 可以各自保留 parked、historical 或 owner-gated PR，但不能同時各占一條
  active Terra BUILD。
- 一個中大型 Issue 仍只允許一位 Terra owner。
- 共用 TEST Supabase 的 migration／reset／seed／integration／E2E 全域序列化。
- PR 歷史保留在 closed PR、commit 與 comment，不靠長期維持 open／active 保存。

## 2. Repo 與每個 Issue 的 PR 預算

### 全 repo

同時最多：

- `1` 個 active `TERRA_BUILD` implementation candidate；
- `1` 個 active `LUNA_CLOSURE` candidate，或 Terra 明確回報 `EMPTY_WITH_SCAN`；
- `1` 個 active `TEST_VALIDATION` lane；
- `2` 個 `ACTIVE_CANDIDATE=true` PR。

### 每個 Issue

原則上每個 Issue 仍只允許：

- `1` 個 `ACTIVE` implementation candidate；
- 必要時最多 `1` 個短命 `VALIDATION`／canary PR。

若同一 Issue 出現第 3 個 open PR，Janitor 必須立即盤點收斂。即使沒有超過每 Issue
預算，若全 repo 已有 active Terra，其他 Issue 的 implementation PR 也必須標成
`REBUILD_REQUIRED`、`OWNER_GATED`、`PARKED` 或 historical，不得繼續施工。

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

- `issue`：單一主要 Issue number。
- `state`：`ACTIVE`、`VALIDATION`、`REBUILD_REQUIRED` 或 `OWNER_GATED`。
- `supersedes`：被此 PR 明確取代的 PR number，以逗號分隔；沒有則留空。

這個 block 處理「同一 Issue 的候選與 supersession」。全域 Terra／Closure／TEST／candidate
上限則由 PR body 的 Agent lane metadata 與 `agent-wip-guard` 處理。兩種 metadata 都必須
保留，不能互相取代。

舊 PR 若沒有 lifecycle metadata，Janitor 可先用 title 與 branch 的 Issue 訊號盤點；
無法唯一判斷時維持 `JANITOR_REVIEW`，不得猜測。

## 4. Janitor 分類

### ACTIVE

目前可作 merge／acceptance candidate 的 PR。它仍須符合全域 WIP 上限；不是每個 Issue
都能同時有 ACTIVE Terra。

### VALIDATION

短命 canary、驗證或環境確認 PR。不得長期承載正式 implementation ownership，也不得
繞過共用 TEST lane。

### SUPERSEDED

舊 PR 已被新的 ACTIVE candidate 完整取代。歷史仍保留，但不再作 merge／acceptance
candidate。

### REBUILD_REQUIRED

main／foundation 已前進，或該 Issue 目前不持有唯一 Terra lane。保留工作，但不得推新
commit、rerun 或輪詢，直到 Sol 重新選為 active。

### OWNER_GATED

只差 Owner、Production、正式 provider 或外部人工門檻。可保持 open，但不得占 BUILD
agent 或 active candidate 預算。

### JANITOR_REVIEW

疑似 stale／duplicate，但硬證據不足。Luna 壓縮差異後，必要時才交 Sol。

## 5. 何時必須跑 Janitor sweep

1. 新 candidate PR 建立；
2. PR synchronize／rebase／rebuild；
3. main 有新 merge；
4. Issue 進入 AUDIT；
5. 長程 `/goal` checkpoint；
6. 手動 `workflow_dispatch`。

Janitor sweep 是固定 `LUNA_CLOSURE` 的一部分，但不等於可以開第二條 Terra。

## 6. 自動關閉的 fail-closed 規則

GitHub automation 只有在全部成立時，才可自動關閉 superseded PR：

1. 新 PR lifecycle metadata 明確列出 `supersedes: <old-pr>`；
2. source 與 target 不得相同；
3. 新舊 PR 對應同一主要 Issue；
4. 舊 PR 仍 open；
5. source 來自同一 repository；
6. GitHub compare 證明新 head 包含舊 head，狀態為 `ahead` 或 `identical`；
7. 沒有 API、權限或 compare 不確定性。

任一條無法證明，就改成 `JANITOR_REVIEW`，不得自動 close。

特別注意：

- rebuild、cherry-pick、squash 或手工重建可能讓 ancestry 無法直接證明，必須由 Luna
  核對 changed files／patch coverage。
- migration、安全、付款、Auth、權限與通知有獨有差異時交 Sol。
- `supersedes` 誤填自己時回 `SELF_SUPERSESSION` 並保持 open。
- Janitor 不能以舊的「多 Terra 平行」決策為由關閉符合最新 global WIP 的治理 PR。

## 7. 關閉 SUPERSEDED PR 的標準動作

1. 在舊 PR 留下 `Superseded by PR #N` 記錄；
2. 說明它不再是 merge／acceptance candidate；
3. 關閉舊 PR；
4. 不再 rerun 舊 PR CI；
5. 不刪歷史 branch、commit 或 evidence，除非另有安全理由。

## 8. 角色責任

### Terra

- 全 repo 同時只施工目前唯一 active 中大型 Issue。
- 建立候選時填 lifecycle 與 lane metadata。
- rebuild 取代舊 PR 時明確列 `supersedes`。
- 沒拿到 Terra lane 的其他 Issue 保持 parked／rebuild required，不繼續推進。

### Luna

- 固定擔任 `LUNA_CLOSURE`／PR Janitor。
- 可做 open PR inventory、Issue grouping、ancestry／changed-file 核對、stale comment、
  evidence 整理與機械 closeout。
- 無法證明 patch 完整承接時，輸出最小差異包，不做產品判斷。
- 發現中大型 code 缺口時交回 Sol，不自行變成第二條 Terra。

### Sol

只在以下情況介入：

- close-first TRIAGE 與唯一 Terra lane 選擇；
- 新舊候選有獨有 code／migration／security 差異；
- 不確定 canonical candidate；
- 高風險 DIAGNOSE 或最後 AUDIT。

Sol 不應做一般 ancestry 比對、PR 搬運或機械 closeout。

## 9. 自動化介面

- Janitor：`node scripts/agents/pr-janitor.mjs`
- 預設 dry-run；GitHub workflow 以 `--apply` 執行，但只按 §6 關閉。
- 本機／agent 可用 `npm run agent:pr-janitor -- --dry-run`。
- Hook 在 PR lifecycle event、`main` push 與手動 dispatch 執行；`pull_request_target` 只接受
  同 repo source，並 checkout trusted default-branch code。
- `agent-wip-guard` 額外檢查全域 Terra／Closure／TEST／candidate 上限與 parked push。

## 10. 成效量測

每輪至少觀察：

```text
open_prs
active_terra_peak
active_candidate_peak
closure_sweeps
superseded_prs_closed
janitor_reviews_requiring_sol
invalid_ci_reruns
closed_issues
```

成功標準是：全 repo 同時只有一條 Terra Build，固定一條 Closure Sweep，stale PR 能安全
收掉，並讓 Issue 持續關閉，而不是多張大型 Draft 同時在製。
