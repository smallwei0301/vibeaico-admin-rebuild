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


#### A-1.2 `POST /api/settings/weekly-business-hours/draft`（逐日營業時間乾跑）

> `src/app/api/settings/weekly-business-hours/draft/route.ts` 與
> `src/server/business-hours-blocks.ts` 的檔頭都指向本節；完整推理寫在後者檔頭，
> 這裡是契約面的摘要。**兩處若有出入，以 `business-hours-blocks.ts` 檔頭為準並回頭修本節。**

**乾跑（dry-run）：一列都不寫。** 真正的寫入走 `PUT /api/settings`（帶 `business` 群組時重建自動封鎖）。

- request：`business` 群組設定（`businessSettingsSchema`），即**尚未存檔**的輸入
- response：`{ perDayMode, autoBlockCount, conflictBookingCount, manualWeeklyBlockCount }`
- 權限：`MANAGER`

⚠️ **「乾跑」是我方選定的語意，不是原站考據結果。** `docs/specs/settings.json` 只給了字串，**沒有給 request/response 形狀**。依據只有兩點：

1. 路徑最後一段是 `draft`
2. jsStrings 有一句「**解析**逐日營業時間失敗:」——「解析」代表它拿還沒存檔的輸入去算東西

**反面證據一併列出**：另外三句文案是過去式／已存檔語氣（「已依你的營業時段自動建立 N 筆」「設定已儲存，但…」「偵測到 N 筆…已保留」），單看那三句會讀成「這一支自己就會寫入」。我方的解讀是那三句在**存檔完成後**才顯示——**這個解讀沒有原站證據**。若日後取得原站實際形狀而與此不符，以原站為準並更新本節。

**自動封鎖的產生／回收規則**（同樣是我方選定，issue #33 要求二選一寫死）：

- 採 **全刪重建**：每次帶 `business` 群組存檔時，先刪掉本租戶所有 `auto=true` 的列，再依當前設定重建。理由是差異更新需要穩定識別鍵，而營業時段本身就是識別鍵的一部分（改時段＝改鍵），差異更新會退化成全刪重建又多一層出錯機會。
- **手動建立的封鎖（`auto=false`）一律不動**——原站文案明講「已保留（不會自動刪除）」。刪除條件永遠帶 `.eq('auto', true)`，這是該模組最重要的一條不變式。
- 產生的列一律 `recurrence='WEEKLY'`、`auto=true`、`staff_id=null`（全店適用）；WEEKLY 採「存規則、查詢時展開」，`start_at`/`end_at` 只存首次發生那天的日期時分。

**頁面顯示規則**：四句既有文案（`src/i18n/zh-TW/pages/settings.ts` 的 `autoBlockCreated`／`conflictWarning`／`conflictWarningHours`／`manualBlockKept`）依上述計數顯示；**計數為 0 時不顯示該句**（不得顯示「0 筆」的警告）。

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
| GET `/api/bookings/available-slots` | `?serviceId&staffId?&date`：讀 business 設定（時段間隔/營業時間/公休）+ 已有 bookings + block_times + shifts → 回 `{slots:[{start,end,staffIds[]}]}` |
| GET `/api/bookings/calendar` | `?from&to`：回該區間全部（不分頁）。**僅服務預約**；行事曆頁請改用下面的統一端點 |
| GET `/api/calendar` | `?from&to`：**行事曆頁唯一資料源**，合併四種事件成一個陣列（展示層合一，資料層仍分開）：`{events: CalendarEvent[]}`，`CalendarEvent` 以 `type` 區辨 —— `BOOKING`（服務預約）／`DEPARTURE`（行程團次，含 `seatsBooked/capacity`）／`BLOCK`（封鎖時段）／`EXTERNAL`（匯入的外部 ICS，唯讀）。`DEPARTURE` 只在租戶有 `TOUR_MODULE` 時出現。共用型別加在 `src/lib/types.ts`（只新增） |
| GET/POST `/api/block-times`、DELETE `/api/block-times/:id` | CRUD，欄位同表 |
| GET/POST `/api/recurring-bookings`、PUT/DELETE `:id`、POST `:id/renew` | rule jsonb `{weekday(0-6), time'HH:mm', intervalWeeks, until}`；renew=依 rule 產生未來實體 bookings（source='RECURRING'） |

### B-2 服務 / 員工 / 班表

| 端點 | 要點 |
|---|---|
| POST `/api/services`、PUT/DELETE `:id` | CRUD ⚙M；DELETE 有未來預約→改 `active=false` |
| POST `/api/services/:id/duplicate` | 複製一筆，name 加「（複本）」 |
| POST `/api/services/reorder` | `{ids:[]}` 依序寫 sort_order=index；若只提交部分 id，伺服器會依目前租戶排序把未提交項目接在後面，保留其相對順序後以完整集合原子重排 |
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
| POST `/api/product-orders/:id/apply-coupon` | `{code}`：**與 `/api/bookings/:id/apply-coupon` 共用同一支 `src/server/coupons.ts` 的 `redeemCoupon()`，不得另寫一份核銷邏輯。** 流程：查 `coupon_instances` 未核銷且屬同租戶 → 檢查有效期（`start_at`／`end_at`）→ `redeemed_at=now` → 依 `discount_type`／`discount_value` 重算並寫回 `product_orders.total_amount`、`coupon_discount`、`coupon_instance_id`（見 migration 0081）。 回傳 `{totalAmount, couponDiscount}`——**折抵後金額與折抵金額都由伺服器算並回傳，前端不得自行計算**（對齊原站 `couponRes.data?.couponDiscount`）。 錯誤：票券代碼不存在 → 404 `REQ_002`；已核銷／已過期／尚未開始／發給別的顧客 → 409 `REQ_003`；跨租戶一律 404（不洩漏他店資料）。**任何錯誤路徑都不得改動訂單金額，也不得消耗票券。** <br><br>**「套用票券成功但『完成訂單』失敗」的交易語意（#33 ①-6）**：本端點與 `POST /api/product-orders/:id/complete` 是**兩個獨立的請求**，不是一個交易。套用成功之後若完成訂單失敗，**票券維持已核銷、訂單金額維持已折抵，兩者都不回滾**；頁面必須如實告知「票券已套用，但完成訂單失敗」，不得顯示成整批失敗，也不得顯示成整批成功。<br>依據是原站證據而非我方選擇：`docs/specs/product-orders.json` 的 jsStrings 同時含有 `票券已套用！折抵 ${formatMoney(couponRes.data?.couponDiscount || 0)}` 與 `票券已套用，但「完成訂單」失敗：` 兩句——後者的存在本身就證明原站允許「票券已套用」與「訂單未完成」並存，且會分別告知。<br>**為什麼不補償性回滾**：核銷是對顧客手上那張券的狀態變更，店員當下已經看到「票券已套用」的提示；自動退回會讓畫面說過的話與資料庫不一致，而店員無從得知。留在已核銷、由店員重試完成訂單（或用 `POST /api/coupons/instances/:id/unredeem` 明確取消核銷），比靜默回滾誠實。 |

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

### B-5 行銷 / LINE 內容（依賴 06 分冊的 LINE 模組）

| 端點 | 要點 |
|---|---|
| GET/POST `/api/marketing/pushes`、PUT/DELETE `:id` | 草稿 CRUD |
| POST `/api/marketing/pushes/:id/send` | 立即發送：解析 audience → line_users → multicast（06 分冊 §5）→ 寫 sent_count、扣 push_quota_usage |
| POST `/api/marketing/pushes/:id/cancel` | SCHEDULED→CANCELLED |
| GET/POST `/api/campaigns`、PUT `:id`、publish/pause/resume/end | API route 已存在；目前沒有 `DELETE :id` route；publish/pause/resume/end 僅更新活動狀態（目前不代表 LINE 推播），頁面接線與刪除仍屬 issue #7，見 14 分冊 §1 A-1 |
| GET/POST `/api/settings/line/keyword-replies`、PUT/DELETE `:id` | `keyword_replies` CRUD。⚠️ **以下 `imageStorageRef` 段落在 `main` 上尚未實作**（2026-09-07 實查：`src/` 內 `imageStorageRef` 零命中；`main` 只收裸 `content.imageUrl`），見 06 分冊 §6.1 的實況對照表。設計原文保留：`IMAGE` 寫入須帶 `content.imageStorageRef={bucket,path,url,previewPath,previewUrl}`；伺服器固定只收 `keyword-reply-images`、驗證 `{tenantId}/{uuid}.{ext}` 路徑、可信 Supabase HTTPS public URL，以及原圖／preview 兩個物件確實存在，不能只信前端送來的 URL。GET 對新版 ref 重驗物件；既有只有 `imageUrl` 的 legacy row 保留唯讀／停用相容，下次換圖才升級，不做猜測式 backfill |
| DELETE `/api/settings/line/keyword-replies/image` | ⚠️ **這支路由在 `main` 上不存在**（2026-09-07 實查），`keyword_reply_image_cleanup` 表亦零命中。設計原文保留，見 06 分冊 §6.1。原文：取消尚未儲存的選圖。只接受本租戶且 URL/path/bucket 一致的完整 storage ref；若仍被任一 keyword reply 引用則不刪。替換／移除／刪除 reply 亦採「DB 先解除引用，再刪原圖＋preview」；Storage 暫時失敗寫入 `keyword_reply_image_cleanup`，由受 `CRON_SECRET` 保護的每日工作重試，重試前再次確認沒有活引用 |
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
| GET `/api/customers/tags` | 該店所有 tags 去重 |
| GET `/api/customers/at-risk` | customers_view at_risk=true |
| POST `/api/feature-store/:code/apply‖cancel‖restore` | 訂閱異動：完整規格（扣點、套裝、還原副作用）在 **09 分冊 §3**，照該冊實作 ⚙O |
| POST `/api/bug-report`、`/api/support-chat/*` | 平台級功能，MVP：寫進一張 `bug_reports` 表＋寄信給平台管理者即可 |

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
