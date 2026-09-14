# TEST 九個無出處欄位的依賴盤點（2026-09-14）

Owner 裁示「先盤點依賴，回報後再決定」。以下是實測結果，**只做唯讀查詢，沒有任何 DDL**。

## 一句話

九個欄位、五條 CHECK，**沒有任何 trigger、function、view 或 index 依賴它們，也沒有任何
一行應用程式碼在讀它們**。清除它們不會撞到上次清 overlay 時遇到的那種依賴鏈。

## A. `tour_orders` 的 §9 欄位（5 個）

| 欄位 | 型別 | not null | default |
|---|---|---|---|
| `balance_due` | numeric | ✅ | `0` |
| `balance_due_at` | timestamptz | — | — |
| `balance_collection_mode_snapshot` | text | ✅ | `'DEADLINE'::text` |
| `balance_due_hours_snapshot` | integer | — | `48` |
| `cancellation_policy_snapshot` | jsonb | ✅ | `jsonb_build_object('source','MIDAO_TEMPLATE', 'bands', …三段 minimumDaysBeforeDeparture 8/4/0)` |

### 出處：全部零命中

```
canonical origin/main:supabase/migrations/**   五個欄位各 0 個檔案命中
supabase/local-migrations/** 與 scripts/**     0 個檔案命中
origin/main:src/**                             0 個檔案命中
```

**沒有任何程式在讀它們**，所以刪除不會讓任何功能失效。

### 依賴：只有三條 CHECK

| 名稱 | 定義 |
|---|---|
| `tour_orders_balance_due_nonnegative_check` | `balance_due >= 0` |
| `tour_orders_balance_collection_mode_snapshot_check` | `balance_collection_mode_snapshot in ('DEADLINE','ON_SITE')` |
| `tour_orders_balance_due_hours_snapshot_check` | DEADLINE ⇒ hours not null and > 0；ON_SITE ⇒ hours is null |

**index、trigger、function、view 全部 0 筆。**

### 與 bootstrap 斷言的正面衝突

`origin/main:.github/workflows/agent-schema-bootstrap.yml:165`：

```sql
'future_issue_41_fields_absent', NOT EXISTS (
  SELECT 1 FROM information_schema.columns
   WHERE table_schema='public' AND table_name='tour_orders'
     AND column_name IN ('balance_due','balance_due_at','balance_due_hours_snapshot',
                         'balance_collection_mode_snapshot','cancellation_policy_snapshot'))
```

同檔 162–164 行的註解寫「仍屬 #41 §9 尚未實作的範圍，斷言對它們繼續生效，未被放寬」。

**這個斷言在 TEST 上是假的。** 五個欄位都在。

### 一個容易被忽略的副作用

`balance_collection_mode_snapshot`（not null default `'DEADLINE'`）與
`cancellation_policy_snapshot`（not null，default 是一整包 MIDAO 樣板）代表：**TEST 上
每一筆新建的 `tour_orders` 都會被靜默塞進一份取消政策**，而 canonical 從來沒有定義過
這件事。如果日後 §9 真的實作，它讀到的舊資料會帶著一份沒有人決定過的預設政策——
那比欄位不存在更難發現。

## B. `trip_departures` 的殘留欄位（4 個）

canonical `0107` 定義 8 個 formation 欄位，TEST 上有 12 個。多出來的四個：

| 欄位 | 型別 | not null | default | canonical | overlay | src |
|---|---|---|---|---|---|---|
| `formation_risk_accepted_participants` | integer | — | — | 0 | 0 | 0 |
| `formation_decision` | text | — | — | 0 | 0 | 0 |
| `formation_decision_note` | text | ✅ | `''::text` | 0 | 0 | 0 |
| `formation_transition_revision` | bigint | ✅ | `0` | 0 | 0 | 0 |

依賴：兩條 CHECK（`trip_departures_formation_risk_accepted_check`、
`trip_departures_formation_transition_revision_check`），**沒有 trigger、function、
view、index**。

canonical 的 8 個欄位在 TEST 上已經全部符合 canonical 形狀（`min_to_depart_snapshot`
default `1`、`formation_status` default `'COLLECTING'::departure_formation_status`）。

## 這次盤點與上次的差別

上一次清 `tour_orders` 的 overlay 時，`DROP COLUMN` 被 trigger 依賴擋下，因而揭露了整個
15 function + 8 trigger 的 overlay（PB-042 第二個實例：只比對欄位會漏掉 trigger 與
function）。這次先把 trigger／function／view／index 一起查過，**四類都是 0 筆**，所以那
種意外不會重演。

## 三個選項與各自的代價

1. **清掉九個欄位與五條 CHECK。** TEST 回到 canonical 形狀，bootstrap 斷言重新成立。
   代價：若 §9 日後實作時打算沿用這些欄位名與預設值，那些設計決定會遺失——但它們本來
   就沒有被記錄在 canonical 任何地方，現在也查不到是誰、為什麼加的。
2. **收緊 bootstrap 斷言，承認欄位存在。** 代價：等於把「環境與 canonical 不一致」變成
   可接受狀態，而那個斷言存在的理由正好相反。
3. **維持現狀。** 代價：那個斷言持續說謊；每筆新 `tour_orders` 繼續被塞進一份沒人決定
   過的取消政策。

盤點到此為止，處置待 Owner 裁示。
