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
10. 長程 `/goal`、多 agent 派工、CI 判案或 Issue closeout，載入
    `.agents/skills/vibeaico-agent-orchestration/SKILL.md`
11. 模型切換、Issue 來源或同時施工量的任務，另讀
    `docs/decisions/2026-08-31-agent-control-wip-and-close-first.md`

## 強制規則

- **正式產品／架構／API／驗收文件以 `main` 為準。** 先 `git fetch origin --prune`，
  再讀 `origin/main`；不要只相信工作分支的舊副本。
- `docs/OWNER-DECISIONS.md` 是已裁示題目的快速索引。已裁示題目不得再次當人工阻擋，
  除非有新規格衝突、安全風險或 Owner 明確改判。
- `docs/AGENT-EXECUTION.md` 是自主執行、角色派工、WIP limit（同時施工上限）、TEST
  授權、停損與停止條件的唯一正式版本；skill 只是執行轉接器。
- 一個主題只留一份 canonical 規格。Owner Decision 記理由，Issue 記施工，兩者不得
  變成另一套互相覆蓋的完整規格。
- Owner 已核准的 docs-only 更新可依治理規則直進 `main`；程式、migration、依賴、
  workflow、agent skill 與部署設定仍走 feature branch → PR → CI → 審核。
- GUIDE 產品體驗以 `19-GUIDE-PRODUCT-EXPERIENCE.md` 的 P0／P1／P2 為準，但不得跳過
  10／17／18 分冊的資料、安全、付款與通知依賴。
- GUIDE 呈現層以 `20-GUIDE-RESPONSIVE-UI.md` 的五大父層級、字級、資訊密度與響應式
  規則為準；桌機變寬不等於恢復舊的多功能平鋪導航。
- 工作分支必須以最新 `main`，或已包含最新 `main` 文件 commit 的整合分支為 base。
- Production DDL／DML、正式部署、會改變正式網站行為的 main merge，皆需 Owner
  明確授權。
- 看不到 Issue 指定文件、規格互相矛盾或權限不足時，只停止受影響路線；其他工作依
  `docs/AGENT-EXECUTION.md` 繼續，不自行猜測。

## Owner 控制訊號

- Owner 重送 `/goal`、`/steer` 或「繼續」可能是切換模型速度、深度或角色，不能單憑
  這些訊息判定前一位 agent 提早停止。
- 只有找到前一位 assistant 的終止性 final／明確暫停，且當時仍有安全可施工工作，
  才記 `AGENT_PREMATURE_STOP`；證據不足寫 `UNKNOWN_CONTROL_EVENT`。
- 模型切換後保留 branch、PR、exact head、TEST lane 與 stage；不得 reset、checkout
  覆蓋或重做已完成工作。

## 程式施工最低流程

```text
讀 main 規格 → 寫測試（紅）→ 最小實作（綠）→ 回歸 → PR／CI → 審核
```

不得把前端提示、mock 成功或隱藏按鈕當成後端功能完成。

## 自主執行摘要

- 固定管線：`SCOUT(Luna) → TRIAGE(Sol) → BUILD(Terra) →
  DIAGNOSE(Terra/Sol) → AUDIT(Sol) → CLOSEOUT(Luna)`。
- **全 repo 同時最多 1 條 active Terra 中大型施工線。** 已有 Terra Build 時，不得再
  開第二個大型 Issue／PR；新題先 park。
- **固定保留 1 條 Luna Closure Sweep。** 它專門推進已有 PR／證據、最接近可關閉的
  Issue；若無候選，必須留下 `EMPTY_WITH_SCAN`，不能被一般研究取代。
- **共用 TEST 最多 1 條驗證線。** migration、reset、seed、integration 與 E2E 依
  `shared-test-supabase-integration` 序列化。
- 同時 `ACTIVE_CANDIDATE=true` 的 PR 最多 2 張，通常是一張 Terra Build 加一張
  Closure candidate；其餘 open PR 標 `PARKED`、`HISTORICAL` 或 `OWNER_BLOCKED`。
- Sol 只做選題、模糊 CI、高風險設計與最後 Audit；一般 Issue 目標只接觸 2 次。
- TRIAGE 先選已有 PR／大多數測試、再補 1～2 步就能 Audit 的 Issue。明知依賴大型題目
  或外部人類的 Issue 降順位，除非它是必要 dependency unlocker 或 P0。
- Terra 不得改驗收或自行關 Issue；Luna 不得做產品／安全決策。只有 Sol 回覆
  `CLOSE_APPROVED` 才能由 Luna 或主 agent 關閉。
- agent 只傳固定精簡交接包，不複製完整對話、不貼整份 CI log。
- 同一路線連續兩次環境錯誤即停損；不得靠第三次盲重試、刪測試、mock 假成功、
  放寬斷言或提高 timeout 掩蓋問題。
- Agent-origin PR 必須填 `.github/pull_request_template.md` 的 lane metadata；
  `.github/workflows/agent-wip-guard.yml` 會標記 metadata 與 WIP 違規。
- Agent 新開 Issue 必須使用 `.github/ISSUE_TEMPLATE/agent-discovered.yml` 或保留
  `AGENT_DISCOVERED` 等價欄位；沒有標記的歷史 Issue 一律是 owner-or-unknown。
- 完成或停工都要留下提交、測試／CI、TEST 基線、未驗證風險、lane 峰值、Closure
  Sweep、Sol 接觸、無效重跑、Issue 來源與 Owner 待辦；實質失敗更新 Playbook。
