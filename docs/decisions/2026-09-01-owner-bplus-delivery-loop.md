# Owner 最終裁示：B+ 出貨迴圈、Luna 小隊與可量化復盤

> Owner 裁示日期：2026-09-01
>
> 狀態：Owner 已裁示，自本文件進入 `main` 後適用於所有新的 `/goal`、持續施工與復盤。
>
> 優先權：本文件取代 `docs/decisions/2026-08-31-owner-multi-terra-test-serial.md`
> 中「不同 Issue 可同時有多條完整 Terra BUILD」的 Mode C 排程。Mode C 的一個 Issue
> 只准一位 Terra、共用 TEST 單線、Production 安全線與精簡交接原則繼續有效。

## 1. Owner 選定的 B+ 拓撲

```text
1 條 MAIN_TERRA      唯一完整出貨線
1 條 RESERVE_TERRA   只准 source-only 備料
1 條 LUNA_CLOSURE    固定收尾線
3～6 個窄任務 Luna  預設 4，必要時最多 6
1 條 TEST_VALIDATION 共用 TEST 驗證線
最多 2 張 ACTIVE_CANDIDATE PR
Sol 一般只在 TRIAGE 與 AUDIT 各出現一次
```

B+ 不是停止多工，而是把多工改成不同職責：一台車完整組裝，一台車先備料，多位 Luna
清點、查證、整理與收尾；只有一台車能進共用驗車道。

## 2. MAIN_TERRA

- 全 repo 同時最多一條 active `TERRA_BUILD`。
- 主線可以讀 code、改多檔案、寫 targeted tests、申請共用 TEST、修明確 CI、進 Sol
  Audit，並一路做到 `CLOSED`、`AUDIT_READY` 或 `OWNER_BLOCKED`。
- `PR 已開`、`CI 綠`、`正在等 Preview` 都不是主線完成。
- 主線沒有到上述三種出口前，不啟動第二條完整中大型 BUILD。

## 3. RESERVE_TERRA

- 全 repo 同時最多一條 active `TERRA_RESERVE`。
- 預備線只能在主線等待 CI、TEST、外部唯讀結果或沒有可繼續施工的小空檔啟動。
- 預備線可以：讀必要規格、寫失敗測試、做不碰主線檔案的 source-only 小切片、跑
  unit／typecheck／build、保存最多一個原子 commit。
- 預備線不可以：使用 shared TEST、進 Sol 最終 Audit、擴大範圍、開第二輪完整 CI、
  變成第二張完整出貨 PR，或碰主線的 hot files。
- 完成後停在 `READY_FOR_PROMOTION`。只有主線進入 `CLOSED`、`AUDIT_READY` 或
  `OWNER_BLOCKED`，Sol 才能把預備線升為下一條 MAIN_TERRA。

## 4. Luna 小隊

預設同時派 4 位窄任務 Luna；工作彼此獨立、結果採用率穩定時可提高到 6 位：

```text
LUNA_TRUTH     GitHub／main／PR／CI／TEST holder 真實盤點
LUNA_CLOSURE   close-ready 候選、證據、checkbox、機械 closeout
LUNA_CI        只在狀態改變時回報 CI，壓縮失敗 step／case
LUNA_JANITOR   stale／superseded PR 與 ancestry 盤點
LUNA_DOCS      PR body、文件、metadata、handoff 同步
LUNA_QA        對照 acceptance 與現有測試，最多回報 3 個 blocking gap
LUNA_METRICS   收集 ledger、產生 scorecard，不能美化缺失資料
```

每個 Luna 任務只能含一個 Issue 或 PR、一個 exact SHA、一個問題、限定讀取範圍與固定輸出。
不得把完整舊對話或全 repo 掃描複製給每位 Luna。

## 5. Sol 的使用上限

一般 Issue 目標只有：

```text
TRIAGE 1 次
AUDIT  1 次
```

只有 Auth、DB、付款、權限、安全、跨租戶、模糊 CI 或重大 scope collision 才增加一次
DIAGNOSE。Sol 不負責 grep、CI polling、一般 CRUD、文件搬運或完整舊 Session 重讀。

## 6. Shared TEST 與 CI

- shared TEST 的 migration、reset、seed、schema cache mutation、integration、E2E 全 repo
  最多一條 `TEST_VALIDATION`。
- RESERVE_TERRA 永遠不得持有 TEST lane。
- 非 TEST holder 的 runtime PR 只跑 source checks，並留下明確 `POLICY_SKIP` 證據；只有
  唯一 TEST holder 與 `main` push 可使用 TEST secrets 與重型驗證。
- 同一 exact head、同一環境、同一命令不得盲目重跑。

## 7. Loop 與報告

每一輪必須有 `RUN_ID`，並留下：

```text
docs/metrics/agent-runs/<RUN_ID>.json
docs/metrics/agent-runs/<RUN_ID>.md
```

JSON 是可重算的原始紀錄；Markdown 是白話報告。每輪至少包含：

- main 起訖 SHA、open Issue／PR 起訖數量；
- MAIN／RESERVE／Closure／TEST lane 與峰值；
- Luna／Terra／Sol 任務、requested／actual model；
- 實際 token（若平台提供）或明確標示 unavailable；
- 內部加權 usage，預設 Luna=1、Terra=3、Sol=6；
- issues closed、audit ready、完整 owner-blocked、carryover；
- CI、無效重跑、品質、安全、證據完整度；
- 100 分 scorecard、前輪比較與下一輪最多兩項調整。

內部模型權重不是 OpenAI 官方 token 換算，只用來比較本專案不同輪次。沒有實際 token
資料時不得捏造百分比。

## 8. 復盤觸發

Owner 說「復盤」或「複盤」時，載入：

```text
.agents/skills/vibeaico-agent-retrospective/SKILL.md
```

Skill 必須找到最新報告，至少比較最近 3 輪，若不足則比較全部；指出 usage、完成效率、
品質、多 Agent 流動與證據的變化。每次只提出一到兩個最有影響的流程調整，避免復盤本身
又長成一個新專案。

## 9. 現有 Mode C PR 的轉場

本文件進入 `main` 後，先做一次轉場盤點：

1. 選一張真正需要持續 code repair 的 PR 作 MAIN_TERRA。
2. 選一張檔案不衝突、可 source-only 備料的 PR 作 RESERVE_TERRA。
3. 選一張最接近 Audit／Owner-blocked 的 PR 作 LUNA_CLOSURE。
4. 其他舊 active Terra 改為 `PARKED`、`OWNER_BLOCKED` 或 `HISTORICAL`；保留 commit 與
   CI 證據，但停止新 commit、重跑與輪詢。
5. 轉場不得 reset、force-push 或丟失現有成果。

## 10. 十輪驗收目標

```text
main_terra_peak = 1
reserve_terra_peak <= 1
active_candidate_peak <= 2
shared_test_peak <= 1
invalid_ci_reruns = 0
一般 Issue sol_touches <= 2～3
Luna 結果採用率 >= 80%
每兩輪至少 1 個 CLOSED 或完整 OWNER_BLOCKED
weighted_usage_per_delivery_unit 持續下降
品質與安全分不得因節省 usage 而下降
```