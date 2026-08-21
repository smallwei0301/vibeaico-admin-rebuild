# 11 — 共用旅客帳號、公開商店 API 與 Midao 整合（Phase 9–10）

> 本冊落實三個 owner 決策（2026-08-21）：
> ① VibeAI 與 Midao 共用同一套旅客帳號；旅客可在 Midao 留評論、下單。
> ② 旅客下單後，該導遊的 VibeAI 後台自動獲得顧客資料。
> ③ Midao 轉型為導流/展示平台（收 VibeAI 使用費＋上架費），所有名額、訂單、
> 金流以 VibeAI 為唯一事實來源（10 分冊）。
>
> **鐵則：Midao 永遠不持有名額或訂單的可寫副本。** 它顯示什麼都可以，
> 但每一次「下單」都必須是對 VibeAI API 的一次呼叫。

---

## 1. 共用旅客帳號（Phase 9）

### 1.1 架構決定

旅客帳號放在 **VibeAI 的 Supabase Auth**（與導遊帳號同一個 instance）。
Midao 的 Traveler realm 改用這個 Supabase 專案（換 URL + anon key 即可，
它本來就是 Supabase cookie 模式）。不做雙系統帳號連結 —— 只有一個身分庫。

> **為什麼不是反過來共用 Midao 既有的 Supabase 專案**（owner 問過，2026-08-21 定案）：
> ① Midao 專案是正在服務生產流量的資料庫，VibeAI Phase 0–9 的密集 migration
> 迭代直接跑在上面，任何失誤都可能波及 Midao 線上服務；② 兩邊資料表大量撞名
> （bookings/orders/customers…），共用就必須引入多 schema 命名空間，對照文件
> 施工的模型是持續的出錯源；③ Midao 專案受 tour-platform harness 的 migration
> ledger 治理，VibeAI 每條 migration 都要走那套流程會嚴重拖慢施工；
> ④ Midao 目前冷啟動、旅客量極小，§1.4 的帳號搬遷成本趨近於零 —— 共用換來的
> 唯一好處（免搬帳號）此刻最不值錢。結論：**兩個獨立 Supabase 專案**，
> 只共用「VibeAI 專案的 Auth」作為兩平台的旅客身分庫。

同一個 auth user 有兩種可能角色，用資料區分、不用不同帳號：

| 角色 | 判定 |
|---|---|
| 店家/導遊（後台使用者） | 有 `tenant_users` 列 |
| 旅客 | 有 `traveler_profiles` 列 |

一個人可以同時是兩者。後台 middleware / `requireTenant` 完全不用改
（旅客沒有 tenant_users 列，天然進不了後台）。

### 1.2 資料表（migration `0013_travelers.sql`）

```sql
create table traveler_profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  name       text not null default '',
  phone      text not null default '',
  email      text not null default '',        -- 冗餘存一份，供顧客建檔比對
  avatar_url text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table traveler_profiles enable row level security;
create policy p_tp_self on traveler_profiles for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 行程評論：唯一事實來源也在 VibeAI（Midao 只是另一個讀寫入口）
create table trip_reviews (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  trip_id       uuid not null references trips(id) on delete cascade,
  tour_order_id uuid not null references tour_orders(id) on delete cascade,
  traveler_user_id uuid not null references auth.users(id) on delete cascade,
  rating        int not null check (rating between 1 and 5),
  content       text not null default '',
  reply         text,                          -- 導遊回覆
  replied_at    timestamptz,
  hidden        boolean not null default false, -- 導遊/平台可隱藏（不刪）
  created_at    timestamptz not null default now(),
  unique (tour_order_id)                        -- 一單一評，且必須真的成團過（API 驗 COMPLETED）
);
alter table trip_reviews enable row level security;
create policy p_tr_traveler on trip_reviews for insert
  with check (traveler_user_id = auth.uid());
create policy p_tr_read on trip_reviews for select using (true);  -- 公開讀（hidden 由 API 過濾）
create policy p_tr_tenant on trip_reviews for update using (is_tenant_member(tenant_id));
```

### 1.3 旅客註冊/登入

- 沿用 03 分冊的驗證碼機制，新開輕量端點：`POST /api/public/auth/register`
  （email+code+password+name → createUser + traveler_profiles）、login/logout/me 比照
  03 寫法（差別：不建 tenant，建 traveler_profiles）。已是店家的 email 直接登入即可
  自動補 traveler_profiles（一人雙角色）。
- Midao 前台呼叫同一組端點（跨網域 → §4 CORS）。

### 1.4 既有 Midao 旅客搬遷

tour-platform 現有 traveler（Supabase Auth）遷入共用庫：用 GoTrue admin
匯入（bcrypt hash 可直接帶入，密碼無感遷移）；e-mail 衝突（同時在兩邊註冊過）
以 VibeAI 側為準、Midao 側資料併入 traveler_profiles。遷移腳本屬 tour-platform
側工作，**必須照該 repo 的 harness/migration ledger 流程**執行，不在本 repo 施工。

---

## 2. 公開 API（Phase 9 — VibeAI 商店頁與 Midao 前台共用同一組）

前綴 `/api/public/**`。信封格式同 04 分冊；**只回白名單欄位**（絕不整列
select *，避免洩漏成本欄位）。無登入者可讀行程；下單需旅客 JWT。

| 端點 | auth | 說明 |
|---|---|---|
| GET `/api/public/shops/{shopCode}` | 無 | 店家公開資料（名稱/介紹/品牌色） |
| GET `/api/public/shops/{shopCode}/trips` | 無 | PUBLISHED 行程列表（Midao 另加 `?midaoListed=true`） |
| GET `/api/public/shops/{shopCode}/trips/{slug}` | 無 | 行程詳情 + 方案 + 未來團次與**即時剩餘名額**（`capacity - seats_booked`，永不快取） |
| GET `/api/public/departures/{id}/availability` | 無 | 單一團次餘額（下單頁輪詢用） |
| POST `/api/public/checkout` | 旅客 JWT | `{departureId, partySize, paymentMethodId, contact}` → rpc `create_tour_order`（佔位＋建單同交易，10 分冊 §2）→ 回付款指示（綠界表單參數或匯款資訊）。§3 自動建檔在此觸發 |
| GET `/api/public/me/orders`、GET `:id` | 旅客 JWT | 旅客自己的訂單（`traveler_user_id = auth.uid()`） |
| POST `/api/public/orders/{id}/report-transfer` | 旅客 JWT | 回報匯款後五碼 |
| POST `/api/public/orders/{id}/cancel` | 旅客 JWT | 出團前 N 天可自行取消（租戶設定），釋放名額 |
| GET `/api/public/trips/{tripId}/reviews` | 無 | 評論列表（hidden 過濾） |
| POST `/api/public/orders/{id}/review` | 旅客 JWT | 限本人、訂單 COMPLETED、一單一評 |

VibeAI 商店頁本體：`src/app/s/[shopCode]/**`（行程列表、詳情、下單、我的訂單），
吃上表同一組 API —— **商店頁不走 services/mock 層**，它是公開站，直接 fetch。

## 3. 旅客 → 導遊顧客自動建檔（owner 決策 ②）

`create_tour_order` 成功後（同一 request 內）：

1. 以 `tenant_id + (phone 或 email)` 比對 `customers`；命中 → 更新
   `traveler_user_id`（customers 加此欄位，migration 0013）並回填空缺欄位。
2. 未命中 → 建立新 customer（name/phone/email 取自 contact 快照 +
   traveler_profiles），`traveler_user_id` 綁定。
3. `tour_orders.customer_id` 指向該 customer —— 之後導遊在 VibeAI 顧客管理、
   LINE 綁定、行銷推播全部直接可用。
4. checkout 頁需有一行告知：「下單即同意將聯絡資料提供給該導遊作為訂單服務使用」。

## 4. Midao 整合（Phase 10）

### 4.1 讀取面（先做 —— 完成即實現願景八成）

- Midao 前台行程頁改為 build/request 時呼叫 §2 公開 API 取行程與即時名額；
  Midao 自己 DB 裡的行程資料降級為 SEO 快取（可存，但**顯示名額一律即時打 API**）。
- 下單按鈕：直接在 Midao 頁面呼叫 `POST /api/public/checkout`（旅客已是共用帳號，
  JWT 同一個 Supabase 簽發）。付款完成頁/訂單頁同樣打公開 API。
- CORS：`/api/public/**` 回應 `Access-Control-Allow-Origin` 白名單
  （Midao 正式/預覽網域，env `PUBLIC_CORS_ORIGINS` 逗號分隔）+ `OPTIONS` preflight。
  Supabase JWT 放 `Authorization: Bearer`，不依賴跨網域 cookie。

### 4.2 Partner API（服務對服務，Midao 後台專用）

前綴 `/api/partner/**`。認證：**API key + HMAC 簽章**（比照 LINE webhook 的驗法：
`x-partner-key` 指到 `partner_clients` 表、`x-partner-signature` =
HMAC-SHA256(raw body, secret)，secret 加密存放）。migration 0013 加：

```sql
create table partner_clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,                       -- 'midao'
  api_key text not null unique,
  secret_enc text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table tenants add column if not exists midao_guide_id text unique;  -- 導遊 ↔ 租戶對應
```

| 端點 | 說明 |
|---|---|
| GET `/api/partner/tenants` | midao_guide_id 已綁定的租戶清單 |
| POST `/api/partner/tenants/{shopCode}/trips`（＋plans/departures 同 10 分冊管理端點鏡像） | **Midao 管理者代導遊建行程**（owner 需求）：寫入即出現在該導遊 VibeAI 後台 —— 因為本來就是同一本帳，無需同步 |
| GET `/api/partner/tenants/{shopCode}/tour-orders` | Midao 管理後台看訂單（金額欄位保留 —— 上架費/使用費計算用） |
| POST `/api/partner/webhooks` | 註冊 Midao 的接收網址；VibeAI 在 `tour_order` 建立/狀態變更、`trip` 發布時 POST 事件（HMAC 簽章）。**用途僅限 Midao 更新它的顯示快取與報表，絕不得據以做名額決策** |

### 4.3 Midao 側退役路線（在 tour-platform repo 施工，遵守其 harness）

1. 前台行程/名額改接公開 API（讀取面，無風險）。
2. Traveler realm 切換到共用 Supabase + 帳號遷移（§1.4）。
3. checkout 改打 `POST /api/public/checkout`；ECPay 平台代收、orders/payments
   凍結區、payout 結算標記 deprecated（凍結區變更需按其規則取得 owner 授權）。
4. 評論改讀寫 §2 評論端點；Midao 舊評論資料一次性搬入 `trip_reviews`。
5. 觀察期後移除 Midao 舊訂單引擎（該 repo 另案處理，不在本規劃範圍）。

---

## 執行順序與 Phase 對照

```
Phase 9  = §1 共用旅客帳號 + §2 公開 API + §3 自動建檔 + VibeAI 商店頁
Phase 10 = §4 Midao 整合（4.1 讀取 → 4.2 Partner API → 4.3 退役）
```

新 env（併入 01 分冊 §3）：`PUBLIC_CORS_ORIGINS`。
新錯誤碼（併入 04 分冊）：`TOUR_001` 名額不足（10 分冊）、`PARTNER_001` 簽章無效（401）。

## 本冊驗收

- [ ] 同一組帳密可登入 Midao 前台與 VibeAI 商店頁；店家帳號登入旅客端自動補 profile
- [ ] 未登入可看行程與餘額；下單被 401 擋
- [ ] Midao 頁面下單與 VibeAI 商店頁下單搶同一席位，恰好一成一敗；兩邊顯示餘額一致
- [ ] 下單後導遊 VibeAI 後台顧客管理出現該旅客（重複下單不重複建檔）
- [ ] 旅客在 Midao 對 COMPLETED 訂單留評，導遊後台可見並可回覆；未成團訂單留評被拒
- [ ] Partner API：錯誤簽章 401；代建行程立即出現在導遊後台；webhook 收到訂單事件
- [ ] CORS：Midao 網域可呼叫公開 API，其他網域被擋
