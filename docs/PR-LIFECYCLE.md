# PR Lifecycle 與 Janitor 規則

> 最新 Owner WIP Decision：`docs/decisions/2026-09-02-owner-free-local-dual-terra-pilot.md`。
>
> Mode C 與付費 Supabase Preview Branch 規劃均為歷史。現行是最多兩條 qualified Terra、免費 per-PR local Supabase，以及單線 remote TEST／Sol Audit／merge。

## 1. 每個 Issue 的 PR 身分

每個 primary Issue 同時最多存在：

```text
1 張 ACTIVE implementation PR
+ 最多 1 張短命 VALIDATION／canary PR
```

雙 Terra 指兩個不同 Issue 各有一張 ACTIVE implementation PR，不代表同一 Issue 可同時開兩張施工 PR。

PR body 必須有：

```text
<!-- pr-lifecycle
issue: <number>
state: ACTIVE | VALIDATION | PARKED | OWNER_BLOCKED | HISTORICAL | REBUILD_REQUIRED | SUPERSEDED | COMPLETE
supersedes: <optional PR number>
-->
```

並依 `.github/pull_request_template.md` 填完整 B+、TEST 與 Completion Truth metadata。

## 2. 現行 WIP 上限

```text
qualified active TERRA_BUILD  max 2
active TERRA_RESERVE          pilot 期間 max 0
active LUNA_CLOSURE           max 1
active remote TEST_VALIDATION max 1
active Product candidates     max 2
Sol Audit                     max 1
merge                         max 1
```

第二條 Terra 只有在兩張 PR 都滿足免費雙 Terra 契約時才存在。否則上限自動維持一條。

必要契約：

```text
DUAL_TERRA_PILOT: true
TERRA_SLOT: 1 / 2
RUN_ID: 相同
Primary Issue: 不同
TEST_PROFILE: LOCAL_ISOLATED
TEST_ENV_ID: 不同
FINAL_CANONICAL_REQUIRED: true
FILE_OWNERSHIP: 不重疊
TEST_LANE_REQUIRED: false（BUILD 階段）
```

## 3. Lifecycle 狀態

### ACTIVE

目前有效的 implementation、Closure、remote TEST 或治理施工候選。ACTIVE 不等於可 merge，仍需 exact-head 證據。

### VALIDATION

短命驗證 PR，只為 isolated canary、remote TEST／Preview 或可重現性證據。它不是第二張長期 implementation PR，驗證完成後必須關閉、合併或回填主候選。

### PARKED

保存未完成工作但不占 WIP：

- 不派 Agent；
- 不 push；
- 不 rerun；
- 不輪詢；
- 不占 Terra、local TEST、remote TEST 或 candidate 名額。

### OWNER_BLOCKED

自主工作已做到最底，只剩精確 Owner／Production／外部供應商動作。PR body 必須列出已完成證據與唯一剩餘步驟。

### HISTORICAL

只作歷史證據。不得引用舊 CI／舊 SHA 當 current acceptance，也不得重新派 Agent。

### REBUILD_REQUIRED

方向仍有價值，但需從 current main 重建。舊 branch 不直接疊新 commit，除非 Sol 確認安全對齊。

### SUPERSEDED

已被新 PR 完整取代。需留下 ancestry／patch coverage／current-state 證據後安全關閉。

### COMPLETE

PR 所負責的 scope 已完成。若 Issue 還有其他 phase，PR COMPLETE 不代表 Issue 可關。

## 4. Terra 與 ownership

每張 active Terra PR 必須明確列：

```text
Primary Issue
TERRA_SLOT
FILE_OWNERSHIP
TEST_ENV_ID
exact head
```

`FILE_OWNERSHIP` 使用逗號分隔路徑根目錄。相同或父子路徑都算衝突。例如：

```text
src/app/api/chat
src/app/api/chat/messages
```

AppShell、同一 migration 編號、共用 fixture、共用 schema 或其他熱門檔無法切開時，不啟動第二條 Terra。

Pilot 期間 Reserve Terra 停用。只有下一輪已退回單 Terra，才可依舊 B+ 邊界恢復最多一條 source-only Reserve。

## 5. Local 與 remote TEST lifecycle

### LOCAL_ISOLATED

每張 Terra PR 在自己的免費本機 Supabase 執行：

```text
migration / reset / seed
integration
E2E
cleanup
```

不同 PR 可平行；同一 PR 新 SHA 取消舊 local run。成功只記：

```text
ISOLATED_GREEN
LOCAL_CLEANUP_VERIFIED
```

Local green 不代表可 merge。

### TEST_VALIDATION

只有一張 PR 可持有 remote canonical TEST：

```text
AGENT_LANE: TEST_VALIDATION
LANE_STATE: ACTIVE
TEST_LANE_REQUIRED: true
```

holder 必須與 exact PR、branch、SHA 相符。其他 runtime PR 在 remote CI 留 `POLICY_SKIP`，但可各自在 local isolated workflow 驗證。

remote TEST 結束後，PR 必須更新 run ID、結果、migration baseline、residue、未驗範圍與下一步，並釋放 holder。

## 6. Audit 與 merge lifecycle

兩張 local green 不得同時進 Sol Audit。依 closeability、風險與依賴排序：

```text
remote canonical TEST
→ Sol Audit
→ merge
→ Completion Truth re-fetch
→ Luna Closeout
```

一次只處理一張。

Sol verdict：

```text
CLOSE_APPROVED
FIX_REQUIRED
OWNER_BLOCKED
```

只有 `CLOSE_APPROVED` 才能進 Issue closeout。PR merge 仍依 repo 的授權與 Production 邊界處理。

## 7. Completion Truth

以下都只算「已提出動作」，不算完成：

- 呼叫 merge API；
- 呼叫 close API；
- 送出 migration／deploy；
- 啟動 CI；
- push branch。

宣稱 PR 已合併至少需要：

```text
live PR merged=true 或 merged_at
merge_commit_sha
current main head
merge commit 對 main 可追溯
ref=main 關鍵檔案重讀
```

宣稱 Issue 已關閉要重新 fetch `state=closed`；宣稱 CI 綠要同一 exact head 的必要 job 全部 terminal success；宣稱 cleanup 成功要重新查本機／外部環境結果。

證據未完成時使用 `*_REQUESTED_UNVERIFIED`。

## 8. Janitor 安全收斂

Janitor 只有在以下條件明確成立時才能自動關閉 superseded PR：

1. 同 repo；
2. 同 primary Issue；
3. lifecycle metadata 完整；
4. 新 PR 明確宣告 supersedes，或 ancestry／patch coverage 證明完整取代；
5. mutation 前重新查狀態未變；
6. 沒有獨有 migration、未回填驗收或外部證據。

不確定就標記 `JANITOR_REVIEW`，不能猜。

付費 Preview Branch 舊 PR／workflow 若已被 2026-09-02 決策取代，關閉時必須誠實記錄 `merged=false`、`paid resource created=false`，不得把歷史提案當現行 gate。

## 9. CI 節流

禁止：

- no-op commit 觸發 CI；
- 舊 SHA 或 superseded PR 重跑；
- 同一小改動拆成多輪完整 CI；
- remote TEST 忙碌時盲目 rerun；
- local cleanup 失敗後假裝成功；
- 透過改 metadata 規避 WIP Guard。

每個實質 source batch 盡量單一原子 commit。只有環境、程式或測試內容真的改變，才有合理新 run。

## 10. 自動退回與三輪觀察

若 local stack／cleanup 失敗、ownership collision、cross-lane contamination、active candidates 超過 2、品質低於 24／30、carryover／regression 上升，或 usage／Delivery Unit 惡化超過 20% 且出貨未增加，下一個 Run 自動退回一條 Terra。

最近三個完整 pilot Run 用來決定是否保留雙 Terra 為預設。任何硬性安全失敗都立即退回，不等待三輪湊滿。
