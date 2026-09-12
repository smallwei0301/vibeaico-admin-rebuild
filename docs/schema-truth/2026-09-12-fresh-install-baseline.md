# Fresh-install compatibility baseline — 2026-09-12

這份文件把 #298 剩餘的「從零建庫」缺口落成可重播的來源邊界。它不是把歷史
overlay 假裝成遠端 migration ledger，也不改寫任何已套用的 migration。

## 可重建來源

執行 `scripts/agents/fresh-install-baseline.mjs` 會在 checkout 外建立一次性的
Supabase 本機目錄，內容是：

1. `supabase/migrations/` 目前 `main` 的全部 canonical migrations；
2. `supabase/local-migrations/fresh-install-compatibility-baseline/manifest.json`
   明列的 7 支歷史相容來源；
3. 不載入 `issue-41-candidate-baseline`、`.env` 或任何遠端憑證。

使用方式：

```bash
EXPECTED_HEAD="$(git rev-parse HEAD)" \
LOCAL_PROJECT_ID=schema-proof-manual \
node scripts/agents/fresh-install-baseline.mjs /tmp/vibeaico-schema-proof
cd /tmp/vibeaico-schema-proof
supabase start
```

腳本會檢查 canonical migration bytes 的 SHA-256、歷史來源的 Git blob SHA、唯一
migration prefix、整個來源 checkout 是否乾淨，以及本機專案識別值。manifest 釘住的
`main` commit 必須存在、是執行 commit 的 ancestor，且兩者的 canonical migration
bytes 完全相同。任一項不符就停止，不會產生半套基線。

## 為什麼需要這 7 支

| 來源 | 只在本機基線保留的理由 |
|---|---|
| `0016_tour_domain_core.sql` | 讓 cap 來源在 canonical `0066` 前有可協調的行程／方案表 |
| `0017_chat_images_bucket_and_line_sort_order.sql` | 建立 canonical Storage allowlist 仍引用的 `chat-images`，並讓早期排序欄位可被後續 canonical migration 調和 |
| `0020_booking_addons.sql` | `0082` 是補欄位，必須先有 `booking_addons` 的表本身 |
| `0026_tour_departures_addons_orders.sql` | 讓 `0097` 之前存在它要收緊 ACL 的 `next_tour_order_no`，同時提供早期團次表供後續 canonical migration 調和 |
| `0030`–`0032` | 保留 Owner 已核准的每個 `(tenant_id, trip_id)` 最多 100 個方案規則 |

這些檔案在 manifest 中都標成 `COMPATIBILITY_ONLY`。它們是為了重播既有 immutable
migration 依賴而保留，不代表歷史檔案整批升格成目前 Product 功能。其他歷史檔案、
`#41` 的 0038／0038a／0040，以及未列名的新來源會被排除。

## 100 個方案的固定契約

`0030`–`0032` 維持原本的三層防線：migration 前置檢查、父行鎖定，以及
`trip_plan_limit_guard`／`trip_plan_limit_guard_update` 的 statement-level trigger。
trigger function 以 `FOR NO KEY UPDATE` 鎖定父行，再檢查每個租戶與行程的方案數量
不得超過 100。manifest、腳本檢查與 CI replay 都會拒絕把上限改成其他數字，或把
statement-level guard 改成逐列的弱化版本。

## 驗證邊界

CI 會在全新的 disposable Supabase 上 replay 這個基線，確認 `booking_addons`、
`tour_orders`、`trip_departure_staff`、`paid_amount`、`expire_tour_order` 與 100-plan
guard 存在，並確認 #41 的八個未採用欄位不存在。guard 的證據會比對 function、ACL、
trigger 綁定、statement-level `tgtype` 與 transition relation，並從 99 筆同時送出兩筆
交易，證明父行鎖讓結果固定停在 100、另一筆收到 `TRIP_PLAN_LIMIT`。

這是可重建與相依性證據；它不等於 TEST／Production 整庫相等，也不授權任何遠端
DDL、DML、migration、deploy 或資料搬移。CI 成功後仍須用同一份 metadata／ACL 查詢
做 TEST 與 Production 的唯讀 fresh capture 比對；Production 沒有 100-plan guard 是已
核准的刻意差異，不可因此補套。遠端環境仍沿用既有三支具名 Production apply 的
read-back 證據。
