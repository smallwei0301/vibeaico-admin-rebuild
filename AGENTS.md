# AGENTS.md

所有 Agent 在本 repo 開工前必須先讀：

1. `CLAUDE.md`
2. `docs/decisions/2026-09-01-owner-bplus-delivery-loop.md`
3. `docs/decisions/2026-09-01-owner-natural-loop-commands-and-completion-truth.md`
4. `docs/decisions/2026-09-01-owner-isolated-test-lanes.md`（歷史基線）
5. `docs/decisions/2026-09-02-owner-free-local-dual-terra-pilot.md`（最新 Issue #104 裁示，衝突時優先）
6. `docs/AGENT-EXECUTION.md`
7. `docs/AGENT-BPLUS-DELIVERY-LOOP.md`
8. `docs/AGENT-PROJECT-COMMANDS-AND-TRUTH.md`
9. `docs/DELIVERY-OUTCOME-V2.md`
10. `docs/DOCUMENTATION-GOVERNANCE.md`
11. `docs/OWNER-DECISIONS.md`
12. 該 Issue 指定的 `docs/integration/**` canonical 文件
13. `docs/integration/12-TESTING-TDD.md`
14. 以 Issue／錯誤碼搜尋 `docs/AGENT-PLAYBOOK.md`，只讀相關條目
15. 若任務涉及 GUIDE 首頁、旅客自助、方案 UX、通知體驗、旅客風險、LINE 開通、
    報表或收費驗證，另讀 `docs/integration/19-GUIDE-PRODUCT-EXPERIENCE.md`
16. 若任務涉及 GUIDE 導航、Dashboard、Calendar、Customers、Chat、手機／平板／桌機
    響應式或 GUIDE 共用 UI，另讀 `docs/integration/20-GUIDE-RESPONSIVE-UI.md` 與
    `docs/assets/guide-mobile-ui/README.md`
17. 長程 `/goal`、開始／繼續 Loop、多 Agent 派工、CI 判案或 Issue closeout，載入
    `.agents/skills/vibeaico-agent-orchestration/SKILL.md`
18. Owner 說「復盤」或「複盤」時，載入
    `.agents/skills/vibeaico-agent-retrospective/SKILL.md`
19. 任務涉及 Issue #104、local Supabase、TEST_PROFILE、Supabase Preview Branch 或雙 Terra，
    載入 `.agents/skills/vibeaico-isolated-test-orchestration/SKILL.md`；若該 Skill 與 2026-09-02
    最新 Owner Decision 衝突，以最新 Decision 為準，付費 Branch 不得執行。

## 自然語言入口

```text
開始 Loop       → 建立或安全接續一輪 B+
繼續 Loop       → 從最新 IN_PROGRESS Run 與 live GitHub 接續
復盤／複盤      → 唯讀比較最近最多三輪
復盤並優化      → 最多實作兩項治理改良
/goal           → 有進行中 Run 就接續，沒有才開始
```

完整語意以 `docs/AGENT-PROJECT-COMMANDS-AND-TRUTH.md` 為準。不得因新 Session 看不到舊對話
而重新發明指令含義。

## 最新工作模式：B+ 免費雙 Terra 試行

2026-09-01 Owner 先用 B+ 取代無上限 Mode C；2026-09-02 Owner 再授權以免費 per-PR local
Supabase 試行最多兩條完整 Terra。這不是恢復無上限多工：

```text
TERRA_BUILD      預設最多 1；只有兩張 PR 都通過 DUAL_TERRA_PILOT 契約時最多 2
TERRA_RESERVE    單 Terra 時最多 1；雙 Terra 試行時固定 0
LUNA_CLOSURE     最多 1，固定收尾／Janitor 線
LUNA_TASKS       預設 4，最多 6，另有 1 位 Aggregator
LOCAL_ISOLATED   每張 Terra PR 各自一套免費本機 Supabase，最多 2
TEST_VALIDATION  最多 1，現有遠端 TEST 唯一最終考場
ACTIVE_CANDIDATE 最多 2，不把 Luna Closure 算成第三個產品候選
Sol Audit        最多 1
Merge            最多 1
```

雙 Terra 必須使用不同 `TERRA_SLOT` 1／2、primary Issue、`TEST_ENV_ID` 與不重疊的
`FILE_OWNERSHIP`，並使用同一 `RUN_ID`。任一契約不完整，自動回到完整 Terra 最多 1。

## 隔離 TEST 現行路線

Issue #104 的最新路線是：

```text
Terra slot 1 → 免費 per-PR local Supabase ┐
                                               ├→ 唯一 remote canonical TEST
Terra slot 2 → 免費 per-PR local Supabase ┘
                                                        ↓
                                                   Sol Audit
                                                        ↓
                                                     Merge
```

- `LOCAL_ISOLATED`／`LOCAL_ISOLATED_CANARY` 只可報 `ISOLATED_GREEN` 或 canary 證據。
- 最終 remote TEST、Sol Audit、merge 仍各自單線。
- DB／Auth／Storage 先跑免費 local isolated，再排現有 remote canonical TEST。
- 付費 Supabase Preview Branch 為 `DEFERRED_NOT_IN_CONSIDERATION`：不建立、不要求費率確認、
  不得當成雙 Terra、Audit 或 merge 的前置條件。
- 任一 local slot 不健康、cleanup 失敗、檔案撞車或跨線污染，下一輪自動退回一條完整 Terra。

## 開工與接手

- 先 `git fetch origin --prune`，從 `origin/main` 讀規則。
- 以 live GitHub、current main、exact-head CI、shared TEST 與外部服務的重新查證為真相；
  舊 Session、舊 PR 描述與 branch-only 文件只當線索。
- 不 reset、force-push 或重做已完成 commit／migration／測試。
- 每輪建立或接續 `RUN_ID`，並維護：

```text
docs/metrics/agent-runs/<RUN_ID>.json
docs/metrics/agent-runs/<RUN_ID>.md
```

新 Run 使用 schema v2；舊 schema v1 只保留歷史重算，不和 v2 直接比較。

## 角色分工

- **Luna**：盤點、CI 摘要、Closure、Janitor、文件、QA、Metrics。每個任務只回答一個
  問題，預設最多 15 行；一位 Luna Aggregator 去重後再交 Sol。
- **Sol**：Terra slot 1／2 選題、重大 scope／file collision、remote TEST 順序、模糊 CI、
  高風險設計、最終 `CLOSE_APPROVED | FIX_REQUIRED | OWNER_BLOCKED`。不做 CI 輪詢與一般施工。
- **Terra slot 1／2**：各自完整施工一張邊界清楚的候選，做到
  `CLOSED | AUDIT_READY | OWNER_BLOCKED`；第二條不是配額，沒有安全題目就不啟動。
- **RESERVE Terra**：只在單 Terra 模式且主線真正等待時做一個 source-only 小切片；不碰 TEST、
  不進 Audit、最多一個原子 commit，停在 `READY_FOR_PROMOTION`。

## 強制護欄

- 完整 Terra 預設最多 1；只有 executable dual-Terra Guard 判定 qualified 時最多 2；
  Reserve 最多 1，但雙 Terra 時為 0；Closure、remote TEST、Sol Audit、merge 各最多 1。
- 兩張完整 Terra 必須同一 `RUN_ID`，但 Issue、slot、local 環境與檔案 ownership 不同。
- MAIN／Terra 必須有 Closure target，或明確 `EMPTY_WITH_SCAN`／`REPORT:<path>` 證據。
- RESERVE 必須填 `RESERVE_BOUNDARY`、`TEST_LANE_REQUIRED=false`，且不可是 active candidate。
- 一般 runtime PR 若不是唯一 remote TEST holder，可依 `TEST_PROFILE` 跑 local isolated TEST，
  但 remote integration／E2E 仍留下 `POLICY_SKIP`，不能碰 shared TEST。
- `PARKED` PR 不派 Agent、不 push、不 rerun、不輪詢。
- 同 exact head、同環境、同命令不得盲目重跑；環境錯誤兩次即停損換路。
- Git Data API 建立 commit／tree 後，先對 exact head 跑 `npm run guard:repo-integrity`；核心路徑缺失、
  大量刪檔或程式檔出現單獨一行 40 碼 SHA 時 fail closed，不得建立／移動 `preview/**`。
- `package.json` 與 `package-lock.json` 必須一起更新並以乾淨環境 `npm ci` 驗證；不得手改 lockfile
  猜測不存在的套件版本。
- `preview/**` 只可指向已通過 exact-head CI 的 commit；typecheck／build 未綠不得用 Vercel 代替檢查。
- Active Agent governance PR 預設最多 8 個檔案、800 行變更；第 9 檔、801 行或缺統計資料都
  fail closed，超過就拆 PR，不得再堆成大型 Draft。
- Issue 只有 Sol 回覆 `CLOSE_APPROVED` 才能由 Luna／主 Agent 關閉。
- Agent 新開 Issue 必須使用 `.github/ISSUE_TEMPLATE/agent-discovered.yml` 並提供完整來源；
  沒有完整 `AGENT_DISCOVERED` 證據一律是 owner-or-unknown。
- Luna 發現鄰近問題只能分類為 blocking、backlog、duplicate、owner-blocked 或 needs-triage；
  不得自行吸入 Terra PR 造成範圍膨脹。

## Completion Truth Gate（完成事實閘門）

**送出寫入動作不等於完成。** 在宣稱合併、關閉、CI 全綠、migration 套用、部署或檔案進入
`main` 前，必須依 `docs/AGENT-PROJECT-COMMANDS-AND-TRUTH.md` 重新 fetch 外部狀態。

例如宣稱「PR 已合併到 main」前，至少要有：

```text
PR merged=true 或 merged_at
merge_commit_sha
current main head
merge commit 對 main 的 reachable compare
after-merge ref=main 關鍵檔案重讀
```

只呼叫 merge API、只收到成功回應、或只看到工作分支檔案時，只能寫
`MERGE_REQUESTED_UNVERIFIED`。未驗證卻宣稱完成，schema v2 復盤必須記為安全性失敗、
`AUDIT_DATA_INVALID` 與 `F-HARD`，不得靠其他分數補回。

## Delivery Outcome v2

成品與半成品分開：

```text
shipped_units              = live-verified CLOSED Issue × 1.0
autonomous_outcome_units   = CLOSED × 1.0 + verified complete OWNER_BLOCKED × 0.75
wip_inventory              = Audit Ready + CI-only + commit-only + unfinished carryover
```

Audit Ready、CI 綠與 commit 只列在製品，不再折算成品。`IN_PROGRESS`／`CLOSURE_RECOVERY`、
缺結束資料、缺必要百分比或 Completion Truth 未驗證時一律 `NOT_GRADED`，不補中性 50 分。
每件真正出貨 usage 只在 `shipped_units >= 1` 時計算。

## CI、TEST 與常見診斷

- 單一 401 可能是刻意驗證未登入；先看測試契約，再查 seed → login → `/api/auth/me` →
  同 cookie 的受保護請求。
- migration 後的 `PGRST202` 優先檢查 TEST migration／schema cache；`PGRST201` 優先檢查
  同表多外鍵造成的關聯歧義。
- seed 的 optional table 只可略過明確「表不存在」；欄位、外鍵、權限、cache 或未知錯誤
  必須 fail closed（不確定就停止該步）。
- 測試沒有開始或 job 為 `skipped` 不能算綠；成功 toast 不能證明副作用真的發生。
- 關鍵寫入不可先查再分段寫；撞班、名額、收款與狀態轉移要用 transaction／atomic RPC
  保護，並測並發。

## Scope Firewall 與證據

新發現只有符合以下任一條件，才可成為阻塞目前 Goal 的新 Issue：

1. UI／原站宣稱可用，但沒有真實副作用或資料不保存；
2. 存在安全、跨租戶、資料損失、付款、退款、權限或真實通知風險；
3. 原 Issue 或 canonical 文件已明定的驗收缺失。

純美化、未來想法、可選重構與非必要效能優化只進 backlog，不得阻塞本輪出貨。

每個完成項目至少留下 Issue／PR、base／head、exact-head CI、TEST 基線、未驗證範圍、
Owner blocker、requested／actual model、Run ID 與 scorecard。實質失敗要更新
`docs/AGENT-PLAYBOOK.md`；相同根因更新原條目，不散落成另一套規格。

## 文件與安全

- 正式產品／API／驗收以最新 `main` canonical 文件為準。
- docs-only 可依治理規則直進 main；程式、workflow、skill、依賴與 migration 走 PR／CI／Audit。
- remote TEST 長期授權只限 Supabase project `nmwhwngojosmagjuvxol`，仍需唯一 TEST holder。
- Production DDL／DML／migration／部署、真實付款／退款／顧客通知，沒有新授權一律禁止。
- 不輸出或提交 token、密碼、key、完整 `.env`。

## 復盤

Owner 說「復盤」或「複盤」時：

1. 找最新 schema v2 `docs/metrics/agent-runs/*.json`，比較最近最多 3 個已完成且 truth-verified 的 Run。
2. 先用 live GitHub 驗證完成主張，再用 `run-ledger-v2.mjs`、`score-run-v2.mjs` 與
   `review-runs-v2.mjs` 重算；schema v1 只作 `LEGACY_V1` 歷史。
3. 比較 shipped units、autonomous outcomes、WIP、usage、close 率、品質、Sol touches、
   Luna 採用率、carryover 與 Completion Truth 失敗。
4. 每次只提出一到兩個最大改良；治理改良走 focused governance PR，不順便改產品。
5. 不得改寫歷史弱分數、把 requested model 冒充 actual model，或拿未完成 Run 與完成 Run 比效率。
