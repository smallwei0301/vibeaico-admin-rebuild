# 正式庫沒有套用 `0107`，而已經上線的程式在讀它的欄位（2026-09-14）

## 一句話

`/api/guide/action-inbox` 這支已經合併到 `main`、已自動部署到 Production 的端點，
會查 `trip_departures.formation_status`。**正式庫上沒有這個欄位。** 該端點在正式環境
會回 500，而正式庫目前唯一的租戶剛好就是 `GUIDE`——也就是唯一會看到這個畫面的人。

## 實測證據（唯讀查詢，沒有對正式庫做任何 DDL／DML）

```sql
-- 1) 欄位不存在
select id, formation_status from public.trip_departures limit 1;
-- ERROR: 42703: column "formation_status" does not exist
```

```sql
-- 2) 整張表只有 0066 的 11 個欄位，0107 的一個都沒有；連 enum 型別都不存在
select (select count(*) from pg_attribute a
         where a.attrelid='public.trip_departures'::regclass
           and a.attnum>0 and not a.attisdropped)                        as total_columns, -- 11
       (select string_agg(a.attname,', ' order by a.attnum) from pg_attribute a
         where a.attrelid='public.trip_departures'::regclass
           and a.attnum>0 and not a.attisdropped and a.attname like 'form%') as formation_columns, -- null
       exists (select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace
                where n.nspname='public' and t.typname='departure_formation_status') as enum_exists; -- false
```

實際欄位清單：`id, tenant_id, trip_id, plan_id, departs_on, start_time, capacity,
seats_booked, status, note, created_at`——全部來自 `0066`，`0107` 的
`formation_status` / `formation_deadline_at` / `min_to_depart_snapshot` /
`formed_at` / `formed_by` / `formed_participants` / `formation_decided_at` /
`formation_decided_by` 一個都不在。

```sql
-- 3) 影響範圍：正式庫只有 1 個租戶，而它就是 GUIDE
select (select count(*) from public.tenants) as tenants_total,          -- 1
       (select string_agg(distinct business_type::text, ', ')
          from public.tenants)                as business_types;        -- GUIDE
```

## 為什麼整支端點會掛，不是只少一張卡片

`src/app/api/guide/action-inbox/route.ts` 把五條查詢放在同一個 `Promise.all`，然後
逐一 `if (xxxResult.error) throw xxxResult.error;`。formation 查詢一旦回 `42703`，
`throw` 會讓**整支端點** 500——連第 1 類（待確認預約）、第 2 類（待收款）與第 5 類
（待退款）一起消失。不是「成團卡片不顯示」，是「待辦區整個壞掉」。

另外 DEPARTURE 那條查詢也帶了
`.not('formation_status', 'in', '(REVIEW_REQUIRED,AT_RISK)')`，同樣引用這個欄位，
所以第 3／4 類之外的今明日出發卡片也一起失效。

## 根因：「已在 main」被當成「已在正式庫」

`0107_issue_41_formation_state_model` 在 `supabase/ledger-alias-map.json` 的分類是
`NOT_APPLIED / PENDING_APPLY`，正式庫 ledger 也查不到它。`0108` 有套用
（ledger row `20260914082715`），`0107` 沒有。

PR #440 的 body 寫：

> `PRODUCTION_SCHEMA_STATUS: NOT_REQUIRED`
> `PRODUCTION_SCHEMA_EVIDENCE: 本 PR 無任何 DDL；所讀欄位來自已在 main 的 0107 與 0066。`

「**已在 main**」不等於「**已在正式庫**」。這支 PR 自己沒有 DDL 是對的，但它讀的欄位
要存在於執行它的環境，而不是存在於 repo 裡。`PRODUCTION_SCHEMA_STATUS` 這一格問的正是
後者，被當成前者回答了。

PR #442（第 5 類 REFUND_PENDING）我寫的是 `PRODUCTION_SCHEMA_STATUS: READY`，理由是
它依賴的 `0108` 已套用正式庫——這對 `tour_orders` 那一段是對的，但我**沒有檢查同一支
端點裡既有的 formation 查詢**。同一個錯誤我犯了第二次，只是換了一個欄位。

## 這正是 `0109` 在修的那個病，出現在第三個層次

- `0108` 依賴「`payment_status` 是那個 enum」，沒斷言 → 在前提不成立的環境靜默通過。
- `0109` 第四段依賴「`0107` 已套用」，沒斷言 → 在正式庫會 `42703` 中止。
- `/api/guide/action-inbox` 依賴「`0107` 已套用」，沒有任何檢查 → 正式環境 500。

三個層次（migration 斷言、migration 執行、runtime 查詢）同一個成因：**依賴一個沒有
被驗證的前提**。`PRODUCTION_SCHEMA_STATUS` 這一格本來就是要擋第三種，但它只有在填寫者
真的去查正式庫時才有用——填「NOT_REQUIRED」而不查，等於沒有這一格。

## 待 Owner 裁示

套用 `0107` 到正式庫屬 Production DDL，需要具名授權，不在自主執行範圍。相關事實：

- `0107` 已以最終內容合併進 `main`，符合「套用前必須先在 canonical」的授權來源要求。
- 正式庫 `trip_plans` / `trip_departures` / `tour_orders` **三張表都是 0 列**，
  `0107` 對既有資料的前置 guard 全部無風險。
- 不套用的話，正式庫唯一的 GUIDE 租戶的首頁待辦區持續 500。

---

# 處置：Owner 具名授權，`0107` 已套用正式庫（2026-09-14T09:47:36Z）

## 授權

Owner 於 2026-09-14 具名裁示「現在套用 0107 到正式庫」。這構成 `AGENTS.md`／
`CLAUDE.md` 所要求的 Production DDL 具名授權。

## 套用前的查證（緊貼動作，不是沿用先前結論）

PB-044：在共用環境上「我剛剛查過」不等於「現在還是這樣」。套用前一刻重查：

| 項目 | 值 |
|---|---|
| `checked_at` | 2026-09-14 09:46:32+00 |
| `trip_plans` 列數 | 0 |
| `trip_departures` 列數 | 0 |
| `tour_orders` 列數 | 0 |
| `form*` 欄位數 | 0 |
| `departure_formation_status` 型別 | 不存在 |
| ledger 內 `0107` | 0 筆 |

三張表皆 0 列，所以 `0107` 的 `capacity < 1` 前置 guard 與後續 `add constraint`
的既有列驗證都沒有風險。

## 授權來源查證

依「套用前必須先證明變更已在 current `origin/main` 的 canonical migration」：
內容逐字取自 `git show origin/main:supabase/migrations/0107_issue_41_formation_state_model.sql`，
套用當下 main head 為 `db5c8c69cab62c81aaafdd95125b131705492251`。未修改任何一行
SQL，只在檔頭加上記錄套用來源的註解。

## 套用後驗證

```sql
-- 套用前：ERROR 42703: column "formation_status" does not exist
select id, formation_status, min_to_depart_snapshot from public.trip_departures limit 1;
-- 套用後：[] （欄位存在，表為空）
```

| 項目 | 套用前 | 套用後 |
|---|---|---|
| `trip_departures` 欄位數 | 11 | **19** |
| `min_to_depart_snapshot` default | 欄位不存在 | `1` |
| `formation_status` default | 欄位不存在 | `'COLLECTING'::departure_formation_status` |
| ledger 總筆數 | 56 | **57** |
| `0107` ledger row | 無 | `20260914094736 / 0107_issue_41_formation_state_model` |

`0107` 自己的五段後置斷言（enum 值域、12 個欄位的型別、6 條 CHECK、成團證據
CHECK 同時涵蓋 FORMED 與 AT_RISK、`min_party` 未被移除）全部通過——套用成功即代表
它們成立，因為任何一項不符都會 `raise exception` 中止整支 migration。

## 連帶結果

`0109` 第四段在正式庫上現在是**真正的 no-op**：兩個 default 都已符合 canonical。
該段的存在性守衛仍然必要——它守的是「`0107` 尚未套用」的環境，那種環境仍會出現
（任何新建或只套到一半的環境）。

## 帳本同步

`supabase/production-ledger-snapshot.json`（56 → 57）與
`supabase/ledger-alias-map.json`（`0107` → `EXACT`）的更新由
`terra/issue-41-0109-assertion-gap` 一併帶入——這兩個檔案目前由該分支持有，
分散在兩條分支修改同一份帳本正是先前造成撞號的原因。

## 尚未完成的一階

依 §9.1 五階梯，`PRODUCTION_SCHEMA_READY` 這一階現在成立了，但
**`AUTHENTICATED_PRODUCTION_ACCEPTED` 仍是 `NOT_RUN`**——沒有人在通過驗證的正式
環境上實際開過那個待辦區。欄位補上了、查詢不再 `42703`，不等於畫面真的正常。
