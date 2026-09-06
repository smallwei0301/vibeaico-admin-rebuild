# Owner Decision：免費本機雙 Terra 試行

> Issue：[#104](https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/104)
> 決策日期：2026-09-02
> 狀態：ACTIVE

## 決策

付費 Supabase Preview Branch 降級為：

```text
DEFERRED_NOT_IN_CONSIDERATION
```

本試行不建立付費 Preview Branch、不要求費率確認，也不把付費 Branch 當成 DB、Auth 或 Storage 驗收前置條件。

雙 Terra 的 BUILD 階段使用兩條互相隔離的免費 per-PR local Supabase 路線：

```text
TERRA_SLOT_1 → 免費 per-PR local Supabase
TERRA_SLOT_2 → 免費 per-PR local Supabase
        ↓
唯一 remote canonical TEST
        ↓
Sol Audit
        ↓
Merge
```

兩條 local 路線可以平行；remote canonical TEST、Sol Audit、Merge 各自維持一次一張 PR 的串行限制。Local green 只能叫 `ISOLATED_GREEN`，不能冒充 canonical remote TEST green。

## 雙 Terra contract

只有同時滿足以下條件的 `TERRA_BUILD` 才能讓 WIP Guard 將 Terra 上限提高到 2：

- `DUAL_TERRA_PILOT=true`。
- `TERRA_SLOT` 恰為 `1` 或 `2`，兩條不可重複。
- primary Issue 不同。
- `RUN_ID` 相同，代表同一輪可稽核試行。
- `FILE_OWNERSHIP` 不重疊，也不可互為父子路徑。
- `TEST_PROFILE=LOCAL_ISOLATED`。
- `TEST_ENV_ID` 不同。
- `FINAL_CANONICAL_REQUIRED=true`。
- `TEST_LANE_REQUIRED=false`；BUILD 不持有 remote TEST。

雙 Terra 有效期間：

- `TERRA_BUILD` 最多 2。
- `TERRA_RESERVE` 固定 0。
- `LUNA_CLOSURE` 最多 1。
- remote `TEST_VALIDATION` 最多 1。
- Product `ACTIVE_CANDIDATE` 最多 2；Luna Closure 不算第三個 Product candidate。

任一 contract 不合格，立即回到單 Terra（Terra 上限 1、Reserve 上限 1），不得以重跑或補註解繞過 Guard。

## 試行與安全邊界

- 每張 local TEST 使用自己的 `TEST_ENV_ID`，完成後必須清理 local 資源。
- local TEST 不讀 Production 或 remote TEST secret。
- remote TEST 維持唯一 canonical holder。
- Production DDL、DML、migration、deploy 或 promote 禁止。
- 真實付款、退款、顧客通知禁止。
- 不新增、不恢復任何付費 Supabase Preview Branch。

## 後續觀察

治理 contract 通過後，由 Luna live 掃描 open Issues／PRs，Sol 重新選出兩個互不依賴且可自主完成的候選，再開始 Pilot Run #1。最近三個完整 Run 必須記錄 local 成功／失敗／清理、remote 等待、Issue／delivery、usage、Sol touches、ownership collision、cross-lane contamination 與 post-merge regression。

若清理失敗、檔案撞車、跨線污染、品質下降，或 usage／delivery unit 惡化超過 20% 且產出沒有增加，下一輪自動降回單 Terra。

## Completion Truth

這份決策只授權治理 contract 與免費 local 試行；它不等於 Production 授權，也不等於任何特定 Issue 已完成。每個 PR／Run 仍須以 exact-head CI、local isolation 結果、唯一 remote canonical TEST、Sol audit、merge 後 main re-read 等 live evidence 關閉。
