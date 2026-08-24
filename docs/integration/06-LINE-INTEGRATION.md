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
關閉「聊天」（設定 → 回應設定 → 回應功能 →「聊天」，畫面顯示「聊天：關閉」；
「回應方式：手動聊天／手動聊天＋自動回應訊息」只是聊天開啟時的子選項，不會讓
`chatMode` 變成 `bot`，一定要關「聊天」本身——2026-08-24 用真實 LINE 帳號實測驗證）。

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
- **簽章驗證失敗回 401 就結束**；驗證通過後**永遠回 200**（處理錯誤只 log，
  否則 LINE 會不斷重送）。

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

  const { events } = JSON.parse(raw);
  for (const ev of events ?? []) {
    try { await handleEvent(admin, tenant.id, token, lineConfig, ev); }
    catch (e) { console.error('[line-webhook]', shopCode, ev.type, e); }
  }
  return new Response('ok');
}
```

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

---

## 7. `/api/settings/line/verify` 的五項檢查（補 04 分冊 A-1）

| key | 判定 |
|---|---|
| TOKEN | `lineBotInfo()` 成功 |
| WEBHOOK | `GET /v2/bot/channel/webhook/endpoint` 的 endpoint 等於本店 webhook URL 且 active |
| AUTO_REPLY | ⚠️ **本行原規格已修正，不要照抄。** 原文寫「無公開 API 可查 → 恆回 `pass:false` + 提醒文案」，實作後使用者實測：在 LINE 關閉自動回應仍看到紅色失敗，因為這項從不檢查任何東西。且頁面把所有非 pass 算成失敗，報告永遠不可能「全部通過」，久了整份被忽略。<br>另外「無公開 API」只對一半：`GET /v2/bot/info` 的 `chatMode` 查得到同一頁的「聊天」開關（`bot`=關、`chat`=開），那正是「Bot 沒反應」最常見的成因（LINE 官方 OpenAPI `BotInfoResponse.chatMode`）。<br>**現行實作**：以 `chatMode` 給真實結論；查不到的部分（自動回應開關本身）降級為 `severity:'WARN'` 提醒，不再是永久失敗。詳見 CLAUDE.md「不要製造假的已知」。 |
| RICH_MENU | `GET /v2/bot/user/all/richmenu` 有值 |
| QUOTA | `GET /v2/bot/message/quota/consumption` 對比 quota，回剩餘則數 |

---

## 本冊驗收

- [ ] 測試店家貼上真實 channel 憑證 → `line/test` 回連線正常；DB 內兩個 `*_enc`
      欄位是密文、`line` jsonb 內無 secret
- [ ] 加 Bot 好友 → 收到歡迎訊息；`line_users` 出現該用戶
- [ ] 傳關鍵字 → 收到 keyword_replies 設定的回覆；亂打字 → 收到 defaultReply
- [ ] 後台 chat 頁看得到收到的訊息；回覆後手機收到（額度 -1）
- [ ] 確認預約 → 已綁定顧客的 LINE 收到通知；關掉 notifyBookingConfirmed 後不再收到
- [ ] 錯誤簽章打 webhook 回 401；正確簽章但處理中丟錯仍回 200
