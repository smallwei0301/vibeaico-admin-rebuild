# Owner Decision — 授權將 main 上的 0084 catalog bridge 套用到正式庫

- 日期：2026-09-07
- 相關 Issue：#241（正式站缺陷）、#242（bridge source 進 main）、#238（後續 invariants）、#197（migration 身分治理）
- 相關 PR：#244（已合併，`main` head `75f483cba2ebe54329e31f6f98f697e71dc3595f`）；#243（同內容，已關閉）
- 分類：Production DDL 逐次具名授權

## 決策

**Owner 授權將 `main` 上的 `supabase/migrations/0084_catalog_position_bridge.sql` 套用到正式庫 `egehnijjpgijmccagxac`。**

這是一次**逐次、具名**的授權，只涵蓋這一支 migration、這一個專案。它不構成任何後續 Production DDL、DML、部署或推廣的概括授權；`0085` 的套用是另一次獨立授權。

## 為什麼需要這次授權

正式站的「新增服務」與「服務重新排序」在授權當下**就是壞的**。

`main` 的 `src/server/service-position.ts:42,103` 呼叫 `reserve_catalog_positions` 與
`reorder_catalog_items`。這兩支函式由 `0065_issue_128_services_order_invariants.sql`（#128）
建立，但實查正式庫發現它們與所依賴的 `catalog_position_counters` **都不存在**——`0065`
從未套用到正式庫。

`0065` 的檔頭寫「The live TEST project already carries these objects through the historical
catalog migrations」，那句話對 canonical TEST 與 fresh local runner 都成立，**唯獨正式庫
沒有被納入考慮**。兩條 CI 路徑（`local-isolated` 從 `0001` 建起、canonical TEST）都帶有
那些函式，所以**兩者都不可能偵測到正式庫的缺口**。

`services` 當時只有 1 列，所以還沒有人撞上；店家新增第二個服務就會 500。

## 為什麼這次套用是安全的

`0084` **刻意只做「新增應用程式會呼叫的東西」**：

- `create table if not exists` / `add column if not exists` / `create or replace function`
- 無 `drop`、無型別變更、無資料改寫
- **不建立任何 ordering 唯一索引、不重排任何既有列**

因此它可以在**部署任何新 app 之前**套用：舊 route 不呼叫這些函式，而且沒有唯一索引時，
舊 route 的逐筆 `update` 仍能運作。雙向相容性窗口因此消失。

這個「PREDEPLOY-only」性質已被 `tests/unit/catalog-position-bridge.242.test.ts` 鎖進測試
（斷言檔案中不得出現 `create unique index` 與六個 ordering 索引名），不會在後續改動中被
悄悄破壞。

## 治理上的約束（本次已遵循）

1. **Production DDL 必須來自已合併到 `main` 的 source。** 先前曾建議從未合併的 feature
   branch 套用 `0084`——那正是 #197 追蹤的 branch-only migration identity 漂移失敗模式。
   本次改為先合併 #244，再從 `main` 套用。
2. **migration name 使用 `main` 上的最終檔名**（`0084_catalog_position_bridge`），符合
   PB-017「先讓檔名在 main 定案，再套用」。本輪前兩次違反此規則造成的 ledger 偏差不再發生。
3. canonical TEST `nmwhwngojosmagjuvxol` 的 provider ledger 有兩筆分支期 `0084_*` 記錄，
   是本輪違反 PB-017 造成的。**不得為了讓 ledger 好看而再套第三次 0084**；ledger 對帳是
   獨立的前進式工作。

## 證據

套用前（唯讀）：

```
has_counter_table 0 | has_reserve_fn 0 | has_reorder_fn 0 | uq_indexes 0
services/products/portfolios 的 line_sort_order 皆已存在 | service_rows 1 | ledger_0084 0
```

套用後（唯讀）：

```
has_counter_table 1 | has_reserve_fn 1 | has_reorder_fn 1
reserve_secdef true（SECURITY DEFINER）| reorder_secdef false（invoker）
reserve_cfg search_path="" | uq_indexes 0（PREDEPLOY-only 成立）| line_cols 3
auth_can_reserve true | svc_can_reorder true | ledger_bridge 1
service_rows 1 | product_rows 0 | portfolio_rows 0 | counter_rows 0（資料未動）
```

另已執行 `notify pgrst, 'reload schema'`。

## 未涵蓋範圍

- `0085`（既有資料 re-rank ＋ 六個 ordering 唯一索引）→ 另一次獨立的 Owner 授權，由 #238 追蹤。
- products / portfolios 的 app route 改走 RPC → PR #239，需先從新 `main` 重建。
- 本次**只有 DDL**，未觸發任何部署或推廣。
