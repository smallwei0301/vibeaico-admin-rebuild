# 04 — API 契約（Phase 3 = §A，Phase 5 = §B）

> 所有端點的請求/回應規格。實作位置一律 `src/app/api/<path>/route.ts`。
> 原站完整端點清單在 `docs/_endpoints.json`（195 條）；本冊把「本專案前端
> 實際會呼叫」的端點定為必做，其餘照 §B 樣板逐步補。

---

## 0. 全域規約（每個端點都適用）

1. **信封**：成功 `{ success:true, data }`；失敗 `{ success:false, message, code }`。
   用 `ok()/fail()/handle()`（01 分冊 §5.1）。
2. **認證**：除 `/api/auth/*` 公開端點與 `/api/line/webhook/*`、`/api/cron/*` 外，
   全部先 `const t = await requireTenant()`；寫入型端點依表格標示 `MANAGER` 或 `OWNER`。
3. **租戶過濾**：查詢一律 `.eq('tenant_id', t.tenantId)`。RLS 是保險絲，不是替代品。
4. **驗證**:每個有 body/query 的端點開頭都用 zod schema `parse()`，失敗自動回 400（`handle()` 已處理）。
5. **分頁**：`?page=0&size=20` → `Paged<T>`（`pageRange()`/`toPaged()`，01 分冊 §5.6）。
   supabase 寫法：`.select('*', { count: 'exact' }).range(from, to)`。
6. **回傳形狀 = `src/lib/types.ts`**，經 `src/server/mappers.ts` 轉換。
7. **404 規則**：id 查無 **或不屬於本租戶** 都回 404 `REQ_002`（不能洩漏其他店的資料存在與否）。
8. **金額**：numeric 欄位以 number 回傳（`Number(row.price)`），不回字串。

### 參考實作（照這個模式寫其他所有端點）

```ts
// src/app/api/bookings/route.ts
import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { pageRange, toPaged } from '@/server/paging';
import { mapBooking } from '@/server/mappers';

const querySchema = z.object({
  page: z.coerce.number().int().min(0).default(0),
  size: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['PENDING','CONFIRMED','COMPLETED','CANCELLED','NO_SHOW']).optional(),
  keyword: z.string().optional(),
  from: z.string().optional(),   // ISO 日期
  to: z.string().optional(),
  staffId: z.string().uuid().optional(),
});

export const GET = handle(async (req) => {
  const t = await requireTenant();
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const { from, to, page, size } = pageRange(q.page, q.size);

  let query = t.supabase.from('bookings_view')
    .select('*', { count: 'exact' })
    .eq('tenant_id', t.tenantId)
    .order('start_at', { ascending: false })
    .range(from, to);
  if (q.status) query = query.eq('status', q.status);
  if (q.staffId) query = query.eq('staff_id', q.staffId);
  if (q.from) query = query.gte('start_at', q.from);
  if (q.to) query = query.lte('start_at', q.to);
  if (q.keyword) query = query.or(
    `customer_name.ilike.%${q.keyword}%,customer_phone.ilike.%${q.keyword}%,booking_no.ilike.%${q.keyword}%`);

  const { data, count, error } = await query;
  if (error) throw error;
  return ok(toPaged(data.map(mapBooking), count, page, size));
});
```

```ts
// src/app/api/bookings/[id]/confirm/route.ts —— 狀態動作的樣板
export const POST = handle(async (_req, { params }) => {
  const t = await requireTenant();
  const { id } = await params;
  const { data, error } = await t.supabase.from('bookings')
    .update({ status: 'CONFIRMED' })
    .eq('id', id).eq('tenant_id', t.tenantId).eq('status', 'PENDING')  // 僅待確認可確認
    .select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiHttpError(409, '此預約狀態已變更，請重新整理', ERR.CONFLICT);
  // Phase 4 之後：這裡呼叫 notifyBookingStatus(t.tenantId, id, 'CONFIRMED')（05/06 分冊）
  return ok();
});
```

---

## §A 核心端點（Phase 3 — 前端 services 已在呼叫，必做）

### A-0 認證（實作見 03 分冊）

| 端點 | Body（zod） | data 回傳 |
|---|---|---|
| POST `/api/auth/send-verification-code` | `{email, purpose:'REGISTER'\|'RESET_PASSWORD'}` | `{sent:true}` |
| POST `/api/auth/tenant/register` | `{email, code, password, tenantName, shopCode}` | `{registered:true}` |
| POST `/api/auth/login` | `{email, password}` | `{loggedIn:true}` |
| POST `/api/auth/logout` | – | `{loggedOut:true}` |
| POST `/api/auth/forgot-password` | `{email}` | `{sent:true}` |
| POST `/api/auth/reset-password` | `{email, code, newPassword}` | `{reset:true}` |
| POST `/api/auth/change-password` | `{currentPassword, newPassword}` | `{changed:true}` |
| GET `/api/auth/me` | – | `{email, tenantId, tenantName, shopCode, role}` |
| GET `/api/auth/my-tenants` | – | `TenantSummary[]` |
| POST `/api/auth/switch-tenant` | `{tenantId}` | `{switched:true}` |

### A-1 設定（`src/services/settings.ts` 呼叫）

| 端點 | 說明 |
|---|---|
| GET `/api/settings` | 回 `TenantSettings`。組法：讀 `tenant_settings` 一列 → 各 jsonb 用對應 zod schema `.parse()` 補預設值 → `line.channelSecret`/`channelAccessToken` 填 `maskSecret(decryptSecret(*_enc))` → `line.webhookUrl = buildWebhookUrl(APP_URL, shopCode)`（唯讀，永遠伺服器算） |
| PUT `/api/settings` | body = `Partial<TenantSettings>`（各群組整包覆蓋）。逐群組 zod 驗證後寫回 jsonb。`basic.shopCode`/`basic.tenantName` 變更時同步更新 `tenants` 表（shopCode 需查重，重複回 409 `AUTH_006`）。需 `MANAGER` |
| PUT `/api/settings/line` | body = `Partial<LineSettings>`。**秘密欄位規則（鐵則 6）**：`channelSecret`/`channelAccessToken` 為空字串 → 不動 DB 舊值；非空 → `encryptSecret()` 後寫 `*_enc` 欄位。其餘欄位寫進 `line` jsonb（jsonb 內永不存這兩個 secret）。需 `MANAGER` |
| POST `/api/settings/line/test` | 解密 token → `GET https://api.line.me/v2/bot/info`。200 → `{ok:true,message:'連線正常'}`；否則 `{ok:false,message:<LINE 錯誤>}`（HTTP 仍 200，錯誤放 data） |
| POST `/api/settings/line/verify` | 回 `{checks:[{key,pass,message}]}`，key 依序 `TOKEN`/`WEBHOOK`/`AUTO_REPLY`/`RICH_MENU`/`QUOTA`，實作見 06 分冊 §7 |
| GET `/api/settings/setup-status` | 回 `SetupStatus`。步驟判定：SHOP_INFO=basic.tenantPhone/Address 有值；STAFF=staff 至少 1；SERVICE=services 至少 1；BUSINESS_HOURS=business 曾儲存（jsonb ≠ '{}'）；LINE_BOT=token 已設定。percent = done 數/5*100 |
| GET `/api/feature-store` | 回 `FeatureSubscription[]`：讀 `feature_subscriptions`，`active = active && (expires_at is null or expires_at > now())` |

### A-1.2 逐日營業時間的乾跑與自動封鎖鏈（issue #33 ②，2026-08-26 補列）

原站有 `POST /api/settings/weekly-business-hours/draft`（`docs/specs/settings.json`
的 `jsApiCalls`），04 分冊原本零記載。

| 端點 | 要點 |
|---|---|
| POST `/api/settings/weekly-business-hours/draft` | body = business 群組（同 `businessSettingsSchema`）。**乾跑：一列都不寫**。回 `{perDayMode, autoBlockCount, conflictBookingCount, manualWeeklyBlockCount}`。格式不合 → 400 `REQ_001`（對應原站文案「解析逐日營業時間失敗:」） |
| PUT `/api/settings`（帶 business 群組時） | 存檔後**重建自動封鎖**，回 `{perDayMode, autoBlockCreated, conflictBookingCount, manualWeeklyBlockCount}`。不帶 business 時 `data` 為空（維持原本的 `ok()`） |

#### ⚠️ 「乾跑 vs 存檔」是**我方選定**的語意，不是原站考據結果

`docs/specs/settings.json` **只給了路徑與文案，沒有 request / response 形狀**。
選「乾跑」的依據只有兩點：

1. 端點路徑最後一段是 `draft`（草稿）。
2. jsStrings[66]「**解析**逐日營業時間失敗:」——這一支會拿**還沒存**的輸入去算東西。

**反面證據（一併記下，不藏起來）**：原站另外三句文案是過去式／已存檔語氣，
單看它們會讀成「這一支自己就會寫入」——

- jsStrings[37]+[7]「已依你的營業時段自動建立 N 筆封鎖時段（…）」
- jsStrings[9]「… 設定已儲存，但這些預約「不會」自動取消。…」
- jsStrings[6]「… 已保留（不會自動刪除）。…」

我方的解讀是：這三句在**存檔完成之後**才顯示，所以過去式成立。頁面因此先乾跑
拿「偵測到的」數字（衝突預約、手動每週封鎖），再 PUT 存檔拿「實際建立」的數字。
**這個解讀沒有原站證據。** 若擁有者裁決 draft 應該自己寫入，要改的是
`src/server/business-hours-blocks.ts` 與那兩支端點，四句文案不用動。

#### 自動封鎖的產生／回收規則（我方定案）

- **產生**：`perDayMode` 開啟時，把每一天「沒開放的時段」補成 `WEEKLY` 封鎖。
  整天沒開放 → 一筆 `full_day` 整天封鎖；有開放但有空隙 → 每個空隙一筆。
  `perDayMode` 關閉 → 不產生任何 auto 封鎖（一般營業時間的非營業時段本來就由
  `available-slots` 的營業時間視窗擋掉）。
- **回收**：**全刪重建**（不是差異更新）。每次存 business 群組先刪光本租戶
  `auto = true` 的列，再依新的營業時段重新產生。差異更新需要「哪一筆對應哪一筆」
  的比對規則，而 auto 列沒有穩定識別依據（時段本身就是識別），比對規則會自己
  長出一套隱性狀態。代價是 id 會換——auto 列本來就不給人編輯。
- **手動建立的封鎖（`auto = false`）一筆都不碰**（原站文案明講「已保留（不會自動刪除）」）。
- auto 列不可編輯／刪除：`PUT`/`DELETE /api/block-times/:id` 回 409 `REQ_003`。
- **衝突預約的口徑**：只看未來（`start_at >= now`）、只看 `PENDING`/`CONFIRMED`、
  上限往後一年；「落在非營業時段」= 這筆預約**沒有整段**落在該星期幾的任何一個
  開放時段裡。零衝突時回 0，頁面**不顯示**那一句警告（「有 0 筆預約落在非營業
  時段」是一句沒有意義的警告）。

#### `block_times` 的每週模型（migration 0027）

新增欄位 `title / recurrence('SINGLE'|'WEEKLY') / day_of_week / full_day / auto`，
逐欄出處見 migration 檔頭（原站 `blockTimeModal` 的五個欄位＋列表三欄）。

**一列 = 一整條每週封鎖**，`start_at`/`end_at` 存的是**參考週**（1970-01-04 起的
那一週，台北時間）裡的第一次發生，實際的每週重複**在讀取時展開**
（`/api/calendar`、`/api/bookings/available-slots`，見
`src/server/business-hours-blocks.ts` 的 `expandWeeklyBlock`）。

為什麼不預先產生一堆具體日期的列：那需要一個定期往前推進視窗的排程，而那個排程
不存在——**有排程才敢說「未來每一週都擋得住」**。原站也是「一列一整條」的模型：
`docs/specs/calendar.json` jsStrings[31] 的刪除確認寫著「這是「每週重複」的封鎖，
會把每一週的這個封鎖整條刪除。」

⚠️ 連帶後果：`GET /api/block-times`、`/api/calendar`、`/api/bookings/available-slots`
**不能**再用 `start_at` 做 SQL 區間過濾（WEEKLY 列的 start_at 是 1970 年，會被全部
濾掉）。三支都改成整批取回、展開後在應用層過濾。

### A-1.1 LINE 老闆通知 owner-notify（`src/services/settings.ts` 呼叫，issue #18）

原站有這四支（`docs/specs/dashboard.json` 的 `jsApiCalls` 逐字），04 分冊原本零記載。
**完整契約（method、body、錯誤、狀態語意、觸發事件、額度 n 倍行為）寫在
`06-LINE-INTEGRATION.md` §5.5**，這裡只列索引避免兩處分岔：

| 端點 | method | 說明 |
|---|---|---|
| `/api/settings/line/owner-notify` | `GET` / `DELETE` | 狀態＋名單＋`maxRecipients` ／ 解除全部 |
| `/api/settings/line/owner-notify/line-users` | `GET` | 可加入的 LINE 好友（已 follow 且不在名單中） |
| `/api/settings/line/owner-notify/bind` | `POST` | 本人自我認領（「是我，綁定通知」） |
| `/api/settings/line/owner-notify/recipients/:id` | `POST` / `DELETE` | 加入 ／ 移出名單（`:id` = `line_user_id`） |

⚠️ **原站沒有 `toggle` 端點**——「關掉通知」＝移除接收者。不得自行補一支。

### A-2 預約（`src/services/bookings.ts`）

| 端點 | 規格 |
|---|---|
| GET `/api/bookings` | 見上方參考實作 |
| POST `/api/bookings/:id/confirm` | PENDING→CONFIRMED（樣板見上） |
| POST `/api/bookings/:id/complete` | PENDING/CONFIRMED→COMPLETED。完成時：若 `points.pointEarnEnabled` → 依 `pointEarnRate`+`rounding` 算點數 → `customers.points += n` 並寫 `customer_point_logs` |
| POST `/api/bookings/:id/cancel` | body `{reason?}`；PENDING/CONFIRMED→CANCELLED，寫 `cancel_reason` |
| POST `/api/bookings/:id/no-show` | CONFIRMED→NO_SHOW |

狀態機（其他轉換一律 409 CONFLICT）：
`PENDING → CONFIRMED | CANCELLED`；`CONFIRMED → COMPLETED | CANCELLED | NO_SHOW`；
`COMPLETED → PENDING`（僅 revert-complete，§B）。

### A-3 顧客（`src/services/customers.ts`)

| 端點 | 規格 |
|---|---|
| GET `/api/customers` | query 見 `CustomerQuery`。資料源 `customers_view`；`atRisk=true` → `.eq('at_risk', true)`；`minSpent/maxSpent` → `total_spent` 範圍；`minVisits` → `booking_count`；keyword → name/phone ilike。回 `Paged<Customer>`（mapper 把 `gender null → ''`、`birthday null → ''`） |
| POST `/api/customers` | body：`{name(必), phone?, email?, gender?, birthday?, note?, tags?, membershipLevelId?}` zod 驗證。回 `{id}` |
| PUT `/api/customers/:id` | 同上欄位皆可選；只更新有出現的欄位 |
| DELETE `/api/customers/:id` | 有 COMPLETED 以外進行中預約時回 409；否則刪除（bookings FK 為 restrict，改為：軟刪 `active=false`） |

### A-4 目錄（`src/services/catalog.ts` — 全部 GET，list 全量不分頁）

| 端點 | 資料源 | 排序 |
|---|---|---|
| GET `/api/services` | services join service_categories（categoryName） | sort_order asc |
| GET `/api/staff` | staff + staff_services 聚合成 serviceIds | sort_order asc |
| GET `/api/products` | products join product_categories | sort_order asc |
| GET `/api/product-orders` | product_orders + items 聚合 + customer name | created_at desc |
| GET `/api/coupons` | coupons + 兩個 count 子查詢（issued/redeemed） | created_at desc |
| GET `/api/membership-levels` | membership_levels + customerCount(count customers) | sort_order asc |

### A-5 報表（`src/services/reports.ts`）

| 端點 | data 組法（皆以租戶時區 Asia/Taipei 計「今天／本月」） |
|---|---|
| GET `/api/reports/dashboard` | `DashboardStats`：todayBookings=start_at 在今日的 bookings count；pendingBookings=status PENDING count；monthRevenue=本月 COMPLETED sum(final_price)；totalCustomers=customers count；pushQuota{Used,Total}=push_quota_usage 本月 used / 200（或加購額度）；linePlatformStatus=token 未設 `NOT_CONFIGURED`，設了取 `/v2/bot/info` 快取結果 `CONNECTED`/`ERROR` |
| GET `/api/reports/dashboard-alerts` | `DashboardAlerts`：unprocessedBookings=PENDING count；lowStockProducts=stock<=safety_stock count；atRiskCustomers=customers_view at_risk count；bookingCutoff*=business 設定比對今天；pushQuotaExhausted=used>=total；expired/expiringFeatures 依 `FEATURE_EXPIRY_WARNING_DAYS` |
| GET `/api/reports/staff-performance` | query `?from&to`（預設本月）：group by staff → bookingCount(全部)、completionRate(COMPLETED/全部)、revenue(COMPLETED sum) |

---

## §B 延伸端點（Phase 5 — 依頁面優先序補齊）

實作規則與 §A 完全相同；下表給契約要點。`:id` 皆為 uuid；`⚙M`=需 MANAGER、`⚙O`=需 OWNER。

### B-1 預約進階

| 端點 | 要點 |
|---|---|
| POST `/api/bookings` | 手動建立：`{customerId, serviceId, staffId?, startAt, note?}`。伺服器算 endAt=start+service.duration、price=service.price、booking_no=`'B'+yymmdd+4位流水`（查當日 max 補零）。重疊由 DB 排除約束擋 → catch code `23P01` 回 409「該時段已有預約」 |
| PUT `/api/bookings/:id` | 改時間/員工/備註；同重疊處理 |
| POST `/api/bookings/:id/adjust-price` | `{finalPrice}` ⚙M |
| POST `/api/bookings/:id/apply-coupon` | `{code}`：查 coupon_instances 未核銷 → redeemed_at=now、final_price 依 discount 重算 |
| POST `/api/bookings/:id/apply-points` | `{points}`：顧客點數足夠 → 扣點寫 log、final_price -= points（1 點 = 1 元） |
| POST `/api/bookings/:id/mark-paid-offline` | payment_status=PAID_OFFLINE |
| POST `/api/bookings/:id/revert-complete` | COMPLETED→PENDING，並回沖完成時發的點數 ⚙M |
| GET `/api/bookings/available-slots` | `?serviceId&staffId?&date`：以共用 staff availability engine 讀 business 設定（時段間隔/營業時間/公休）+ shifts（依 staff `availability_policy`）+ bookings + block_times + 已指派團次 → 回 `{slots:[{start,end,staffIds[]}]}`；只排除實際被指派的 PRIMARY／ASSISTANT，不做全店粗略封鎖 |
| GET `/api/bookings/calendar` | `?from&to`：回該區間全部（不分頁）。**僅服務預約**；行事曆頁請改用下面的統一端點 |
| GET `/api/calendar` | `?from&to`：**行事曆頁唯一資料源**，合併四種事件成一個陣列（展示層合一，資料層仍分開）：`{events: CalendarEvent[]}`，`CalendarEvent` 以 `type` 區辨 —— `BOOKING`（服務預約）／`DEPARTURE`（行程團次，含 `seatsBooked/capacity`、`primaryStaffId/Name`、`assistantStaffIds/Names`）／`BLOCK`（封鎖時段）／`EXTERNAL`（匯入的外部 ICS，唯讀）。沒有團次資料的租戶自然回空；GUIDE 的 `TOUR_MODULE` 是隨業態贈送，不以付費訂閱列判斷。共用型別加在 `src/lib/types.ts`（只新增） |
| GET/POST `/api/block-times`、DELETE `/api/block-times/:id` | CRUD，欄位同表 |
| GET/POST `/api/recurring-bookings`、PUT/DELETE `:id`、POST `:id/renew` | rule jsonb `{weekday(0-6), time'HH:mm', intervalWeeks, until}`；renew=依 rule 產生未來實體 bookings（source='RECURRING'） |
| GET/POST `/api/bookings/:id/addons`、DELETE `/api/bookings/:id/addons/:addonId` | 預約加購明細，見 **§B-1.1** |

### B-1.1 預約加購（`booking_addons`）

> 補寫於 2026-08-25（GitHub issue #17 / 補齊-2）。原站有這個功能——
> `docs/specs/bookings.json` 的 `jsApiCalls` 含 `/api/bookings/${b.id}/addons` 與
> `/api/bookings/${bookingId}/addons/${itemId}`，`docs/REBUILD-SPEC.md:382–396`
> 有加購對話框的 6 個欄位（含 `addonNotify`）——但本冊原本**零記載**，後端也零實作。
>
> ⚠️ **與行程加購（10 分冊 §5 `trip_addons`、Phase 8b）同名，但不是同一個資料模型。**
> CLAUDE.md 明令 `services` 與 `trips` 兩套庫存模型不得合併；LOCAL_SHOP／CLINIC
> 租戶不會開 `TOUR_MODULE`，卻一樣要有預約加購。issue #3 曾把本功能誤標為
> 「Phase 8b 排期」，成因即此同名（記於 14 分冊 §8）。

資料表 `booking_addons`（migration **0020**）：`id, tenant_id, booking_id, service_id?,
name, price(≥0), quantity(≥1), duration_minutes(≥0), staff_id?, `performance_mode`
(`PRIMARY|SPECIFIC_STAFF|NONE`), `performance_staff_id?`, applied_amount, applied_minutes,
notified, created_at`。RLS 四條 `is_tenant_member(tenant_id)`（02 §0006 慣例）。

| 端點 | 要點 |
|---|---|
| GET `/api/bookings/:id/addons` | 回 `BookingAddon[]`（依 `created_at`）。預約不屬於本店 → 404（不回空陣列） |
| POST `/api/bookings/:id/addons` | `{serviceId?, name, price, quantity, durationMinutes=0, staffId?, performanceMode=PRIMARY, performanceStaffId?, notify=false}`。`SPECIFIC_STAFF` 必須帶同租戶人員；`NONE` 明確不計個人業績。回 `{addon, finalPrice, endAt, durationMinutes, notified}` |
| DELETE `/api/bookings/:id/addons/:addonId` | 回 `{finalPrice, endAt, durationMinutes, revertedAmount}` |

**金額與時長**

- 新增：`bookings.final_price += price × quantity`；`duration_minutes += durationMinutes × quantity`
  且 `end_at` 同步往後延。實際加上去的量寫進該列的 `applied_amount` / `applied_minutes`。
- 刪除（**回沖**）：`final_price = max(0, final_price − applied_amount)`，時長同理往回收
  （`end_at` 不得早於 `start_at`）。
- 兩支都用 **compare-and-swap**（條件帶讀到的舊 `final_price` / `end_at`，最多重試 3 次）
  避免併發 lost update，寫法同 `apply-points`。

**「回沖」為什麼是「減去存下來的數字」而不是重算**

`bookings.final_price` 在本專案是**流水餘額**：`adjust-price` 絕對覆寫且不留紀錄、
`apply-coupon` / `apply-points` 都以「目前的 final_price」為基底加減。因此刪除加購時
**無法重算**，只能反向掉當初那一次異動。存 `applied_*` 而不是刪除時重算
`price × quantity`：兩者今天相等，但日後若開放編輯加購或計價規則變動就會分岔。

已知**不精確**的兩種互動（不假裝沒有）：

1. 加購後又套 **PERCENT 票券**：折扣連加購金額一起打了，回沖卻減全額 → 多減。
   例：1000＋加購200＝1200，九折→1080，刪加購→880（精確值 900）。
2. 加購後又**手動調價**：調價是絕對覆寫，回沖等於假設店家輸入的總價含這筆加購全額。

兩者都無法從資料判定，所以**不猜**：刪除確認視窗把「將扣回多少錢」這個確定的數字
直接寫給店家看（CLAUDE.md：不得已的取捨要寫在使用者讀得到的地方）。

**員工業績**

依 Owner 的 C+ 決策：`PRIMARY` 繼承 `bookings.staff_id`、`SPECIFIC_STAFF` 歸指定人員、
`NONE` 只算店家營收；`null` 不可再同時代表繼承與 NONE。`staff_id` 仍只記執行人員。

**`notify`（原站 `addonNotify`「通知顧客消費明細」）**

勾選才送，且**不吃 `tenant_settings.notify` 的任何開關**（這則通知的開關就是勾選框本身，
同 `notifyProductOrderReceipt`）。未綁 LINE **不改寄 Email**——那個勾選框的標籤沒有這句
承諾（商品訂單那個有）。回應與 `booking_addons.notified` 記的都是**實際結果**：

| `notified` | 意義 | HTTP |
|---|---|---|
| `NONE` | 沒有要求通知（或 mock 模式，沒有推播管道） | 200 |
| `LINE` | 已推播，扣 1 則推播額度 | 200 |
| `NO_LINE` | 顧客未綁定 LINE，**零 LINE 請求** | 200 |
| `NOT_CONFIGURED` | 本店尚未設定 LINE Channel，零 LINE 請求 | 200 |
| `QUOTA_EXCEEDED` | 本月推播額度用完，**零 LINE 請求**；**加購仍已寫入且金額已生效** | **409 REQ_003** |
| `FAILED` | LINE 平台回錯，沒送成 | 200 |

409 的 message 必須寫明「加購已新增」，否則店家會以為整筆失敗而重加一次。

**錯誤碼**

| 情況 | HTTP / code |
|---|---|
| `price < 0`、`quantity < 1`、`name` 空、`durationMinutes < 0` | 400 `REQ_001`（**`price = 0` 允許**：贈送／招待的項目要記得下來，只是不加錢） |
| 預約／`serviceId`／`staffId` 查無或屬別店 | 404 `REQ_002` |
| 加購項目查無或不屬於該預約 | 404 `REQ_002` |
| 預約狀態不是 `PENDING`／`CONFIRMED`（已結案） | 409 `REQ_003` |
| 延長後的時段與同一位員工的下一筆預約重疊（DB `23P01`） | 409 `REQ_003`（明細列一併收回） |
| 推播額度用盡 | 409 `REQ_003`（加購仍已寫入，見上表） |

### B-2 服務 / 員工 / 班表

| 端點 | 要點 |
|---|---|
| POST `/api/services`、PUT/DELETE `:id` | CRUD ⚙M；DELETE 有未來預約→改 `active=false` |
| POST `/api/services/:id/duplicate` | 複製一筆，name 加「（複本）」 |
| POST `/api/services/reorder` | `{ids:[]}` 依序寫 sort_order=index |
| POST `/api/services/:id/toggle-line-featured` | 切換 line_featured |
| GET/POST `/api/service-categories`、PUT/DELETE `:id`、reorder | 同模式 |
| POST `/api/staff`、PUT/DELETE `:id` | CRUD ⚙M；body 含 `serviceIds[]` → 先寫 staff 再全刪重插 staff_services |
| GET `/api/staff/bookable` | active且bookable 的精簡清單 |
| GET/POST `/api/staff/:id/leaves`、DELETE | 請假 CRUD |
| GET/POST `/api/shift-templates`、PUT/DELETE `:id` | 班別 CRUD |
| GET `/api/shifts?from&to`、POST（批次 upsert）、POST `/api/shifts/repeat-cycle` | repeat-cycle=`{staffId, weekPattern, from, to}` 展開寫入 |

### B-3 商品 / 訂單 / 庫存

| 端點 | 要點 |
|---|---|
| POST `/api/products`、PUT/DELETE `:id`、reorder、toggle-line-featured | 同 services 模式 ⚙M |
| POST `/api/products/:id/adjust-stock` | `{delta, reason}`：update stock（不可 <0，409）＋寫 inventory_logs |
| GET `/api/inventory/logs` | `?productId?&page&size` 分頁 |
| GET/POST `/api/product-categories`… | 同 service-categories |
| POST `/api/product-orders/manual` | `{customerId, items:[{productId,quantity}]}`：驗庫存→扣庫存＋logs＋建單（單價取當下 price 快照） |
| POST `/api/product-orders/:id/confirm‖complete‖cancel‖mark-paid-offline` | 狀態機同預約；cancel 回補庫存 |
| GET `/api/product-orders/pending/count` | `{count}`（Topbar 徽章） |

### B-4 票券 / 會員 / 點數

| 端點 | 要點 |
|---|---|
| POST `/api/coupons`、PUT/DELETE `:id` | CRUD ⚙M；DELETE 僅 DRAFT 可刪 |
| POST `/api/coupons/:id/publish‖pause‖resume` | DRAFT→PUBLISHED→PAUSED→PUBLISHED；到期由讀取時判定 EXPIRED |
| POST `/api/coupons/:id/batch-issue` | `{customerIds[]}`：每人一張 instance，code=8 碼大寫英數；限量檢查 |
| POST `/api/coupons/redeem-by-code` | `{code}` → redeemed_at=now；已核銷/不存在 → 409/404 |
| GET `/api/coupons/instances?couponId` | 發放明細 |
| POST `/api/coupons/instances/:id/unredeem` | 取消核銷 ⚙M |
| POST `/api/membership-levels`、PUT/DELETE `:id` | CRUD ⚙M；儲存後重算所有顧客等級（依 threshold_spent 由高至低比對 total_spent） |
| GET `/api/points/balance` | `{balance}` = tenant_point_transactions 最新 balance_after（無紀錄=0） |
| GET `/api/points/transactions` | 分頁 `Paged<PointTransaction>` |
| POST `/api/points/transfer` | `{toShopCode, amount}`：兩筆交易（OUT/IN）需在一個 postgres function 內完成（寫 rpc） |
| POST `/api/product-orders/:id/apply-coupon` | **（issue #33 ①，2026-08-26 補列）** 見下方 §B-4.1 |

#### B-4.1 商品訂單套用票券（issue #33 ①，2026-08-26 補列）

原站有 `POST /api/product-orders/${id}/apply-coupon`（`docs/specs/product-orders.json`
的 `jsApiCalls`），04 分冊原本零記載。

**request** `{ code: string }`（非空，否則 400 `REQ_001`）
**response** `{ totalAmount: number, couponDiscount: number }`

`couponDiscount` 的欄位名對齊原站 jsStrings[76]
「票券已套用！折抵 `${formatMoney(couponRes.data?.couponDiscount || 0)}`」——
也就是**折抵金額由後端算並回傳，前端只負責格式化**，不得自行組。

| 情況 | HTTP / code | 訊息 |
|---|---|---|
| 票券代碼不存在（或不屬於本租戶） | 404 `REQ_002` | 找不到此票券 |
| 票券已核銷 | 409 `REQ_003` | 此票券已核銷 |
| 票券已過期（`coupons.end_at` 在過去；null = 不限期） | 409 `REQ_003` | 此票券已過期 |
| 票券不是這張訂單的顧客的 | 409 `REQ_003` | 此票券不屬於該訂單的顧客 |
| 訂單不存在 | 404 `REQ_002` | 找不到此訂單 |
| 訂單已完成／已取消 | 409 `REQ_003` | 此訂單狀態已變更，請重新整理 |
| 未訂閱 PRODUCT_SALES | 403 `FEAT_001` | （同其他商品端點） |

⚠️ 被擋下的票券**不會被核銷**（過期／不是本人／訂單狀態不符都在 update 之前擋）。

##### ⚠️ 適用範圍是**我方選定**的，不是原站考據結果

issue #33 的人工介入點問的是「票券是否適用於商品訂單、有無品類限制」。
**原站對此零字串**：`docs/specs/product-orders.json` 的 jsStrings 只有
「票券已套用！折抵 …」「票券已套用，但「完成訂單」失敗：」「請輸入票券代碼」
三句，沒有任何一句提到限制、品類或不適用；`coupons.json` 的 formModal 也沒有
「適用範圍」欄位。

我方採 issue 的預設值：**與 `/api/bookings/:id/apply-coupon` 完全同一套規則**
——不限品類，只限票券持有人本人。這是**我方選的**，不是考據結果。
規則寫在 `src/server/coupon-redeem.ts` 一處，日後要加品類限制只改那一個檔。

##### 交易邊界：兩段獨立，照原站

原站 jsStrings[77]「票券已套用，但「完成訂單」失敗：」代表原站是
**先套票券、再完成訂單，兩段可以分開失敗**。我方照這個語意做：
本端點**只做套券，不碰訂單狀態**，「完成取貨」仍是
`POST /api/product-orders/:id/complete`。套券成功而完成失敗時，票券**已經核銷掉**
——頁面必須說出這件事（用原站那句），不能只說「操作失敗」。

##### 金額語意

`product_orders` 只有一個金額欄位 `total_amount`（0004:166），沒有 bookings 的
`price`/`final_price` 兩層；列表也只有一個「金額」欄
（`docs/specs/product-orders.json` tables[0].columns）。所以：

- `total_amount` = **應付金額**，套券後直接扣減。
- `coupon_discount`（migration 0027）= 已發生的折抵金額**累計**，一張訂單套多張
  票券就累加。`null` = 沒有折抵紀錄（畫面顯示「無」）。
- `coupon_instance_id`（0027）= 追溯用；原始金額可由 `total_amount + coupon_discount`
  還原，也可從 `product_order_items` 的單價快照重算。

##### 核銷邏輯只有一份

`src/server/coupon-redeem.ts` 是票券核銷的唯一實作，三個呼叫端共用：
`/api/coupons/redeem-by-code`、`/api/bookings/:id/apply-coupon`、
`/api/product-orders/:id/apply-coupon`。本輪之前前兩者各有一份拷貝，補第三支時
就會變三份。

### B-5 行銷 / LINE 內容（依賴 06 分冊的 LINE 模組）

| 端點 | 要點 |
|---|---|
| GET/POST `/api/marketing/pushes`、PUT/DELETE `:id` | 草稿 CRUD |
| POST `/api/marketing/pushes/:id/send` | 立即發送：解析 audience → line_users → multicast（06 分冊 §5）→ 寫 sent_count、扣 push_quota_usage |
| POST `/api/marketing/pushes/:id/cancel` | SCHEDULED→CANCELLED |
| GET/POST `/api/campaigns`、PUT `:id`、publish/pause/resume/end | 狀態機同票券。**`publish` 不只是狀態轉換**：非「自動觸發」的活動會 multicast 給本店 `followed=true` 的 `line_users` 並扣 `push_quota_usage`（14 分冊 §8.6 擁有者裁決），回 `{pushed, sentCount, pushSkipReason?, pushErrorMessage?}` 照實回報這一次有沒有推出去 |
| DELETE `/api/campaigns/:id` | **（2026-08-26 補列；端點與測試早已存在，本表先前漏列）** ⚙M；先查存在且屬於本店，否則 404 `REQ_002`——不可對不存在的 id 靜靜回成功。實作 `src/app/api/campaigns/[id]/route.ts`，測試 `tests/integration/api/campaigns.07.test.ts` |
| GET/POST `/api/settings/line/keyword-replies`、PUT/DELETE `:id` | keyword_replies CRUD |
| GET/POST `/api/portfolios`、PUT/DELETE `:id`、reorder、toggle-* | 同 services 模式 |
| GET `/api/chat/conversations` | line_users 加最後訊息、未讀數。支援 `?since=<ISO>` → 只回該時間後有新訊息的對話（輪詢用，見下方 §B-5.1） |
| GET `/api/chat/messages?lineUserId&page` | 分頁，舊→新。支援 `?after=<messageId>` → 只回該筆之後的新訊息（輪詢用） |
| POST `/api/chat/messages` | `{lineUserId, text}` → LINE **push**（06 分冊）＋寫 OUT 訊息。⚠️ 店家在後台主動回覆時 replyToken 早已失效，只能用 push，**會佔用推播額度** → 送出前先 `consumePushQuota(tenantId, 1)`，額度不足回 409 `REQ_003` 並附文案「本月推播額度已用完」 |
| POST `/api/chat/messages/:id/read` | read_at=now |

### B-5.1 後台聊天的「即時性」（雙向收發完整鏈路）

原站是 SSE；本專案部署在 Vercel serverless，**MVP 一律用輪詢**（實作簡單、
無連線維持問題、低階模型不易做錯）。SSE 屬 Phase 7+ 的優化，非必要。

| 方向 | 鏈路 |
|---|---|
| 顧客 → 店家（收） | LINE → `/api/line/webhook/{shopCode}`（06 分冊）→ 寫 `chat_messages`(IN) → 後台輪詢 `GET /api/chat/messages?after=` 取得新訊息 |
| 店家 → 顧客（回） | 後台 `POST /api/chat/messages` → 扣推播額度 → LINE push API → 寫 `chat_messages`(OUT) |

輪詢規約（寫進 `src/services/chat.ts`，頁面只呼叫 service）：

- 開啟中的對話：每 **5 秒** 帶 `after=<最後一筆 id>` 拉增量。
- 對話列表：每 **15 秒** 帶 `since=<上次拉取時間>` 更新未讀數與最後訊息。
- 分頁隱藏時（`document.hidden`）暫停輪詢，回到前景立刻拉一次。
- 側邊欄「顧客訊息」未讀徽章沿用既有 `MOCK_SIDEBAR_COUNTS` 的來源端點，
  由同一個 15 秒輪詢更新。

**頁面接線（鐵則 1 的核准例外，僅此一頁）**：`/tenant/chat/page.tsx` 目前是
純本地 mock（沒有 service 層、送出只 append 到 local state），Phase 5 實作
B-5 時必須新增 `src/services/chat.ts`（`adapt(mock, real)` 包好四個端點 +
輪詢函式）並把該頁改為呼叫它。版面與文案不動。
| GET `/api/line-users/unbound` | followed=true 且 customer_id is null |
| POST `/api/customers/:id/bind-line` | `{lineUserId}`：寫 customers.line_user_id + line_users.customer_id |
| POST `/api/customers/:id/unbind-line` | 雙向清除 |

### B-6 報表進階 / 匯出 / 雜項

| 端點 | 要點 |
|---|---|
| GET `/api/reports/summary‖daily‖hourly‖top-services‖top-products‖top-staff‖advanced` | `?from&to`；各回聚合陣列，欄位命名照前端 reports 頁的 mock 形狀（實作前先讀該頁 mock） |
| GET `/api/export/customers/excel`、`/api/export/bookings` | 產 CSV（UTF-8 BOM），`Content-Disposition: attachment`。**不走信封**，直接回檔案 |
| GET `/api/export/bookings/:format` | **（issue #33 ③，2026-08-26 補列）** 原站的形狀（`docs/specs/bookings.json` jsApiCalls `/api/export/bookings/${format}`）。`format` 白名單 `csv`\|`excel`，其他值 400 `REQ_001`。**兩個 format 產出的都是 CSV**（本專案沒有裝 xlsx 產生器；把 CSV 命名成 .xlsx 是謊報檔案格式），內容與無 format 段的舊端點**完全相同**——兩支共用 `src/server/export-bookings.ts` 的 `buildBookingsCsv()`，不是兩份實作。檔名由後端決定（前端不得自組），頁面兩個選單項只是各送自己的 format |
| GET `/api/customers/tags` | 該店所有 tags 去重 |
| GET `/api/customers/at-risk` | customers_view at_risk=true |
| POST `/api/feature-store/:code/apply‖cancel‖restore` | 訂閱異動：完整規格（扣點、套裝、還原副作用）在 **09 分冊 §3**，照該冊實作 ⚙O |
| POST `/api/bug-report`、`/api/support-chat/*` | 平台級功能，MVP：寫進一張 `bug_reports` 表＋寄信給平台管理者即可。**（2026-08-24 現況：bug-report 只做了寫表——email 模組缺通用寄信函式，寄信半沒做；support-chat 未實作。見 14 分冊）** |
| GET/POST/DELETE `/api/demo-data` | **（2026-08-24 補記，實作先行）** 依業態鋪/計數/一鍵清空示範資料（名稱前綴 `[示範]` 判定，見 `src/server/demo-seed.ts` 檔頭）；註冊流程自動呼叫 seed |

---

## 錯誤碼總表（前端顯示 message、依 code 分支）

| code | 意義 | HTTP |
|---|---|---|
| AUTH_001 | 未登入 / session 過期 | 401 |
| AUTH_002 | 帳密錯誤 / 目前密碼錯誤 | 401/400 |
| AUTH_003 | Email 已註冊 | 409 |
| AUTH_004 | 驗證碼錯誤或過期 | 400 |
| AUTH_005 | 無權限（非成員/角色不足） | 403 |
| AUTH_006 | shopCode 重複 | 409 |
| REQ_001 | 輸入驗證失敗 | 400 |
| REQ_002 | 資源不存在 | 404 |
| REQ_003 | 狀態衝突 / 時段重疊 / 頻率限制 | 409/429 |
| FEAT_001 | 功能未訂閱 / 免費方案上限 | 403 |
| POINTS_001 | 點數不足 | 409 |
| LINE_001 | LINE 尚未設定 | 400 |
| LINE_002 | LINE API 錯誤 | 502 |
| SYS_001 | 未預期錯誤 | 500 |

---

## 本冊驗收（§A 完成即 Phase 3 過關）

- [ ] `NEXT_PUBLIC_USE_MOCK=false` 後：dashboard、bookings、customers、
      services、staff、products、coupons、membership-levels、settings、
      line-settings、feature-store 各頁載入無紅字、資料來自 DB
- [ ] 預約列表篩選（狀態/關鍵字/員工）與分頁正確
- [ ] settings 儲存後重新整理值仍在；LINE secret 顯示為遮罩
- [ ] 未登入呼叫任一 §A 端點回 401 AUTH_001
- [ ] B 店帳號帶 A 店資源 id 呼叫回 404（跨租戶測試）

---

## §S 全站外框（AppShell）取值 — issue #34（2026-08-26 新增）

外框（側邊欄徽章／開店進度／使用者名稱）先前**沒有任何 USE_MOCK 分支**，
一律吃寫死的 mock 常數。本節記錄它現在取值的來源。

⚠️ **本節沒有新增任何端點**——issue #34 要求「先查證有沒有既有端點可用，有就接」，
查證結果是四項裡有三項已經有端點，第四項的資料表根本還不存在。

| 徽章／值 | service | 端點 | 查證結論 |
|---|---|---|---|
| `pendingBookingBadge` | `services/bookings.ts` `listBookings({status:'PENDING',size:1})` | `GET /api/bookings?status=PENDING&size=1` 的 `totalElements` | **既有端點**。列表端點本來就吃 `status` 篩選並回 `totalElements`（Spring 式信封），`size=1` 只取筆數不搬資料，不需要另開計數 API |
| `pendingOrderBadge` | `services/catalog.ts` `pendingProductOrderCount()` | `GET /api/product-orders/pending/count` | **既有端點，先前是孤兒**（有實作、有整合測試、零呼叫端）。本 issue 是它的第一個呼叫端 |
| `unreadChatBadge` | `services/chat.ts` `unreadChatCount()` | `GET /api/chat/conversations` 的 `unread` 加總 | **既有端點**。該端點已逐對話回 `unread`（`direction='IN'` 且 `read_at is null`），加總即所求；另開 `/api/chat/unread/count` 會變成同一件事寫兩份 |
| `pendingTourOrderBadge` | —— | —— | **沒有資料來源**：`/api/tour-orders/**` 這棵路由樹不存在、`tour_orders` 表也還沒建（Phase 8b／issue #8）。**刻意不給值**——寫 0 會變成「已知為零」 |
| `setupPercent` | `services/settings.ts` `getSetupStatus()` | `GET /api/settings/setup-status` | **既有端點**（本冊 §A-1 已定義，dashboard 頁已在用）。issue #34 內文假設「查證有無既有來源；沒有就補」，實際查證：**已經有**，只是外框沒接 |
| `userName` | `services/auth.ts` `currentUser()` | `GET /api/auth/me` | **既有端點，先前是孤兒**。⚠️ 該端點回的是 `{email, tenantId, tenantName, shopCode, role}`，**沒有姓名欄位**（`auth.users` 也沒存 display name，註冊流程不收），所以 real 模式的顯示名稱就是帳號 email，不從 email 猜一個像人名的字串 |

### 三種狀態的表示法（呼叫端必須分得開）

`sidebarCounts()` 回 `Record<string, number>`：

- **key 有值** → 查到了，`>0` 才畫紅點（`0` 是「沒有待處理」，是一個答案）
- **key 不存在** → 查不到（該徽章沒有來源，或這次查詢失敗）→ 什麼都不畫
- **整個回傳值還沒到** → 呼叫端以 `null` 表示「載入中」→ 畫「查詢中」占位

⚠️ 任一支失敗只讓該 key 缺席（`Promise.allSettled`），不影響其他兩支；
外框不能因為一個徽章查不到就整片壞掉，也不能用 0 頂替。

`setupPercent` 與 `userName` 取不到時一律保持 `null`，畫面顯示「--」並附一句說明
（issue #34 人工介入點的預設值，主導者採用：顯示「--」而非整塊隱藏——
隱藏會讓店家以為功能不見了，而原站有這塊）。

⚠️ 但那個決策的**前提是錯的**：它問的是「`setupPercent` 沒有真實來源時要怎麼顯示」，
而 `GET /api/settings/setup-status` 與 `services/settings.ts` 的 `getSetupStatus()`
**早就存在**（dashboard 頁已在呼叫）。所以「--」不是常態，而是**載入中／取得失敗**
時的樣子；正常情況顯示的是後端算出來的真實百分比。
（15 分冊：裁示的效力來自它背後的事實，事實錯了裁示就不成立——這裡採用了裁示的
結論「顯示 --」，但把它放回它真正適用的狀態。）
