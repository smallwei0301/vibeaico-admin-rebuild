# 21 — 平台管理者代登入（platform admin impersonation）

> **Owner 裁示（已定案，不得重問）**
>
> - `docs/OWNER-DECISIONS.md:108`（2026-08-27）：**要做，作為正式平台能力。** 從 Midao 管理者後台
>   進入指定租戶協助**查看／修改**。僅 platform admin；全程 audit；**租戶可查紀錄**；
>   不可取得租戶密碼或共用密碼。
> - `docs/OWNER-DECISIONS.md:88`（2026-08-28）：平台可代建，但**導遊仍是可編輯的資料 owner**；
>   使用 platform-admin／impersonation + audit，不共用密碼。provenance
>   `GUIDE / PLATFORM_ASSISTED / IMPORTED` 只做來源 badge。
> - Owner 2026-09-09 補充：這是平台初期的**核心賣點**（協助代建），且必須連通 Midao 的
>   tour platform 專案，管理者要進得去且**改得動**。
>
> 施工 Issue：#25（平台級三項）、#42（代建方案）。相關引用：
> `18-GUIDE-COMMERCE-LIFECYCLE.md` §10.3、`19-GUIDE-PRODUCT-EXPERIENCE.md` P1 表。

---

## 0. 這份規格要守住的一句話

> 這條路徑一旦存在，「**是店家自己改的**」就不再能單憑 `updated_at` 證明。
> 所以本規格的每一個設計選擇，都以「**任何一筆資料都查得出是誰改的**」為第一順位，
> 便利性排第二。

這不是把功能做小，而是讓它敢在正式站開啟。一個查不出誰改過的代登入能力，
第一次爭議就會讓平台失去店家的信任，而那個信任是初期賣點的前提。

---

## 1. platform admin 是什麼，不是什麼

| | 說明 |
|---|---|
| **是** | Supabase auth user 層級的一個獨立身分，存在 `platform_admins` 表 |
| **不是** | 租戶角色。`tenant_users.role` 的 `STAFF / MANAGER / OWNER` 與它**完全無關** |
| **授予方式** | 只能由 service role 直接寫 DB（或未來的平台後台，另立 Issue）。**沒有任何 API 可以新增 platform admin** |
| **升級路徑** | 不存在。租戶 OWNER 無法把自己變成 platform admin |

> ⚠️ 「沒有任何 API 可以新增 platform admin」是刻意的。一個能自我授權的權限系統
> 等於沒有權限系統；而這個權限的爆炸半徑是**全平台每一家店的每一筆資料**。
> 新增管理者是低頻動作，值得用「必須有 service role」換掉整類提權漏洞。

### 1.1 `requirePlatformAdmin()`

```ts
// src/server/platform-admin.ts
export async function requirePlatformAdmin() {
  const { supabase, user } = await requireUser();          // 沿用既有登入判定
  const admin = createAdminSupabase();
  const { data } = await admin.from('platform_admins')
    .select('user_id').eq('user_id', user.id).eq('active', true).maybeSingle();
  if (!data) throw new ApiHttpError(403, '需要平台管理者權限', ERR.FORBIDDEN);
  return { supabase, user };
}
```

`platform_admins` 的 RLS 只允許 service role 讀寫；一般使用者**讀不到這張表**，
所以「有沒有人是管理者」本身不外洩。

---

## 2. 進入與退出

### 2.1 端點

| 端點 | 權限 | 說明 |
|---|---|---|
| `POST /api/platform/impersonation/start` | platform admin | body `{ tenantId, reason }`；`reason` 必填、8–200 字 |
| `POST /api/platform/impersonation/end` | 進行中的 session 本人 | 結束目前 session |
| `GET /api/platform/impersonation/current` | platform admin | 回目前 session（沒有則 `null`） |

**`reason` 必填**：一句「為什麼要進去」寫在紀錄裡，是這條路徑唯一能事後判斷
「該不該進去」的依據。沒有理由的進入紀錄，稽核時等於沒有紀錄。

### 2.2 生命週期

```
start  → 寫 impersonation_sessions 一列（ended_at = null，expires_at = now() + 30 min）
       → 設 cookie vibeai_impersonation = <session id>（httpOnly, sameSite=lax, path=/）
end    → ended_at = now()，清 cookie
逾時   → expires_at 過了就自動失效，不需要任何清理工作
```

**30 分鐘硬上限，不續期。** 需要更久就重新 start 一次，紀錄裡也就多一筆——
這正是我們要的：長時間停留在別人的後台，本身就該留下痕跡。

### 2.3 `requireTenant()` 的改動——本規格最危險的一段

`requireTenant()` 目前完全由 `tenant_users` 成員資格決定租戶。代登入的管理者
**不是成員**，所以必須加一條分支。這一段有 bug 就是全平台提權，因此規則寫死：

```
代登入分支只有在「以下全部成立」時才啟用：
  ① cookie vibeai_impersonation 存在
  ② 該 session 存在，且 ended_at is null
  ③ expires_at > now()
  ④ 該 admin_user_id 在 platform_admins 仍為 active
  ⑤ session.admin_user_id === 當前登入者的 user.id

任何一項不成立 → **不報錯、不提權**，直接落回原本的成員資格判定。
```

⑤ 是防「cookie 被複製到另一個帳號」；④ 是防「管理者權限被撤銷後舊 session 還能用」。
兩者都必須每次請求重查，不可快取。

回傳值新增一個欄位，且**不可為 optional-and-forgotten**：

```ts
type TenantContext = {
  …既有欄位…
  role: string;                      // 代登入時固定為 'OWNER'
  impersonation: { sessionId: string; adminUserId: string } | null;
};
```

### 2.4 ⚠️ 代登入必然繞過 RLS，這件事要講清楚

租戶業務表的 RLS 是 `is_tenant_member(tenant_id)`。代登入的管理者不是成員，
用他自己的 session client 一列都讀不到。因此**代登入請求一律改用 service role
client**（與既有 `requireTenantManager()` 同一個做法）。

也就是說：**代登入狀態下，租戶邊界完全落在 `requireTenant()` 解析出來的 `tenantId` 上，
沒有第二道防線。** 這與 `src/server/public-shop.ts` 檔頭記載的處境相同，收斂手段也相同：

- 每一次查詢都必須 `.eq('tenant_id', t.tenantId)`，不得省略
- `tenantId` 只能來自 session row，**絕不可**從 request body 或 query 覆蓋
- 有一條原始碼鎖擋住「代登入分支回傳的 client 被用在沒有 tenant_id 條件的查詢上」

---

## 3. 稽核：兩張表

### 3.1 `impersonation_sessions`

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | uuid pk | |
| `admin_user_id` | uuid not null | 誰 |
| `tenant_id` | uuid not null → tenants | 進了哪一家 |
| `reason` | text not null | 為什麼 |
| `started_at` | timestamptz not null default now() | |
| `expires_at` | timestamptz not null | `started_at + 30 min` |
| `ended_at` | timestamptz null | 主動結束才有值 |

### 3.2 `impersonation_actions`

每一次**寫入型**請求記一列。

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | uuid pk | |
| `session_id` | uuid not null → impersonation_sessions | |
| `tenant_id` | uuid not null | 冗餘一份，讓租戶端查詢不必 join |
| `method` | text not null | `POST` / `PUT` / `PATCH` / `DELETE` |
| `path` | text not null | 例如 `/api/trip-plans/abc123` |
| `status` | int not null | 回應狀態碼 |
| `at` | timestamptz not null default now() | |

**刻意不記 request body。** body 裡會有顧客姓名、電話等個資，把它抄進一張
「租戶自己看得到、平台也看得到」的表，是拿稽核之名多做一份個資副本。
「哪一筆資料被改成什麼」由既有資料表自己的 `updated_at` 與業務欄位承擔；
本表回答的是「**是誰在什麼時候動了哪一支端點**」。

> ⚠️ 誠實記錄一個覆蓋缺口：因此本表**證不到欄位級的變更內容**。若日後需要
> 欄位級 diff，那是一張獨立的變更歷史表，不是把 body 塞進這裡。

### 3.3 記錄點必須是唯一入口，不能靠自律

寫入紀錄不可交給每一支 route 自己呼叫——那等於 163 個必須記得的地方。
改成在 `handle()` 之外包一層：

```ts
// src/server/http.ts
export function handleTenantWrite(fn) { … }   // 代登入時自動寫 impersonation_actions
```

並有一條原始碼鎖：**任何寫入型 route 若使用了代登入可達的 `requireTenant()`，
就必須經過這一層**。少一個地方沒包，那個地方就是稽核的破口。

---

## 4. 租戶自己查得到（裁示明文要求）

| 端點 | 權限 | 說明 |
|---|---|---|
| `GET /api/settings/impersonation-log` | 租戶 `MANAGER` 以上 | 回本店的 session 與 action 列表，分頁 |

- RLS：兩張表對租戶成員開放 `select using (is_tenant_member(tenant_id))`，
  寫入只有 service role。
- 畫面：`/tenant/settings` 新增一個「平台協助紀錄」分頁，空的時候顯示
  「目前沒有平台管理者進入過您的後台」——**這句話為真時才顯示**，不得在查詢失敗時
  也顯示它（PB-023：丟掉 error 會讓故障冒充「沒有資料」）。
- **不通知**：本版不主動寄信給店家。是否要在管理者進入時即時通知店家，
  屬 Owner 決策，尚未裁示，先不做也不假裝有做。

---

## 5. 不取得也不共用租戶密碼（裁示明文要求）

- 管理者全程**以自己的帳號登入**，只是多帶一個 impersonation session。
- 流程中不存在讀取、複製、重設租戶 credential 的任何一步。
- 可 grep 證明：`impersonation` 相關檔案不得出現
  `password`、`credential`、`admin.auth.admin.` 等字樣。

---

## 6. 代建 provenance（#42）

`0095` 新增 `source` 欄位（`text not null default 'GUIDE'`，值域
`GUIDE | PLATFORM_ASSISTED | IMPORTED`）到代建會碰的資源表。

- 在代登入 session 下建立的列，`source` 自動寫 `PLATFORM_ASSISTED`，
  **由伺服器端決定，不接受客戶端傳入**。
- 它**只是來源標記**：不改變任何權限。導遊仍然是可編輯的資料 owner，
  可以自由修改甚至刪除平台幫他建的東西（裁示明文）。
- UI 顯示「Midao 協助建立」badge。
- 已在 Midao LISTED 的行程，修改仍走既有 review 機制（#42）。

---

## 7. 驗收（對應 #25 的 impersonate 八格）

| # | 驗收 | 證據形式 |
|---|---|---|
| 1 | platform admin 與租戶角色完全分離；租戶 OWNER 無法自我升級 | 整合測試 + `grep` 證明無新增 platform admin 的 API |
| 2 | 進入後可查看**且可修改** | 整合測試：以管理者身分寫入一筆並直查 DB |
| 3 | 非 platform admin 一律 403（含租戶 OWNER） | 整合測試 |
| 4 | 全程 audit（進入／退出／每次寫入） | 直查兩張表的整合測試 |
| 5 | 租戶自己查得到 | 以該租戶成員身分讀取的整合測試 |
| 6 | 不取得也不共用密碼 | `grep` 輸出 |
| 7 | provenance 只作來源 badge，不改變 owner 權限 | 整合測試：導遊仍改得動 `PLATFORM_ASSISTED` 的資料 |
| 8 | 與 tour platform 的連通方式 | 見 §8.8。A／B 方案擇一為 Owner 決策，未裁示前依 A 實作 |

**必須有的變異測試**（否則上面幾條都可能是空轉）：

1. 把 §2.3 的條件 ④（`platform_admins` 仍 active）拿掉 → 「權限撤銷後舊 session 失效」轉紅
2. 把條件 ⑤（session 屬於當前登入者）拿掉 → 「cookie 換一個帳號帶」轉紅
3. 把 `handleTenantWrite` 的記錄拿掉 → 「每次寫入都有 action 紀錄」轉紅
4. 把 `expires_at` 檢查拿掉 → 「逾時後不再生效」轉紅

---

## 8. 與 Midao tour platform 的連通

> 本節依 2026-09-09 對 `smallwei0301/tour-platform`（commit `159d956`）的**實查**撰寫，
> 不是推測。四個原本待釐清的問題現在有三個有答案，第三個是 Owner 決策。

### 8.1 最重要的發現：tour platform 已經有一套在跑的 impersonation

不需要發明，需要對齊。既有實作：

| 檔案 | 作用 |
|---|---|
| `apps/web/app/api/v2/admin/guides/[guideId]/impersonate/route.ts` | 管理員按「進入導遊後台」的端點 |
| `apps/web/src/lib/midao/impersonation-actor.ts` | 簽章／驗章的 actor cookie |
| `apps/web/src/lib/midao/canonical-guide-session.ts:114` | 每次請求解析 actor |
| `supabase/migrations/20260723002500_midao_audit_events.sql` | 稽核事件表 |
| `apps/web/e2e/midao-auth-and-impersonation.spec.ts` | E2E |

機制是：管理員呼叫該端點 → 伺服器**為目標導遊簽發一組真的 guide session cookie**
（沿用 `createGuideSessionCookies` 的 HMAC ＋ 該導遊當前的 `guide_session_version`），
另外下兩顆 cookie：

- `midao_impersonation_actor` — HttpOnly、HMAC 簽章、domain-separated
  （`midao:impersonation-actor:v1`），payload 是
  `{ actorType:'admin', actorId:<管理員 email>, targetGuideId, issuedAt, expiresAt }`，
  **上限 1 小時**，驗章時綁定 `targetGuideId`、逐欄檢查 key 集合與時間區間。
- `guide_impersonation=1` — 非 HttpOnly，純標記，供前端顯示「管理員代入模式」橫幅。

守門：只允許 `verification_status === 'approved'` 的導遊；停權／申請中一律 409。

### 8.2 Q1 管理者身分：**兩邊不是同一組使用者，而且 tour platform 的 admin 不是 Supabase user**

`apps/web/src/lib/admin-auth.mjs` 的 `isAdminAuthorized()`：

```
ADMIN_ACCESS_TOKEN（共用祕密，constant-time 比較）
  ＋ email allowlist
  ＋ admin_session_version
  ＋ admin_session_expires_at
```

來源是 `x-admin-token` / `x-admin-email` header，或 `admin_token` / `admin_email` cookie。

**所以沒有「同一個 Supabase 使用者」可以沿用。** 兩個專案的 Supabase 是
`pyoderxmpeyqjwkeliiu`（tour platform）與 `egehnijjpgijmccagxac`（本專案），
JWT 互不認得。

⚠️ **本專案不採用共用 token 模型。** 共用祕密有兩個本案承受不起的性質：
① 「誰進去的」只能靠自己宣告的 header email，不是驗過的身分；
② 撤銷一個人 = 幫所有人換一次祕密。而本專案的代登入看得到顧客姓名電話。
所以 §1 的 `platform_admins`（逐人、Supabase auth user、可單獨撤銷）維持不變。

### 8.3 Q2 管理者後台在哪一邊：**在 tour platform，本專案不另建**

tour platform 已有 `/admin` 與 `/midao`，且 `/admin/guides/[guideId]` 就是現在
按「進入導遊後台」的地方。入口放那裡，本專案只提供被進入的那一端。

### 8.4 Q3 跨專案信任：兩個方案，**需 Owner 選一個**

**方案 A（預設建議）—— 深連結 ＋ 管理者自己也有本專案帳號**

```
tour platform /admin/guides/[guideId]
  └─ 「進入店家後台」按鈕 → 導向
     https://<vibeaico>/tenant/dashboard?impersonate=<tenantId>
        └─ 本專案：未登入 → 導去登入頁；登入者非 platform_admins → 403
           是 platform_admins → 走 §2 的 start 流程（reason 必填）
```

- 代價：管理者第一次要在本專案登入一次（之後 session 持續）。
- 好處：**不新增任何跨專案祕密**；身分是本專案自己驗過的 Supabase user；
  撤銷一個人就是把他的 `platform_admins.active` 設 false，不影響別人。

**方案 B —— tour platform 簽發短期斷言，本專案驗章後直接開 session**

```
tour platform 用共用 HMAC key 簽一段
  { adminEmail, tenantId, issuedAt, expiresAt≤60s, nonce }
本專案驗章 → 直接建立 impersonation session，管理者不需要本專案帳號
```

- 好處：一鍵直達，UX 最順。
- 代價：**多一把跨專案共用祕密，它外洩等於可以扮演任何一家店的任何操作**。
  若採 B，以下為必要條件，缺一不可：斷言壽命 ≤60 秒、`nonce` 一次性（存 DB 防重放）、
  key 與兩邊的 service key 分離且可單獨輪替、`adminEmail` 仍必須落在本專案的
  `platform_admins` 內（斷言只證明「來自 tour platform」，不證明「這個人有權限」）。

> **絕對不做的事**：共用 service role key。那不是「連通」，那是把兩個資料庫的
> 完整寫入權互相交出去。

⚠️ **A 或 B 是 Owner 決策**，本規格不自行決定。未裁示前依 A 實作——A 是 B 的
子集：先做 A，日後要加 B 只是多一條入口，不需要改動 §1–§7 的任何設計。

### 8.5 Q4 租戶對應：**目前兩邊零關聯，必須新建**

實查結果：tour platform 全 repo 搜不到 `vibeaico`、`tenant_id`、`shop_code`、
`midao_listing` 任何一處。它的導遊是 `guide_profiles`，本專案的店家是 `tenants`，
**兩者今天沒有任何欄位互相指向**。

因為本專案是可寫的那一邊，對應關係放這裡：

```sql
alter table public.tenants
  add column if not exists midao_guide_id uuid;          -- tour platform 的 guide_profiles.id
create unique index if not exists tenants_midao_guide_id_uq
  on public.tenants (midao_guide_id) where midao_guide_id is not null;
```

- 一對一：一個 Midao 導遊最多對應一家本專案店家，反之亦然（partial unique index）。
- `null` 是合法且常見的狀態：本專案的店家不一定在 Midao 上架，反之亦然。
  **未對應時「進入店家後台」按鈕不該出現**，而不是出現了按下去出錯。
- 誰負責填：屬 #13（Midao 整合／資料搬遷）範圍，本規格只定義欄位與唯一性。

### 8.6 從 tour platform 借到的兩條設計佐證

1. **`midao_audit_events` 的欄位註解逐字寫著**：
   > `Minimal audit context only; must not contain tokens, cookies, payment secrets, or complete traveler PII.`

   這與本規格 §3.2「刻意不記 request body」是各自獨立得到的同一個結論。

2. 該表 `FORCE ROW LEVEL SECURITY` 且 `REVOKE ALL FROM PUBLIC, anon, authenticated`，
   只有 service role 有 SELECT/INSERT —— 也就是說**導遊自己讀不到那張表**。
   本專案的裁示明文要求「租戶可查紀錄」，所以 §4 的租戶端查詢端點是本專案必須自己補的，
   不能指望對面已經有。

### 8.7 一條必須由本專案自己保證的性質

tour platform 的做法是**為目標導遊簽發一組真的 session**，管理員在系統眼中就是那位導遊；
可歸屬性靠 actor cookie，`canonical-guide-session.ts` 會解析它，`actorId` 再流進
command handler。

這代表：**只要有任何一條寫入路徑只讀 session、沒讀 actor，那一筆寫入就與導遊本人親手做的
無法區分。** 我沒有逐一稽核對面所有 route，因此不對它下判斷（PB-027）；但這正是本規格
§3.3 要求「記錄點包在 `handle()` 外的一層、不交給 163 支 route 自律」的原因——
在本專案這一邊，這個性質必須由結構保證，不是由每個實作者記得。

### 8.8 驗收（§7 第 8 格）

- [ ] `tenants.midao_guide_id` 欄位與 partial unique index 存在；未對應的店家不顯示入口
- [ ] 依 Owner 選定的 A 或 B 實作；若選 A，`grep` 證明**沒有任何跨專案共用祕密**
- [ ] 非 `platform_admins` 的使用者帶著正確的 `?impersonate=<tenantId>` 一律 403
- [ ] 從 tour platform 的 `/admin/guides/[guideId]` 點進來到本專案租戶後台的完整路徑，
      有一條端對端測試（可用 mock 的 tour platform 端）

## 9. Migration

`0095_platform_admin_impersonation.sql`（編號＝現有最大 `0094` ＋1）：

- `platform_admins`、`impersonation_sessions`、`impersonation_actions` 三張表
- RLS：`platform_admins` 只有 service role；兩張稽核表對租戶成員開放 select、
  寫入只有 service role
- 代建資源表新增 `source` 欄位（§6）
- `tenants.midao_guide_id` 與其 partial unique index（§8.5）
- 依 `02-SUPABASE-SCHEMA.md` 的樣板；套用**兩個** Supabase 專案並各自驗證
- ⚠️ 正式庫套用需 Owner 逐次具名授權（`docs/AGENT-EXECUTION.md`）
