# Owner Decision：Vercel Preview 部署白名單

> Owner 裁示日期：2026-09-01
>
> 狀態：Owner 已裁示；本變更進入 `main` 後生效。

## 決策

Vercel Git 自動部署改為白名單模式：

```text
main         → 允許自動部署（既有 Production 行為維持）
preview/**   → 允許自動 Preview 部署
其他 branch → 不自動建立 Vercel deployment
```

目的不是降低 GitHub CI 品質，而是避免 Agent 的細碎 commit／push 把每一步都轉成沒有實際驗收價值的 Preview deployment，快速消耗 Hobby 每 24 小時部署額度。

## Preview 驗收流程

一般 `agent/**`、`terra/**`、`fix/**`、`goal/**`、`test/**`、`docs/**`、`governance/**` 等施工分支只使用 GitHub CI 與 TEST 驗證，不等待 Vercel Preview。

真的需要瀏覽器、登入、UI、LINE provider 或 Owner Preview 驗收時，才建立明確的短命驗收分支，例如：

```text
preview/pr-92
preview/issue-47
```

驗收分支必須指向要驗收的 exact candidate SHA。不要為了讓 Vercel 重跑而做 no-op commit。候選 SHA 改變後，只有在再次需要 Preview 驗收時才更新 `preview/**` 分支。

## 判案規則

- 一般 PR 沒有 Vercel check 是預期行為，不是 CI 缺失。
- `api-deployments-free-per-day`、`Deployment rate limited` 屬外部平台額度限制；不得因此修改無關程式、盲目 rerun 或 no-op push。
- GitHub CI、shared TEST、Sol Audit 與 Issue 自身 acceptance gate 仍照 canonical 規則執行。
- 本決策不授權 Production DDL／DML／migration、流量切換或任何額外 Production 操作。

## 實作

`vercel.json` 使用 `git.deploymentEnabled`：先用 `* = false` 預設關閉，再明確開啟 `main` 與 `preview/**`。Vercel 的 branch rules 若同時命中多個 pattern，只要其中一個為 `true` 就會部署，因此 `main` 與 `preview/**` 可在全域 false 規則下正常放行。
