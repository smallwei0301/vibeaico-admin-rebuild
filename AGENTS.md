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
11. 所有長程 `/goal` 與多 Agent 施工必讀最新 Owner WIP 裁示：
    `docs/decisions/2026-08-31-owner-multi-terra-test-serial.md`

## 強制規則

- **正式產品／架構／API／驗收文件以 `main` 為準。** 先 `git fetch origin --prune`，再讀
  `origin/main` 的文件；不要只相信工作分支裡的舊副本。
- **2026-08-31 Owner 最新 WIP 裁示為 Mode C：不同 Issue 可以由不同 Terra 同時施工；
  同一個中大型 Issue 同時最多一位 Terra owner；固定最多 1 條 repo-wide Luna Closure
  Sweep；shared TEST migration／reset／seed／schema cache mutation／integration／E2E 全 repo
  最多 1 條。** 不再有「全 repo Terra max 1」或「全 repo active candidate max 2」硬限制。
  PR 預算改為每 Issue 最多 1 張 ACTIVE implementation，必要時最多 1 張短命 VALIDATION。
- `docs/decisions/2026-08-31-owner-global-wip-cap.md` 是同日較早、已被 Mode C 取代的歷史決策；
  不得再用其中的 repo-wide 單 Terra／兩候選限制阻擋不同 Issue 的平行施工。
- 多 Terra 平行不等於可以同時寫 shared TEST。任何 Terra 需要 TEST 時先排入唯一
  `TEST_VALIDATION` lane；其他 Terra 繼續 source／unit／typecheck／build，不得搶寫 TEST。
- 若不同 Issue 大量修改同一批核心檔案，或同時碰 Auth、payment callback、migration 基線、
  共用 RPC 等高風險基礎，由 Sol 切清責任與整合順序。這是 scope/file collision 管理，
  不是恢復全 repo 單 Terra。
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
- **不同 Issue 可各有一條 active Terra 中大型施工線；同一 Issue 只准一位 Terra。**
  等待別人的 CI／TEST 不構成停止其他 Issue source 工作的理由。
- **固定最多 1 條 repo-wide Luna Closure Sweep。** 它專門找已有 PR、已有多數測試、
  只差 1～2 個自主步驟的候選，不能被新功能研究取代。
- **共用 TEST 的 migration、reset、seed、schema cache mutation、integration 與 E2E
  永遠只允許 1 條驗證線。** GitHub Actions 固定使用 `shared-test-supabase-integration`
  排隊且 `cancel-in-progress: false`。
- PR candidate 預算按 Issue 計算：每 Issue 最多 1 ACTIVE implementation，必要時最多
  1 VALIDATION/canary。不得用全 repo PR 數量阻擋不同 Issue 的合法 Terra 施工。
- Sol 只做選題、真正的 scope/file collision、模糊 CI、高風險設計與最後 Audit；一般
  Issue 目標只接觸 2 次，除非有新增高風險或模糊證據。
- TRIAGE 優先選 closeability 3～5 且沒有 Owner／外部 blocker 的 Issue；同時可挑選多個
  **互不衝突** Issue 給不同 Terra，但每條都要有明確 scope 與 TEST 需求。
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
  active Terra Issue 峰值、shared TEST 峰值、Closure Sweep、Sol 接觸與無效重跑量測、
  Owner 待辦；實質失敗更新 `docs/AGENT-PLAYBOOK.md`。
