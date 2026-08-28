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


## 多模型派工、節流與環境停損（2026-08-28）

以下規則是本 repo 遇到多輪 agent 重複閱讀、測試環境重試與憑證誤判後的共同教訓。

- **目前對話選擇的模型是總體主力**：它負責目標、風險、整合與回報；不要因為可派 agent 就再派同級模型重做。
- **Luna 只做低風險、可審核工作**：例如照既有模式接線、資料盤點、格式整理與可重複的測試準備；完成仍須附實際證據。
- **中大型 Issue 只交一位 Terra 完整負責**：由同一人讀必要規格、修改、跑針對性測試並交付。不得同時派多位 Terra 重複閱讀同一題或各自提出修法。
- **Sol 僅做一次最後高風險審計**：登入、付款、權限、資料庫、正式環境或不可逆改動才需要；不要提前多輪重讀同一題。若主力本身是 Sol，也不另派第二位 Sol。
- 回報模型時分開寫「已指定模型」與「平台可驗證模型」；平台無法獨立回讀時，不得把派工意圖寫成已證實的使用事實。
- 派工只提供最小必要交接：目標、必要文件、目前 commit、指定範圍、驗收條件、最新錯誤與安全邊界。禁止預設複製完整舊對話或 fork 全部歷史。
- 先跑針對性測試，整合後才跑一次全量；共用 TEST 專案的 reset、seed 與整合測試必須序列化。

### 環境錯誤停止線

- 同一驗證路徑連續兩次遇到環境錯誤，就停止重試。只有環境條件真的改變，才重新計數；沒有新條件不得第三次再試。
- 停止後改走不同且安全的驗證路徑、保留最小錯誤證據，或回報需要的權限／決策。
- GitHub connector 已連結，不代表 shell 的 git 有 push 憑證；兩條通道要分別確認。
- Supabase connector 與環境文件可能屬不同帳號。看到專案不存在或 401，先比對 project ref，再判斷權限或程式問題。
- seed 的 optional-table 邏輯只能跳過明確的「表不存在」錯誤；欄位、外鍵、權限、schema cache 或未知錯誤必須 fail closed（失敗就停止），不可靜默跳過。

完成或停工時，記錄主力模型、已指定／可驗證的 agent 模型、範圍、測試證據、未完成風險、環境錯誤次數與是否需要 Owner 決策；新失敗模式補入對應 canonical 文件。
