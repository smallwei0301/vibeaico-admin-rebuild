# 06 — LINE 官方帳號連動（Phase 6）

> 多租戶 LINE Messaging API：**每家店自己的 Channel token**（存 DB、加密），
> 一個部署服務所有店。平台不需要任何 LINE env 變數（LINE_LOGIN_* 是另一回事，
> 只給 03 分冊 §7 的 OAuth 登入用）。

---

## 1. 兩套 Channel，不要搞混

| | 誰的 | 用途 | 憑證放哪 |
|---|---|---|---|
| Messaging API channel | **每家店自己** | Bot 收發訊息、推播、Rich Menu | `tenant_settings.line_*_enc`（加密） |
| LINE Login channel | 平台一個 | 店家用 LINE 帳號登入後台 | `.env` `LINE_LOGIN_*` |

店家操作流程（後台 line-settings 頁已有教學 UI）：
LINE Developers → 建 Messaging API channel → 把 Channel ID / Secret / Access Token
貼進 `/tenant/line-settings` → 系統顯示該店專屬 Webhook URL
`{APP_URL}/api/line/webhook/{shopCode}` → 店家貼回 LINE console 並啟用 webhook、
關閉「自動回應訊息」。

---

## 2. `src/server/line.ts` — LINE API 客戶端

不裝 SDK，直接 fetch（端點少、避免依賴膨脹）。

```ts
import { createAdminSupabase } from './supabase';
import { decryptSecret } from './crypto';
import { ApiHttpError, ERR } from './http';

const API = 'https://api.line.me';

/** 讀出該店解密後的 LINE 憑證；未設定 → 丟 LINE_001 */
export async function getLineCredentials(tenantId: string) {
  const admin = createAdminSupabase();
  const { data } = await admin.from('tenant_settings')
    .select('line, line_channel_secret_enc, line_channel_access_token_enc')
    .eq('tenant_id', tenantId).single();
  const token = decryptSecret(data?.line_channel_access_token_enc ?? '');
  const secret = decryptSecret(data?.line_channel_secret_enc ?? '');
  if (!token) throw new ApiHttpError(400, '尚未設定 LINE Channel', ERR.LINE_NOT_CONFIGURED);
  return { token, secret, lineConfig: (data!.line ?? {}) as Record<string, any> };
}

async function lineFetch(token: string, path: string, init?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`,
               'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    console.error('[line]', path, res.status, body);
    throw new ApiHttpError(502, `LINE API 錯誤（${res.status}）`, ERR.LINE_API_ERROR);
  }
  return res.status === 200 ? res.json().catch(() => ({})) : {};
}

export const lineReply = (token: string, replyToken: string, messages: any[]) =>
  lineFetch(token, '/v2/bot/message/reply', {
    method: 'POST', body: JSON.stringify({ replyToken, messages }) });

export const linePush = (token: string, to: string, messages: any[]) =>
  lineFetch(token, '/v2/bot/message/push', {
    method: 'POST', body: JSON.stringify({ to, messages }) });

export const lineMulticast = (token: string, to: string[], messages: any[]) =>
  lineFetch(token, '/v2/bot/message/multicast', {
    method: 'POST', body: JSON.stringify({ to, messages }) });

export const lineBotInfo = (token: string) => lineFetch(token, '/v2/bot/info');
export const lineProfile = (token: string, userId: string) =>
  lineFetch(token, `/v2/bot/profile/${userId}`);
```

### 額度控管（免費 200 則/月，`LINE_FREE_PUSH_QUOTA`）

`push`/`multicast` 前先過：

```ts
export async function consumePushQuota(tenantId: string, count: number): Promise<boolean> {
  const admin = createAdminSupabase();
  const month = new Date().toISOString().slice(0, 7);          // 'YYYY-MM'
  const { data } = await admin.from('push_quota_usage').select('used')
    .eq('tenant_id', tenantId).eq('month', month).maybeSingle();
  const used = data?.used ?? 0;
  const quota = (await isFeatureActive(tenantId, 'EXTRA_PUSH')) ? 700 : 200;  // 09 分冊 §5
  if (used + count > quota) return false;
  await admin.from('push_quota_usage')
    .upsert({ tenant_id: tenantId, month, used: used + count });
  return true;
}
```

**reply 不佔額度**（LINE 規則），webhook 內能用 reply 就用 reply。

---

## 3. Webhook — `src/app/api/line/webhook/[shopCode]/route.ts`

要點：
- `export const runtime = 'nodejs'`（需要 crypto）。
- **不走 requireTenant**（LINE 打進來沒有 session）→ 用 shopCode 查店、service role 存取。
- **簽章驗證失敗回 401 就結束**；合法 HMAC 但 malformed JSON 回 `400 invalid JSON`；
  合法 JSON 驗證通過後事件處理錯誤只 log 並回 `200`，否則 LINE 會不斷重送。

以下是原始 webhook 契約的簡化示意；事件後處理與 malformed JSON branch 見 §3.1。

```ts
import { createHmac, timingSafeEqual } from 'crypto';
import { createAdminSupabase } from '@/server/supabase';
import { getLineCredentials, lineReply, lineProfile } from '@/server/line';

export const runtime = 'nodejs';

export async function POST(req: Request, { params }: { params: Promise<{ shopCode: string }> }) {
  const { shopCode } = await params;
  const admin = createAdminSupabase();
  const { data: tenant } = await admin.from('tenants')
    .select('id').eq('shop_code', shopCode).maybeSingle();
  if (!tenant) return new Response('unknown shop', { status: 404 });

  const raw = await req.text();                     // 簽章要用原始 body
  const { token, secret, lineConfig } = await getLineCredentials(tenant.id);
  const expect = createHmac('sha256', secret).update(raw).digest('base64');
  const got = req.headers.get('x-line-signature') ?? '';
  if (!got || !timingSafeEqual(Buffer.from(expect), Buffer.from(got)))
    return new Response('bad signature', { status: 401 });

  let events;
  try {
    events = JSON.parse(raw).events;
  } catch (e) {
    console.error('[line-webhook]', shopCode, 'parse', e);
    return new Response('invalid JSON', { status: 400 });
  }
  for (const ev of events ?? []) {
    try { await handleEvent(admin, tenant.id, token, lineConfig, ev); }
    catch (e) { console.error('[line-webhook]', shopCode, ev.type, e); }
  }
  return new Response('ok');
}
```

### 3.1 驗簽後立即回應、事件交給 `after()`（issue #31）

current-main 的 webhook 實作保留 §3 的驗簽順序，並把事件處理移到回應之後。這裡的
保證是**驗簽在排程之前**，不是宣稱驗簽前完全不會讀 tenant 或 credentials：目前
route 仍依既有 contract 先用 `shopCode` 查 tenant、取 LINE credentials 並讀 raw body，
這些 lookup 仍在 HMAC 驗證之前。

- route 先讀取 raw body、查好的 tenant／LINE credentials；HMAC 驗證失敗仍直接回 `401`，
  在驗簽前或驗簽失敗時不會排入背景工作。
- HMAC 驗證成功後若 raw body 不是合法 JSON，會寫 `[line-webhook]` parse error、回
  `400 invalid JSON`，也不會排入背景工作。這個錯誤不適用「處理錯誤仍 200」的 webhook
  事件處理契約，因為事件尚未成功解析。
- 驗簽成功後先註冊 `after()` 工作，再回 `200`。callback 只使用已取出的
  `admin`、`tenant`、`token`、`lineConfig` 與 `events`，不讀取已結束的 `Request`。
- `handleEvent` 在 `after()` 內動態載入，因此 AI 客服分派仍保留，只是不再在 webhook
  acknowledgement 前載入整個事件模組。每個事件的錯誤與 callback 外層例外都會寫入
  `[line-webhook]` log；HTTP 回應仍維持 `200`。

route 同檔的 `GET` 不是 production observability API，而是明確受限的 local/CI
test/dev drain seam：只有 `NODE_ENV !== production`、`LINE_WEBHOOK_DRAIN_ENABLED=true`
且 request 帶 `x-line-webhook-test-drain: 1` 時才啟用，否則（含 production）回 `405`。
它只在該 test server process 記憶體保存 per-shop 狀態，pending work 最多 100 筆／shop、
最多 32 個 shop state，錯誤摘要每 shop 最多 20 筆；pending 完成後會移除。回傳
`{ drained, scheduled, errors }` 的 `scheduled` 是該 shop 在此 process 的累計排入數，
`errors` 只是非 production 測試摘要，且不會跨 tenant 回傳。沒有 Preview 或 production
排空／觀測入口的證據或承諾。

對應測試證據：

- `tests/integration/api/line-webhook.06.test.ts`：壞簽章 `401` 且 `scheduled` 不變；
  合法 HMAC 但 malformed JSON 回 `400`、有 parse log 且 `scheduled` 不變；
  mock LINE 回應被 `holdNext()` 扣住時，webhook 仍先回 `200`，release 後由
  `drainWebhook()` 確認事件完成；LINE API 失敗時 HTTP 仍為 `200` 且 drain 結果含錯誤。
- `tests/helpers/line-webhook.ts` 只帶 test drain header；`tests/integration/global-setup.ts`
  只在 spawned integration `next dev` 明確設定 `LINE_WEBHOOK_DRAIN_ENABLED=true`。
- `tests/integration/api/chat-link.06.test.ts`：需要讀取 webhook 副作用的既有案例先使用
  同一個 drain 訊號，再檢查資料與 mock 請求。

上述只證明「事件處理不阻塞 webhook acknowledgement」及其保留的副作用；本節沒有
真實 LINE cold-start、真實 AI provider latency 或 authenticated Preview 證據。那些仍須
外部／Owner gate，不能由 local mock 或此測試替代。

### `handleEvent` 分派（同檔或 `src/server/line-events.ts`）

| event.type | 處理 |
|---|---|
| `follow` | `lineProfile()` 取暱稱頭像 → upsert `line_users`（followed=true）→ 回覆歡迎訊息（`notify.welcomeMessageText`，空則略過）。若 `privacy.deferProfileCollectionEnabled=false` → 追加個資收集引導（`profileCollectIntroText`） |
| `unfollow` | `line_users.followed = false` |
| `message`(text) | 依序嘗試，命中即回覆並停止：① 進行中的下單對話（`chat_sessions` 有 step → 交給 10 分冊 §6.2 流程）② `keyword_replies`（active，keywords 完全比對）③ `campaigns`（PUBLISHED 且 keyword 相符，`lineConfig.campaignKeywordEnabled`）④ 內建指令：「預約」→ 服務/行程目錄（10 分冊 §6.1）、「行程」→ 行程輪播、「服務」→ 服務輪播、「我的預約」→ 合併 bookings + tour_orders ⑤ AI 客服（09 §7，訂閱且啟用時）⑥ `lineConfig.autoReplyEnabled` → `defaultReply` ⑦ 都沒有→不回。無論是否回覆，都寫入 `chat_messages`（direction='IN'） |
| `message`(image/sticker…) | 只寫 `chat_messages` |
| `postback` | 保留：`data` 格式 `action=xxx&…`，MVP 先 log |

---

## 4. 顧客綁定

把 `line_users` 連到 `customers`（讓預約通知推得到人）：

1. 後台手動：B-5 的 `bind-line`/`unbind-line` 端點（已規格化）。
2. 自動：LINE 端個資收集流程收到手機號 → 比對 `customers.phone` 相同者自動綁定；
   無則建新顧客（name=LINE 暱稱）並綁定。
3. `chat` 頁的「未綁定」清單來源：`GET /api/line-users/unbound`。

---

## 5. 事件推播 — `src/server/line-notify.ts`

預約狀態變更時呼叫（04 分冊 A-2 註明的 hook 點）：

```ts
export async function notifyBookingStatus(
  tenantId: string,
  bookingId: string,
  kind: 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'MODIFIED' | 'NO_SHOW' | 'REMINDER',
) { /* 流程：
  1. admin 讀 bookings_view 該筆 + customers.line_user_id；未綁定 → return
  2. 讀 notify 設定，對應開關（notifyBookingConfirmed 等）關閉 → return
  3. consumePushQuota(tenantId, 1) 失敗 → log 後 return（絕不丟錯）
  4. linePush(token, lineUserId, [textMessage])，文案含店名/服務/時間
*/ }
```

呼叫規約：動作端點內 `void notifyBookingStatus(...)`，不 await、不影響 API 結果。

---

## 5.5 老闆通知 owner-notify（Issue #18）

推的對象是**店家團隊**（老闆／主管），不是顧客——與上面 §5 的顧客端推播是
兩條不同通道，共用同一份每月推播額度（`push_quota_usage`），但名單、觸發
事件、文案都不同，不得合併成同一支函式。

**Canonical flow（不得走回頭路的舊 bind-code 模式）**：

```
已加入 LINE 好友 → 後台從 line_users 挑人 → 本人在 LINE 上按確認「是我」
→ 加入 owner-notify recipients
```

### 資料模型（migration `0116_issue_18_owner_notify.sql`）

- `owner_notify_bind_requests`：「已推出確認訊息、等待本人按確認」的暫存態。
  `status` ∈ PENDING/CONFIRMED/EXPIRED/CANCELLED，24 小時過期，同一位好友同時
  只能有一筆 PENDING（DB 部分唯一索引）。
- `owner_notify_recipients`：正式名單。`is_primary`（DB 部分唯一索引保證單一
  租戶最多一位）、`notify_new_booking`、`notify_cancel` 兩個獨立開關。
  FK 到 `line_users(tenant_id, line_user_id) on delete cascade`——好友被刪
  （unfollow 清理）時一併移除通知名單資格。
- 兩表 RLS 皆 `is_tenant_member(tenant_id)`，四操作全開放（比照 0066 trips
  系列 all policy）。

### 上限與規則（Owner 已裁決，Issue #18 本文，不可再議）

- 每租戶最多 **3 位**接收者，**無付費解鎖**——寫死在
  `src/server/owner-notify.ts` 的 `OWNER_NOTIFY_MAX_RECIPIENTS`，不是 DB 可調欄位。
- 第一位加入者自動成為主要；移除主要時依 `created_at` 遞補最早的下一位；
  移除最後一位接收者即停止該租戶所有老闆 LINE 通知。
- 事件對應：
  | 事件 | 觸發對象 |
  |---|---|
  | 新預約 | `notify_new_booking = true` 的接收者 |
  | 旅客自行取消 | `notify_cancel = true` 的接收者 |
  | 訂閱到期／儲值提醒 | 僅主要接收者，無視上面兩個開關（本 PR 未實作寄送 cron，見下方範圍註記） |
- 送給 N 位＝消耗 N 則推播額度（`lineMulticast` + `consumePushQuota(tenantId, N)`），
  不得少算成 1 則。
- 「已綁定」（有正式接收者）與「LINE provider 可連線」是兩個不同概念：
  後者由 `checkOwnerNotifyProviderHealth()` 實際打一次 `GET /v2/bot/info`
  才回報 healthy，不是看有沒有存 Token 就宣稱已連線。

### 四支端點

| 端點 | 做法 |
|---|---|
| GET／POST `/api/settings/line/owner-notify` | 總覽：目前接收者、`maxRecipients`、實測的 provider 連線狀態；POST 為「重新檢查」按鈕，不落庫 |
| GET `/api/settings/line/owner-notify/line-users` | 候選清單：已加好友、扣掉已是正式接收者的，帶回進行中邀請的 id |
| POST `/api/settings/line/owner-notify/bind` | 發起本人確認：推一則帶 `postback` 確認按鈕的訊息＋記一筆 PENDING 請求，**不會**直接加入名單 |
| `/api/settings/line/owner-notify/recipients/*` | CRUD：POST（把已確認的請求落地成正式接收者——正常路徑走 webhook postback，這支端點供沒有真 LINE webhook 環境的測試重放同一段邏輯）、DELETE（remove-all）、`[id]` 的 PATCH（切換開關／指定主要）與 DELETE（移除單一，主要遞補） |

### webhook postback 分派（`src/server/line-events.ts`）

沿用既有 webhook 收件端點（`src/app/api/line/webhook/[shopCode]/route.ts`），
**沒有新建 webhook 路由**：`postback.data` 為 `ownerNotifyConfirm:<requestId>`
時呼叫 `confirmOwnerNotifyBind()`（service-role client，因為 webhook 沒有
登入 session）；`ownerNotifyDecline:<requestId>` 呼叫 `declineOwnerNotifyBind()`
把請求標記 CANCELLED。

### 本 PR 範圍與明確延後項目

- 未建立「訂閱到期／儲值提醒」的實際寄送 cron；資料模型（僅主要接收者收到）
  已就緒，寄送邏輯留待對應的訂閱到期偵測 Issue 一併實作。
- 本 repo 沒有未登入的旅客自助取消入口（`src/app/s/[shopCode]` 只有展示，
  沒有取消動作），「旅客自行取消」通知掛在既有的
  `POST /api/bookings/:id/cancel`，由呼叫端明確帶 `customerInitiated: true`
  才觸發——不是靠「誰呼叫了這支 API」自動判斷，因為目前呼叫者一律是已登入
  店家成員。真正的旅客自助取消入口出現時，一樣呼叫本端點並帶這個旗標即可
  重用同一段邏輯。

---

## 6. Rich Menu / Flex 選單（line-settings、rich-menu-design 頁）

端點（原站清單 `/api/settings/line/rich-menu*`）最小可用集：

| 端點 | 做法 |
|---|---|
| POST `/api/settings/line/rich-menu/create` | ① 依 `richMenuTheme` 產生 2500×1686 選單設定（6 格：預約/我的預約/服務項目/會員卡/優惠/聯絡我們，action=message 或 uri 到公開頁）② `POST /v2/bot/richmenu` 建立 ③ 上傳圖片 `POST https://api-data.line.me/v2/bot/richmenu/{id}/content`（圖檔：MVP 用預先做好的主題底圖存 `richmenu-assets` bucket；設計器合成屬後期）④ `POST /v2/bot/user/all/richmenu/{id}` 設為預設 ⑤ richMenuId 記到 `tenant_settings.line` jsonb |
| POST `/api/settings/line/rich-menu/upload-bg-image` | multipart 收圖 → 存 bucket → 回 URL |
| POST `/api/settings/line/flex-menu` | 儲存 flex 設定（jsonb）；webhook 的「選單」關鍵字回這份 Flex Message |
| POST `/api/settings/line/disconnect` | 清空兩個 `*_enc` 欄位與 line jsonb 的 channelId ⚙O |

進階設計器（rich-menu-design 頁的 create-advanced / preview-* 端點）標為 Phase 6+，
留待 rich menu 基本流程可用後再逐一實作。

### 6.1 關鍵字回覆圖片的 Storage 決策（issue #50）

> ### ⚠️ 2026-09-07 實況對照：本節描述的是**設計**，`main` 只實作了其中一部分
>
> 本節（與 04 分冊 §B 的兩列端點契約）成文時，參照的是 PR #98 的分支實作。
> **該 PR 至今未合併**。對 `main` 實查：
>
> ```
> src/ 內 imageStorageRef                       0 命中
> keyword_reply_image_cleanup 表（migrations）   0 命中
> DELETE /api/settings/line/keyword-replies/image 路由   不存在
> preview 物件（previewPath / previewImageUrl 的產生）   沒有實作
> ```
>
> `main` 上實際成立的是（PR #264 / squash `83ab9f0`）：
>
> | 項目 | 本節描述 | `main` 實況 |
> |---|---|---|
> | bucket | 專用 `keyword-reply-images`、public | ✅ 相同（`0086` 建立） |
> | 上傳路徑 | `{tenantId}/{uuid}.{ext}`，伺服器端組出 | ✅ 相同（既有 `/api/upload`） |
> | 格式與上限 | JPEG/PNG、5 MB | ✅ 相同（另允許 webp） |
> | 存進 keyword reply 的形狀 | `content.imageStorageRef={bucket,path,url,previewPath,previewUrl}` | ⛔ 只有裸 `content.imageUrl` |
> | preview 物件 | 先產 ≤1 MB preview，上傳兩個物件 | ⛔ 未實作，只上傳原圖 |
> | 取消未儲存選圖的 DELETE 端點 | 有 | ⛔ 不存在 |
> | 替換／移除後的清理 ＋ 可重試 queue | 有 | ⛔ 不存在（見下） |
>
> **孤兒素材清理在 `main` 上完全沒有，而且六個既有圖片 bucket 都沒有**
> （service-images／product-images／portfolio-images／staff-avatars／
> richmenu-assets／welcome-card-images）。為關鍵字圖片單獨做第七套會違反 #50
> 自己的原則 3（不新增第二套上傳邏輯）；正確形狀是六個 bucket 共用一套清理設計，
> 屬另一張 issue 的範圍。#50 的「替換圖片的舊檔清理規則」那一格因此**維持未打勾**。
>
> 本節不刪除上述設計——它是既定方向，落地時照它做。但在落地之前，
> **本節描述的不是 `main` 的行為**，讀者不得據以推論功能可用
> （同 14 分冊 §7.4.3：從規格或路由檔存在，推論不出功能可用）。


LINE image message 需要可由 LINE 直接抓取的 HTTPS 原圖與 preview。以下是開工時對既有
LINE image bucket 的用途／公開性／格式／租戶路徑／生命週期查證；結論是不能混用：

| bucket | public／格式與上限 | tenant path | 既有生命週期 | #50 決定 |
|---|---|---|---|---|
| `richmenu-assets` | public；JPEG/PNG；1 MB | `{tenantId}/…` | Rich Menu 底圖，發布時整張送給 LINE，沒有 image-message preview | 不重用：格式上限、引用模型與刪除時機不同 |
| `chat-images` | public；JPEG/PNG；原圖 5 MB，另產 ≤1 MB preview | `{tenantId}/…` | 聊天歷史訊息的附件需隨對話保留 | 不重用：刪 keyword reply 不可連帶破壞聊天歷史 |
| `keyword-reply-images` | **public**；JPEG/PNG；原圖 5 MB，先產 ≤1 MB preview 再上傳兩個物件 | `{tenantId}/{uuid}.jpg` 或 `.png` | reply 替換／移除／刪除或取消未儲存選圖時清理；失敗進可重試 queue | 採專用 bucket；public 是 LINE 拉圖必要條件，URL 即讀取權限 |

public bucket 無法承諾「知道 URL 的其他 tenant 也讀不到」；隔離邊界是 authenticated upload
policy 的 tenant 首段，以及 keyword reply API 對 bucket、tenant path、可信 origin、原圖／preview
位置與物件存在的重驗。A tenant 不得寫入、引用或透過 cleanup 刪除 B tenant 的物件；public URL
不可放私密內容。Production bucket／policy 套用仍需 Owner 明確授權。

命中 `reply_type=IMAGE` 時沿用既有「圖片取代文字」契約：只送一則 LINE image message，
`originalContentUrl=content.imageUrl`、`previewImageUrl=content.previewImageUrl`，不另外追加文字。
inactive row 不參與 webhook 查詢；移除圖片後寫回 TEXT，故不再送舊圖。legacy 裸 `imageUrl`
可繼續讀取／停用，但任何新建或圖片變更都必須使用完整 storage ref。

---

## 7. `/api/settings/line/verify` 的六項可查證檢查 + 一項人工確認提示（補 04 分冊 A-1；
   issue #477 2026-09-15 首次修正三態語意，同日稍後依 Owner 提供的新版報告設計重構為
   六項可查證檢查 + 獨立 INFO 提示，見 `src/app/api/settings/line/verify/route.ts` 檔頭）

回應每項 check 帶 `status:'PASS'|'FAIL'|'INFO'`（主欄位；INFO 僅 AUTO_REPLY 專用）與
`pass:boolean`（`= status==='PASS'`，僅供既有呼叫端相容，不再獨立判定）。

六項可查證檢查（皆可能是 PASS 或 FAIL）：

| key | 判定 |
|---|---|
| CREDENTIALS | 本地檢查（不呼叫 LINE）：Channel ID／Secret／Access Token 是否都已填寫 |
| TOKEN | `GET /v2/bot/info` 成功 → PASS，否則 FAIL |
| ID_SECRET_PAIR | `POST /oauth2/v2.1/token`（client_credentials grant，Channel ID 當 client_id、Channel Secret 當 client_secret）成功換發短期 token → PASS（代表兩者確實互相配對，不是各自單獨有效但湊錯對）；LINE 回 invalid_client 等非 2xx → FAIL |
| BOT_MODE | 沿用 TOKEN 檢查同一次 `GET /v2/bot/info` 的 `chatMode` 欄位：`'bot'` → PASS（回應方式為 Bot 模式）；`'chat'` 或缺欄位 → FAIL。⚠️ 這與下面的 AUTO_REPLY 是兩個完全不同的 LINE 設定——chatMode 代表 LINE OA Manager「回應方式」，是官方公開 API 欄位，這裡讀它判斷「回應方式」正當；AUTO_REPLY 檢查的是同一頁裡「自動回應訊息」這顆*另外*的開關，LINE 未公開讀取 API，兩者不可混用同一個判斷來源（這正是本項目的前身、舊版 AUTO_REPLY 誤用 chatMode 的坑） |
| WEBHOOK | `GET /v2/bot/channel/webhook/endpoint` 的 endpoint 等於本店 webhook URL 且 active → PASS，否則 FAIL |
| WEBHOOK_TEST | `POST /v2/bot/channel/webhook/test`（LINE 主動對已註冊 endpoint 送一次測試請求）回 `success:true` → PASS，否則 FAIL |

一項獨立的人工確認提示（`AUTO_REPLY`，status 恆為 **INFO**，不計入通過／失敗任一邊）：
LINE 官方沒有公開 API 能直接讀取「自動回應訊息」這顆開關本身，一律導引店家自行到
LINE Official Account Manager 確認並視需要關閉，避免 LINE 內建自動回應攔截 Bot
訊息。不論 chatMode 為何、缺欄位、甚至 `/v2/bot/info` 呼叫失敗，AUTO_REPLY 皆為
INFO——這一點延續自 issue #477 首次修正時建立的規則（拿 chatMode 推論 AUTO_REPLY
是錯的，2026-09-15 稍早的教訓）。前端把它獨立渲染成藍色資訊提示，不是黃色警告。

無 LINE Channel Access Token 時，六項可查證檢查一律 `status:'FAIL'`（統一提示尚未
設定），且不對 LINE 發出任何請求；此時也不顯示 AUTO_REPLY 人工提示——連基本設定
都還沒接上，提醒一個還沒生效的開關沒有意義。

---

## 本冊驗收

- [ ] 測試店家貼上真實 channel 憑證 → `line/test` 回連線正常；DB 內兩個 `*_enc`
      欄位是密文、`line` jsonb 內無 secret
- [ ] 加 Bot 好友 → 收到歡迎訊息；`line_users` 出現該用戶
- [ ] 傳關鍵字 → 收到 keyword_replies 設定的回覆；亂打字 → 收到 defaultReply
- [ ] 上傳 JPEG/PNG 關鍵字圖後重新 GET 仍為同一 storage ref；mock LINE 收到一則 IMAGE，原圖／preview URL 與 DB 一致；停用或移除後不再送圖
- [ ] 後台 chat 頁看得到收到的訊息；回覆後手機收到（額度 -1）
- [ ] 確認預約 → 已綁定顧客的 LINE 收到通知；關掉 notifyBookingConfirmed 後不再收到
- [ ] 錯誤簽章打 webhook 回 401；正確簽章但處理中丟錯仍回 200
