# 多 Issue 平行施工與 PR Lifecycle Janitor

> Owner 裁示日期：2026-08-31
> 性質：治理方向與影響；機械規則唯一以 [PR-LIFECYCLE](../PR-LIFECYCLE.md) 為準。

## 理由與影響

不同 Issue 可由不同 Terra 平行施工；同一中大型 Issue 只保留一位 Terra owner。共享 TEST
migration、reset、seed、integration 與 E2E 仍由單一 serialized TEST holder 執行。

每個 Issue 僅保留一個 ACTIVE implementation candidate，必要時加一個短命 VALIDATION；Janitor
負責盤點與安全收斂，不能因名稱、年齡或 base 落後自行關閉 PR。任何把 `TERRA_BUILD max 1`
或 `ACTIVE_CANDIDATES max 2` 當全 repo 拓撲的舊草案均被拒絕；限制是每 Issue ownership 與共享 TEST。

## 參考

- Canonical execution: [AGENT-EXECUTION](../AGENT-EXECUTION.md)
- Lifecycle mechanics and fail-closed close conditions: [PR-LIFECYCLE](../PR-LIFECYCLE.md)
- Janitor implementation: `scripts/agents/pr-janitor.mjs`
