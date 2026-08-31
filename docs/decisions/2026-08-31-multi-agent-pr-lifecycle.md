# Owner Decision：多 Issue 多 Agent 平行施工與 PR Lifecycle Janitor

> Owner 裁示日期：2026-08-31
> 狀態：已裁示，repo governance

## 決策摘要

專案採用「**不同 Issue 可由不同 Terra 平行施工；同一中大型 Issue 只由一位 Terra owner；共用 TEST 資源全域序列化**」的模式。

這個決策的目的不是無限制增加 WIP，而是把限制放在正確的位置：

- **BUILD ownership 限制以 Issue 為單位**，不是全 repo 只能有一位 Terra；
- **共享 TEST Supabase** 的 migration/reset/seed/integration/E2E 仍維持全 repo 單線；
- **PR lifecycle 限制以 Issue 為單位**，避免同一 Issue 因 rebuild、rebase、CI candidate 反覆新增而累積 stale Draft；
- Luna 常駐負責 PR Janitor 與機械收斂，Sol 不用消耗高階模型做一般 PR 搬運。

任何尚未合併、主張 `TERRA_BUILD max 1` 或 `ACTIVE_CANDIDATES max 2` 為全 repo 硬上限的舊治理草案，若與本決策衝突，**以本決策為準並需先 reconciliation，不得直接覆蓋本決策**。

## 1. BUILD 併行模型

允許：

```text
Terra A → Issue #40
Terra B → Issue #41
Terra C → Issue #9
Terra D → Issue #26
```

前提是各 Issue 的責任範圍、branch/PR、依賴與資料庫使用沒有互相踩線。

禁止：

```text
Terra A ┐
        ├→ 同一個中大型 Issue #40 競作不同修法
Terra B ┘
```

若同一 Issue 已有可接續 candidate，優先接續或重建該 candidate，不開重複 BUILD ownership。

## 2. 全域只能單線的資源

以下仍是全 repo 序列化資源：

- TEST Supabase migration；
- reset / seed；
- 會共享同一 TEST DB 狀態的 integration；
- 對同一共享 TEST fixture 有寫入副作用的 E2E。

TEST lane 被占用時，不代表其他 Terra 停工。其他路線繼續 source、targeted unit、docs、靜態檢查、可安全 Preview 驗證或其他不碰撞工作。

## 3. 每個 Issue 的 PR 預算

每個 Issue 原則上最多同時保留：

- `1` 個 `ACTIVE` implementation/integration candidate；
- 必要時 `1` 個短命 `VALIDATION` / canary PR。

同一 Issue 出現第 3 個 open PR 時必須立即進 Janitor sweep。

這不是限制整個 repo 只能有兩個 active PR。不同 Issue 可以各自擁有一個 ACTIVE candidate，只要 BUILD ownership 與共享 TEST 資源符合本決策。

## 4. Luna PR Janitor

Luna 的跨階段常駐職責包含：

- 盤點 open PR 並依 primary Issue 分組；
- 判斷 `ACTIVE / VALIDATION / REBUILD_REQUIRED / OWNER_GATED / SUPERSEDED / JANITOR_REVIEW`；
- 核對 ancestry、changed files、patch coverage 與 candidate evidence；
- 對已被安全取代的 PR 留 superseded 註記並關閉；
- 不再替 retired candidate 重跑 CI。

只有遇到獨有 code、migration、安全、付款、Auth、權限、通知差異，或無法判斷 canonical candidate 時才交 Sol。

## 5. 自動化必須 fail-closed

機器不得只因 PR 較舊、base 落後或名稱相似就自動關閉。

自動 close 至少必須有：

1. machine-readable `supersedes` 明確宣告；
2. 新舊 PR primary Issue 相同；
3. target PR 仍 open；
4. source 為同 repo branch；
5. GitHub commit ancestry 能證明新 head 包含舊 head。

cherry-pick、squash、手工 rebuild 或 compare 不確定時一律 `JANITOR_REVIEW`，先保留 PR。

## 6. 觸發時機

Janitor sweep 在以下時機自動或機械執行：

- 新 candidate PR 建立；
- candidate synchronize/rebuild；
- `main` 前進；
- Issue 進 AUDIT；
- `/goal` checkpoint；
- 手動 workflow dispatch。

## 7. 與既有角色式模型的關係

產品施工流程仍是：

```text
SCOUT(Luna) → TRIAGE(Sol) → BUILD(Terra)
→ DIAGNOSE(Terra/Sol) → AUDIT(Sol) → CLOSEOUT(Luna)
```

PR Janitor 是 Luna 的跨階段維護工作，不增加新的產品驗收閘門。

Sol 仍只負責優先順序、模糊 CI、高風險判斷與最終 close verdict；一般 ancestor 比對、stale PR 清理與 evidence 搬運不應佔用 Sol。

## 8. 正式實作位置

- canonical execution policy：`docs/AGENT-EXECUTION.md`
- PR lifecycle mechanics：`docs/PR-LIFECYCLE.md`
- repository entry rules：`AGENTS.md`
- agent adapter：`.agents/skills/vibeaico-agent-orchestration/SKILL.md`
- CLI：`scripts/agents/pr-janitor.mjs`
- GitHub hook：`.github/workflows/pr-janitor.yml`
- PR metadata template：`.github/pull_request_template.md`

若上述檔案與本 Owner Decision 發生衝突，應修正實作文件，不得把本決策重新問 Owner。
