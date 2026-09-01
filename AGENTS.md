# AGENTS.md

所有 Agent 在本 repo 開工前必須先讀：

1. `CLAUDE.md`
2. `docs/decisions/2026-09-01-owner-bplus-delivery-loop.md`
3. `docs/AGENT-EXECUTION.md`
4. `docs/AGENT-BPLUS-DELIVERY-LOOP.md`
5. `docs/DOCUMENTATION-GOVERNANCE.md`
6. `docs/OWNER-DECISIONS.md`
7. 該 Issue 指定的 `docs/integration/**` canonical 文件
8. `docs/integration/12-TESTING-TDD.md`
9. 以 Issue／錯誤碼搜尋 `docs/AGENT-PLAYBOOK.md`，只讀相關條目
10. 長程 `/goal` 載入 `.agents/skills/vibeaico-agent-orchestration/SKILL.md`
11. Owner 說「復盤」或「複盤」時，載入
    `.agents/skills/vibeaico-agent-retrospective/SKILL.md`

## 最新工作模式：B+

2026-09-01 Owner 已用 B+ 取代「不同 Issue 可同時有多條完整 Terra BUILD」的 Mode C：

```text
MAIN_TERRA      最多 1，唯一完整中大型出貨線
RESERVE_TERRA   最多 1，只准 source-only 備料
LUNA_CLOSURE    最多 1，固定收尾／Janitor 線
LUNA_TASKS      預設 4，最多 6，任務必須窄且不重複
TEST_VALIDATION 最多 1，共用 TEST 單線
ACTIVE_CANDIDATE 最多 2
Sol             一般只做 TRIAGE 與 AUDIT
```

Mode C 文件保留為歷史，不得再用它同時開多張完整 Terra 工地。

## 開工與接手

- 先 `git fetch origin --prune`，從 `origin/main` 讀規則。
- 以 live GitHub、current main、exact-head CI 與 shared TEST 為真相；舊 Session 只當線索。
- 不 reset、force-push 或重做已完成 commit／migration／測試。
- 每輪建立或接續 `RUN_ID`，並維護：

```text
docs/metrics/agent-runs/<RUN_ID>.json
docs/metrics/agent-runs/<RUN_ID>.md
```

## 角色分工

- **Luna**：盤點、CI 摘要、Closure、Janitor、文件、QA、Metrics。每個任務只回答一個
  問題，預設最多 15 行；一位 Luna Aggregator 去重後再交 Sol。
- **Sol**：MAIN／RESERVE 選題、重大 scope/file collision、模糊 CI、高風險設計、最終
  `CLOSE_APPROVED | FIX_REQUIRED | OWNER_BLOCKED`。不做 CI 輪詢與一般施工。
- **MAIN Terra**：唯一完整施工線，做到 `CLOSED | AUDIT_READY | OWNER_BLOCKED`。
- **RESERVE Terra**：只有 MAIN 等待時才做一個 source-only 小切片；不碰 TEST、不進 Audit、
  最多一個原子 commit，停在 `READY_FOR_PROMOTION`。

## 強制護欄

- MAIN Terra 全 repo 最多 1；Reserve 最多 1；Closure 最多 1；TEST 最多 1；active
  candidates 最多 2。
- MAIN 必須有 Closure target，或明確 `EMPTY_WITH_SCAN`／`REPORT:<path>` 證據。
- RESERVE 必須填 `RESERVE_BOUNDARY`，`TEST_LANE_REQUIRED=false`，且不可是 active candidate。
- 一般 runtime PR 若不是唯一 TEST holder，只跑 source checks；integration／E2E 必須留下
  `POLICY_SKIP`，不能碰 shared TEST。
- `PARKED` PR 不派 Agent、不 push、不 rerun、不輪詢。
- 同 exact head、同環境、同命令不得盲目重跑；環境錯誤兩次即停損換路。
- Issue 只有 Sol 回覆 `CLOSE_APPROVED` 才能由 Luna／主 Agent 關閉。

## 文件與安全

- 正式產品／API／驗收以最新 `main` canonical 文件為準。
- docs-only 可依治理規則直進 main；程式、workflow、skill、依賴與 migration 走 PR／CI／Audit。
- TEST 長期授權只限 Supabase project `nmwhwngojosmagjuvxol`，仍需唯一 TEST holder。
- Production DDL／DML／migration／部署、真實付款／退款／顧客通知，沒有新授權一律禁止。
- 不輸出或提交 token、密碼、key、完整 `.env`。

## 復盤

Owner 說「復盤」或「複盤」時：

1. 找最新 `docs/metrics/agent-runs/*.json`，至少比較最近 3 輪。
2. 用 `score-run.mjs` 重算，不相信手填分數。
3. 比較 weighted usage／Delivery Unit、close 率、品質、Sol touches、Luna 採用率、carryover。
4. 每次只提出一到兩個最大改良；治理改良走 governance PR，不順便改產品。
