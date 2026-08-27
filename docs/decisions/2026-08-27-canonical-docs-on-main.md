# 2026-08-27 Owner Decision — 正式文件以 main 為唯一入口

## 決策

Owner 確認採用以下文件治理方式：

- 定案後的產品規格、架構、API 契約、驗收標準與 Owner Decision 必須放在 `main`。
- Owner 明確核准的純文件更新可以直接推送 `main`，不必建立功能分支。
- 程式碼、資料庫、依賴、workflow 與部署設定仍必須走 branch／PR／CI。
- 一個主題只保留一份 canonical 規格；新的決策回併原分冊，Decision 文件只保存原因與影響。
- Issue 必須引用 `main` 上的穩定 repo path，不得要求 agent 只到暫時分支尋找正式規格。

## 原因

多 agent 並行時，若正式規格只存在某個施工分支，其他 agent 很容易從 `main` 讀到舊世界觀，進而做出互相衝突的實作。把定案文件放進 `main`，等於把全隊共用的地圖掛在入口處，而不是鎖在某一間施工房。

## 安全邊界

- docs-only 直推不得混入 runtime 程式、migration、env、lockfile 或部署設定。
- `main` push 可能觸發 Vercel，但文件授權不等於正式程式部署授權。
- Production DDL／DML 與會改變正式行為的 merge 仍需 Owner 另行明確授權。

## 規格來源

- `docs/DOCUMENTATION-GOVERNANCE.md`
- `AGENTS.md`
- `CLAUDE.md`
