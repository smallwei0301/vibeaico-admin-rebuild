# AGENTS.md

所有 agent 在這個 repo 開工前都必須先讀：

1. `CLAUDE.md`
2. `docs/DOCUMENTATION-GOVERNANCE.md`
3. `docs/OWNER-DECISIONS.md`
4. 該 Issue 指定的 `docs/integration/**` canonical 文件
5. `docs/integration/12-TESTING-TDD.md`

## 強制規則

- **正式產品／架構／API／驗收文件以 `main` 為準。** 先 `git fetch origin`，再讀 `origin/main` 的文件；不要只相信工作分支裡的舊副本。
- `docs/OWNER-DECISIONS.md` 是跨領域已裁示題目的快速索引。索引中已標記「Owner 已裁示」的題目不得再次當成人工阻擋點，除非有新的規格衝突、安全風險或 Owner 明確改判。
- Owner 已核准的純文件更新可以直接進 `main`；程式碼、migration、依賴、workflow 與部署設定仍必須走 feature branch → PR → CI → 審核。
- 一個主題只留一份 canonical 規格。Owner Decision 記錄理由，Issue 記錄施工，兩者不得變成另一套互相覆蓋的完整規格。
- 工作分支必須以最新 `main`，或已包含最新 `main` 文件 commit 的整合分支為 base。
- 若 branch 文件與 `main` 衝突，以 `main` 中較新的 Owner Decision 與 canonical 文件為準。
- Production DDL／DML、正式部署、會改變正式網站行為的 main merge，皆需 Owner 明確授權。
- 看不到 Issue 指定文件、規格互相矛盾或權限不足時，停止施工並回報，不自行猜測。

## 程式施工最低流程

```text
讀 main 規格 → 寫測試（紅）→ 最小實作（綠）→ 回歸 → PR／CI → 審核
```

不得把前端提示、mock 成功或隱藏按鈕當成後端功能已完成。
