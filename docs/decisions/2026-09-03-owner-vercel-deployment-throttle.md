# Owner Decision：Vercel 自動部署節流與含斜線分支封鎖

- 日期：2026-09-03
- 狀態：APPROVED
- Owner 指示：降低 `vibeaico-admin-rebuild` 的 Vercel 自動部署次數。
- 追蹤 Issue：#141

## 現場證據

2026-09-03 重新讀取 Gmail 全文與 Vercel live deployment inventory：

- Gmail 在同一分鐘收到三封 `product/issue-42-plan-quick-edit-v1` Preview 失敗通知，對應 commit `dce2823`、`ddd0b7e`、`374b03b`。
- Vercel inventory 顯示普通 `product/*`、`claude/*` 分支仍建立 Preview；同一條產品分支的連續 commit 會各自產生 deployment。
- `main` 的純文件 commit 也各自建立 Production deployment。
- 當時 `vercel.json` 使用：

```json
{
  "git": {
    "deploymentEnabled": {
      "*": false,
      "main": true,
      "preview/**": true
    }
  }
}
```

Vercel branch pattern 使用 minimatch 語意；單一 `*` 不跨 `/`。因此含斜線的 `product/...`、`claude/...` 沒被 deny-by-default 規則涵蓋。

## 決策

### 1. Git 自動部署採 slash-safe deny-by-default

```json
{
  "git": {
    "deploymentEnabled": {
      "**": false,
      "main": true,
      "preview/**": true
    }
  }
}
```

只有：

- `main`；
- Owner／驗收流程明確建立的 `preview/**`；

可自動部署。`product/**`、`claude/**`、`governance/**`、`agent/**` 與其他普通分支皆不得自動建立 Preview。

### 2. main 純文件變更跳過完整建置

`ignoreCommand` 固定使用：

```text
node scripts/ci/vercel-ignore-build.mjs
```

規則：

- 非允許分支：exit 0，忽略建置；
- `preview/**`：exit 1，繼續明確驗收建置；
- `main`：比較上一個成功部署 SHA 與本次 SHA；只有 runtime／build 路徑改變才繼續；
- 比較 SHA 缺失或 Git diff 無法可信完成：fail-safe 繼續建置，不冒險漏掉產品版本。

Runtime／build 路徑至少包含：

```text
src/
public/
package.json
package-lock.json
next.config.mjs
postcss.config.mjs
tailwind.config.ts
tsconfig.json
vercel.json
scripts/ci/vercel-ignore-build.mjs
```

文件、測試、GitHub workflow 與 Agent 治理紀錄本身不需要重新打包正式網站。

## 驗收方法

1. exact-head CI 驗證 JSON、分支規則、純文件與 runtime Git diff。
2. 合併後建立一個含 `/` 的安全 canary branch，新增不進 main 的純文字檔。
3. 重新讀 Vercel inventory，確認該 branch／commit 沒有 deployment。
4. 刪除 canary branch。
5. 下一次 `main` 純文件 commit 應呈現 Ignored Build Step，而不是完整 Production build。

## 邊界

- 本決策不關閉 GitHub 與 Vercel 的連線。
- 不改 Production 資料庫、環境變數、付款、退款、通知或網域。
- 不用 Vercel Preview 取代 GitHub CI、local isolated TEST 或 remote canonical TEST。
- 明確 Preview 必須先有 exact-head CI，且只使用 `preview/**` 分支。
