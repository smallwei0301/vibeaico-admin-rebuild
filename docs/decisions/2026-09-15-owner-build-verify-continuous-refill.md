# Owner Decision — Product BUILD / VERIFY 分離與 continuous refill

日期：2026-09-15

## 背景

2026-09-15 Product Run 已觀測到 `mainTerraPeak=2`、`activeCandidatePeak=2`、`reserveTerraPeak=0`、`sharedTestPeak=0`。現行 `ACTIVE_CANDIDATE` hard cap 已是 3，因此當前吞吐瓶頸不是 candidate cap 被塞滿，而是雙 Terra 被當成例外，且 source BUILD 與後續 CI／TEST／Final Risk／merge VERIFY tail 綁在同一個 Terra slot。

## Owner 裁示

1. `ACTIVE_CANDIDATE` hard max **維持 3**。
2. `TERRA_BUILD` hard max **維持 2**，不開第三 Terra。
3. 當同一 Product Run 有兩張可機械證明安全、不同 Issue、不同 local TEST、`FILE_OWNERSHIP` 零重疊的候選時，**兩個 BUILD slot 應作為預設目標占滿**；只有沒有第二張 qualified candidate 或存在 hot-boundary 衝突時才降回單 Terra。
4. `TERRA_BUILD` 只代表仍允許 source mutation。source 已完成並可進 exact-head 驗證後，候選改由既有 `TEST_VALIDATION` 承接 VERIFY tail；VERIFY 仍算 active Product candidate，但不再占 Terra BUILD slot。
5. 任一 BUILD slot 釋放後，只要 `ACTIVE_CANDIDATE < 3` 且存在 qualified candidate，就立即 continuous refill，不等待前一張 PR 完成 Final Risk／merge 才開下一張 Product source work。
6. 合法穩態為最多 **2 BUILD + 1 VERIFY = 3 active Product candidates**；shared canonical TEST 仍只能一位 holder。
7. VERIFY tail 若發現需要 source fix，必須先重新取得 `TERRA_BUILD` slot、通過 WIP Guard，再 push source commit；VERIFY lane 本身不得偷偷修改 source。
8. 雙 Terra 時 `TERRA_RESERVE=0` 不變。
9. 同一 migration／migration ledger、payment/refund transaction、Auth／RLS／ACL、Production DB writer／release、或其他共享高風險 hot boundary，不因本裁示而允許強行雙線施工。
10. Product Final Risk、shared TEST serialization、branch protection、Production DB policy gate 全部維持原強度。

## 執行原則

這是 throughput scheduling 調整，不是安全標準放寬。實作應優先重用既有 `AGENT_LANE`、`LANE_STATE`、`ACTIVE_CANDIDATE`、`RUN_ID` 與 dual-Terra metadata，不新增新的必填 PR metadata 欄位。

現行操作規則最後收斂回 `docs/AGENT-EXECUTION.md`；本文件只保存本次 Owner Decision 的原因與邊界。
