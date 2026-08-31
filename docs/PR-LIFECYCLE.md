# PR Lifecycle 與 Janitor 規則

> Owner Decision：`docs/decisions/2026-08-31-multi-agent-pr-lifecycle.md`。
> 本文件是 `docs/AGENT-EXECUTION.md` §6 的機械化實作補充。
> 若執行文件仍殘留較舊的全 repo 單 Terra／兩個 candidate 限制，以較新的 Owner Decision 為準並先 reconciliation；其餘衝突以 `docs/AGENT-EXECUTION.md` 為準。

## 1. 目的

本 repo 允許多個 Issue 由不同 Terra 平行施工，但不允許同一 Issue 因反覆 rebuild、CI 驗證或 main 前進而累積多個長期 open Draft PR。

目標是同時提高施工吞吐量與降低 stale PR 數量：

- 不同 Issue 可以平行 BUILD；
- 一個中大型 Issue 同時間只由一位 Terra owner；
- 共用 TEST Supabase 的 migration/reset/seed/integration/E2E 仍保持單線序列化；
- PR 歷史保留在 closed PR、commit 與 comment，不靠維持 open 狀態保存。

## 2. 每個 Issue 的 PR 預算

原則上每個 Issue 只允許：

- `1` 個 `ACTIVE` implementation/integration candidate；
- 必要時最多 `1` 個短命 `VALIDATION` / canary PR。

若同一 Issue 出現第 3 個 open PR，Janitor 必須立即盤點並收斂，不得把「之後可能有用」當成保留理由。

這是**每個 Issue 的預算**，不是整個 repo 只能有兩個 candidate。不同 Issue 可各自保有一個 ACTIVE candidate。

## 3. Machine-readable lifecycle metadata

新 PR 應在 body 保留以下註解區塊：

```text
<!-- pr-lifecycle
issue: 40
state: ACTIVE
supersedes: 59,72
-->
```

欄位：

- `issue`: 單一主要 Issue number。
- `state`: `ACTIVE`、`VALIDATION`、`REBUILD_REQUIRED` 或 `OWNER_GATED`。
- `supersedes`: 被此 PR 明確取代的 PR number，以逗號分隔；沒有則留空。

此區塊是 agent、Janitor script 與 GitHub Actions 的共同契約。人類可在其外自由撰寫一般 PR 說明。

舊 PR 若尚未加入 metadata，Janitor 可先用 PR title 與 branch 的 Issue 訊號做 primary Issue inventory；PR body 只作次要訊號，避免依賴段落裡的其他 Issue／PR 編號讓分類失真。無法唯一判斷時維持 `JANITOR_REVIEW`。

## 4. Janitor 分類

Luna / Janitor 對 open PR 使用以下狀態：

### ACTIVE

目前唯一可作 merge / acceptance candidate 的 implementation PR。

### VALIDATION

短命 canary、驗證或環境確認 PR。不得長期承載正式 implementation ownership。

### SUPERSEDED

舊 PR 已被新的 ACTIVE candidate 完整取代。歷史價值存在，但不再作 merge / acceptance candidate。

### REBUILD_REQUIRED

main 或必要 foundation 已前進，舊 candidate 需要由原 Terra 在新 base 重建後才能再次成為 ACTIVE。

### OWNER_GATED

剩餘工作只差 Owner 明確授權、正式 provider 設定、Production 行為或其他人工門檻。此類 PR 可以保持 open，但不得佔用 BUILD agent。

### JANITOR_REVIEW

自動化偵測到可能 stale / duplicate，但無法用硬證據證明安全收掉。交 Luna 壓縮差異後，必要時才交 Sol。

## 5. 何時必須跑 Janitor sweep

以下事件都要觸發一次 sweep：

1. 新 candidate PR 建立；
2. PR synchronize / rebase / rebuild；
3. main 有新 merge；
4. Issue 進入 AUDIT；
5. 長程 `/goal` checkpoint；
6. 手動 `workflow_dispatch`。

不得等新 PR merge 後才整理舊 PR。

## 6. 自動關閉的 fail-closed 規則

GitHub automation 只能在全部條件成立時自動關閉 superseded PR：

1. 新 PR machine-readable metadata 明確列出 `supersedes: <old-pr>`；
2. source 與 target 不得是同一個 PR；
3. 新舊 PR 對應同一主要 Issue；
4. 舊 PR 仍是 open；
5. source 必須來自同一個 repository，不接受 fork PR 取得自動 close 權限；
6. GitHub commit compare 證明新 head 包含舊 head，compare status 為 `ahead` 或 `identical`；
7. 沒有 API / 權限 / compare 不確定性。

任一條無法證明，就不得自動關閉，改標為 `JANITOR_REVIEW`。

特別注意：

- branch rebuild、cherry-pick、squash 或手工重建常會讓 commit ancestry 無法直接證明完整承接；這種情況必須保留 PR，直到 Luna 核對 changed files / patch coverage。
- migration、安全、付款、Auth、權限、通知等高風險差異，只要有獨有變更就交 Sol，不由 Janitor 猜測。
- `supersedes` 若誤填自己，script 必須回 `SELF_SUPERSESSION` 並保持 PR open。

## 7. 關閉 SUPERSEDED PR 的標準動作

安全收斂時：

1. 在舊 PR 留下 `Superseded by PR #N` 的 Janitor 註記；
2. 說明它不再是 merge / acceptance candidate；
3. 關閉舊 PR；
4. 不再 rerun 舊 PR CI；
5. 不刪除歷史 branch、commit 或 evidence，除非另有安全理由。

## 8. 角色責任

### Terra

- 專注自己的單一 Issue。
- 不同 Issue 可由不同 Terra 同時施工。
- 建立新 candidate 時填寫 lifecycle metadata。
- 若 rebuild 取代舊 PR，明確列出 `supersedes`。
- 不自行刪除可能仍有獨有變更的舊 PR。

### Luna

- 預設擔任 `PR JANITOR`。
- 可平行執行 open PR inventory、issue grouping、ancestry/changed-file 核對、stale comment、機械 closeout。
- 無法證明 patch 完整承接時，輸出最小差異包，不做產品判斷。

### Sol

只在以下情況介入：

- 新舊 candidate 有獨有 code / migration / security 差異；
- 不確定 canonical ACTIVE candidate；
- 高風險領域或最終 AUDIT。

Sol 不應花 token 做一般 ancestor 比對、PR 搬運或機械 closeout。

## 9. 自動化介面

- 腳本：`node scripts/agents/pr-janitor.mjs`
- 預設為 dry-run inventory。
- GitHub Actions 以 `--apply` 執行，但只會依 §6 的硬條件自動 close。
- 本機或 agent 可使用 `npm run agent:pr-janitor -- --dry-run` 先看分類。
- GitHub hook 在 PR lifecycle event、`main` push 與手動 dispatch 執行；`pull_request_target` 只接受同 repo source，並 checkout trusted default branch code。

## 10. 成效量測

每個 `/goal` round 至少觀察：

- open PR 總數；
- `ACTIVE` PR 數；
- 同一 Issue 超過 PR budget 的數量；
- 本 round 自動/人工收掉的 `SUPERSEDED` PR 數；
- `JANITOR_REVIEW` 需要 Sol 的比例；
- stale PR CI 無效 rerun 次數。

成功標準不是「PR 數越少越好」，而是：不同 Issue 保持平行施工，同一 Issue 不累積殭屍 candidate。
