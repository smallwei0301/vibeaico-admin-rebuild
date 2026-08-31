# Owner 最新裁示：多 Terra 分 Issue，shared TEST 仍單線

> 日期：2026-08-31
>
> 狀態：Owner 已裁示，立即取代同日較早的 `docs/decisions/2026-08-31-owner-global-wip-cap.md`
> 中「全 repo 最多 1 條 Terra BUILD」與「全 repo 最多 2 張 ACTIVE_CANDIDATE」規則。
>
> 仍保留：每個中大型 Issue 只有一位 Terra owner、Close-first、Luna Closure Sweep、Sol
> 高價值介入邊界、PR Janitor fail-closed、shared TEST 全域序列化。

## Owner 選定的拓撲

```text
Issue #A → TERRA_BUILD A ─┐
Issue #B → TERRA_BUILD B ─┼─ source / unit / typecheck / build 可平行
Issue #C → TERRA_BUILD C ─┘
                           │
                           ▼
                  shared TEST_VALIDATION
                    全 repo 最多 1 條
```

核心規則：

- **不同 Issue 可以由不同 Terra 同時施工。**
- **同一個中大型 Issue 同時最多一位 Terra owner、最多一張 active implementation candidate。**
- **shared TEST Supabase 仍然全 repo 單線。** migration、reset、seed、schema cache mutation、
  integration 與 E2E 必須排隊，不得因多 Terra 而平行寫同一 TEST。
- `LUNA_CLOSURE` 仍是跨 Issue 的單一 Closure Sweep／Janitor lane，最多一條 active。
- 不再設定「全 repo Terra max 1」與「全 repo ACTIVE_CANDIDATE max 2」。candidate 預算改回
  **每 Issue** 管理：1 張 ACTIVE implementation，必要時最多 1 張短命 VALIDATION/canary。

## 多 Terra 可平行做什麼

不同 Issue 的 Terra 可以同時進行：

- source code 實作；
- unit tests；
- typecheck；
- build；
- 不碰 shared TEST 的靜態檢查、mock/provider-local tests；
- 各自 branch／PR 的 source reconciliation。

前提：

- 不得多人同時施工同一 Issue；
- 若兩個 Issue 大量修改同一批核心檔案，Sol 應調整責任邊界或暫停其中一條衝突線，
  但這是 **file/scope collision** 管理，不是恢復全 repo Terra max 1；
- 高風險共用基礎（Auth、payment callback、migration 基線、共用 RPC）若責任重疊，先由
  Sol 定義 owner 與整合順序。

## shared TEST 單線規則

所有 Terra 進 TEST 前都先取得唯一 `TEST_VALIDATION` lane：

1. 確認當前 TEST holder 與 exact head。
2. 只有 holder 可執行 migration／reset／seed／integration／E2E。
3. 其他 Terra 在 source/unit/build 繼續工作，但不得寫 TEST、不得啟動會寫 shared TEST 的手動流程。
4. GitHub Actions 維持 `shared-test-supabase-integration` concurrency，`cancel-in-progress: false`。
5. TEST lane 釋放後，由 TRIAGE 排定下一個需要 TEST 的 exact head，不能多條 branch 同時搶寫。

這等同多個廚師可以在各自砧板備料，但共用的一口壓力鍋一次只能進一道菜。

## PR 與 Janitor

每個 Issue：

- 最多 1 張 lifecycle `ACTIVE` implementation PR；
- 必要時最多 1 張短命 `VALIDATION` PR；
- 第 3 張 open PR 立即進 Janitor 收斂；
- 同 Issue 的舊 PR 只有在 explicit `supersedes`、same Issue、same repo、ancestry／patch coverage
  證明成立時才可自動或機械 close。

全 repo：

- 可以同時存在多張來自不同 Issue 的 active Terra PR；
- 不以 PR 數量本身阻擋不同 Issue 施工；
- `TEST_VALIDATION` 仍最多 1；
- `LUNA_CLOSURE` 仍最多 1；
- parked／historical／owner-blocked PR 不派 agent、不重跑無效 CI。

## Sol / Luna / Terra 分工

- **Sol**：每個 Issue 的 TRIAGE、真正 file/scope collision、高風險 DIAGNOSE、最後 AUDIT。
  Sol 不因多 Terra 而替每條線常駐搬運。
- **Terra**：一人一 Issue，端到端施工到 source-ready；需要 shared TEST 時排隊。
- **Luna**：跨 Issue inventory、Closure Sweep、Janitor、證據整理與 closeout。

## 被取代的規則

以下規則從本裁示起失效：

```text
全 repo active TERRA_BUILD max 1
全 repo ACTIVE_CANDIDATE max 2
已有一條 Terra 時其他 Issue 一律 PARKED
```

`docs/decisions/2026-08-31-owner-global-wip-cap.md` 保留為歷史決策記錄，但不再是最新 WIP
拓撲。若其他 canonical 文件仍寫上述全域上限，必須依本決策修正；在修正完成前，以本文件
為最高優先。

## 驗收指標

未來觀察：

```text
active_terra_peak                 可 > 1，但同 Issue active_terra <= 1
same_issue_multi_terra_violations = 0
shared_test_peak                  = 1
shared_test_collisions            = 0
invalid_ci_reruns                 = 0
janitor_budget_violations         = 0
closed_issues                     持續增加
sol_contacts_per_normal_issue     目標 2～3
```

這次調整的目的不是把所有 Issue 同時打開，而是解除「明明檔案互不衝突，也被全域單 Terra
鎖住」的人工瓶頸，同時把真正不可並行的 shared TEST 保持單線。