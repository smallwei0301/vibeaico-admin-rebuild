# Owner 授權：對正式庫補套 canonical `0066` / `0067` / `0068`

- 日期：2026-09-08
- 相關 Issue：#197、#8、#8-A
- 授權形式：Owner 於本輪具名作答（逐次具名，非概括授權）

---

## 一、這件事的起點是一個被我講錯的診斷

我先前在 #197 留言寫下：

> `public.trips` 與 `trip_plans` 在 repo 與正式庫是「**同名但形狀不相容**」……
> 也就是說，`main` 上的旅遊模組程式碼，對正式庫是**結構性不相容**的。

**「程式對正式庫跑不動」這個結論是對的，但我給的原因是錯的。**

我當時據此提了兩個方向（甲：改程式配合正式庫／乙：改正式庫配合程式），而**真正的原因是
第三種**：`0066_issue_8_tour_domain_core.sql` **就是為了調和這件事而寫的，而且它從來沒有
被套到正式庫**。

`0066` 的內容：

```sql
alter table public.trips
  add column if not exists location text,
  add column if not exists duration_hours numeric,
  add column if not exists includes text,
  add column if not exists notes text;
-- 接著從 region / inclusions / safety_notice / duration_minutes 回填
-- 並建立雙向同步 trigger，讓兩套名字在寫入時保持一致
```

`trip_plans` 同樣有 `add column if not exists price_per_person / min_party / max_party`。

## 二、為什麼沒有任何一道閘門抓到

| 環境 | `trips` 欄位數 | 兩套名字 | 程式能動嗎 |
|---|---|---|---|
| 純 canonical build（repo） | 23 | 只有新那套 | 能 |
| CI `local-isolated` lane | 32 | **兩套都在** | 能 |
| canonical TEST | 32 | **兩套都在** | 能 |
| **正式庫（套用前）** | **28** | 只有舊那套 | **不能** |

CI 那條 lane 會先套 overlay 的 `0016`（舊那套）再套 canonical `0066`（補上新那套），
結果是一個**超集**——它同時滿足兩種寫法，因此**天生偵測不到這個分歧**。canonical TEST
同理。這正是 #197 §影響第 2 點所預言的失效模式，只是當時沒人想到它會以「超集」的形式出現。

## 三、Owner 裁示

在得知真因後，我把兩種具體做法重新提給 Owner：

- **套用缺的 canonical migration**（我建議）：`0066` 是 `add column if not exists` ＋ 回填，
  無 `drop` / `rename` / `delete`；套完正式庫就與 TEST 一致，現行程式一行都不必改。
- 照原本說的改程式：會丟掉 `0066` 已經做好的調和，而且 TEST 與 CI 上兩套名字都在，
  改完反而是往另一個方向偏離。

**Owner 選擇：套用缺的 canonical migration。**

## 四、套用範圍與前置查證（全部唯讀）

| 項目 | 結果 |
|---|---|
| 正式庫 `trips` / `trip_plans` / `trip_departures` / `trip_addons` / `tour_orders` 資料列數 | **全部 0 筆** |
| `0066` 是否含破壞性動作 | 無 `drop` / `rename` / `delete` / `truncate` |
| `0067` 的 `drop constraint` 範圍 | 只移除單欄 `trip_id → trips.id`（與 `plan_id → trip_plans.id`），並立即換成 tenant-aware 複合 FK；且有 fail-closed 前置檢查 |
| `0068` | 只有 `revoke`，不動資料 |
| 正式庫是否有「not null 且無預設」的舊欄位會擋住新寫入 | 無（`base_price` 可為空） |

**這是逐次具名授權，只涵蓋 `0066` / `0067` / `0068`、只涵蓋正式庫
`egehnijjpgijmccagxac`，不構成後續 Production DDL／DML／部署的概括授權。**

三支皆依 #197 的規定，從 merged `main` 逐字取用（sha256 前 16 碼：
`0066` `f2646d7c9aca4e64`、`0067` `f9dc8a7927cf022d`、`0068` `14b3a4bec80bbddb`）。

## 五、套用結果（唯讀核實）

| 檢查 | 套用前 | 套用後 |
|---|---|---|
| `trips` 欄位數 | 28 | **32** |
| `trips` 指紋 | — | `trips\|32\|df0cb48962653904a1f50731a31d6b89`，**與 canonical TEST 逐字相同** |
| `trips` 的 `location` / `duration_hours` / `includes` / `notes` | 不存在 | 存在，`includes` / `location` / `notes` 為 NOT NULL |
| `trip_plans` 的 `price_per_person` / `min_party` / `max_party` | 不存在 | 存在，皆 NOT NULL |
| 雙向同步 trigger | 無 | `t_trips_legacy_sync_0015` 已建立 |
| tenant-aware 複合 FK | 無 | 四支全建立（plans / addons / departures→trips、departures→plans） |
| 殘留的單欄 FK | 3 支 | **0 支** |
| `anon` / `authenticated` 對四張旅遊表的權限 | **INSERT, UPDATE, DELETE, TRUNCATE, SELECT…** | **只剩 SELECT**（＋無害的 REFERENCES / TRIGGER） |
| `service_role` 權限 | 完整 DML | 完整 DML（未動） |
| 五張表資料列數 | 0 / 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 / 0（未觸及任何資料） |

**程式可用性的逐欄驗證（唯讀）**：把 `tripRow()` / `planRow()` 實際寫入的欄位、
以及 `mapTrip()` / `mapTripPlan()` 實際讀取的欄位全部列出來，逐一比對正式庫的
`information_schema.columns` —— **缺漏數為 0**。套用 `0066` 之前，其中 7 個
（`location`、`duration_hours`、`includes`、`notes`、`price_per_person`、
`min_party`、`max_party`）是不存在的。

## 六、順帶關掉的一個側門

`0068` 套用前，正式庫的 `anon` 與 `authenticated` 對 `trips` / `trip_plans` /
`trip_departures` / `trip_addons` **持有 INSERT / UPDATE / DELETE / TRUNCATE**。
也就是說，任何持有 anon key 的瀏覽器都能直接對這四張表做 DML，只靠 RLS 擋——
而路由層的 `MANAGER` 與 `TOUR_MODULE` 檢查會被完全繞過。`0068` 正是為此而寫的，
它同樣從未被套到正式庫。這一項不是對齊，是實質的安全修補。

## 七、誠實標註：兩件沒有做到完全一致的事

1. **`t_trip_plans_legacy_sync_0015` 沒有建立。** 該 trigger 的前提是舊欄位五個全在
   （`base_price`、`min_participants`、`max_participants`、`min_party_size`、
   `max_party_size`），而正式庫沒有後兩個。影響：寫 `price_per_person` 不會自動同步
   `base_price`。因為 `base_price` 可為空，寫入不會失敗；本專案沒有任何程式讀它。
   若日後 Midao 前台（另一個專案／資料庫）需要讀，這一項要另外處理。
2. **repo 與正式庫仍未完全一致。** 純 canonical build 的 `trips` 只有 23 欄，因為
   canonical 不會建立 overlay 時代的 `region` / `inclusions` / `faq` 等欄位。
   目前是「正式庫 ⊇ 程式所需」，不是「repo 能重現正式庫」。後者屬 #197 建議處置第 2 步，
   仍待排期。
