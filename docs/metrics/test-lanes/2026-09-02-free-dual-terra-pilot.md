# 免費本機雙 Terra 試行基準

> Issue：#104
>
> Decision：`docs/decisions/2026-09-02-owner-free-local-dual-terra-pilot.md`
>
> 建立時 main：`2e9d4bc664bea1c09c3f8cb079313c9072ffd842`

## Owner 決策

```text
付費 Supabase Preview Branch：DEFERRED_NOT_IN_CONSIDERATION
免費 per-PR local Supabase：最多兩條完整 Terra 各自使用
現有 remote TEST：唯一最終 canonical gate
Sol Audit：max 1
merge：max 1
```

## 已知基礎

- Phase 1A 已證明兩個 local runner/database 可以同時持有相同固定 ID 而不互相污染。
- Phase 1B 已跑過完整 local migration、reset/seed、integration、E2E 與 cleanup。
- 現有 remote TEST lane 保留唯一 holder 與 exact-head 驗證。
- 付費 Preview Branch 控制層曾進入 main，但新決策將其移出 active workflow；歷史提交仍可追溯。

## Pilot 驗收

- [ ] WIP Guard 只在兩張 PR 都符合 pilot 契約時允許第二條 Terra。
- [ ] slot 1／2、Issue、TEST_ENV_ID、FILE_OWNERSHIP 不同。
- [ ] 兩條 Terra 使用同一 RUN_ID。
- [ ] pilot 期間 Reserve Terra 為 0。
- [ ] 兩張 PR 都使用 `LOCAL_ISOLATED` 與 `FINAL_CANONICAL_REQUIRED=true`。
- [ ] active candidate 不超過 2。
- [ ] remote canonical TEST、Sol Audit、merge 仍分別 max 1。
- [ ] `REMOTE_BRANCH_REQUIRED` 不再是有效 TEST profile。
- [ ] active paid-branch workflow、policy、schema、unit test 已從 main 移除。
- [ ] exact-head CI 與治理 Audit 通過。
- [ ] merge 後從 `ref=main` 重新讀回關鍵檔案。

## 三輪觀察欄位

```text
RUN_ID
full_terra_peak
slot_1_active_minutes
slot_2_active_minutes
local_isolated_runs / success / failure / cleanup
remote_canonical_wait_minutes
file_ownership_collision
cross_lane_contamination
issues_closed
delivery_units
carryover
weighted_usage_per_delivery_unit
Sol_touches_per_issue
post_merge_regression
fallback_to_single_terra
```

三輪觀察不是試行前等待條件。新規則合併後可以直接啟動兩位 Terra；任何失控訊號則下輪自動退回單 Terra。
