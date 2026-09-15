# 文件治理與分支規則

> Owner 首次決策日期：2026-08-27。
>
> 2026-09-15 同步現行 `docs/AGENT-EXECUTION.md`；本次是既有裁示收斂，不新增授權。
>
> 本文件規範本 repo 的產品規格、架構文件、Owner 決策、Issue 與程式分支如何協作。涉及文件治理時必須遵守；日常開工與依任務載入文件的規則以 `docs/AGENT-EXECUTION.md` §2 為準。

## 1. 核心原則

### 1.1 `main` 是正式文件的唯一入口

下列內容一旦定案，正式版本必須存在於 `main`：

- 產品規格與商業規則
- 架構與資料模型
- API 契約與整合分冊
- 測試／驗收標準
- Owner 決策紀錄
- 專案級 agent 指示（`CLAUDE.md`、`AGENTS.md`、`docs/AGENT-EXECUTION.md`）
- Agent 失敗／教訓索引（`docs/AGENT-PLAYBOOK.md`，不得取代 canonical 規格）

功能分支可以有施工筆記與草稿，但**不得把 branch-only 文件當作最後規格**。Issue 也不得只指向某個暫時分支才看得到的正式文件。

### 1.2 一個主題只留一份正式規格

新的產品決策應回併原本的 canonical 文件，不長期維護「舊分冊 + 補充分冊 + Issue 留言」三套互相覆蓋的規格。

- canonical 文件回答：**現在應該怎麼做**。
- `docs/decisions/**` 回答：**為什麼改成這樣、由誰在何時裁示**。
- Issue 回答：**這次要施工哪些項目、怎麼驗收**。

例如行程領域的正式規格放在 `docs/integration/10-TOUR-DOMAIN.md`；Owner Decision 只保存決策背景，不複製另一套會漂移的完整規格。

### 1.3 治理文件的分工

- `docs/AGENT-EXECUTION.md` 是唯一正式操作入口，負責現行 Workstream、B+、授權、安全及停止規則。
- `AGENTS.md`／`CLAUDE.md` 是入口與必要摘要；`docs/AGENT-BPLUS-DELIVERY-LOOP.md` 是 B+ 背景／歷史追溯，不另立一套現行流程。
- `docs/DELIVERY-CHAIN.md` 說明交付流程與證據標準；本文件負責文件版本、更新與分支協作，不取代它們。
- 後續執行裁示先回併 `docs/AGENT-EXECUTION.md` 的既有主題，再同步受影響入口；不得只留在 Issue、對話或另一份補充手冊。

## 2. 哪些修改可以進 `main`

### 2.1 Owner 已明確核准的 docs-only 更新

Owner 明確授權後，純文件變更可使用 docs-only 輕量路徑，**但不得繞過 live branch protection**。只有即時分支保護允許直推時才可直接推送 `main`；若要求 PR／required checks，就使用短期文件分支 → PR → 必要檢查 → 合併，不建立長期功能分支，也不暫時關閉保護。直推授權的路徑白名單原則上只有：

```text
docs/**
CLAUDE.md
AGENTS.md
README.md
```

同一個 docs-only commit **不得混入**：

- `src/**`、`supabase/**`、`package*.json`
- `.env*` 或秘密值
- `.github/workflows/**`、`vercel.json` 等會改變執行流程的設定
- migration、DDL、DML
- 任何會改變正式網站行為的程式碼

`main` 會觸發 Vercel，因此 docs-only 直推前必須先確認 changed files 全部是文件。文件直推的授權，**不等於**正式部署、Production migration 或資料寫入授權。

CI 的 docs-only 輕量路徑與直推授權是兩件事：它只接受 `docs/**`、`README.md`、
`AGENTS.md`、`CLAUDE.md`、`.agents/**`、`.claude/**` 的非空變更；rename 的兩端都必須
在白名單內。任何 workflow、程式、依賴或未知／無法比較的 diff 都必須 fail closed，
改跑完整 runtime CI，不能使用 `paths-ignore` 靜默略過。

### 2.2 程式與資料庫變更

下列工作仍一律走 feature branch → PR → CI → 審核 → merge：

- 前後端程式碼
- API／Auth／排程
- schema、migration、RLS、資料修復
- 依賴與 lockfile
- 部署與 workflow 設定

Production DDL／DML／migration 的授權以 `docs/AGENT-EXECUTION.md` §3.2 與
`docs/PRODUCTION-DB-RELEASE-WORKFLOW.md` 為準：`AUTOMATION_READY` 前保留逐次 Owner gate；
只有 trusted-main 機器證明 `AUTOMATION_READY=true` 且 `POLICY_GATED_ACTIVE`，才在該政策精確範圍內改由完整機器關卡放行，不需第二次啟用裁示或逐次人工批准。
**修改文件、合併 main 或單一 CI 綠燈都不等於啟用自動化，也不授權本輪寫入正式庫。**
缺少證據仍停止受影響操作；reset／seed、災難性刪除不在政策允許範圍。

正式環境部署與會改變正式行為的 `main` merge 仍依 `docs/AGENT-EXECUTION.md` §3 的任務／領域授權。
Production DB 政策不授權網站發布、付款／退款、顧客通知或其他 Production 專案。

## 3. Agent 開工流程

以下只補充**涉及文件治理**的任務，不建立第二套全域開工流程。依 `docs/AGENT-EXECUTION.md` §2：

1. `git fetch origin --prune`，重建 live main 與本次相關 Issue／PR；舊 Session 只當線索。
2. 先讀 `origin/main:AGENTS.md`、`origin/main:CLAUDE.md`、
   `origin/main:docs/AGENT-EXECUTION.md` 與本文件。
3. 只讀 `origin/main:docs/OWNER-DECISIONS.md` 中直接相關的現行裁示，以及命中本範圍的更新 Owner Decision；不得重問已裁示題目。
4. 以 Issue、錯誤碼、測試或領域關鍵字搜尋 `origin/main:docs/AGENT-PLAYBOOK.md`，
   只讀相關教訓。
5. 從 Issue 找到對應 canonical 文件，**以 `main` 版本為準**。
6. **建立新施工分支**時，以當下 current `main` 或已包含必要 canonical decisions 的指定 integration branch 作 base。
   **接續既有分支**時，不因無關 main 前進而 rebase／重建；僅在 material migration-ledger change／prefix collision、實際 merge conflict、shared contract／acceptance precondition 改變，或 CI 證明新 base 實質影響候選時重整。`HEAD^ == origin/main` 不是全域前置條件。
7. 若工作分支的舊文件與 `main` 衝突，以 `main` 的產品／架構規格為準；不得用舊 branch 文件覆蓋新決策。
8. 看不到 Issue 指定的 `main` 文件時只停止受影響路線並回報；其他可施工項目依
   `docs/AGENT-EXECUTION.md` 繼續，不自行猜測。

Issue 應引用穩定 repo path，例如：

```text
docs/integration/10-TOUR-DOMAIN.md
```

不要把某個 branch URL 當成唯一規格入口。

## 4. 文件更新流程

### 4.1 產品決策

1. Owner 裁示。
2. 先更新 canonical 文件。
3. 在 `docs/decisions/YYYY-MM-DD-*.md` 留下簡短理由與影響。
4. 更新相關 Issue 的範圍、前置與驗收。
5. 舊補充文件刪除，或改成只指向 canonical 文件的短引導，避免雙重真相；保留有追溯價值的歷史裁示，不改寫歷史驗證結果。
6. 若是執行規則，依 §1.3 同步操作入口與受影響摘要。文件定案不代表 validator／workflow 已實作；有落差要記錄具體待辦與未驗證項，不能宣稱護欄已生效。

### 4.2 尚未裁示的草稿

未定案內容可放在功能分支或 `docs/drafts/**`，但必須清楚標示 `DRAFT`，不得被 Issue 寫成強制規格。裁示後才回併 canonical 文件並進 `main`。

## 5. Docs-only 合併／直推 main 的安全檢查

推送前：

```bash
git diff --name-only origin/main...HEAD
```

必須逐檔確認都是允許的文件路徑；取得不到完整 diff 時不得假定 docs-only。
先查 live branch protection，要求 PR／required checks 就正常走 PR；輕量 CI 不豁免 required status。
推薦使用一個有界 commit，訊息標明 `docs:`；PR metadata 依 `docs/AGENT-EXECUTION.md` §2.0.1 先做 local／trusted preflight，再 push／dispatch，不用 remote CI 猜合法欄位。
不得為了文件通過而放寬分支保護、TEST、Product Final Risk 或 Production gate。

合併／直推後：

- 依 `docs/AGENT-PROJECT-COMMANDS-AND-TRUTH.md` 重新確認外部狀態。走 PR 時要讀回 `merged`／`merged_at`、merge commit、current main、可達性及 main 關鍵文件；直推則驗證寫入 commit 對 main 可達與 main 文件內容。
- 只收到寫入／merge API 成功不等於完成；未完成回讀不得宣稱文件已成正式版本。
- 確認 canonical 文件已在 `main`。
- 確認 Issue 不再要求 agent 去暫時分支找正式文件。
- 確認開發分支沒有殘留會在未來 merge 時重新引入的重複規格。
- 若 Vercel 因 main push 建置，確認此次 diff 沒有 runtime 變更。

## 6. 衝突優先順序

同一主題出現矛盾時，依序採用：

1. `main` 中最新且明確的 Owner Decision
2. `main` 中 `docs/AGENT-EXECUTION.md` 的執行／權限／安全規則
3. `main` 中該領域 canonical 規格
4. `main` 中 API／測試分冊
5. Issue 施工與驗收描述
6. branch 草稿、舊留言、歷史 migration 註解

低順位內容不得覆蓋高順位的新裁示。