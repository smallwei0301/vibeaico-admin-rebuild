# AGENTS.md

所有 agent 在這個 repo 開工前都必須先讀：

1. `CLAUDE.md`
2. `docs/AGENT-EXECUTION.md`
3. 以任務關鍵字搜尋 `docs/AGENT-PLAYBOOK.md` 的相關教訓
4. `docs/DOCUMENTATION-GOVERNANCE.md`
5. `docs/OWNER-DECISIONS.md`
6. 該 Issue 指定的 `docs/integration/**` canonical 文件
7. 若任務涉及 GUIDE 首頁、旅客自助、方案 UX、通知體驗、旅客風險、LINE 開通、
   報表或收費驗證，另讀 `docs/integration/19-GUIDE-PRODUCT-EXPERIENCE.md`
8. 若任務涉及 GUIDE 導航、Dashboard、Calendar、Customers、Chat、手機／平板／桌機
   響應式、次層頁資訊重排或 GUIDE 共用 UI 元件，另讀
   `docs/integration/20-GUIDE-RESPONSIVE-UI.md` 與 `docs/assets/guide-mobile-ui/README.md`
9. `docs/integration/12-TESTING-TDD.md`
10. 長程 `/goal`、多 agent 派工、CI 判案或 Issue closeout，若平台支援 repository
    skills，載入 `.agents/skills/vibeaico-agent-orchestration/SKILL.md`

## 強制規則

- **正式產品／架構／API／驗收文件以 `main` 為準。** 先 `git fetch origin`，再讀
  `origin/main` 的文件；不要只相信工作分支裡的舊副本。
- `docs/OWNER-DECISIONS.md` 是跨領域已裁示題目的快速索引。已標記「Owner 已裁示」
  的題目不得再次當成人工阻擋點，除非有新規格衝突、安全風險或 Owner 明確改判。
- Owner 已核准的純文件更新可以直接進 `main`；程式碼、migration、依賴、workflow、
  agent skill 與部署設定仍走 feature branch → PR → CI → 審核。
- `docs/AGENT-EXECUTION.md` 是常駐自主執行、角色式模型派工、TEST 授權、停損與停止
  條件的唯一正式版本；skill 只是執行轉接器，不得另造互相衝突的流程。
- 一個主題只留一份 canonical 規格。Owner Decision 記錄理由，Issue 記錄施工，
  兩者不得變成另一套互相覆蓋的完整規格。
- GUIDE 產品體驗任務以 `19-GUIDE-PRODUCT-EXPERIENCE.md` 的 P0／P1／P2 為優先級
  覆蓋，但不得跳過 10／17／18 分冊的資料、安全、付款與通知依賴。
- GUIDE 呈現層任務以 `20-GUIDE-RESPONSIVE-UI.md` 的五大父層級、字級、資訊密度與
  響應式規則為準；桌機變寬不代表可以恢復舊的多功能平鋪導航。
- 工作分支必須以最新 `main`，或已包含最新 `main` 文件 commit 的整合分支為 base。
- 若 branch 文件與 `main` 衝突，以 `main` 中較新的 Owner Decision 與 canonical
  文件為準。
- Production DDL／DML、正式部署、會改變正式網站行為的 main merge，皆需 Owner
  明確授權。
- 看不到 Issue 指定文件、規格互相矛盾或權限不足時，只停止受影響路線並留下精確
  阻塞；其他可施工工作依 `docs/AGENT-EXECUTION.md` 繼續，不自行猜測。

## 程式施工最低流程

```text
讀 main 規格 → 寫測試（紅）→ 最小實作（綠）→ 回歸 → PR／CI → 審核
```

不得把前端提示、mock 成功或隱藏按鈕當成後端功能已完成。

## 自主執行摘要

- 固定管線：`SCOUT(Luna) → TRIAGE(Sol) → BUILD(Terra) →
  DIAGNOSE(Terra/Sol) → AUDIT(Sol) → CLOSEOUT(Luna)`。
- Sol 決定下一個 Issue、模糊 CI、高風險設計與能否關閉；一般 Issue 目標只接觸
  2 次。Terra 負責單一中大型 Issue 的完整施工；Luna 負責事實盤點、log、文件與
  已有標準答案的機械工作。
- Terra 不得自行改驗收或關 Issue；Luna 不得做產品／安全決策。Issue 只有收到 Sol
  `CLOSE_APPROVED` 才能由 Luna 或主 agent 執行關閉。
- agent 間只傳固定精簡交接包，不複製完整對話、不貼整份 CI log、不讓多位 Terra
  重複閱讀同一題。
- 共用 TEST 的 migration、reset、seed、integration 與 E2E 必須序列化；先跑針對性
  測試，有新提交或新環境證據後才跑全量。
- 同一路線連續兩次環境錯誤即停損換路；不得以第三次盲重試、刪測試、mock 假成功、
  放寬斷言或隨意提高 timeout 掩蓋問題。
- 新 blocking Issue 只限假功能、原驗收缺失或安全／資料／付款／權限／通知風險；
  純美化與未來想法進 backlog，不得阻塞目前 goal。
- Vibe Ai TEST 的長期授權、安全鎖與憑證規則以 `docs/AGENT-EXECUTION.md` §3 為準；
  Production 不在授權內。
- 完成或停工都要留下提交、測試／CI、TEST 基線、未驗證風險、錯誤次數、模型分工、
  Sol 接觸與無效重跑量測、Owner 待辦；實質失敗依固定格式更新
  `docs/AGENT-PLAYBOOK.md`。
