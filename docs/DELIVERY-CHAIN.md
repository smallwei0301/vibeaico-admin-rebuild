# 產品交付鏈路（Delivery Chain）

> Owner 裁示日期：2026-09-04。
>
> 本文件是**產品交付**的 canonical 鏈路：從「決定做哪一項」到「敢說它真的好了」之間，
> 每一關要做什麼、由誰做、以及**通過的證據長什麼樣**。
>
> 治理定位：本文件描述**交付流程**；`docs/AGENT-EXECUTION.md` 規範**執行模式與 WIP 上限**；
> `docs/DOCUMENTATION-GOVERNANCE.md` 規範**文件與分支**。三者衝突時，以 `main` 上較新的
> Owner Decision 為準。

## 0. 這條鏈路要解決什麼問題

這個專案反覆出現的不是「寫不出功能」，而是**兩種假象**：

1. **假成功**：使用者按下按鈕，畫面顯示成功，但資料從來沒有被寫進去。
2. **假完成**：Agent 宣稱「已合併」「CI 綠」「已上線」，但實際上沒有、或只綠了一個什麼都沒跑的 job。

CI 抓不到第一種（假成功的程式碼是合法的、型別正確的、測試甚至可能鎖住了假行為）。
單看 API 回應抓不到第二種（呼叫成功 ≠ 事情發生了）。

因此鏈路的每一關都有一個**明確要抓的東西**，而不是「再檢查一次」。

## 1. 鏈路總覽

```text
Luna 查證歸屬（避免重複 Issue、確認沒被 owner-blocked）
  ↓
Terra 施工（獨立 worktree，不互相污染）
  ↓
Sol audit（實際讀 diff，抓 CI 抓不到的假成功）
  ↓
本機隔離 Supabase（唯一能驗證 migration 對空白資料庫正確的地方）
  ↓
序列化 canonical TEST（一次一張，不搶共用資源）
  ↓
Completion Truth 五項驗證（不信 API 回應，實查 main）
```

**任何一關可以判定「這一關不適用」，但不能判定「這一關略過」。** 不適用要寫出理由並留在
PR body 的對應欄位（例如 `MIGRATION_TOUCH: false` 時本機隔離 Supabase 仍要跑，但
`ISOLATION_CANARY_STATUS: NOT_RUN` 可以，理由要寫）。

## 2. 各關的職責與通過條件

### 2.1 Luna — 查證歸屬

**要抓的東西：重複施工，以及動到已被 Owner 封鎖的題目。**

- 候選項目是否**已經**被某個 open Issue 涵蓋？涵蓋就掛在那個 Issue 底下當 slice，**不要開新 Issue**。
- 對應 Issue 或子項是否處於 `OWNER_BLOCKED`？是就換一項，不要自行解封。
- 是否需要新的 migration？是否觸及金流、真實通知、Production DDL？任何一項為真 → 先升級，不進 Terra。

通過條件：Primary Issue 明確、非 owner-blocked、且與目前所有 ACTIVE lane 的 Primary Issue
不衝突（dual-Terra 契約要求兩條同時在跑的 Terra lane 有**不同**的 Primary Issue）。

Luna 的輸出必須是**實際 grep 到的行號、實際存在的 route 路徑、實際存在的 service 函式名**。
沒把握就寫「無法確認」。**不得把推論寫成已知** —— 這是本專案長期防的具體失敗模式。

### 2.2 Terra — 施工

**要抓的東西：兩條 lane 互相污染工作目錄。**

每條 Terra lane 使用**獨立的 `git worktree`**，不共用同一個工作目錄。實務規則：

- 每條 lane 一個 worktree，`node_modules` 以 symlink 共用即可。
- **禁止 `git add -A`**，只 `git add` 明確列出的路徑。
- commit 前以檔案清單比對兩條 lane 的 `FILE_OWNERSHIP`，**必須零重疊**；migration 檔的擁有權
  也不得重疊。
- 兩條 lane 使用**不同的本機 TEST 環境 ID**。

一個 PR = 一個 Product Outcome。**禁止 30–40 檔的大型 PR。**

> 本規則的由來：曾發生兩條 lane 共用同一個工作目錄，`src/services/bookings.ts` 與
> `src/lib/trip-plan-quick-edit.ts` 同時被改動，一次 commit 就會把兩個 slice 混在一起。

### 2.3 Sol — audit（實際讀 diff）

**要抓的東西：CI 綠但功能是假的。**

Sol **必須實際讀 diff**，不得只看 CI 結論。至少檢查：

- **假成功**：`await new Promise(r => setTimeout(...))`、只有 `toast.show()` 沒有 `await service()`、
  頁面內寫死的 `MOCK_*` 常數被當成真實資料來源。
- **半接線**：寫入路徑改成真的，但**讀取／候選清單仍是假資料**。這比完全沒改更糟 ——
  使用者會拿一個不存在的 id 去操作真實資料。
- **捏造欄位**：前端顯示的欄位在線上 schema 裡根本不存在。不得為了讓畫面有東西而發明資料；
  應升級為 Owner 待決事項。
- **module scope 讀 live binding**：`src/mock/index.ts` 的 `MOCK_MODE` 等是 ES module live binding，
  由 `AppShell` 在切換租戶時 reassign。在 module scope 讀取它（或 `byMode()`）會永久凍結錯誤
  業態的資料。mock store 必須**延遲初始化**。
- **邊界 no-op**：陣列首尾的上移／下移、值相同的交換，必須在**呼叫 API 與顯示成功之前**就返回。

> 本關的由來：PR #168 的 exact-head CI **結論是 success**，但 `sort_order` 全為預設值 0 時，
> 交換 0↔0 寫回相同值、順序沒有任何改變，toast 仍顯示已更新。CI 抓不到，是 Sol 讀 diff 抓到的。

Sol 一次只審一張 PR。

### 2.4 本機隔離 Supabase

**要抓的東西：migration 對「空白資料庫」是不是真的正確。**

這是**唯一**能證明 migration 正確性的地方。原因：線上 TEST 與 PROD 已經有那些欄位了，
冪等 migration（`add column if not exists`）在它們身上跑起來是 **no-op** —— 跑綠什麼都沒證明。
只有全新建庫、從第一支 migration 依序套到最後一支，才會暴露順序錯誤、相依缺失、約束名稱衝突。

通過條件（逐項確認 job step 的**真實耗時**，不是只看 conclusion）：

- `Start a fresh local Supabase stack and apply migrations` success
- `Prove the TEST target is local` success（證明打的不是遠端）
- integration 與 E2E 各自有**分鐘級**的實際執行時間
- `Destroy the local Supabase stack` success（`TEST_CLEANUP_STATUS`）

每條 lane 使用**各自獨立**的本機環境，互不共用。

### 2.5 序列化 canonical TEST

**要抓的東西：搶用共用資源，以及把「沒跑測試的綠」當成綠。**

canonical TEST 是**唯一一套**遠端共用環境，**全 repo 同時最多一個 holder**。

- 只有唯一的 `TEST_VALIDATION` holder 可以使用 TEST secrets。
- 非 holder 的 `integration` job 會留下一個**成功的 `POLICY_SKIP`**。
  **`POLICY_SKIP` 不是綠。** 辨識方式：job 只跑幾秒到十幾秒、`Source-only policy skip evidence`
  這一步是 **success**（而非 skipped）、且 `Run integration tests` 根本沒有執行。
  真正跑起來時，policy skip 那步會是 **skipped**，而 integration／E2E 有分鐘級耗時。
- 目前 lane transition 時由 Guard **自動派工**。因此**不要再手動 `workflow_dispatch`** ——
  兩者會疊加成重複佔用。

> 本規則的由來：一次手動 dispatch 與 Guard 的自動派工疊加，同時產生兩個 run 佔用共用 TEST，
> 事後必須取消其中一個。

### 2.6 Completion Truth 五項驗證

**要抓的東西：把「請求成功」當成「事情完成」。**

**一個成功的 tool／API 呼叫只代表 REQUESTED，不代表 COMPLETED。** 宣稱「已合併」之前，
五項全部要以**實查**取得，不得引用先前的 API 回應：

1. 重新 fetch 該 PR，讀 `merged_at`（非 null）
2. 取得 `merge_commit_sha`
3. 取得**當下**的 `main` head
4. 驗證 merge commit 從 main head **可達**（ancestry / compare）
5. 以 `ref=main` **重新讀取**一個關鍵檔案，確認內容確實是合併後的版本

五項齊備才可以說「已合併」。

## 3. Delivery Truth Ladder：合併不等於出貨

合併只是第二階。完整五階：

```text
SOURCE_VERIFIED
  → MERGED_TO_MAIN
    → AUTO_VERCEL_DEPLOYED
      → PRODUCTION_SCHEMA_READY
        → AUTHENTICATED_PRODUCTION_ACCEPTED
```

**五階全數成立才是 `shipped_unit`；否則一律記為 `PRODUCTION_PENDING`。**

特別注意最後一階：`AUTHENTICATED_PRODUCTION_ACCEPTED` 指**以登入帳號在正式站實機操作驗收**。
沒做就是沒做，`shipped_units` 就要如實記 0 —— 即使該 PR 已經合併、CI 全綠、Vercel 也部署了。

同時，**「沒有手動部署」不得被寫成「Production 完全沒有部署」**：`main` 會自動觸發 Vercel。

## 4. 授權邊界（未取得明確授權一律禁止）

- Production DDL
- Production DML
- Production migration
- Production reset / seed
- 手動 Production deploy / promote
- 真實付款、真實退款
- 真實顧客通知

Owner 的授權是**逐次、具名**的：一次「僅限本次新增欄位」的授權，不延伸到下一次。

## 5. 治理原則：復原，而不是取消

> Owner 裁示（2026-09-04）：**取向為將目前無效功能復原為可用，而不是直接取消功能。**

發現某個功能是假的時候，預設處置是**把它接成真的**，不是移除按鈕或欄位。

當某項能力**確實無法實作**（後端缺欄位、缺商業決策）時：

- **不得**捏造前端資料讓畫面看起來正常
- **不得**默默移除該 UI
- **應**保留 UI 流程、改為呼叫真實端點、**把後端的真實訊息原樣顯示給使用者**
- 並把缺口升級為 Owner 待決事項，寫在 Issue 上

這稱為**誠實復原**：功能沒有被取消，只是不再說謊。

## 6. 反停滯：每個檢查點都要寫回 GitHub

Agent 的對話不是真相來源。**每一個實質檢查點都必須寫到 GitHub 的 truth surface**
（PR body 的結構化欄位、Issue 留言、ledger），使得一個全新的 session **只讀 GitHub 就能接手**。

真相優先序：

```text
GitHub 現況 > main 上的 canonical 文件 > 交接文件 > 舊對話與記憶
```

**不得從舊 UI 的最後一行繼續。**

一條 lane 等待 CI 時，另一條 lane 必須繼續 —— 等待不是停止工作的理由。

## 7. 相關文件

- `docs/AGENT-EXECUTION.md` — 執行模式、B+ 角色路由、WIP 上限、停止條件
- `docs/DOCUMENTATION-GOVERNANCE.md` — 文件治理與分支規則
- `docs/OWNER-DECISIONS.md` — Owner 決策紀錄
- `docs/AGENT-PLAYBOOK.md` — 失敗／教訓索引
- `docs/integration/12-TESTING-TDD.md` — 測試與驗收標準
