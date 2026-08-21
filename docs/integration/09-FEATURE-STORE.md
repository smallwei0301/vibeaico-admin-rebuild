# 09 — 功能商店與訂閱制（Phase 5.5）

> 目標：讓 `/tenant/feature-store` 頁的 22 項功能、套裝方案、點數扣款、
> 取消/恢復、到期副作用全部真實運作。本冊依賴 Phase 1–3 與 B-4 的點數錢包。
>
> 功能目錄的唯一事實來源是前端 `src/app/tenant/feature-store/page.tsx` 的
> `FEATURE_CATALOG`（22 項）與 `src/i18n/zh-TW/pages/feature-store.ts` 的文案。
> **後端不得發明新的功能碼**；價格若要調整，前端 catalog 與本冊 §1 要一起改。

---

## 1. 功能目錄（22 項）

| code | 分類 | 點/月 | 付費 | 後端落點（實作所在分冊） |
|---|---|---|---|---|
| ONLINE_BOOKING | 預約 | 0 | 免費 | 04 §A-2/B-1（預約 API 本體） |
| SERVICE_CATALOG | 預約 | 0 | 免費 | 04 §A-4/B-2 |
| CUSTOMER_BASIC | 顧客 | 0 | 免費 | 04 §A-3 |
| STAFF_BASIC | 系統 | 0 | 免費 | 04 §B-2（**上限 3 位**，見 §5） |
| UNLIMITED_STAFF | 系統 | 49 | ✔ | §5 閘門：解除 3 位上限 |
| SHIFT_MANAGEMENT | 系統 | 49 | ✔ | 04 §B-2 shifts/leaves + §5 閘門 |
| BOOKING_REMINDER | 預約 | 49 | ✔ | 07 cron booking-reminders + §5 閘門 |
| BIRTHDAY_GREETING | 行銷 | 49 | ✔ | 07 cron birthday-greetings + §5 閘門 |
| CUSTOMER_RECALL | 行銷 | 49 | ✔ | 07 cron customer-recall + §5 閘門 |
| POINT_SYSTEM | 顧客 | 49 | ✔ | 04 §A-2 complete 累點邏輯 + §5 閘門 |
| ADVANCED_CUSTOMER | 顧客 | 49 | ✔ | 04 §A-3 篩選/§B-6 tags、匯出 + §5 閘門 |
| EMAIL_NOTIFICATION | 系統 | 49 | ✔ | 05 通知信 + §5 閘門 |
| BASIC_REPORT | 系統 | 99 | ✔ | 04 §A-5/§B-6 + §5 閘門 |
| MEMBERSHIP_SYSTEM | 顧客 | 49 | ✔ | 04 §B-4 + §5 閘門 |
| COUPON_SYSTEM | 行銷 | 49 | ✔ | 04 §B-4 + §6 到期副作用 |
| PRODUCT_SALES | 商品 | 99 | ✔ | 04 §B-3 + §6 到期副作用 |
| INVENTORY | 商品 | 49 | ✔ | 04 §B-3 inventory_logs + §5 閘門 |
| KEYWORD_REPLY | LINE | 49 | ✔ | 06 webhook +「**每店最多 20 組**」限制（§5） |
| AI_ASSISTANT | LINE | 249 | ✔ | §7（Claude API 自動回覆）|
| PORTFOLIO_SHOWCASE | 商品 | 49 | ✔ | 04 §B-5 portfolios + §5 閘門 |
| CUSTOM_RICH_MENU | LINE | 149 | ✔ | 06 §6 進階選單 + §5 閘門 |
| EXTRA_PUSH | LINE | 249 | ✔ | §5：推播額度 200 → **700**/月 |

套裝方案（原站文案）：

| key | 價格 | 內容 |
|---|---|---|
| LITE 輕量版 | 399 點/月 | UNLIMITED_STAFF、BOOKING_REMINDER、BASIC_REPORT、POINT_SYSTEM、MEMBERSHIP_SYSTEM |
| PRO 專業版 | 799 點/月 | 全部 18 項付費功能 |

規則（照原站文案，UI 已寫死）：LITE 可隨時升級 PRO，**剩餘天數不退點**；
方案與單買並存，各自計到期日；取消方案不影響單買。

> 注意：`src/config/features.ts` 的 `FEATURE_CODES`（10 個）只是**側邊欄閘門用的子集**，
> 不是完整目錄。實作本冊時在該檔新增一個 `FEATURE_CATALOG` 常數
> （22 項：key/category/price/paid，內容同上表），並把 `page.tsx` 內的本地
> `FEATURE_CATALOG` 改為 import 這個常數 —— 這是鐵則 1 的核准例外（只搬常數，不動 UI）。

---

## 2. 資料表擴充（migration `0011_feature_store.sql`）

```sql
-- 訂閱列擴充：取消/來源/起訖
alter table feature_subscriptions
  add column if not exists started_at   timestamptz not null default now(),
  add column if not exists cancelled_at timestamptz,
  add column if not exists source       text not null default 'INDIVIDUAL';
    -- 'INDIVIDUAL' | 'BUNDLE_LITE' | 'BUNDLE_PRO' | 'GRANTED'（平台贈送）

-- 到期副作用還原用的旗標（§6）
alter table coupons  add column if not exists auto_paused_by_feature boolean not null default false;
alter table products add column if not exists auto_paused_by_feature boolean not null default false;

-- 原子扣點 + 開通（防止「扣了點但沒開通」或並發重複扣點）
create or replace function subscribe_feature(
  p_tenant uuid, p_code text, p_months int, p_price int, p_source text
) returns void as $$
declare v_balance int;
        v_cost int := p_price * p_months;
        v_base timestamptz;
begin
  select coalesce((select balance_after from tenant_point_transactions
                   where tenant_id = p_tenant order by created_at desc limit 1), 0)
    into v_balance;
  if v_balance < v_cost then
    raise exception 'INSUFFICIENT_POINTS' using errcode = 'P0001';
  end if;
  insert into tenant_point_transactions (tenant_id, type, amount, balance_after, description)
  values (p_tenant, 'CONSUME', -v_cost, v_balance - v_cost, '訂閱功能：' || p_code || ' × ' || p_months || ' 個月');

  -- 到期日：尚未到期者從原到期日累加（續訂）；否則從現在起算
  select greatest(coalesce((select expires_at from feature_subscriptions
                            where tenant_id = p_tenant and code = p_code), now()), now())
    into v_base;
  insert into feature_subscriptions (tenant_id, code, active, expires_at, source, started_at, cancelled_at)
  values (p_tenant, p_code, true, v_base + make_interval(months => p_months), p_source, now(), null)
  on conflict (tenant_id, code) do update
    set active = true, cancelled_at = null, source = excluded.source,
        expires_at = greatest(coalesce(feature_subscriptions.expires_at, now()), now())
                     + make_interval(months => p_months);
end;
$$ language plpgsql security definer set search_path = public;
revoke execute on function subscribe_feature from anon, authenticated;  -- 僅 service role
```

**有效性判定（全後端統一用這條規則）**：

```
featureActive(code) =
  存在訂閱列 且 active
  且 (expires_at is null 或 expires_at > now())
```

`cancelled_at` 不影響到期前可用（原站「已取消（到期前可用）」）；它只代表
不再續訂 + UI 顯示狀態。`source='GRANTED'` 且 `expires_at null` = 平台永久贈送。

---

## 3. 訂閱端點（取代 04 分冊 B-6 的三行簡述）

全部 ⚙OWNER。`:code` = §1 的功能碼；bundle 用 `LITE`/`PRO`。

| 端點 | body | 行為 |
|---|---|---|
| GET `/api/feature-store` | – | 回全部訂閱列（含免費功能不入庫，前端 catalog 自行判定）。回傳型別擴充：`FeatureSubscription` **新增選填欄位** `startedAt?`、`cancelledAt?`、`source?`（types.ts 只增不改，鐵則 3） |
| POST `/api/feature-store/:code/apply` | `{months: 1\|3\|6\|12}` | 驗 code 在 §1 付費清單 → `rpc('subscribe_feature', {price: 目錄價, source:'INDIVIDUAL'})`。收到 `INSUFFICIENT_POINTS` → 409、code `POINTS_001`、message「點數不足」（前端會開儲值 modal）。EXTRA_PUSH 加購前的「LINE 方案提醒」是純前端 modal，後端不管 |
| POST `/api/feature-store/:code/cancel` | – | `cancelled_at = now()`。**不退點、不縮短到期日**（原站規則） |
| POST `/api/feature-store/:code/restore` | – | 未過期且 cancelled → `cancelled_at = null`，不扣點；已過期 → 409 請重新訂閱。恢復 COUPON_SYSTEM / PRODUCT_SALES 時執行 §6 的還原，回 `{restoredCoupons, restoredProducts}`（前端顯示「N 張票券已自動恢復發布」） |
| POST `/api/feature-store/bundle/:key/apply` | `{months}` | 一個迴圈對 bundle 內每個 code 各 upsert 一列（source=`BUNDLE_LITE/PRO`），**扣點只扣一次 bundle 價**：先手動檢查餘額、寫一筆 CONSUME（描述「訂閱套裝：LITE × N 月」），再逐碼 upsert（此段包在一個自訂 rpc `subscribe_bundle` 裡，寫法比照 `subscribe_feature`）。LITE→PRO 升級：對 LITE 各碼 `cancelled_at=now()` 後照常訂 PRO |
| POST `/api/feature-store/bundle/:key/cancel` | – | 該 source 的所有列 `cancelled_at = now()` |

---

## 4. 點數儲值（`/api/points/topup/pay`）

真金流（1 點 = NT$1）。分兩階段：

- **MVP（先做這個）**：不接金流。平台管理者收到轉帳後用 service role 腳本入點：
  `insert into tenant_point_transactions (tenant_id,type,amount,balance_after,description)
   values (:t,'TOPUP',:n,:balance+n,'銀行轉帳儲值')`。
  `/tenant/points` 頁的儲值按鈕顯示轉帳資訊（聯絡平台），端點回 501 + message
  「請聯絡平台客服儲值」。
- **正式（Phase 7+ 選配）**：接台灣金流（建議綠界 ECPay 或藍新，皆有信用卡+ATM）：
  `POST /api/points/topup/pay {amount}` → 建 `topup_orders` 表（pending）→ 回金流
  跳轉參數 → 金流 server callback `/api/payments/ecpay/callback` 驗證 CheckMacValue
  → 寫 TOPUP 交易。需要新 env：`ECPAY_MERCHANT_ID / ECPAY_HASH_KEY / ECPAY_HASH_IV`。
  **實作前先跟平台擁有者確認選哪家金流**，這是本規劃唯一留白的商業決策。

---

## 5. 功能閘門（gating）— `src/server/features.ts`

```ts
import { createAdminSupabase } from './supabase';
import { ApiHttpError, ERR } from './http';

export async function isFeatureActive(tenantId: string, code: string): Promise<boolean> {
  const admin = createAdminSupabase();
  const { data } = await admin.from('feature_subscriptions')
    .select('active, expires_at').eq('tenant_id', tenantId).eq('code', code).maybeSingle();
  if (!data?.active) return false;
  return !data.expires_at || new Date(data.expires_at) > new Date();
}

export async function requireFeature(tenantId: string, code: string) {
  if (!(await isFeatureActive(tenantId, code)))
    throw new ApiHttpError(403, '此功能尚未訂閱，請至功能商店開通', ERR.FEATURE_LOCKED);
}
```

錯誤碼新增（併入 04 分冊錯誤碼總表）：`POINTS_001` 點數不足（409）。

**閘門對應表**（在對應端點開頭呼叫 `requireFeature`；cron 內改用 `isFeatureActive` 過濾店家）：

| 功能碼 | 擋哪裡 |
|---|---|
| UNLIMITED_STAFF | `POST /api/staff`：未訂閱且該店 active 員工已達 **3 位** → 403 FEAT_001，message「免費方案最多 3 位員工」 |
| SHIFT_MANAGEMENT | `/api/shifts*`、`/api/shift-templates*`、`/api/staff/:id/leaves*` 全部 |
| BOOKING_REMINDER | cron booking-reminders 逐店過濾 |
| BIRTHDAY_GREETING | cron birthday-greetings 逐店過濾 |
| CUSTOMER_RECALL | cron customer-recall 逐店過濾 |
| POINT_SYSTEM | complete 端點的累點段、`apply-points` 折抵端點 |
| ADVANCED_CUSTOMER | `/api/customers/tags`、匯出 Excel、`minSpent/maxSpent/minVisits/tag` 篩選參數（未訂閱時忽略這些參數即可，不用整條擋） |
| EMAIL_NOTIFICATION | 05 分冊的預約/訂單通知信（驗證碼信與密碼重設**不受此限**） |
| BASIC_REPORT | `/api/reports/*` 除 dashboard 與 dashboard-alerts 外全部 |
| MEMBERSHIP_SYSTEM | `/api/membership-levels` 寫入端點 |
| COUPON_SYSTEM | `/api/coupons*` 寫入端點 |
| PRODUCT_SALES | `/api/products*`、`/api/product-orders*` 寫入端點 |
| INVENTORY | `/api/products/:id/adjust-stock`、`/api/inventory/logs` |
| KEYWORD_REPLY | `/api/settings/line/keyword-replies` 寫入端點；另 POST 時檢查該店筆數 ≥ **20** → 409「每店最多 20 組」 |
| AI_ASSISTANT | webhook 內 AI 回覆分支（§7） |
| PORTFOLIO_SHOWCASE | `/api/portfolios*` 寫入端點 |
| CUSTOM_RICH_MENU | 06 §6 的進階選單端點（create-advanced/create-custom 等）；基本 5 主題不擋 |
| EXTRA_PUSH | 06 分冊 `consumePushQuota` 的 `quota` 改為：`isFeatureActive(t,'EXTRA_PUSH') ? 700 : 200`（這就是 06 留的 TODO） |

側邊欄的導購（未訂閱點進去導向 feature-store）前端已實作，後端閘門是第二道防線。

---

## 6. 到期副作用與自動還原

### cron `/api/cron/feature-expiry`（每日執行，併入 07 分冊 crons）

逐店處理「昨天以前到期」的訂閱：

1. `COUPON_SYSTEM` 到期 → 該店 `status='PUBLISHED'` 的票券改 `PAUSED` 且
   `auto_paused_by_feature=true`。
2. `PRODUCT_SALES` 到期 → 該店 `active=true` 的商品改 `active=false` 且
   `auto_paused_by_feature=true`。
3. 其他功能到期不動資料（原站原則：**資料保留、對外功能暫停**），閘門自然失效。

### 還原（restore / 重新 apply 成功後）

- `COUPON_SYSTEM`：`auto_paused_by_feature=true` 的票券改回 `PUBLISHED`、旗標歸 false，
  回傳筆數（前端 toast「N 張票券已自動恢復發布」）。
- `PRODUCT_SALES`：同理改回 `active=true`（「N 項商品已自動重新上架」）。
- 還原失敗不可讓訂閱失敗：catch 後回 `{restoreSideEffectFailed: true}`，
  前端已有對應警示文案。

---

## 7. AI 客服（AI_ASSISTANT）— Claude API

平台層新 env（加入 01 分冊 §3 與 `.env.example`）：

| 變數 | 說明 |
|---|---|
| `ANTHROPIC_API_KEY` | 平台一把 key，所有店共用；成本屬平台（249 點/月訂閱費涵蓋） |

安裝（此功能實作時才裝）：`npm install @anthropic-ai/sdk`

### 7.1 設定儲存（`/tenant/ai-settings` 頁）

`tenant_settings` 加一個 jsonb 欄位 `ai`（migration 0011 一併加）：

```sql
alter table tenant_settings add column if not exists ai jsonb not null default '{}';
-- 結構：{ enabled: boolean, personaNotes: string, faq: [{q,a}], handoffMessage: string }
```

端點：`GET/PUT /api/ai-settings`（讀寫該 jsonb，寫入 ⚙MANAGER + requireFeature）。

### 7.2 Webhook 整合（`src/server/ai-reply.ts`）

插入 06 分冊 message 事件處理順序的第 ④ 步之前：
關鍵字、活動都沒命中，且 `AI_ASSISTANT` 有效且 `ai.enabled` → AI 回覆；
AI 失敗或判定無法回答 → 落回原本的 `defaultReply` / 引導人工。

```ts
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic();   // 讀 ANTHROPIC_API_KEY

export async function aiReply(
  question: string,
  shop: { name: string; description: string; services: string[];
          businessHours: string; ai: { personaNotes?: string; faq?: {q: string; a: string}[] } },
): Promise<string | null> {
  const faq = (shop.ai.faq ?? []).map((f) => `Q: ${f.q}\nA: ${f.a}`).join('\n\n');
  const response = await anthropic.messages.create({
    model: 'claude-opus-5',
    max_tokens: 1024,
    system: [
      `你是「${shop.name}」的 LINE 客服助理，用繁體中文、口語、簡短（100 字內）回覆顧客。`,
      `店家介紹：${shop.description}`,
      `服務項目：${shop.services.join('、')}`,
      `營業時間：${shop.businessHours}`,
      shop.ai.personaNotes ?? '',
      faq ? `常見問答：\n${faq}` : '',
      '規則：只回答與本店相關的問題；不確定或涉及改期/退費/客訴時，回覆「UNSURE」讓真人接手；不要編造價格或優惠。',
    ].filter(Boolean).join('\n\n'),
    messages: [{ role: 'user', content: question }],
  });
  const text = response.content.find((b) => b.type === 'text')?.text?.trim() ?? '';
  if (!text || text.includes('UNSURE')) return null;   // null = 交給 defaultReply/人工
  return text;
}
```

規約：AI 回覆走 **reply**（不佔推播額度）；單次失敗 catch 後回 null 不重試；
把 AI 回覆同樣寫入 `chat_messages`（direction='OUT'，message_type='ai'）。

---

## 本冊驗收

- [ ] migration 0011 執行成功；`FEATURE_CATALOG` 移入 `src/config/features.ts`
- [ ] 訂閱：餘額足 → 扣點、開通、到期日正確；餘額不足 → 409 `POINTS_001`，
      前端跳出既有的「點數不足」modal
- [ ] 續訂從原到期日累加；取消後到期前功能仍可用；restore 不重複扣點
- [ ] 套裝 LITE 一次開通 5 項只扣 399×月數；LITE→PRO 升級後 LITE 各碼顯示已取消
- [ ] 閘門抽測：未訂閱 SHIFT_MANAGEMENT 打 `/api/shifts` 回 403 FEAT_001；
      第 4 位員工被擋；第 21 組關鍵字被擋；EXTRA_PUSH 訂閱後額度變 700
- [ ] cron feature-expiry：手動把某店 COUPON_SYSTEM 到期日改昨天 → 跑 cron →
      票券變 PAUSED；restore 後自動恢復 PUBLISHED 並回報筆數
- [ ] AI 客服：開啟後在 LINE 問「你們營業到幾點」收到合理回覆；問客訴類問題
      收到 defaultReply / 人工引導；關閉訂閱後不再觸發
