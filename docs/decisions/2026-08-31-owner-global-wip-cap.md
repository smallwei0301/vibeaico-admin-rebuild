# Owner 歷史裁示：全域 Agent WIP 上限與 Close-first

> **⚠️ SUPERSEDED / 已取代**
>
> 本文件記錄 2026-08-31 較早的 Owner 裁示，供歷史追溯。Owner 同日稍後已明確改判為
> **Mode C：不同 Issue 可多 Terra 平行、同 Issue 單 Terra、shared TEST 全域單線**。
>
> 現行規則以 `docs/decisions/2026-08-31-owner-multi-terra-test-serial.md`、
> `docs/AGENT-EXECUTION.md` 與 `docs/PR-LIFECYCLE.md` 為準。
>
> 下文的「全 repo active Terra max 1」與「全 repo ACTIVE_CANDIDATE max 2」**不得再當成
> 現行 Guard、派工或停工依據**。Close-first、Luna Closure、Sol 節流與 shared TEST 單線
> 等未被新裁示推翻的部分仍可作歷史背景參考。

---

> 日期：2026-08-31
>
> 原狀態：Owner 當時已裁示，後來被同日較新的 Mode C 裁示取代。
>
> 原優先權敘述：本文件當時針對同日互相衝突的多 Agent 提案作較新裁示；現在已不再是
> 最高優先，因 Owner 已再次明確改判。

## 當時選定的拓撲（已失效）

```text
1 條 active TERRA_BUILD
1 條固定 LUNA_CLOSURE
1 條 shared TEST_VALIDATION
最多 2 張 ACTIVE_CANDIDATE PR
```

當時的「1 條 Terra」是全 repo 全域上限；**這一條已被 Mode C 取代**。

## 當時固定分工

- **Sol**：只做開工 TRIAGE、模糊或高風險 DIAGNOSE、最後 AUDIT。
- **Terra**：當時只負責唯一 active 中大型 Issue；**現在改為每 Issue 一位 Terra，跨 Issue 可平行**。
- **Luna**：固定維持 Closure Sweep，另可做盤點、log 壓縮、文件與機械收尾。
- **TEST lane**：migration、reset、seed、integration、E2E 全域序列化，**這一條仍有效**。

## 當時的 Close-first TRIAGE

Sol 在啟動 Terra BUILD 前，先看已有 PR、已有 commit／CI 與上一輪高分候選，優先選：

1. 已在最終分支，只差證據、checkbox 或 close；
2. 只差一個小型自主步驟；
3. 已有 PR 與大多數測試，最多再做兩個自主步驟即可進 AUDIT。

Close-first 仍保留，但 Mode C 允許 Sol 同時選出多個 scope 不衝突的 Issue，分別交不同 Terra。

## 當時的活躍候選與停放（部分已失效）

- 當時 `ACTIVE_CANDIDATE=true` 全 repo 最多兩張；**此全域限制已失效，改為每 Issue 預算**。
- `PARKED` PR 不得再派 Agent、推 commit、手動 rerun、占 TEST lane 或反覆輪詢，仍有效。
- 當時第二張大型題目必須替換唯一 Terra；**此條已失效，不同 Issue 現可平行**。

## Closure Sweep

每輪 `/goal` 固定最多一條 Luna Closure Sweep：

- 優先掃 open PR 對應 Issue、近期有 commit／CI 的 Issue、上一輪 closeability 3 以上候選；
- 找不到可收尾候選時回報 `EMPTY_WITH_SCAN` 與已檢查清單；
- Luna 可補 evidence、checkbox、文件、小型非 TEST 檢查與已核准 closeout；
- 發現中大型 code 缺口時交回 Sol TRIAGE，不自行做產品 Terra 工作。

這部分在 Mode C 仍保留，但 Luna 發現新大型缺口時，可以為該 Issue 交 Sol 建立另一條合法 Terra lane，
不需要停掉其他不同 Issue Terra。

## Owner 控制與 Issue 來源

- Owner 重送 `/goal`、`/steer` 或「繼續」可能只是切換模型速度、深度或角色，不能單憑
  這些訊息判定 Agent 提早停止。
- 只有找到前一位 assistant 的終止性 final／明確暫停，且當時仍有安全可施工工作，
  才可記 `AGENT_PREMATURE_STOP`。
- 只有明確帶有 `AGENT_DISCOVERED` provenance 的 Issue 才算 Agent 新增；歷史無標記
  Issue 一律是 `owner-or-unknown`。

## 當時被取代的提案

當時本文件曾取代 PR #78/#80 等「多 Terra 跨 Issue」提案；**2026-08-31 稍後 Owner 又
明確採用經收斂後的 Mode C**。因此那些舊草案仍不是 canonical，但「不同 Issue 多 Terra、
shared TEST 單線」概念已由新的正式 Owner Decision 重新採納並加上可執行 Guard。

PR Janitor 的 stale PR 清理、supersession ancestry 與 fail-closed 檢查仍有效。

## 歷史驗收指標（已更新）

當時目標：

```text
active_terra_peak = 1
active_candidate_peak <= 2
```

現在 Mode C 改為：

```text
active_terra_peak                  可 > 1
same_issue_multi_terra_violations = 0
shared_test_peak                  = 1
shared_test_collisions            = 0
```

以最新 Mode C Decision 為準。
