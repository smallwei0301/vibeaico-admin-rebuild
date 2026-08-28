# AGENTS.md

所有 agent 在這個 repo 開工前都必須先讀：

1. `CLAUDE.md`
2. `docs/AGENT-EXECUTION.md`
3. 以任務關鍵字搜尋 `docs/AGENT-PLAYBOOK.md` 的相關教訓
4. `docs/DOCUMENTATION-GOVERNANCE.md`
5. `docs/OWNER-DECISIONS.md`
6. 該 Issue 指定的 `docs/integration/**` canonical 文件
7. 若任務涉及 GUIDE 首頁、旅客自助、方案 UX、通知體驗、旅客風險、LINE 開通、報表或收費驗證，另讀 `docs/integration/19-GUIDE-PRODUCT-EXPERIENCE.md`
8. `docs/integration/12-TESTING-TDD.md`

## 強制規則

- **正式產品／架構／API／驗收文件以 `main` 為準。** 先 `git fetch origin`，再讀 `origin/main` 的文件；不要只相信工作分支裡的舊副本。
- `docs/OWNER-DECISIONS.md` 是跨領域已裁示題目的快速索引。索引中已標記「Owner 已裁示」的題目不得再次當成人工阻擋點，除非有新的規格衝突、安全風險或 Owner 明確改判。
- Owner 已核准的純文件更新可以直接進 `main`；程式碼、migration、依賴、workflow 與部署設定仍必須走 feature branch → PR → CI → 審核。
- `docs/AGENT-EXECUTION.md` 是常駐自主執行、派工、TEST 授權、停損與停止條件的唯一正式版本；不得在 Issue 或 agent 提示裡另造一套互相衝突的流程。
- 一個主題只留一份 canonical 規格。Owner Decision 記錄理由，Issue 記錄施工，兩者不得變成另一套互相覆蓋的完整規格。
- GUIDE 產品體驗任務以 `19-GUIDE-PRODUCT-EXPERIENCE.md` 定義的 P0／P1／P2 為優先級覆蓋，但不得跳過 10／17／18 分冊的資料、安全、付款與通知依賴。
- 工作分支必須以最新 `main`，或已包含最新 `main` 文件 commit 的整合分支為 base。
- 若 branch 文件與 `main` 衝突，以 `main` 中較新的 Owner Decision 與 canonical 文件為準。
- Production DDL／DML、正式部署、會改變正式網站行為的 main merge，皆需 Owner 明確授權。
- 看不到 Issue 指定文件、規格互相矛盾或權限不足時，只停止受影響路線並留下精確阻塞；其他可施工工作依 `docs/AGENT-EXECUTION.md` 繼續，不自行猜測。

## 程式施工最低流程

```text
讀 main 規格 → 寫測試（紅）→ 最小實作（綠）→ 回歸 → PR／CI → 審核
```

不得把前端提示、mock 成功或隱藏按鈕當成後端功能已完成。


## 自主執行摘要（完整規則見 `docs/AGENT-EXECUTION.md`）

- 目前對話選擇的模型統籌；Luna 做互不重疊的低風險工作；一個中大型 Issue 只交一位 Terra；Sol 只做一次最後高風險審計。
- 階段性回報後立即繼續。等待 CI／agent 時處理其他不碰撞工作，直到所有可施工項目完成或只剩真正的 Owner／Production 阻塞。
- 共用 TEST 的 migration、reset、seed、integration 與 E2E 必須序列化；先跑針對性測試，有新提交或新環境證據後才跑全量。
- 同一驗證路線連續兩次環境錯誤即停損換路；不得用第三次相同重試、刪測試、mock 假成功或放寬斷言掩蓋問題。
- Vibe Ai TEST 專案的長期授權、安全鎖與憑證規則以 `docs/AGENT-EXECUTION.md` §3 為準；Production 不在授權內。
- 完成或停工都要留下提交、測試／CI、TEST 基線、未驗證風險、錯誤次數、模型分工與 Owner 待辦；每次實質失敗依固定格式新增或更新 `docs/AGENT-PLAYBOOK.md`。
