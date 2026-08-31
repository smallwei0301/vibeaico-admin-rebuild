# 文件治理與分支規則

> Owner 決策日期：2026-08-27。
>
> 本文件規範本 repo 的產品規格、架構文件、Owner 決策、Issue 與程式分支如何協作。所有 agent 與人工貢獻者開工前都必須遵守。

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

## 2. 哪些修改可以直接進 `main`

### 2.1 Owner 已明確核准的 docs-only 更新

Owner 明確授權後，純文件變更可以直接推送 `main`，不必為文件再建立長期功能分支。允許的範圍原則上只有：

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

Production DDL／DML、正式環境部署與會改變正式行為的 `main` merge，仍需 Owner 明確授權。

## 3. Agent 開工流程

每個 agent 接 Issue 後必須：

1. `git fetch origin`。
2. 先讀 `origin/main:AGENTS.md`、`origin/main:CLAUDE.md`、
   `origin/main:docs/AGENT-EXECUTION.md` 與本文件。
3. 讀 `origin/main:docs/OWNER-DECISIONS.md`，不得重問已裁示題目。
4. 以 Issue、錯誤碼、測試或領域關鍵字搜尋 `origin/main:docs/AGENT-PLAYBOOK.md`，
   只讀相關教訓。
5. 從 Issue 找到對應 canonical 文件，**以 `main` 版本為準**。
6. 程式施工分支必須以最新 `main`，或「已包含最新 main 文件 commit」的指定整合分支作 base。
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
5. 舊補充文件刪除，或改成只指向 canonical 文件的短引導，避免雙重真相。

### 4.2 尚未裁示的草稿

未定案內容可放在功能分支或 `docs/drafts/**`，但必須清楚標示 `DRAFT`，不得被 Issue 寫成強制規格。裁示後才回併 canonical 文件並進 `main`。

## 5. Docs-only 直推 main 的安全檢查

推送前：

```bash
git diff --name-only origin/main...HEAD
```

必須逐檔確認都是允許的文件路徑。推薦使用一個原子 commit，訊息標明 `docs:`，並在完成後從 GitHub 重新讀取 `main` 驗證。

推送後：

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
