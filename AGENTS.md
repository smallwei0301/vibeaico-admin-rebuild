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
11. 模型切換、Stop Guard 評估、效率分析或 Agent 新建 Issue，另讀
    `docs/decisions/2026-08-31-agent-control-signals-and-issue-provenance.md`
12. TRIAGE、新 BUILD、TEST 排程、Closure Sweep 或 active candidate 管理，另讀
    `docs/decisions/2026-08-31-close-first-wip-lanes.md`

## 強制規則

- **正式產品／架構／API／驗收文件以 `main` 為準。** 先 `git fetch origin`，再讀
  `origin/main` 的文件；不要只相信工作分支裡的舊副本。
- `docs/OWNER-DECISIONS.md` 是跨領域已裁示題目的快速索引。已標記「Owner 已裁示」
  的題目不得再次當成人工阻擋點，除非有新規格衝突、安全風險或 Owner 明確改判。
- Owner 已核准的純文件更新可以直接進 `main`；程式碼、migration、依賴、workflow、
  agent skill 與部署設定仍走 feature branch → PR → CI → 審核。
- `docs/AGENT-EXECUTION.md` 是常駐自主執行、角色式模型派工、TEST 授權、WIP lanes、
  停損與停止條件的主要正式版本；較新的 Owner Decision 可補充或修正執行語意。
  skill 只是執行轉接器，不得另造互相衝突的流程。
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
- Owner 為切換模型速度、思考等級或工作角色而再次送出 `/goal`、`/steer` 或
  「繼續」，是控制訊號，不是前一位 agent 自行停工的證據。接手者必須沿用目前
  branch／PR／checkpoint，不 reset、不重做，也不得把這類訊號計入 Stop Guard 失敗。
- 只有在 assistant 已送出終止性 final、明確暫停或要求 Owner 再次下令，且當時仍有
  可自主施工工作時，才可記為 `AGENT_PREMATURE_STOP`。沒有該證據時一律標為未知。
- Agent 新開 Issue 時必須使用 `.github/ISSUE_TEMPLATE/agent-discovered.yml` 的欄位，
  或在 API 建立內容中保留同一組 `AGENT_DISCOVERED` 來源資料。沒有來源標記的歷史
  Issue 視為 `owner-or-unknown`，不得算進 Agent 新增 blocking Issue 指標。
- 整個 repo 同一時間最多一條 `TERRA_BUILD`、一條 `LUNA_CLOSURE_SWEEP`、一條
  `TEST_VALIDATION`，且最多兩個 `candidate:active`。未被 TRIAGE 正式升級的 open PR
  預設 parked，不得因為仍是 Draft 就持續收到 commit、完整 CI 或 Sol 審計。
- Sol TRIAGE 必須 close-first：先選已有實作、只差 0–2 個自主驗收缺口的 READY／NEAR
  候選；仍依賴 Owner、外部人類或另一張未完成大型 Issue 的 BLOCKED 題目不得搶先
  占用新的 Terra lane。

## 程式施工最低流程

```text
讀 main 規格 → 寫測試（紅）→ 最小實作（綠）→ 回歸 → PR／CI → 審核
```

不得把前端提示、mock 成功或隱藏按鈕當成後端功能已完成。

## 自主執行摘要

- 固定管線：`SCOUT(Luna) → TRIAGE(Sol) → BUILD(Terra) →
  DIAGNOSE(Terra/Sol) → AUDIT(Sol) → CLOSEOUT(Luna)`。
- 全域固定三條線：一條 Terra 中大型施工、一條 Luna Closure Sweep、一條共用 TEST
  驗證；active candidates 上限為 2。Lane 以 PR body metadata 與 `lane:*`／
  `candidate:*` labels 表達，由 `.github/workflows/agent-wip-lanes.yml` 檢查。
- Sol 決定下一個 Issue、模糊 CI、高風險設計與能否關閉；一般 Issue 目標只接觸
  2 次。Terra 負責唯一中大型 BUILD；Luna 固定負責盤點、log、文件、證據與機械收尾。
- TRIAGE 排序：READY → NEAR → UNBLOCKER → BUILDABLE → BLOCKED。只要有 READY／NEAR，
  不得先開另一張明知會停在依賴上的大型 Draft PR。
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
  active candidate peak、Sol 接觸與無效重跑量測、Owner 待辦；實質失敗依固定格式更新
  `docs/AGENT-PLAYBOOK.md`。
- 效率報告必須分開列 `OWNER_CONTROL_EVENT` 與 `AGENT_PREMATURE_STOP`，以及
  agent-created blocking Issue 與 owner-or-unknown Issue；無來源證據不得猜測歸屬。
