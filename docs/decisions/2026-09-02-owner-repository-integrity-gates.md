# Owner Decision：Repository Integrity Gates

> 日期：2026-09-02
>
> 狀態：Accepted

## 決策

所有 PR 與 `main` runtime CI 必須在安裝套件與編譯之前執行 repository integrity guard
（專案完整性閘門）。閘門採 fail closed：不能證明完整就停止。

固定順序：

```text
repository integrity
→ npm ci
→ typecheck
→ unit tests
→ build
→ 必要時才建立／移動 preview/**
```

## 阻擋條件

1. `package.json`、`package-lock.json`、`src/app/` 或 `src/server/` 不存在。
2. 相對 base tree 一次刪除至少 50 個檔案，或在至少刪除 10 個檔案時達 baseline 的 20%。
3. 受 Git 追蹤的 JavaScript／TypeScript 程式檔出現單獨一行 40 碼 Git SHA。
4. `npm ci` 無法從 lockfile 重建，包含不存在的版本或 package／lock 不一致。
5. typecheck、unit test 或 production build 失敗。

大量刪檔若確實是 Owner 核准的重構，必須先調整此決策與可執行規則；不得在單一 PR 以
環境變數或忽略旗標繞過。

## 理由

2026-09-01 曾出現遠端 tree 缺少 Next.js 入口、必要 import 檔案消失、commit SHA 混入
程式碼、套件版本不存在，以及檔案結尾不完整。原子 Git commit 只能避免一檔一 push，
無法保證包裹內容正確；Vercel 也不應成為第一個打開包裹的人。
