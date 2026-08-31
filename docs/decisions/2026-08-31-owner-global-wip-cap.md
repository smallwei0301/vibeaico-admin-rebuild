# Owner 最終裁示：全域 Agent WIP 上限與 Close-first

> 日期：2026-08-31
>
> 狀態：Owner 已裁示，適用於本裁示之後的所有長程 `/goal`。
>
> 優先權：本文件是針對同日互相衝突的多 Agent 提案所做的較新明確裁示。若 branch、
> Draft PR、Issue 留言、舊 session 或未合併決策文件與本文件衝突，以本文件為準，直到
> Owner 再次明確改判。

## Owner 選定的拓撲

```text
1 條 active TERRA_BUILD
1 條固定 LUNA_CLOSURE
1 條 shared TEST_VALIDATION
最多 2 張 ACTIVE_CANDIDATE PR
```

這裡的「1 條 Terra」是 **全 repo 的全域上限**，不是「每個 Issue 各可有一位 Terra」。
不同 Issue 不得在沒有 Owner 新 override 的情況下，同時各開一條中大型 Terra BUILD。

## 固定分工

- **Sol**：只做開工 TRIAGE、模糊或高風險 DIAGNOSE、最後 AUDIT。
- **Terra**：只負責目前唯一 active 中大型 Issue 的端到端施工與 targeted tests。
- **Luna**：固定維持 Closure Sweep，另可做盤點、log 壓縮、文件與機械收尾。
- **TEST lane**：migration、reset、seed、integration、E2E 全域序列化。

## Close-first TRIAGE

Sol 在啟動新的 Terra BUILD 前，先看已有 PR、已有 commit／CI 與上一輪高分候選，優先選：

1. 已在最終分支，只差證據、checkbox 或 close；
2. 只差一個小型自主步驟；
3. 已有 PR 與大多數測試，最多再做兩個自主步驟即可進 AUDIT。

明知主要依賴其他大型 Issue、Owner、外部人類、Production 或真實供應商驗證的 Issue，
原則上降順位。只有它是必要 dependency unlocker、P0、安全或資料損失問題時，才可占用
唯一 Terra lane，並留下理由。

## 活躍候選與停放

- `ACTIVE_CANDIDATE=true` 最多兩張，通常是一張 Terra 候選與一張 Closure 候選。
- 其他 open PR 必須標為 `PARKED`、`HISTORICAL` 或 `OWNER_BLOCKED`。
- `PARKED` PR 不得再派 Agent、推 commit、手動 rerun、占 TEST lane 或反覆輪詢。
- Owner 指定第二張大型題目時，Sol 必須決定替換目前 Terra lane，或將新題 park；不得
  自動把全域上限擴成兩條。

## Closure Sweep

每輪 `/goal` 固定保留一條 Luna Closure Sweep：

- 優先掃 open PR 對應 Issue、近期有 commit／CI 的 Issue、上一輪 closeability 3 以上
  候選；先限制在最多五個候選。
- 找不到可收尾候選時，回報 `EMPTY_WITH_SCAN` 與已檢查清單。
- Luna 可以補 evidence、checkbox、文件、小型非 TEST 檢查與執行已核准 closeout。
- 發現中大型 code 缺口時交回 Sol TRIAGE，不能自己變成第二條 Terra。

## Owner 控制與 Issue 來源

- Owner 重送 `/goal`、`/steer` 或「繼續」可能只是切換模型速度、深度或角色，不能單憑
  這些訊息判定 Agent 提早停止。
- 只有找到前一位 assistant 的終止性 final／明確暫停，且當時仍有安全可施工工作，
  才可記 `AGENT_PREMATURE_STOP`。
- 只有明確帶有 `AGENT_DISCOVERED` provenance 的 Issue 才算 Agent 新增；歷史無標記
  Issue 一律是 `owner-or-unknown`。

## 被取代的提案

以下提案在未來可以保留其技術資產，但其「多 Terra 跨 Issue 平行」規則已被本裁示取代：

- PR #78 的 PR Janitor 草案；
- PR #80 的乾淨 PR Janitor 草案；
- 任何宣稱「每個 Issue 各一位 Terra，所以全 repo 可同時多 Terra」的 branch-only 文件。

PR Janitor 的 stale PR 清理、supersession ancestry 與 fail-closed 檢查仍有價值，可在本裁示
的全域 WIP 上限落地後，以窄幅 follow-up 整合；不得藉此重新放寬 Terra 上限。

## 驗收指標

接下來十個 Issue 的目標：

```text
active_terra_peak = 1
active_candidate_peak <= 2
closure_sweeps >= 每輪 1 次
invalid_ci_reruns = 0
一般 Issue 的 Sol 接觸 <= 2～3 次
closed_issues 持續增加
```

本裁示要把結果從「多張 Draft、沒有 Close」改成「一到兩個完整候選、持續 Close、更少
CI 與 Sol 重讀」。
