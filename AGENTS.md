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
11. 所有長程 `/goal` 與多 Agent 施工必讀
    `docs/decisions/2026-08-31-owner-global-wip-cap.md`

## 強制規則

- **正式產品／架構／API／驗收文件以 `main` 為準。** 先 `git fetch origin --prune`，再讀
  `origin/main` 的文件；不要只相信工作分支裡的舊副本。
- **2026-08-31 Owner 最新 WIP 裁示具有優先權：全 repo 同時最多 1 條中大型 Terra
  BUILD、固定 1 條 Luna Closure Sweep、最多 1 條共用 TEST 驗證線、最多 2 張 active
  candidate PR，並採 close-first TRIAGE。** 任何 branch、PR 留言或舊 session 若允許多條
  Terra 跨 Issue 同時施工，均為已被取代的舊提案，不得據此關閉或覆蓋新治理候選。
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
- **全 repo 同時最多 1 條 active Terra 中大型施工線。** 已有 Terra BUILD 時，新大型題目
  必須 park 或替換目前 lane，不得另開第二條實作線。
- **固定保留 1 條 Luna Closure Sweep。** 它專門找已有 PR、已有多數測試、只差 1～2
  個自主步驟的候選，不能被新功能研究取代。
- 共用 TEST 的 migration、reset、seed、integration 與 E2E 只允許 1 條驗證線。
- 同時 `ACTIVE_CANDIDATE=true` 最多 2 張，通常是 Terra 候選加 Closure 候選；其他
  open PR 必須是 PARKED、HISTORICAL 或 OWNER_BLOCKED。
- Sol 只做選題、模糊 CI、高風險設計與最後 Audit；一般 Issue 目標只接觸 2 次。
- TRIAGE 優先選 closeability 3～5 且沒有 Owner／外部 blocker 的 Issue；明知依賴其他
  大型題目或外部人類的 Issue 降順位，除非是 dependency unlocker 或 P0。
- Terra 不得自行改驗收或關 Issue；Luna 不得做產品／安全決策。Issue 只有收到 Sol
  `CLOSE_APPROVED` 才能由 Luna 或主 agent 執行關閉。
- agent 間只傳固定精簡交接包，不複製完整對話、不貼整份 CI log、不讓多位 Terra
  重複閱讀同一題。
- 同一路線連續兩次環境錯誤即停損換路；不得以第三次盲重試、刪測試、mock 假成功、
  放寬斷言或隨意提高 timeout 掩蓋問題。
- Owner 重送 `/goal`、`/steer` 或「繼續」可能是模型切換，不能單憑這些訊息記成
  Agent 提早停止；沒有 `AGENT_DISCOVERED` 標記的歷史 Issue 也不得算 Agent 新增。
- Vibe Ai TEST 的長期授權、安全鎖與憑證規則以 `docs/AGENT-EXECUTION.md` §3 為準；
  Production 不在授權內。
- 完成或停工都要留下提交、測試／CI、TEST 基線、未驗證風險、錯誤次數、模型分工、
  lane 峰值、Closure Sweep、Sol 接觸與無效重跑量測、Owner 待辦；實質失敗更新
  `docs/AGENT-PLAYBOOK.md`。
