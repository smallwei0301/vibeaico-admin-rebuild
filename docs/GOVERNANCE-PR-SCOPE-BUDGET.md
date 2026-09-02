# 治理 PR 範圍預算

> 追蹤：Issue #113

## 規則

Agent 建立且目前為 ACTIVE 的治理 PR，預設上限：

```text
changed files <= 8
additions + deletions <= 800
```

這是「一張 PR 裡裝多少工作」的上限，不是整個專案只能改 8 個檔案。超過時應依功能拆成數張小 PR，依序測試與合併。

## 為什麼需要

大型治理 PR 容易同時混入：

- 工作分配規則；
- CI／TEST 流程；
- 評分程式；
- schema（資料格式）；
- Skill（Agent 工作手冊）；
- 舊流程清理。

結果會像一個行李箱同時塞進廚具、輪胎和棉被。任何一樣要修改，整箱又得重新安檢。

## 自動守門

`.github/workflows/governance-scope-budget.yml` 使用 `pull_request_target`，只從可信任的 default branch 讀取政策程式，不執行 PR 分支裡的程式。

它只檢查：

```text
WORK_ORIGIN: AGENT
AGENT_LANE: GOVERNANCE
LANE_STATE: ACTIVE
```

Product PR、Owner 親自建立的 PR，以及 PARKED／HISTORICAL PR 不受此預算阻擋。

## 超過上限時

正常作法：

```text
停止往原 PR 加內容
→ 標記 REBUILD_REQUIRED 或 PARKED
→ 從 current main 建小分支
→ 每張 PR 只修一種治理問題
```

例如：

```text
PR A：Delivery Outcome v2
PR B：治理 PR 範圍守門
PR C：雙 Terra WIP 規則
```

不要把 A、B、C 又重新黏成一張巨型 PR。

## Owner 例外

真的無法拆分時，PR 只能引用已存在於可信任 `main` 的 Owner Decision：

```text
GOVERNANCE_SCOPE_EXCEPTION: OWNER:docs/decisions/2026-09-02-example.md
```

該決策檔必須明確包含：

```text
GOVERNANCE_SCOPE_EXCEPTION: APPROVED
GOVERNANCE_SCOPE_BRANCH: governance/exact-branch-name
```

守門程式會同時確認檔案存在、核准標記與分支名稱一致。只寫 `OWNER:#113`、「Owner 說可以」或引用 PR 分支自己新增的決策檔都無效。

例外只解除範圍預算，不解除 CI、Completion Truth、Production 或安全邊界。

## 不可用的繞法

- 把 ACTIVE 改成 PARKED，實際卻繼續 push；
- 把多個檔案內容塞進單一 generated（生成）檔；
- 壓成一行只為降低變更行數；
- 用空白 commit 反覆重跑；
- 把不同目的說成「同一個治理主題」。

若出現這些情況，Sol Audit 應判 `FIX_REQUIRED`，必要時復盤記為治理失敗。
