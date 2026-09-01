# AGENTS.md

所有 Agent 在本 repo 開工前必須先讀：

1. `CLAUDE.md`
2. `docs/decisions/2026-09-01-owner-bplus-delivery-loop.md`
3. `docs/decisions/2026-09-01-owner-natural-loop-commands-and-completion-truth.md`
4. `docs/AGENT-EXECUTION.md`
5. `docs/AGENT-BPLUS-DELIVERY-LOOP.md`
6. `docs/AGENT-PROJECT-COMMANDS-AND-TRUTH.md`
7. `docs/DOCUMENTATION-GOVERNANCE.md`
8. `docs/OWNER-DECISIONS.md`
9. 該 Issue 指定的 `docs/integration/**` canonical 文件
10. `docs/integration/12-TESTING-TDD.md`
11. 以 Issue／錯誤碼搜尋 `docs/AGENT-PLAYBOOK.md`，只讀相關條目
12. 若任務涉及 GUIDE 首頁、旅客自助、方案 UX、通知體驗、旅客風險、LINE 開通、
    報表或收費驗證，另讀 `docs/integration/19-GUIDE-PRODUCT-EXPERIENCE.md`
13. 若任務涉及 GUIDE 導航、Dashboard、Calendar、Customers、Chat、手機／平板／桌機
    響應式或 GUIDE 共用 UI，另讀 `docs/integration/20-GUIDE-RESPONSIVE-UI.md` 與
    `docs/assets/guide-mobile-ui/README.md`
14. 長程 `/goal`、開始／繼續 Loop、多 Agent 派工、CI 判案或 Issue closeout，載入
    `.agents/skills/vibeaico-agent-orchestration/SKILL.md`
15. Owner 說「復盤」或「複盤」時，載入
    `.agents/skills/vibeaico-agent-retrospective/SKILL.md`

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

## 最新工作模式：B+

2026-09-01 Owner 已用 B+ 取代「不同 Issue 可同時有多條完整 Terra BUILD」的 Mode C：

```text
MAIN_TERRA       最多 1，唯一完整中大型出貨線
RESERVE_TERRA    最多 1，只准 source-only 備料
LUNA_CLOSURE     最多 1，固定收尾／Janitor 線
LUNA_TASKS       預設 4，最多 6，另有 1 位 Aggregator
TEST_VALIDATION  最多 1，共用 TEST 單線
ACTIVE_CANDIDATE 最多 2
Sol              一般只做 TRIAGE 與 AUDIT
```

Mode C 文件保留為歷史。不得再用舊文件同時開第二、第三條完整 Terra 工地。

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

## 角色分工

- **Luna**：盤點、CI 摘要、Closure、Janitor、文件、QA、Metrics。每個任務只回答一個
  問題，預設最多 15 行；一位 Luna Aggregator 去重後再交 Sol。
- **Sol**：MAIN／RESERVE 選題、重大 scope／file collision、模糊 CI、高風險設計、最終
  `CLOSE_APPROVED | FIX_REQUIRED | OWNER_BLOCKED`。不做 CI 輪詢與一般施工。
- **MAIN Terra**：唯一完整施工線，做到 `CLOSED | AUDIT_READY | OWNER_BLOCKED`。
- **RESERVE Terra**：只有 MAIN 真正在等待時才做一個 source-only 小切片；不碰 TEST、
  不進 Audit、最多一個原子 commit，停在 `READY_FOR_PROMOTION`。

## 強制護欄

- MAIN Terra 全 repo 最多 1；Reserve 最多 1；Closure 最多 1；TEST 最多 1；active
  candidates 最多 2。
- MAIN 必須有 Closure target，或明確 `EMPTY_WITH_SCAN`／`REPORT:<path>` 證據。
- RESERVE 必須填 `RESERVE_BOUNDARY`、`TEST_LANE_REQUIRED=false`，且不可是 active candidate。
- 一般 runtime PR 若不是唯一 TEST holder，只跑 source checks；integration／E2E 必須留下
  `POLICY_SKIP`，不能碰 shared TEST。
- `PARKED` PR 不派 Agent、不 push、不 rerun、不輪詢。
- 同 exact head、同環境、同命令不得盲目重跑；環境錯誤兩次即停損換路。
- Issue 只有 Sol 回覆 `CLOSE_APPROVED` 才能由 Luna／主 Agent 關閉。
- Agent 新開 Issue 必須使用 `.github/ISSUE_TEMPLATE/agent-discovered.yml` 並提供完整來源；
  沒有完整 `AGENT_DISCOVERED` 證據一律是 owner-or-unknown。
- Luna 發現鄰近問題只能分類為 blocking、backlog、duplicate、owner-blocked 或 needs-triage；
  不得自行吸入 MAIN PR 造成範圍膨脹。

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
`MERGE_REQUESTED_UNVERIFIED`。未驗證卻宣稱完成，復盤必須記為安全性失敗與
`AUDIT_DATA_INVALID`，不得靠其他分數補回。

## CI、TEST 與常見診斷

- 單一 401 可能是刻意驗證未登入；先看測試契約，再查 seed → login → `/api/auth/me` →
  同 cookie 的受保護請求。
- migration 後的 `PGRST202` 優先檢查 TEST migration／schema cache；`PGRST201` 優先檢查
  同表多外鍵造成的關聯歧義。
- seed 的 optional table 只可略過明確「表不存在」；欄位、外鍵、權限、cache 或未知錯誤
  必須 fail closed（不確定就停止該步）。
- 測試沒有開始不能算綠；成功 toast 不能證明副作用真的發生。
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
- TEST 長期授權只限 Supabase project `nmwhwngojosmagjuvxol`，仍需唯一 TEST holder。
- Production DDL／DML／migration／部署、真實付款／退款／顧客通知，沒有新授權一律禁止。
- 不輸出或提交 token、密碼、key、完整 `.env`。

## 復盤

Owner 說「復盤」或「複盤」時：

1. 找最新 `docs/metrics/agent-runs/*.json`，比較最近最多 3 輪。
2. 先用 live GitHub 驗證所有完成主張，再用 `score-run.mjs` 重算。
3. 比較 weighted usage／Delivery Unit、close 率、品質、Sol touches、Luna 採用率、carryover。
4. 每次只提出一到兩個最大改良；治理改良走 governance PR，不順便改產品。
5. 不得改寫歷史弱分數或把 requested model 冒充 actual model。
