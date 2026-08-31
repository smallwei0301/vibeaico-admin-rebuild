# 多 Issue 平行施工與 PR Lifecycle Janitor

> Owner 裁示日期：2026-08-31
>
> 狀態：**部分被較新 Owner 裁示取代。**
>
> 較新裁示：`docs/decisions/2026-08-31-owner-global-wip-cap.md`
>
> 保留內容：PR Janitor、每 Issue 候選預算、fail-closed supersession 與 stale PR 退休機制。
>
> 已被取代內容：不同 Issue 可同時由多位 Terra 平行 BUILD，以及拒絕全 repo Terra max-1／
> candidate max-2 的條款。

## 歷史理由與原提案

本文件原先提議不同 Issue 可由不同 Terra 平行施工，同一 Issue 只保留一位 Terra owner，
共用 TEST 則單線執行。這個提案確實能提高施工吞吐，但實際早上工作出現多張大型 Draft、
大量 CI 與零 closeout，因此 Owner 後續明確改採全 repo WIP 上限。

目前 canonical 拓撲是：

```text
1 條 active TERRA_BUILD
1 條固定 LUNA_CLOSURE
1 條 shared TEST_VALIDATION
最多 2 張 ACTIVE_CANDIDATE PR
```

## 仍有效的 Janitor 原則

- 每個 Issue 最多一個 ACTIVE implementation candidate，必要時一個短命 VALIDATION。
- Janitor 不能因名稱、年齡或 base 落後就關閉 PR。
- 自動 supersession 必須由同 Issue、明確 `supersedes` 與 commit ancestry 證明。
- ancestry、API、權限或差異不確定時 fail closed 到 `JANITOR_REVIEW`。
- PR 歷史保存在 closed PR、commit 與 comment，不靠長期維持 active。
- stale PR 不再 rerun CI。

## 現行參考

- 最新 Owner WIP：`docs/decisions/2026-08-31-owner-global-wip-cap.md`
- Canonical execution：`docs/AGENT-EXECUTION.md`
- Lifecycle mechanics：`docs/PR-LIFECYCLE.md`
- Janitor implementation：`scripts/agents/pr-janitor.mjs`

未來可以改良 Janitor 程式，但不得藉由修改本歷史文件，重新恢復多 Terra 跨 Issue平行。
