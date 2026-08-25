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

> ⚠️ **實作備註（2026-08-24 稽核，14 分冊）**：
> 1. 上表 ④ 的「內建指令」實作只比對了 4 個字面值（預約/服務/我的預約/行程佔位），
>    **關鍵字覆蓋規格補列如下，接手者必須補齊**：
>    - `MODE_PRESETS.richMenuCells`（`src/config/modes.ts`）三種業態每個格子送出的
>      文字（服務項目/會員卡/優惠/聯絡我們/團次/我的訂單/常見問題/看診進度/營業時間…）
>      都必須有對應分支——**發布出去的按鈕文字沒有 handler ＝ 顧客按了沒反應**，
>      這正是「按 Bot 沒反應」的來源之一。richMenuCells 與 handler 兩邊要用同一份
>      常數，改一邊必動另一邊。
>    - 系統關鍵字 15 組（`src/i18n/zh-TW/pages/keyword-replies.ts` 的 systemGroups）
>      **含全部同義詞**（「我要預約」「立即預約」…）都要命中；各組的
>      `systemGroupDisabled` 停用開關 webhook 必須讀，停用的組不回應。
>    - 「選單」關鍵字 → 依 flex-menu 設定回 Flex Message（見 §6 現況標註）。
> 2. 實作與本節範例的刻意偏離（合理，回寫記錄）：店未設定 channel 時回 404 結束
>    而非讓 LINE_001 例外冒出；`timingSafeEqual` 前先比長度避免 throw。
> 3. 範例程式註解「trips 表尚不存在」已過時——migration 0016 已建 trips/trip_plans，
>    「行程」→ 行程輪播可以動工了（團次相關仍等 Phase 8b）。

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
| DELETE `/api/settings/line/rich-menu` | **（2026-08-24 補記，實作先行）** 刪除已發布選單：mock LINE 收到 DELETE、jsonb 的 richMenuId 清空；無 richMenuId 時冪等回成功 |
| POST `/api/settings/line/disconnect` | 清空兩個 `*_enc` 欄位與 line jsonb 的 channelId ⚙O |

> ⚠️ **flex-menu 現況（2026-08-24 稽核）：三層只完成一層，勿再誤判為完成。**
> ① 儲存端點：已做（只存開關/顏色/標題等設定值；**卡片內容清單目前沒有欄位可存**，
> 補規格：卡片陣列 `[{title, subtitle, imageUrl, ad}]` 一併存入 line jsonb 的
> `flexCards` 鍵，上限 12 張）。② webhook「選單」關鍵字回 Flex：**完全未實作**
> （line-events.ts 無任何 flexMenu* 引用）。③ 選單設計頁 Flex 分頁的發布/重設/刪卡：
> **全是本地假成功**。三層都補齊且過 08 清單「flex-menu 端到端」項才算完成。
>
> **rich menu 底圖**：richmenu-assets bucket 的六張主題圖從未有人上傳（bucket 為空），
> 原規格「MVP 用預先做好的主題底圖」因此必然 404。現行實作：無自訂圖、bucket 也
> 無圖時，後端以 `src/server/png.ts` 現生成該主題色的 2500×1686 純色 PNG，
> 「選主題即可發布」不再依賴人工上傳；之後要美化再補真圖即可。

進階設計器（rich-menu-design 頁的 create-advanced / preview-* 端點）標為 Phase 6+，
留待 rich menu 基本流程可用後再逐一實作。**同屬未實作、但頁面已有 UI 的還有**：
每格自訂文字/連結接上發布、儲存草稿、還原前次發布、背景圖上傳按鈕接 `/api/upload`
（目前是無 onClick 的死按鈕）——在接上之前，頁面必須明示「尚未生效」（鐵則 12），
不得顯示成功。

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

## 8. 圖片訊息與 `chat-images` bucket —— LINE 抓圖行為查證紀錄

> 對應 `docs/integration/14-GAP-AUDIT.md` §8.12。issue #15（migration `0017`）把
> `chat-images` 建成 **public** bucket，`/tenant/chat` 傳圖時 `/api/upload` 回
> `getPublicUrl()`，再原封不動塞進 image message 的 `originalContentUrl` /
> `previewImageUrl`（`src/app/api/chat/messages/route.ts`）。
> 本節記錄「能不能改成短效簽名 URL」的查證過程與結論。**查證日期：2026-08-25。**

### 8.1 結論：**無法確認**（不是 A、也不是 B，是「官方沒寫」）

核心問題是「LINE 什麼時候去抓 `originalContentUrl`」：

- **(A) 發送當下抓一份存到 LINE 自己的伺服器** → 簽名 URL 可行
- **(B) 顧客每次點開才即時回源抓** → 簽名 URL 會製造破圖 bug

**查遍 LINE 官方 OpenAPI spec、Messaging API 參考文件、開發指南與 FAQ，沒有任何一句
話直接說明 image message 的 `originalContentUrl` 在什麼時間點被誰抓取、LINE 端是否
保留副本、保留多久。** 官方旁證兩邊都有一點，但沒有一條是針對 image message 的直述
句，因此本節不下 A/B 的結論，也不寫「應該是」。

**最高可信度來源直接落空**：LINE 官方 OpenAPI spec 的 `ImageMessage` 只有型別，
沒有任何描述文字——
[line/line-openapi `messaging-api.yml`](https://github.com/line/line-openapi/blob/main/messaging-api.yml)：

```yaml
ImageMessage:
  externalDocs:
    url: https://developers.line.biz/en/reference/messaging-api/#image-message
  required: [originalContentUrl, previewImageUrl]
  allOf:
    - "$ref": "#/components/schemas/Message"
    - type: object
      properties:
        originalContentUrl: { type: string, format: uri }
        previewImageUrl:    { type: string, format: uri }
```

上次靠 `BotInfoResponse.chatMode` 一次解決爭議的那招（見 §7 AUTO_REPLY），這次在
spec 裡查不到答案——spec 對這題完全沉默。

### 8.2 傾向 (B)（回源、次數與收訊人數成正比）的官方旁證

三條都是官方文件原文，但**都不是講 image message 的 `originalContentUrl`**：

1. **法人開發指南「大量のアクセスへの対応 / Dealing with high volume access」**
   （[ja](https://developers.line.biz/ja/docs/partner-docs/development-guidelines/)｜
   [en](https://developers.line.biz/en/docs/partner-docs/development-guidelines/)）：
   > メッセージの送信対象のユーザー数や、送信したメッセージの内容によっては、メッセージ
   > に含まれるURLや画像などのコンテンツに対し、大量のアクセスが発生する場合があります。
   > そのような場合に備え、CDNやロードバランサーなどの負荷分散の仕組みを利用したり、
   > メッセージの送信を段階的に行ったりして、**コンテンツ保存元のサーバー**が大量の
   > アクセスによってダウンしないように対応してください。

   英文版：「a large volume of access may be generated to URLs, images, and other
   content in the messages … so that **the server from which the content is stored**
   doesn't go down」。
   → 若 LINE 在發送當下抓一份自存，來源站的存取量不會隨收訊人數放大。這條指南的存在
   本身就說明來源站會被反覆打。**但它把「URL（點連結）」和「画像」寫在同一句**，
   點連結必然是逐人存取，所以無法排除放大效應只來自連結那一半。

2. **同指南「HTTPS（TLS 1.2以上）の利用」**：
   > 画像メッセージや画像コンポーネントを含むFlex Messageなどを送信する場合、
   > **ファイルを保存するサーバー**はHTTPS（TLS 1.2以上）での通信に対応している必要があります。

   → 官方一貫把來源站稱為「保存圖片的伺服器」，沒有任何「LINE 會轉存」的敘述。

3. **imagemap message「How to configure an image」**
   （[Messaging API reference](https://developers.line.biz/en/reference/messaging-api/#base-url)）：
   > Make it possible to access images of 5 different sizes using the
   > `baseUrl/{image width}` URL format. **LINE will then download an image at the
   > appropriate resolution based on the device.**

   → 「依裝置決定抓哪一張」＝抓取發生在知道裝置之後，不是發送當下。**但這是 imagemap，
   不是 image message**，兩者是不同的訊息型別。

4. **FAQ「メッセージとして送信した動画が再生できないのはなぜですか？」**
   （[ja](https://developers.line.biz/ja/faq/)｜
   [en `#why-cant-i-play-a-video-that-i-sent-as-a-message`](https://developers.line.biz/en/faq/)）：
   > - 動画が再生可能なファイル形式（mp4）であること
   > - 動画のファイルサイズが200MB以下であること
   > - **動画をホストしているサーバーが、HTTPの範囲リクエスト（Range request）に対応していること**

   → 要求來源站支援 Range request，意味著播放端是直接對來源站串流。**但這是 video
   message**，不能直接推到 image message。

### 8.3 傾向 (A)（LINE 端有副本）的第三方實測——非官方，僅供參考

Qiita 問答
[「LineMessageAPIで画像を署名付きURL(有効期限:1時間)で対応した際の挙動と対処法」](https://qiita.com/Forest_Bear/questions/4fe6be5bce9ee43dfa48)
（2025-01-24，提問者 @Forest_Bear，主題正是「合約、收據等重要文件用簽名 URL 送」）。
發問者實測（原文）：

| 環境 | 條件 | 結果 |
|---|---|---|
| LINE App | 通信良好、送出後**在有效期限外**開啟聊天室 | **画像が表示される** |
| LINE App | 通信良好、看過後在有效期限外再開 | 画像が表示される |
| LINE App | 通信不良、送出後在有效期限外開啟 | 画像が表示されない |
| OAM（Official Account Manager） | 通信良好、送出後**在有效期限外**開啟 | **画像が表示されない** |
| OAM | 看過後在有效期限外再開 | 画像が表示されない |

發問者自己寫明「**公式ドキュメントに詳しい仕様が記載されておらず**」（官方文件沒寫細節）。
唯一的回答者（非 LINE 官方）只說「LINEアプリでは画像データはキャッシュされるので
読み込まれた後はオフラインでも表示されます」——那解釋的是**看過之後**的離線快取，
**沒有解釋第一次開啟就已過期卻仍顯示**的那一列。

**這份實測能確定的、與不能確定的**：

- ✅ 可確定：**店家端的 LINE Official Account Manager 會直接回源抓圖，簽名一過期就破圖。**
  這一條與 A/B 無關，是獨立成立的事實。
- ❌ 不能確定：LINE App 那一列到底是「LINE 平台有副本」還是「該裝置在期限內就背景預抓過」。
  單一個人的實測、樣本一則、無法排除裝置背景預載，**不足以當作 (A) 成立的證據**。

### 8.4 順帶查到的硬性限制（官方原文，均可直接引用）

來源：[Messaging API reference — Image message](https://developers.line.biz/en/reference/messaging-api/#image-message)

| 項目 | `originalContentUrl` | `previewImageUrl` |
|---|---|---|
| 最大字元數 | 2000 | 2000 |
| 協定 | HTTPS（TLS 1.2 or later） | HTTPS（TLS 1.2 or later） |
| 圖片格式 | **JPEG or PNG** | **JPEG or PNG** |
| 最大檔案大小 | **10 MB** | **1 MB** |
| 編碼 | URL 須以 UTF-8 percent-encode | 同左 |

另附原文一句：「Depending on the situation of a user device, the image of the
`originalContentUrl` property may be used as the preview image.」

**⚠️ 由此發現本專案現有實作的兩個規格違反（本次查證的附帶產出，未在此次改動中修）：**

1. `/api/upload`（`src/app/api/upload/route.ts`）的 `ALLOWED_TYPES` 收
   `image/webp`，但 LINE image message **只接受 JPEG / PNG**。店家傳 WebP →
   上傳成功、`chat_messages` 有紀錄、LINE 端可能顯示不出來。
2. `src/app/api/chat/messages/route.ts` 與 `src/app/api/marketing/pushes/[id]/send/route.ts`
   都把**同一個 URL 同時當 original 與 preview**。`/api/upload` 上限是 5 MB，
   而 `previewImageUrl` 官方上限是 **1 MB** → 1~5 MB 的圖已超出 preview 規格。

**未能確認的其他項目**（查過但官方沒有寫）：

- **重試行為**：LINE 抓 `originalContentUrl` 失敗會不會重抓、重抓幾次。
  查過 Messaging API reference 全文（`index.html.md`，約 69 萬字元）grep
  `retry / retries / timeout / redirect`，只有 `X-Line-Retry-Key`（那是**你打 LINE**
  的 API 重試，不是 LINE 抓你的圖），以及 webhook 的 `REQUEST_TIMEOUT`。**無此規格。**
- **抓取逾時秒數**：同上，grep 不到任何針對 content URL 的逾時值。**無此規格。**
- **LINE 端圖片保留期限**：官方只有針對「**使用者傳給 Bot** 的內容」寫過保留規則
  （[Get content](https://developers.line.biz/en/reference/messaging-api/#get-content)：
  「Content is automatically deleted after a certain period from when the message was
  sent. There is no guarantee for how long content is stored.」）。
  那條講的是 LINE 保存的**收訊**內容，**不適用於 Bot 送出、由我方伺服器託管的圖片**。
  對後者，官方沒有任何保留期限敘述。
- 另注意 `contentProvider.type: external` 那段（同上 reference）雖然寫著
  「The server where the image file is located isn't provided by LY Corporation」，
  **那是 webhook 收訊事件的欄位**，描述的是「使用者端收到的訊息其內容由誰提供」，
  不能當成「Bot 送出的圖 LINE 不會存副本」的證據。

### 8.5 `chat-images` 目前是 public 的理由與已知風險

**理由**：LINE image message 只收「可外連的 HTTPS 網址」（見 8.4）。Supabase public
bucket 的 `getPublicUrl()` 是目前唯一**已驗證可用**的形式（`tests/integration/api/chat-image.15.test.ts`）。

**已知風險（照實記錄，不粉飾）**：

1. **無身分檢查**：`storage.buckets.public = true` + `p_storage_read` 對此 bucket
   `for select using (bucket_id in (...))` 無條件放行。任何人拿到網址即可開啟，
   不需登入、不分租戶。
2. **內容可能敏感**：CLINIC 模式的療程紀錄、訂單明細、含顧客姓名的截圖都可能被店家
   直接傳出去。網址會出現在瀏覽器歷史、截圖、貼錯群組。
3. **唯一的保護是「路徑不可猜」**：`/api/upload` 產生
   `{tenantId}/{randomUUID()}.{ext}`，兩段都是 UUID，實務上無法枚舉。
   **但這是 bearer-URL 模型，不是存取控制**——網址即權限，外流即失守。
4. **無保留期限**：0017 沒有任何 lifecycle 設定，物件無限期累積，成本只增不減。
5. **`chat_messages` 只存最終 URL，沒存 storage path**，日後要清理得反解 URL。

### 8.6 建議做法

**（1）現階段不得改用短效簽名 URL。** 理由不是「做不到」，是「沒有依據」：
沒有任何官方文件保證 LINE 端有副本，而 8.3 已可確定 OAM 端一定破圖。在 (A) 未被
證實前改成短效簽名，等於拿顧客看得到圖這件事去賭一個沒有出處的假設。

**（2）保留期限也被同一個未知卡住，同樣不可先做。**
若真相是 (B)，刪掉舊物件＝顧客回頭看舊訊息全部破圖；若是 (A)，刪掉無害。
所以「清理策略」的參數（保留幾天）不是成本問題而是正確性問題，必須先解 8.1。
**在解開之前，能做且無風險的只有**：
- `/api/upload` 改成 chat-images 只收 JPEG / PNG（修 8.4 的違反 1），
- preview 與 original 分流或限制 preview ≤ 1 MB（修 8.4 的違反 2），
- `chat_messages` 補存 storage path，讓未來的清理工具有得刪，
- 後台傳圖 UI 明示「此圖片將以公開網址提供給 LINE，請勿傳送身分證、病歷等文件」
  ——這是使用者讀得到的地方，不是只寫在程式碼註解裡（CLAUDE.md 鐵則）。

**（3）真正敏感的內容，無論 A/B 都不該用 image message 送。**
關鍵結構性理由：**LINE 端抓圖時不會帶任何可辨識顧客的憑證**，所以「顧客點圖 →
我們的伺服器驗身分 → 再回傳圖」這種代理層，掛在 `originalContentUrl` 後面是無效的
——伺服器收到請求時無從得知對方是誰。而且官方明文
「[we don't disclose the IP addresses of the LINE Platform](https://developers.line.biz/en/docs/messaging-api/development-guidelines/#prohibiting-ip-address-restrictions)」
且要求「Don't restrict access by IP address」（該段落是講 webhook 來源，不可過度延伸，
但足以說明 IP 白名單不是可行的替代方案）。
→ 正確做法是**不送圖，送連結**：推一則含 LIFF / 短網址的訊息，顧客點開後在我方頁面
以 LINE Login 取得 `userId` 驗明身分，再由伺服器發短效簽名 URL 顯示。這是獨立的工程，
不屬於 issue #15 範圍。

**（4）在此之前，維持 public + 不可猜路徑，並如實記錄風險（即本節）。**

### 8.7 建議的實測驗證方法（需真實 LINE 頻道，留給主導者決定，勿自行執行）

要把 8.1 從「無法確認」變成事實，唯一可行的是實測。**設計重點是排除裝置本機快取**
——這正是 8.3 那份第三方實測最大的漏洞：

1. 用**測試用 channel**，push 一則 image message，`originalContentUrl` /
   `previewImageUrl` 指向有效期 **60 秒**的 Supabase 簽名 URL。
2. 送出後**完全不要開啟該聊天室**（也不要讓 App 在前景），等 **5 分鐘**確定過期。
   期間可在伺服器端記錄 access log，觀察這 60 秒內是否有來自 LINE 的抓取（有抓取
   ≠ 有保存，但沒抓取幾乎可直接判定 (B)）。
3. 用一台**從未收過該訊息的裝置**（或清除 App 資料後重新登入）第一次開啟聊天室：
   - 縮圖與大圖都正常顯示 → 傾向 (A)，LINE 端有副本
   - 破圖 → **確定 (B)**
4. 分別確認 preview（聊天列表的縮圖）與 original（點開的大圖）是否行為一致
   ——兩個欄位可能不同時機抓取。
5. 同步在 LINE Official Account Manager 的聊天畫面確認（依 8.3 預期會破圖）。
6. 補一輪：把物件從 Storage **刪除**（而非只是簽名過期）後，再從一台新裝置開啟舊訊息。
   這一輪才真正回答「保留期限能設多短」。

**實測結果請回填本節 8.1，並把 8.6 的建議一併改寫。** 在回填之前，8.1 必須維持
「無法確認」——不得因為 8.2 的旁證較多就改寫成 (B)，那就是 CLAUDE.md 警告的
「把沒有量到的狀態當成量到的」。

---

## 本冊驗收

- [ ] 測試店家貼上真實 channel 憑證 → `line/test` 回連線正常；DB 內兩個 `*_enc`
      欄位是密文、`line` jsonb 內無 secret
- [ ] 加 Bot 好友 → 收到歡迎訊息；`line_users` 出現該用戶
- [ ] 傳關鍵字 → 收到 keyword_replies 設定的回覆；亂打字 → 收到 defaultReply
- [ ] 後台 chat 頁看得到收到的訊息；回覆後手機收到（額度 -1）
- [ ] 確認預約 → 已綁定顧客的 LINE 收到通知；關掉 notifyBookingConfirmed 後不再收到
- [ ] 錯誤簽章打 webhook 回 401；正確簽章但處理中丟錯仍回 200
