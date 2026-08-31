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


### 3.1 驗簽後**立刻回 200**，事件處理搬到 `after()`（issue #31，2026-08-25）

**規格（新增，覆蓋 §3 範例程式最後那段 `for…await…` 的位置）：**

```ts
// 驗簽仍在回應之前 —— 簽章錯誤照樣 401，不進任何處理
if (!got || expectBuf.length !== gotBuf.length || !timingSafeEqual(expectBuf, gotBuf))
  return new Response('bad signature', { status: 401 });

const { events } = JSON.parse(raw);
after(async () => {                       // next/server（本專案 Next 15.5.23，實測可用）
  try {
    for (const ev of events ?? []) {
      try { await handleEvent(admin, tenant, token, lineConfig, ev); }
      catch (e) { /* 一定要 log */ }
    }
  } catch (e) { /* 迴圈外的意外也要 log，不能靜默死掉 */ }
});
return new Response('ok');                // ← 事件還沒處理就已經回應
```

三條必守：

1. **驗簽留在回應之前。**「先回 200」指的是**事件處理**，不是驗簽。簽章失敗仍回 401，
   且**一筆背景工作都不准排入**。
2. **`after()` 內不得再碰 `request`**（回應已結束）。需要的東西（tenant、token、
   lineConfig、events）在回應前就取出來帶進去。
3. **`after()` 內的例外一定要 log。** 處理搬到背景之後，錯誤不再有任何使用者看得見的
   出口——不 log 就是「後端每一步都成功」的假象。

> `after()` 在 Vercel 上真的會執行嗎？**有實測**：對 preview 部署送一個簽章正確、
> 但 `events` 不可迭代的 payload，HTTP 立刻回 200 `ok`，Vercel Runtime Logs 裡出現
> `[line-webhook] sulawei0301 after() TypeError: (r ?? []) is not iterable`——
> 那一行只可能在回應之後被印出來。（「文件說支援」不算查證過。）

#### 同檔多出來的 `GET`：只給測試用的排空端點

`after()` 一旦落地，整合測試就沒有「拿到 200 ＝ 處理完了」這回事。為了讓測試能
**確定地**等到背景處理結束（12 §2.3 禁用 sleep 等待），route 同檔多了一個 `GET`：

- `NODE_ENV === 'production'`（含 Vercel 的 preview 與 production 部署）→ 回 405，
  跟沒有實作 GET 時一模一樣。**已在 preview 部署實測回 405。**
- 其他環境（`next dev`，即整合測試的伺服器）→ await 掉所有還沒跑完的處理，
  回 `{ drained, scheduled, errors }`。`scheduled` 是**累計**排入過幾筆背景工作，
  「驗簽失敗不得排入任何工作」就是拿它前後相減來斷言的。

測試端的包裝在 `tests/helpers/line-webhook.ts`（`drainWebhook`）。

#### 為什麼要改（實測，不是推論）

`POST /v2/bot/channel/webhook/test`（LINE 從**他們的伺服器**打我們，最有代表性）：

| 時間 | 情境 | 結果 |
|---|---|---|
| 2026-08-25 16:00 UTC | 閒置後第一發 | `{"success":false,"statusCode":0,"reason":"REQUEST_TIMEOUT"}` |
| 同上，緊接著 8 連打 | 暖機 | 6 次 `success:true`、**2 次 `REQUEST_TIMEOUT`** |

⚠️ 第二列值得記下來：**暖機狀態也會逾時**（issue #31 原文寫「暖機後 8/8 成功」，
重測是 8 取 2 失敗）。所以這不是純粹的冷啟動問題，而是「**我們的回應時間本來就
壓在 LINE 的容忍線上**」，冷啟動只是把它推過去。

我方直接以正確簽章打同一個路徑、**`events: []`（零事件、什麼都不用處理）**：

```
GET 同路徑（Next 回 405，不進我們的 handler）  0.934s   ← 網路與平台底噪
run1 1.816s  run2 1.376s  run3 0.716s  run4 1.804s  run5 1.291s  run6 0.729s
```

也就是說，**在還沒處理任何一則訊息之前**，光是「查 tenants → 查 tenant_settings →
解密 → 驗簽」就吃掉了 0.3〜1.7 秒。事件處理（reply、寫 chat_messages、AI 客服呼叫
LLM）全部疊在這之上，而且 LINE 的**重送（redelivery）預設是關閉的**——逾時就是
把顧客那則訊息丟掉，後台不會有任何異常。

#### 一併做的：驗簽前只留一趟 DB

原本驗簽前有兩趟 round-trip（`tenants`、`tenant_settings`）。`tenant_settings.tenant_id`
是 `tenants(id)` 的 FK，PostgREST 可以內嵌，改成一趟：

```ts
.from('tenants')
.select('id, shop_code, name, business_type, tenant_settings(line, line_channel_secret_enc, line_channel_access_token_enc)')
.eq('shop_code', shopCode).maybeSingle()
```

解密與 LINE_001 的判斷抽成 `decryptLineCredentials()`（`src/server/line.ts`），
`getLineCredentials()` 也改用它——兩條路徑共用同一份程式碼，不會慢慢分岔。

#### 改後實測（同一套流程，改前改後各一次）

冷啟動用**新部署的第一發**製造（方法與理由見 14 分冊 §6.11）：把同一份原始碼
（改前＝未修改、改後＝已修改）各自 `vercel deploy` 成一個獨立的 preview 部署，
READY 後立刻用 `POST /v2/bot/channel/webhook/test` 的 `endpoint` 參數打過去。

| 回合 | 條件 | 改前（未修改） | 改後（已修改） |
|---|---|---|---|
| 1 | 新部署後的第一發（必冷） | `{"success":false,"statusCode":0,"reason":"REQUEST_TIMEOUT"}` | `{"success":true,"statusCode":200,"reason":"OK"}` |
| 1 | 接著連打 8 次 | 8/8 `success:true` | 8/8 `success:true` |
| 2 | 閒置約 5–7 分鐘後第一發 | `REQUEST_TIMEOUT` | `success:true` |
| 3 | 閒置約 4 分鐘後第一發 | **`success:true`**（沒重現） | `success:true` |
| 4 | **閒置約 17 分鐘後第一發** | `REQUEST_TIMEOUT` | **`REQUEST_TIMEOUT`（改後也逾時）** |
| — | 零事件請求（我方直接打，暖機） | 1.15〜2.76s | **0.36〜1.39s** |

⚠️ **第 3 回合改前也成功了，如實記下**：這個缺陷是機率性的，閒置得不夠久就可能
不重現。所以「跑一次沒事」不能當成沒問題的證據——要能重現才有比較的意義，
這也是為什麼冷啟動一定要用「新部署的第一發」來製造。

🔴 **第 4 回合更重要：閒置夠久（約 17 分鐘）之後，改後的版本一樣拿到
`REQUEST_TIMEOUT`。所以「`after()` 修好了冷啟動逾時」是不成立的說法，不要這樣寫。**
精確的說法是：

- `after()` 拿掉的是**事件處理**佔用的回應時間（這一段有確定性的測試釘住）；
- 單趟 DB 把驗簽前的自有開銷從 1.15〜2.76s 壓到 0.36〜1.39s；
- **但 Lambda 的冷啟動本身仍在回應路徑上**，閒置夠久時它自己就會超出 LINE 的容忍。

同一發逾時的請求，在 Vercel Runtime Logs 裡是
`17:09:27 POST /api/line/webhook/sulawei0301 200`，而 LINE 回報的逾時時間戳是
`17:09:29`——**我們確實有回 200，是 LINE 先放棄等待**。這也代表改後的失敗形態
和改前不同：事件已經進到我們手上並照樣在 `after()` 裡處理，不是「訊息被丟掉」；
壞處變成「LINE 那邊記成失敗」（若之後開啟 redelivery，就會變成重送與重複）。
⚠️ 這一段只斷言「我們有回 200」——顧客最後有沒有收到回覆**沒有實測**
（LINE 的 webhook 測試端點送的不是 message 事件，見下方 §3.1 末的限制說明）。

#### 一併做的：把 `line-events` 的模組載入也移出回應路徑

冷啟動的時間不只是「執行程式」，還包括**把模組載進來**。`src/server/line-events.ts`
會連帶拉進 `src/config/modes.ts`、i18n、`src/server/flex-menu.ts`、
`src/server/ai-reply.ts`（後者又 `import Anthropic from '@anthropic-ai/sdk'`）——
那一整包跟「回 200」這件事完全無關，卻整包算在冷啟動裡。

所以 route **不在檔頭 import `handleEvent`**，改成在 `after()` 裡動態載入：

```ts
after(async () => {
  const { handleEvent } = await import('@/server/line-events');
  …
});
```

回應路徑因此只剩 `crypto` + supabase 客戶端 + `src/server/line.ts`。**量化的部分**
（`npm run build` 後看該路由的伺服器 bundle）：

```
.next/server/app/api/line/webhook/[shopCode]/route.js
  檔頭 import handleEvent（改動前）  196,524 bytes
  after() 內動態 import（改動後）     14,920 bytes   ← 回應前需要載入的量，約 1/13
```

⚠️ **但它沒有讓冷啟動那一發變成成功**：同樣閒置約 18 分鐘後，動態 import 版
（`…-fthwynhwk…`）與檔頭 import 版（`…-1rte31p6z…`）**兩個都拿到
`REQUEST_TIMEOUT`**（2026-08-25 17:32 UTC）。所以這一項的正確描述是
「**回應路徑要載入的東西少了約 13 倍，但冷啟動仍會逾時**」——
少載入是量到的，解決冷啟動不是。

#### 憑證快取：**評估後決定不做**（issue #31 要求的明確答案）

- **理由一：快取在最需要它的那一刻是空的。** 出事的是**冷啟動那一發**；那一發正好是
  新的 serverless 實例、記憶體快取剛出生。省得到的是暖機請求那 100〜200ms，
  而暖機請求本來就大多會過。**這是典型的「量錯地方的最佳化」。**
- **理由二：換 token 的空窗是一種假的已知。** 店家在後台換了 Channel Access Token，
  若快取還在，系統會繼續用舊 token 發訊息——**畫面上不會有任何異常**，訊息就是沒送到。
  這正是本專案反覆在清的那一類缺陷。

因此**「店家換 token 之後多久生效」的答案是：下一個進來的 webhook 請求就生效，沒有
TTL 空窗。** 這句話能寫在這裡，是因為程式裡真的沒有快取層，不是因為 TTL 很短。

> 未來若真要加快取，最低要求是**寫入端主動失效**（`/api/settings/line` 存檔時清掉該
> tenant 的快取項），而且必須在本節寫明生效時間；只靠 TTL 到期不算。

#### 殘留風險（`after()` 修不掉的部分，誠實列出）

1. **冷啟動本身還在——而且已經量到它單獨就會逾時。** `after()` 讓「處理時間」
   不再算進 LINE 的等待，但「Lambda 冷啟 + 一趟 DB + 解密 + 驗簽」仍在回應路徑上。
   **實測第 4 回合（閒置約 17 分鐘）改後仍拿到 `REQUEST_TIMEOUT`**（見上表）。
   **這一格沒有解決，不准打勾。** 下一步的候選在第 3 點，需要擁有者決策。
2. **`after()` 的工作仍活在同一次函式呼叫裡，受 `maxDuration` 限制。**
   回應送出後背景工作還要跑，若超過函式的上限就會被砍掉——**顧客一樣收不到回覆，
   而且這次連 LINE 都以為成功了**。本專案 `vercel.json` 沒有設 `maxDuration`，
   實際上限取決於 Vercel 方案與 Fluid 設定，**本輪沒有查證，不寫數字**。
   ⚠️ 一旦 AI 客服真的啟用（見下方第 5 點），LLM 呼叫本身就設了 10 秒逾時，
   這條限制會變成實際風險——那時要先確認上限、必要時在 route 明確
   `export const maxDuration = …`。
3. **可考慮的下一步**（未做，需要決策）：
   - 把 `tenants`＋`tenant_settings` 那一趟改成走更靠近的資料來源／或在驗簽前加一層
     只讀 secret 的輕量查詢；
   - `cloudflare/` 的排程 pinger 目前是每小時一次，**保不住** Vercel 幾分鐘就回收的
     實例；要真的壓住冷啟動需要更密的 ping 或 Vercel 的常駐設定（費用問題，屬擁有者決策）。
     ⚠️ 實測給出的量級：閒置 4 分鐘還好、**閒置 17 分鐘就逾時**——若要用 ping 壓，
     間隔得抓在分鐘級，不是小時級。Hobby 的 cron 最密只到每天一次（見 `vercel.json`
     的註記與 commit `67eb054` 的 Cloudflare Worker），所以這條路要嘛加密 Worker 的
     排程、要嘛換方案，兩者都要擁有者決定。
   - 或者換個方向：**別讓冷啟動落在回應路徑上**——例如把 webhook 這一支改成
     edge runtime（沒有 Node 冷啟那麼重）並只做「驗簽 + 入列」，處理交給另一支。
     這會動到驗簽用的 `crypto`（edge 有 WebCrypto，可行但要改寫），屬於較大的改動，
     本輪不做，列在這裡當下一步的候選。
4. **LINE 端的 webhook redelivery 預設關閉**（官方原文：*"By default, webhook
   redelivery is disabled."*，
   <https://developers.line.biz/en/docs/messaging-api/receiving-messages/>）。
   查證到的三件事，措辭照官方，不要放大：
   - **設定位置是 LINE Developers Console → 該 channel → Messaging API 分頁**，
     **不是** LINE Official Account Manager（issue #31 原文寫成後者，實查為前者）。
   - **沒有公開 API 可以改。** `line/line-openapi` 的 `messaging-api.yml` 裡
     `/v2/bot/channel/webhook/*` 只有 `endpoint`（GET/PUT）與 `test`（POST）
     三個操作，全文 grep `redeliver` 只出現在 webhook 事件的說明欄位。
   - 觸發條件官方寫的是「**bot server 沒有回 2xx**」；同一頁也提醒
     **事件順序可能與發生順序不同**，去重要用 `webhookEventId`。
   - ⚠️ **官方文件沒有寫 LINE 等多久算逾時**，所以本冊不列具體秒數；
     我們只知道實測會拿到 `REQUEST_TIMEOUT`。

   **本輪的評估：先不要開。** 兩個理由——(a) 逾時那一發我們其實**有回 200 也有
   處理**（見上表第 4 回合的 Runtime Log 對照），redelivery 補的是「我們沒收到」，
   而我們收到了；(b) 開啟後 LINE 會重送，
   而我們**還沒有任何去重機制**（`webhookEventId` 沒有被記錄，也沒有唯一索引），
   重送會變成重複回覆、重複寫 `chat_messages`——用一個看得見的錯換一個看不見的錯。
   **要開之前的前置**：先把 `webhookEventId` 存下來並做冪等（唯一鍵），再請擁有者
   到 LINE Developers Console 開啟。這件事目前沒有人在做，列在這裡等排程。
5. **AI 客服目前在 Preview 上根本沒有在跑**（2026-08-25 查證）：
   `vercel env ls preview` 的清單裡**沒有 `ANTHROPIC_API_KEY`**，而
   `src/server/ai-reply.ts` 第一行就是「沒有 key 就直接回 `null`」。所以
   issue #31 說的「AI 客服必逾時」在 Preview 上**現在不成立**——它不是慢，是沒跑。
   程式路徑本身是真的；**補上 key 之後**，LLM 的秒級延遲就會出現在事件處理裡，
   而那正是 `after()` 這次要擋在回應之外的東西。
   補 key 屬平台層設定（CLAUDE.md 的兩層設定表），是**擁有者的動作**。

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

## 5.5 老闆通知（owner-notify）— `src/server/owner-notify.ts`（issue #18，2026-08-26 新增）

> **本節在 06 分冊原本零記載。** 不是做壞了，是規格從來沒寫（14 分冊 §0 根因 B）。
> 原站事實基準是 `docs/specs/dashboard.json`（owner-notify 的 UI 全在 JS 裡動態
> 渲染，證據集中在 `jsStrings` 與 `jsApiCalls`）。
>
> ⚠️ 規格只記錄**路徑字串**，**不記錄 HTTP method 與 request/response 形狀**
> （14 分冊 §9.4 第 1 點）。下面的 method 與契約形狀**是我方設計**，不是原站考據結果。

### 5.5.0 與 §5（顧客通道）的關係：兩條通道，不得合併

| | 顧客通道 §5 `line-notify.ts` | 老闆通道 §5.5 `owner-notify.ts` |
|---|---|---|
| 對象 | 該筆預約的顧客一人 | 店家團隊（老闆＋主管），名單 n 位 |
| 名單來源 | `customers.line_user_id` | `owner_notify_recipients`（從已 follow 的好友挑人） |
| 觸發 | 預約狀態變更（confirm/cancel/…） | 新預約（全部）／訂閱到期・儲值提醒（僅主要） |
| 額度 | 每次 1 則 | **每次 n 則**（n = 名單人數） |
| 開關 | `tenant_settings.notify.*` | 名單本身（名單為空＝不發，原站沒有獨立 toggle） |

### 5.5.1 資料模型（migration 0022）

```sql
owner_notify_recipients(id, tenant_id, line_user_id, is_primary, created_at)
  unique (tenant_id, line_user_id)
  foreign key (tenant_id, line_user_id) → line_users(tenant_id, line_user_id) on delete cascade
  create unique index … on (tenant_id) where is_primary   -- ★ 一租戶最多一位主要
tenants.owner_notify_max_recipients int not null default 3
owner_notify_reminder_log(tenant_id, kind, ref, sent_at)  -- 提醒去重
```

- **「一租戶最多一位 `is_primary`」由 DB 的部分唯一索引保證，不是靠應用層先查後寫。**
  應用層的 `count` 再 `insert` 在併發下擋不住（兩個請求都讀到 0 位主要）。
- `display_name` **不存在本表**：唯一事實來源是 `line_users.display_name`，
  存副本會在店主改暱稱後分岔。顯示時 join；名稱為空時前端顯示規格的
  fallback 文案 `(LINE 用戶)`。
- `max_recipients` **預設 3**。規格證明這個欄位存在（`>已達上限 ${_notify.maxRecipients} 位`，
  由後端提供），但**沒有任何一句記錄它是幾**——3 是**擁有者 2026-08-25 的裁示**
  （issue #1 裁示總表），理由：推播額度 200 則/月，而通知每次發給 n 位就消耗 n 則，
  上限直接決定額度燒速；老闆＋兩位主管是常見規模。**我們選的數字，不是原站考據結果。**

### 5.5.2 認領流程：沒有綁定碼，也沒有 webhook 分支

原站的流程是：

```
GET  …/owner-notify/line-users        取「已加入好友、且尚未在名單中」的人
  ↓  （後台下拉選單；空集合時顯示 `尚無可加入的 LINE 好友`）
POST …/owner-notify/bind              本人按「是我，綁定通知」→ `確認是您本人嗎？`
  ↓                                    成功 `綁定成功！之後有新預約會即時通知綁定的 LINE。`
POST …/owner-notify/recipients/:id    之後要加同事按「新增接收者」→ `確認將此人加入通知名單？`
```

⚠️ issue #18 原本設計的「後台產生一次性**綁定碼** → 店主在 LINE 傳該碼 → webhook 認出」
在規格裡毫無出處（`grep -rn '綁定碼' docs/` 零命中），2026-08-25 已整段作廢。
**`bind` 是後台按鈕，不是 LINE 端事件**——確認文案「確認是您本人嗎？」是後台的
confirm 視窗，`jsApiCalls` 把它列在 dashboard 頁的呼叫清單裡。因此 webhook
（§3 的 `handleEvent`）**不需要也不得**為此新增任何分支。

`bind` 與 `recipients/:id` 的寫入行為是同一件事（差別只在畫面語意與文案），
因此兩支端點共用 `addOwnerNotifyRecipient()`——分成兩份實作會慢慢分岔，
而分岔那天不會有測試紅。

### 5.5.3 四支端點契約（method 與形狀＝我方設計）

| 端點 | method | body / 回應 | 備註 |
|---|---|---|---|
| `/api/settings/line/owner-notify` | `GET` | → `{ status, recipients[], maxRecipients }` | 見 5.5.5 狀態語意 |
| 同上 | `DELETE` | → `{ removed: n }` | 「解除全部」（`確定解除全部 ${n} 位接收者的綁定？`）。需 MANAGER |
| `…/owner-notify/line-users` | `GET` | → `{ lineUsers: [{ lineUserId, displayName, pictureUrl }] }` | 已 follow 且不在名單中 |
| `…/owner-notify/bind` | `POST` | `{ lineUserId }` → `{ recipient, maxRecipients }` | 本人認領。需 MANAGER |
| `…/owner-notify/recipients/:id` | `POST` | → `{ recipient, maxRecipients }` | 加入名單。需 MANAGER |
| 同上 | `DELETE` | → `{ promoted: Recipient \| null }` | 移出名單。需 MANAGER |

`:id` ＝ **`line_user_id`**（我方設計）。理由：加入時畫面手上只有 `line-users`
回的 `lineUserId`；加入與移除若用不同的鍵，同一條路徑會有兩種鍵。

⚠️ **原站沒有獨立的 toggle 端點**（`jsApiCalls` 全文沒有 `toggle`）。
「關掉通知」＝移除接收者（單筆或全部）。**不得自行補一支 `toggle`。**

錯誤：非該店好友或已封鎖 → `404 REQ_002`；已在名單中 → `409 REQ_003`；
達上限 → `409 REQ_003`，message 逐字含 `已達上限 ${max} 位`。

### 5.5.4 加入與移除規則

- 名單原本為空 → 加入的**第一位自動成為主要**。
- 已達 `max_recipients` → 加入被拒（前端顯示 `已達上限 ${n} 位`）。
- 移除**非主要** → 其他接收者不受影響（`確定將此人移出通知名單？其他接收者不受影響。`）。
- 移除**主要** → 名單順序（`created_at` 遞增）的**下一位自動遞補為主要**
  （`此人是「主要」接收者。移除後「…」將成為主要接收者（訂閱到期／儲值提醒改發給他）。`）。
  先刪再升，順序不可反——反過來會有一瞬間兩位主要，撞唯一索引。
- 移除**最後一位** → 名單為空、之後不再發送。**這不是我方選擇，是規格逐字**：
  `這是最後一位接收者，移除後將不再收到 LINE 即時通知。確定移除？`
  所以不擋、不自動關閉任何東西、也不留下「殘存的主要」。

### 5.5.5 狀態語意：三態＋一個規格沒蓋到的態

```
NOT_CONFIGURED  沒有 Channel Access Token（解密後為空）          → `未設定 LINE`
NO_RECIPIENTS   有 token，但名單是空的                            → 我方新增，見下
DISCONNECTED    有名單，但 GET /v2/bot/info 打不通                → `LINE 通知已綁定（連線中斷）`
ENABLED         有名單，且剛剛真的問過 LINE 且回 200              → `LINE 通知已開啟`
```

- **每一態都是實際查證過的事實。** 特別是 `ENABLED` 與 `DISCONNECTED` 的分界：
  這裡**不沿用** `DashboardStats.linePlatformStatus`——那一支「有 token 字串就叫
  CONNECTED」，從未呼叫過 LINE（CLAUDE.md 點名的例子）。「已綁定」與「連線正常」
  是兩件事，要分得開就必須真的問一次。`GET /v2/bot/info` 不佔推播額度。
- `NO_RECIPIENTS` 是**我方新增**（規格三態蓋不住）：LINE 設好了但名單是空的時候，
  一則通知都不會發出去，說「已開啟」就是假的已知。畫面照實說「尚未加入接收者」。
- `DISCONNECTED` 時畫面顯示規格逐字的
  `LINE 連線已中斷，通知暫停發送中——請至 LINE 設定頁 檢查並重新儲存設定以恢復。`

### 5.5.6 觸發事件與額度

| 事件 | 收件者 | 額度 | 觸發點 |
|---|---|---|---|
| 新預約 | 名單**全部** n 位 | **n 則** | `POST /api/bookings`（`void notifyOwnerNewBooking(...)`） |
| 訂閱到期提醒 | **僅主要一位** | 1 則 | `GET /api/cron/owner-reminders`（每日） |
| 儲值提醒 | **僅主要一位** | 1 則 | 同上 |

- 規格逐字：`每次通知會同時發給 ${n} 位（消耗 ${n} 則推播額度）`、
  `「主要」接收者另外會收到訂閱到期／儲值提醒（僅發給主要一位）。`
- **不用 multicast，逐一 `push`**：畫面說的則數與實際送出的請求數必須對得起來；
  multicast 一次呼叫送 n 人，送失敗時分不出是哪一位。
- 額度**先整包扣 n 則**再送；扣不到就**一則都不送**（半套送出會讓一部分人收到、
  一部分沒收到，而畫面說的是「同時發給 n 位」）。額度不足時**預約仍然成立**，
  通知失敗只 log（fire-and-forget，同 §5 規約）。
- **「顧客自行取消」不納入。** `dashboard.json` 全文沒有任何一句把取消與老闆通知
  綁在一起；擁有者 2026-08-25 裁示不納入（issue #1 裁示總表）——加一個觸發很便宜，
  發一堆沒人要的通知把 200 則/月的額度燒光很貴。日後找到出處再加。

### 5.5.7 `owner-reminders` cron 的判定條件（一個既有、一個我方設計）

| 提醒 | 判定 | 出處 |
|---|---|---|
| 訂閱到期 | `feature_subscriptions.active` 且 `expires_at ∈ (now, now + FEATURE_EXPIRY_WARNING_DAYS]` | **既有常數**（`src/config/features.ts`；`/api/reports/dashboard-alerts` 的 `expiringFeatures` 用同一個窗） |
| 儲值 | 點數餘額 < 上述即將到期訂閱的續訂所需點數總和 | ⚠️ **我方設計** |

⚠️ 儲值提醒的門檻**規格未載**（`grep -rn 儲值 docs/specs/` 的命中全部在點數頁與
功能商店頁，都是儲值流程本身，沒有一句記錄提醒門檻）。選這個條件的理由：
它不引進任何新的魔術數字——兩個數都是系統裡已經有的（餘額 = `tenant_point_transactions`
最新一筆的 `balance_after`；所需 = `FEATURE_CATALOG` 的月費），而且它解釋了規格為什麼
把「訂閱到期」與「儲值」寫成同一組提醒（`feature-store.json`：「點數不足時可前往
『點數管理』儲值」）。**已在 issue #18 留言列為規格缺口，找到出處再改。**

去重（每日跑，同一件事不可以連發七天）走 `owner_notify_reminder_log`：
訂閱到期 `ref = '<code>@<expires_at>'`（一張訂閱一次）、儲值 `ref = 台北月份鍵`
（一個月一次）。**推播真的送出去了才寫紀錄**——否則這次沒送到、下次也不會再送。

---

## 6. Rich Menu / Flex 選單（line-settings、rich-menu-design 頁）

端點（原站清單 `/api/settings/line/rich-menu*`）最小可用集：

| 端點 | 做法 |
|---|---|
| POST `/api/settings/line/rich-menu/create` | ① 依 `richMenuTheme` 產生 2500×1686 選單設定（6 格：預約/我的預約/服務項目/會員卡/優惠/聯絡我們，action=message 或 uri 到公開頁）② `POST /v2/bot/richmenu` 建立 ③ 上傳圖片 `POST https://api-data.line.me/v2/bot/richmenu/{id}/content`（圖檔：MVP 用預先做好的主題底圖存 `richmenu-assets` bucket；設計器合成屬後期）④ `POST /v2/bot/user/all/richmenu/{id}` 設為預設 ⑤ richMenuId 記到 `tenant_settings.line` jsonb |
| ~~POST `/api/settings/line/rich-menu/upload-bg-image`~~ | **（2026-08-26 刪除）** 這件事由 `POST /api/upload`（`bucket=richmenu-assets`，07 分冊 §3）承擔，選單設計頁走的一直是它；本端點零呼叫端且只信 `file.type`（缺 `/api/upload` 的解碼比對），留著只會是同一件事的第二份實作。它唯一多出來的 1 MB 伺服器端守門已搬進 `/api/upload` 的 `BUCKET_MAX_BYTES`，見下方「§6.1 底圖上傳的單一入口」 |
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

### 6.1 Flex 卡片契約 —— `linkUrl` 的可用 scheme（14 分冊 §8.20 / §8.20-b）

卡片契約是 `{title, subtitle, imageUrl, ad, linkUrl?}`，存在 `tenant_settings.line`
jsonb 的 `flexCards` 鍵，上限 12 張（LINE carousel 的 bubble 上限）。

`linkUrl` 是 §8.20 擁有者裁決加上的第五欄：填了 → 卡片底部按鈕變成 `uri` action，
沒填（空字串或缺鍵）→ 維持 `message` action（送出 title）。**兩種 action 擇一，不並存。**

**可用 scheme（白名單）** —— 2026-08-25 擁有者裁決 §8.20-b「**廣告卡全開**」：
LINE 的 `uri` action 實測收什麼，本平台就收什麼，一個都沒再扣。

| scheme | LINE `validate/reply` | 進白名單 |
|---|---|---|
| `https://` | 200 | ✅ |
| `http://` | 200 | ✅ |
| `line://` | 200 | ✅ |
| `tel:` | 200 | ✅ |
| `mailto:` | 200 | ✅ |
| `sms:` | 400 `invalid uri scheme` | ❌ |
| `javascript:` / `data:` / `ftp:` / `file://` | 400 `invalid uri scheme` | ❌ |
| 無 scheme（`/foo`、`a.example/foo`） | 400 `invalid uri` + `invalid uri scheme` | ❌ |

實測出處：`scripts/verify/flex-menu-validate.cjs` 的「scheme 探測」段，
打 LINE 官方 `POST /v2/bot/message/validate/reply`（不耗推播額度）。

判斷規則（**唯一出處**：`src/config/tenant-settings.ts` 的 `isAllowedFlexLinkUrl()`，
寫入驗證 / webhook 讀取路徑 / 頁面前端三處共用同一支）：

1. 先 `trim()`，存進 jsonb 的也是 trim 後的值——LINE 對前置空白的網址回 400。
2. scheme 比對 **case-insensitive**（LINE 對 `HTTPS://` 回 200）。
3. 必須以白名單的某個 scheme 開頭。所以 `JavaScript:`、`" javascript:"`、
   `<TAB>javascript:`、`java<TAB>script:` 等變形全部落在白名單外。

⚠️ **必須是白名單，不得改成黑名單。** 黑名單只擋得住今天想得到的字串，明天多一個
沒人想過的 scheme 就會直接送到顧客手上，而**沒有任何測試會紅**；白名單漏掉一個合法
scheme 只是少一個功能、店家會反映。兩種錯的代價不對等。

⚠️ **不要把 `linkUrl` 的規則寫成 https-only。** https-only 的是 **hero 圖的 `url`**
（`imageUrl`，LINE 對 http 回 400），那是另一個欄位。14 分冊 §8.20 曾把兩者混為一談
並附上一個不支持該主張的引用，§8.20-b 有完整經過。

讀取路徑（`normalizeFlexCards()`）與寫入驗證刻意不同調：寫入時一張不合規整包 400，
店家當場看得到；讀取時顧客正在等回覆，所以**只丟掉那個連結、卡片留著**、按鈕退回
message action。一個壞連結不得帶走整張卡。

---

進階設計器（rich-menu-design 頁的 create-advanced / preview-* 端點）標為 Phase 6+，
留待 rich menu 基本流程可用後再逐一實作。**同屬未實作、但頁面已有 UI 的還有**：
每格自訂文字/連結接上發布、儲存草稿、還原前次發布、背景圖上傳按鈕接 `/api/upload`
（目前是無 onClick 的死按鈕）——在接上之前，頁面必須明示「尚未生效」（鐵則 12），
不得顯示成功。

> **（2026-08-26，issue #19 更新）** 上面這一段是本節被展開之前的狀態，保留供追溯。
> 進階設計器的 11 支端點契約、狀態機、回滾與還原點策略**已展開為下方 §6.2**，
> 該組端點不再是「Phase 6+ 待實作」。§6.2 是這一組的唯一規格出處。

### 6.1 底圖上傳的單一入口（2026-08-26 新增）

Rich Menu 底圖的上傳**只有一個入口**：`POST /api/upload`，`bucket=richmenu-assets`。

先前有第二支 `POST /api/settings/line/rich-menu/upload-bg-image`。它是綠燈孤兒
（14 分冊 §10：有實作、有守門、**零呼叫端**），本輪刪除，理由三條：

1. **接上去會是退步。** 它只看 `file.type` 就決定格式，而 `/api/upload` 會實際解碼
   並比對宣告的 MIME——那道檢查正是為了堵「改名的 WebP 冒充 `image/jpeg`」而加的
   （見 14 分冊 §6.7 的「順手補的一個洞」）。換過去等於把已修好的漏洞放回來。
2. **同一件事兩份實作**是本專案反覆抓到的缺陷家族：短期看起來一樣、長期一定分岔，
   而分岔那天沒有任何測試會紅。這一支與 `/api/upload` 的 `richmenu-assets` 分支
   目標完全相同（同 bucket、同格式限制、同回傳形狀）。
3. 它與 `flex-menu.ts` 的 `FLEX_POPUP` 分支**不同性質**，所以不適用那種「已實作、
   已測試、刻意尚未被使用」的誠實標註：FLEX_POPUP 是還沒有觸發條件的**未來能力**，
   這一支則是已經被更好的實作取代的**過去能力**——標註它只會讓下一個人以為
   還有一條路可以接。

它唯一比 `/api/upload` 強的地方是 **1 MB 的伺服器端上限**（LINE
「Requirements for rich menu image」的 Max file size: 1 MB）。因為零呼叫端，那道
守門從來沒有生效過；真正走的 `/api/upload` 放行到 5 MB，1 MB 只在選單設計頁的
前端 `RICH_MENU_BG_MAX_BYTES` 擋，繞過前端就能塞 5 MB 進來，然後在「發布」那一刻
才被 LINE 退回——失敗被推遲到使用者已經離開畫面、手上也不再握著那個檔案的時候。

所以守門**搬到有流量的那一支**：`/api/upload` 新增 `BUCKET_MAX_BYTES`
（`richmenu-assets` → 1 MB，其餘 bucket 維持 5 MB）。限制跟著「這張圖最後會流到
哪裡」走，與該檔既有的 `LINE_BOUND_BUCKETS` / `LINE_PREVIEW_BUCKETS` 同一條原則。

---

## 6.2 進階選單設計器：11 支端點（issue #19，2026-08-26 展開）

本節把原本那一句「標為 Phase 6+，留待……再逐一實作」展開成完整規格。
在此之前這一組**沒有契約、沒有 schema、沒有驗收格子**，所以清單上永遠不會出現漏勾
（14 分冊 §0 根因 B ＋ 根因 C）。

### 6.2.0 先講三件會影響整節怎麼讀的事實

**(1) 原站規格只留下路徑，沒有留下 method 與形狀。**
`docs/specs/rich-menu-design.json` 的 `jsApiCalls`、`docs/specs/line-settings.json`
與 `docs/specs/_endpoints.json` 是**扁平的字串清單**，只有 URL。原站的 inline JS
（590 KB）沒有被抓進 spec，所以：

> **下方每一支端點的 method、request body、response 形狀，全部是「我方設計」，
> 不是還原的原站契約。** 比照 §5.5.3 老闆通知那一組的標註慣例。

看到本節的欄位名時不要當成考據結果——它們沒有出處，只有設計理由。

**(2) `booking-step-guide` 不在 `rich-menu/` 底下。**
規格逐字是 `/api/settings/line/booking-step-guide`
（`docs/specs/rich-menu-design.json:1420`、`docs/specs/_endpoints.json:144`），
**不是** `/api/settings/line/rich-menu/booking-step-guide`。issue #19 的範圍表用
`POST …/booking-step-guide` 表示，而該表的 `…` 展開是 `/api/settings/line/rich-menu`
——照抄會做出一支規格上不存在的路徑。以規格為準。

**(3) `preview-custom` 不存在。**
40 個 spec 檔零命中；規格的第三支預覽端點是 `preview-scene-flex`
（`docs/specs/rich-menu-design.json:1431`）。issue #19 已於 2026-08-25 更名。

### 6.2.1 資料模型（migration 0025）

一張表 `rich_menu_designs`，主鍵 `(tenant_id, kind)`，`kind` 三態：

| kind | 意義 | 幾份 |
|---|---|---|
| `DRAFT` | `advanced-config` 讀寫的草稿。**與 LINE 無關**，存了不代表顧客看得到 | 每租戶 1 |
| `PUBLISHED` | 目前真的掛在 LINE 上、且是預設選單的那一份設計 | 每租戶 1 |
| `RESTORE_POINT` | 上一次發布（被現在這一份取代掉的那一份） | 每租戶 **1** |

```sql
create table rich_menu_designs (
  tenant_id         uuid not null references tenants(id) on delete cascade,
  kind              text not null check (kind in ('DRAFT','PUBLISHED','RESTORE_POINT')),
  config            jsonb not null default '{}'::jsonb,
  line_rich_menu_id text not null default '',
  updated_at        timestamptz not null default now(),
  primary key (tenant_id, kind)
);
```

**「保留幾份」＝ 1 份，而且是主鍵保證的，不是靠清理排程。**
擁有者 2026-08-25 裁決「只支援還原到上一次發布」（#1 裁示總表）。
用 `(tenant_id, kind)` 當主鍵、一律 upsert，份數上限就是資料庫結構本身的性質——
沒有「保留 N 份」的設定值可以被改壞，也沒有需要跑的 GC。

⚠️ **草稿不是發布。** `DRAFT` 存在不代表 LINE 端有任何東西。頁面顯示草稿狀態時
不得寫成「已套用」「已上線」之類的字（鐵則 12）。

### 6.2.2 還原點策略（**先寫得出這一段，才可以動 `restore-previous`**）

還原點**同時**存兩樣東西，因為它們會在不同情況下失效：

| 存什麼 | 用途 | 什麼時候沒用 |
|---|---|---|
| `config` jsonb（整份設計） | 重建用 | 永遠有效 |
| `line_rich_menu_id` | 直接切回去用 | 店家在 LINE OA Manager 手動刪過、或 token 換頻道 |

**發布時的三代輪替**（`publishRichMenu()`，`src/server/rich-menu.ts`）：

```
發布前：  RESTORE_POINT = A(舊舊)        PUBLISHED = B(現行, LINE 上是預設)
發布後：  RESTORE_POINT = B              PUBLISHED = C(新)
LINE 端： A 的選單被刪除                 B 的選單「保留但不再是預設」    C 設為預設
```

所以 LINE 端每租戶最多留 **2** 張選單（現行 + 可還原的上一張），不是無限累積。
**B 的選單刻意不刪**——留著，`restore-previous` 就只要 `POST
/v2/bot/user/all/richmenu/{B}` 把它切回預設，不必重新上傳底圖，還原到的是
**位元組完全相同的那一張**，不是「照設計重畫一張很像的」。

⚠️ 這一點與基本 `create` 端點的行為**不同**：`create`（§6 表格）換新之後
best-effort 刪掉舊選單。進階這一組刻意不刪，理由就是上面那一句。改動任何一邊之前
先讀懂另一邊為什麼不一樣。

**`restore-previous` 的兩條路徑（都要實作，不得只做第一條）：**

1. `line_rich_menu_id` 還在 → `lineSetDefaultRichMenu()` 切回去。回 `source:'LINE_MENU_REUSED'`。
2. 上面那一步被 LINE 退（選單已被手動刪除 / id 失效）→ **用 `config` 重跑一次建立序列**
   （建立→上傳底圖→設預設），產生新的 richMenuId。回 `source:'RECREATED'`。

**沒有還原點時回 404，訊息要說清楚「為什麼沒有」，不得靜默成功。**
第一次發布之後本來就沒有上一次可還原——這不是錯誤，是狀態，訊息要講出這件事。

**還原之後，還原點換成剛剛被換下來的那一份**（C），也就是還原是可以再還原回去的
一次來回。這是「只保留 1 份」的必然結果，不是額外功能：只要不引入第二份，
「上一次」永遠只有一個意思。

### 6.2.3 回滾：兩種孤兒都要處理

建立一張選單是 **LINE 端 3 個呼叫 ＋ 我方 DB 2 個寫入**的複合動作，中間任何一步失敗
都可能留下**孤兒**。兩個方向都要處理，只堵一邊等於沒堵：

| 失敗點 | 孤兒長什麼樣 | 處理 |
|---|---|---|
| LINE 建立成功、**上傳底圖或設預設失敗** | LINE 端多一張沒有圖、也沒人用的選單 | `lineDeleteRichMenu(newId)` 後把原錯誤丟出去。**已在基本 `create` 實作，進階沿用同一段** |
| LINE 全成功、**DB 寫入失敗** | DB 說還是舊的，LINE 端卻已經換成新的——**顧客看到的與後台顯示的不一致** | 把預設選單切回舊的 `PUBLISHED.line_rich_menu_id`（有的話），刪掉剛建立的 `newId`，然後丟 500。**不得吞掉 DB 錯誤只回成功** |
| DB 寫入成功、**best-effort 刪除三代前的選單失敗** | LINE 端多留一張舊選單 | 只 `console.error`，**不影響結果**。這一張不影響任何人看到的畫面，為它把一次成功的發布回滾才是更糟的選擇 |

⚠️ 第二列是最容易被寫漏的一列：`await supabase.upsert()` 的 `error` 不丟出去，
畫面就會顯示「已發布」而 DB 沒有那一列——下一次發布會拿錯的東西當還原點。
**`upsert` 的 `{ error }` 一律要檢查並丟出。**

### 6.2.4 三支 `create-*`

共同前置：`requireTenant('MANAGER')` → `requireFeature('CUSTOM_RICH_MENU')`
（09 分冊 §5：進階端點擋，基本 5 主題不擋）→ `getLineCredentials()`。
共同流程：§6.2.2 的三代輪替 ＋ §6.2.3 的回滾。
共同 response：`{ richMenuId: string }`。

| 端點 | request body | 差別 |
|---|---|---|
| `POST …/create-advanced` | `{ theme, layout, cells[], bgImageUrl?, chatBarText?, name? }` | 用 `layout` 的**格線**算 areas |
| `POST …/create-custom` | `{ areas: [{ bounds:{x,y,width,height}, label, action, value }], bgImageUrl?, chatBarText?, name? }` | 呼叫端自己給座標，不套格線 |

> ⚠️ **`create-custom` 目前沒有任何呼叫端**，而且這是刻意的：選單設計頁只有
> `RICH_MENU_LAYOUTS` 的七種格線版型，**沒有自由座標編輯器**，畫不出任意矩形。
> 端點與 `src/services/settings.ts` 的包裝是照規格補齊的能力——**已實作、已整合測試、
> 刻意尚未被使用**，不是已經生效的功能（標註方式比照 `flex-menu.ts` 的 `FLEX_POPUP`
> 分支與 14 分冊 §8.8）。
>
> 它與 §6.1 刪掉的 `upload-bg-image` **不同性質**：那一支是被更好的實作取代的
> **過去能力**（留著只會讓人以為還有一條路可以接），這一支是還沒有 UI 可以觸發的
> **未來能力**。判準是「有沒有第二條路在做同一件事」——這裡沒有。
> **頁面不得因為它存在就宣稱支援自由座標排版。**
| `POST …/create-scene` | `{ sceneId }` | 從 `SCENE_TEMPLATES` 取設定 |

`layout` 可用值與格數（`RICH_MENU_LAYOUTS`，`src/config/rich-menu-layouts.ts`，
頁面與後端共用同一份）：
`3+4`(7)、`2x3`(6)、`2+3`(5)、`2x2`(4)、`1+2`(3)、`3+4+4`(11)、`4+4`(8)。

底圖尺寸**固定 2500×1686**（LINE 只收 2500×1686 或 2500×843；本專案的版型都 ≥2 列，
一律用 1686）。列高、欄寬用整數除法，**餘數補到最後一列／最後一欄**——不補的話
會在圖的右緣或下緣留下一條沒有任何 area 蓋到的死區，顧客按下去沒反應。

每格 action 一律經 `richMenuCellAction()`（§6 的單一事實來源要求）：

| 頁面上的 action | 送給 LINE 的 | 備註 |
|---|---|---|
| `SEND_TEXT` | `{type:'message', label, text: value}` | `value` ≤ 300 字（LINE 上限） |
| `OPEN_URL` / `OPEN_URL_AD` | `{type:'uri', label, uri: value}` | scheme 走 `isAllowedFlexLinkUrl()` 白名單（§6.1） |
| `FLEX_POPUP` | `{type:'message', label, text: FLEX_POPUP_TRIGGER_TEXT}` | 與顧客自己打「選單」走同一條路徑 |

`label` ≤ 20 字（LINE 的 action label 上限）；areas ≤ 20 個（LINE 的 rich menu 上限）。

**`create-scene` 的已知規格缺口（不得憑空補回）：**
`REBUILD-SPEC` §9.3 第 1 點記載原站「哪一句文案屬於哪一個範本」的對應**已遺失**
（spec 只留下排序後的扁平字串）。所以情境範本目前**只決定主題配色**，每格文案一律
用 `MODE_PRESETS[businessType].richMenuCells`、版型用預設 `3+4`。
⚠️ 這件事**必須寫在店家讀得到的畫面上**，不能只寫在這裡：店家看到「海鮮餐廳」範本，
合理預期會拿到海鮮餐廳的六格文案。

### 6.2.5 三支 `preview-*`：**零 LINE 呼叫**，這是硬性條件

| 端點 | request | response |
|---|---|---|
| `POST …/preview-advanced` | 同 create-advanced 的 body | `{ size, areas[], background, imageDataUrl }` |
| `POST …/preview-scene` | `{ sceneId }` | 同上 |
| `POST …/preview-scene-flex` | `{ sceneId? }` | `{ kind, messages[] }`（聊天室 Flex 主選單的預覽 payload） |

> **預覽端點一行都不准碰 LINE。** 不呼叫 `/v2/bot/richmenu`、不呼叫
> `/v2/bot/user/all/richmenu`、不上傳任何 content。這是這一組**最容易寫成
> 「按了預覽結果真的發出去了」**的地方：預覽與發布共用同一段組裝程式碼，
> 只要順手把 `publishRichMenu()` 叫下去，畫面上看起來一模一樣，而顧客的選單被換掉了。
>
> 釘住這件事的斷言是 **mock LINE 的 richmenu 建立次數為 0**，不是「回傳值長得對」。

`imageDataUrl` 是 `data:image/png;base64,…` 的**縮圖**（500×337，`solidColorPng()`），
不是 2500×1686 原圖——預覽不需要原尺寸，塞原尺寸只是讓 response 變大。

⚠️ **預覽圖是純色底圖，圖上沒有店名、沒有格子文字、沒有格線**，因為
`create` 上傳給 LINE 的就是這樣一張圖（`src/server/png.ts` 只會產純色矩形，
本專案沒有裝任何影像合成套件）。頁面右側那塊 CSS 預覽把文字畫在色塊上，
**那是後台的示意圖，不是顧客會看到的東西**——這句話已經常駐在頁面上，
接上真預覽之後仍然要留著。

### 6.2.6 `GET/PUT …/advanced-config`（草稿）

| method | request | response |
|---|---|---|
| `GET` | — | `{ draft: Design\|null, published: {config, richMenuId, updatedAt}\|null, restorePoint: {updatedAt}\|null }` |
| `PUT` | `Design` | `{ updatedAt }` |

- `GET` 不擋功能閘門（唯讀、不打 LINE、不寫 DB）；`PUT` 擋 `CUSTOM_RICH_MENU`。
- **往返一致**：`PUT` 存什麼，`GET` 就要拿回什麼（含 cells 的順序與空字串欄位）。
  這是這一支唯一有意義的驗收——存進去被 normalize 掉一半，店家重整就發現設定變了。
- `restorePoint` 只回 `updatedAt`，**不回 config**：畫面只需要知道「有沒有可還原的」
  與「是什麼時候的」。回整份設計沒有畫面在用，只是多一份可以分岔的資料。

### 6.2.7 `POST …/restore-previous`

request `{}`；response `{ richMenuId, source: 'LINE_MENU_REUSED' | 'RECREATED' }`。
行為與失敗語意見 §6.2.2。沒有還原點 → **404**，`code = REQ_002`。

### 6.2.8 兩支上傳端點與 §6.1「單一入口」的關係

§6.1（2026-08-26）裁定底圖上傳**只有一個入口** `POST /api/upload`，並據此刪掉了
`upload-bg-image`。本節新增 `upload-image` / `upload-cell-icon` 兩支，**不牴觸那條規則**，
因為 §6.1 反對的是**第二份實作**（它逐字寫的是「同一件事兩份實作……短期看起來一樣、
長期一定分岔」），而不是第二個路徑名。

作法：`/api/upload` 的驗證與落地邏輯抽成 `src/server/upload.ts` 的
`uploadToBucket()`，三支路由**共用同一支函式**，`/api/upload` 自己也改成呼叫它。
沒有第二份可以分岔的邏輯，`BUCKET_MAX_BYTES`（`richmenu-assets` → 1 MB）
與 MIME 解碼比對三支一體適用。

| 端點 | 多做的那件事（＝它存在的理由） |
|---|---|
| `POST …/upload-image` | 上傳完**順手寫進 `tenant_settings.line.richMenuBgImageUrl`**。發布端點讀的是這個欄位而不是請求 body，少了這一步，「上傳成功」就只是半個事實 |
| `POST …/upload-cell-icon` | 上傳完寫進 `DRAFT.config.cells[i].icon` |

⚠️ **`upload-cell-icon` 的誠實邊界**：圖示會被上傳、會被存進草稿、下次開頁面會讀回來
——但**不會出現在 LINE 選單的底圖上**，因為本專案沒有影像合成能力
（`png.ts` 只產純色矩形）。這句話**必須寫在按鈕旁邊**，不能只寫在這裡：
店家上傳一個圖示、看到「已上傳」，合理預期它會出現在選單上。

### 6.2.9 `PUT /api/settings/line/booking-step-guide`

**路徑不在 `rich-menu/` 底下**（§6.2.0 第 (2) 點）。method 用 `PUT`
（＝我方設計，與 `advanced-config` 的寫入一致；`rich-menu-design/page.tsx` 檔頭
原本就寫 `PUT`）。**不擋功能閘門**——§8.21 已裁決 Flex 主選單不收費，
步驟引導屬同一區。

存進 `tenant_settings.line.bookingStepGuide`：

```ts
{ enabled: boolean, steps: [{ key, title, color }] }   // 七步，key 固定
```

七個 key 與預設值逐字取自 `docs/specs/line-settings.json` 的 `looseFields[20..33]`
（`placeholder` 是原站的預設標題，`value` 是原站的預設色）：

| key | 預設 title | 預設 color | spec 出處 |
|---|---|---|---|
| `SERVICE` | `✂️ 選擇您的服務` | `#4A90D9` | `stepServiceTitle` / `stepServiceColor` |
| `DATE` | `📅 選擇預約日期` | `#1DB446` | `stepDateTitle` / `stepDateColor` |
| `STAFF` | `👤 選擇服務人員` | `#4A90D9` | `stepStaffTitle` / `stepStaffColor` |
| `TIME` | `⏰ 選擇時段` | `#4A90D9` | `stepTimeTitle` / `stepTimeColor` |
| `NOTE` | `📝 備註事項` | `#5C6BC0` | `stepNoteTitle` / `stepNoteColor` |
| `CONFIRM` | `📋 確認預約資訊` | `#1DB446` | `stepConfirmTitle` / `stepConfirmColor` |
| `SUCCESS` | （空，用系統預設標題） | `#1DB446` | `stepSuccessColor`（title 欄在原站就是唯讀提示） |

response 一併回**引導卡的 Flex bubble payload**（`buildBookingStepGuideCard()`），
好讓它能過 LINE 的 `POST /v2/bot/message/validate/reply` 而不必真的發訊息。

> ### ⚠️ 這一支目前**存得到、但顧客收不到**，而且必須這樣說
>
> 原站的引導卡是「預約 carousel **最前面**那張『👈 往左滑動 ＋ 步驟清單』指引卡」
> （`docs/REBUILD-SPEC.md` `bookingStepGuideToggle` 的 label 逐字）。
> **本專案沒有那個 carousel**：`src/server/line-events.ts` 的 `replyServiceList()`
> 對「預約 / 服務 / 服務項目」回的是**純文字服務清單**，不是 Flex carousel。
>
> 所以引導卡沒有可以被插在前面的東西。設定會被存下來、讀得回來、payload 也過 LINE
> 驗證，**但顧客端目前不會因為這個開關而看到任何變化**。
>
> 這是「absence of data ≠ invented data」的同一條線：把設定存起來是誠實的，
> 顯示「已套用，顧客現在會看到引導卡」則是編造。**畫面上必須明講**。
> LINE 端的對話式預約流程（carousel）屬於尚未建置的範圍，不在 issue #19。

### 6.2.10 `flexShowTip`：判定結果與採用的語意（14 分冊 §8.22-b/-c 結案）

**判定得出來的部分：`flexShowTip` 不屬於步驟引導，屬於 Flex 主選單那一組。**
依據四條，全部可在 `docs/specs/line-settings.json` 的 `looseFields` 逐字驗證：

1. **id 前綴**：七組步驟欄位一律 `step*`（`stepServiceColor`…`stepSuccessColor`）；
   `flexShowTip` 是 `flex*`，與 `flexMenuEnabledToggle`、`flexMenuFallbackHint/Silent`、
   `flexHeaderColor/Title/Subtitle` 同一族。
2. **CSS class**：14 個步驟欄位全部帶 `flex-step-color` / `flex-step-title`；
   `flexShowTip` 只有 `form-check-input`，與 `flexMenuEnabledToggle` 相同。
3. **`help` 屬性**：每一個步驟欄位的 `help` 都寫著它屬於哪一步（選擇服務／選擇日期／…）；
   `flexShowTip` 的 `help` 是空字串，與它前面的 `flexHeaderTitle`/`flexHeaderSubtitle` 一致。
4. **步驟引導已經有自己的開關，而且在另一頁**：`bookingStepGuideToggle`
   （`docs/specs/rich-menu-design.json:243`），label 完整描述了它控制什麼。
   同一件事在兩頁各有一顆開關、其中一顆還沒有任何說明文字——證據不支持這個讀法。

**判定不出來的部分：它具體控制什麼文字、出現在哪裡。**
`help` 是空字串；`jsStrings` 全文只有「已設為純文字提示模式」一句含「提示」，
而那句屬於 fallback 模式；沒有任何 card 的 bodyText 提到「顯示使用提示」。
`grep '顯示使用提示' docs/specs/` 全站只命中這一個欄位定義本身。**原站語意救不回來。**

於是照 issue #19 的規則走預設語意——

> **⚠️ 以下語意是我們選的，不是從原站還原的。**
> 後來的人不要把它當考據結果引用。

`flexShowTip=true` 時，Flex 主選單 carousel 之**後**多送一則純文字使用提示。

- **只在 `buildFlexMenuOutcome()` 回 `FLEX` 時生效。** `HINT`／`SILENT`／`NO_CARDS`
  一律不加：`HINT` 本身就是一句提示，再補一句是重複；`SILENT` 是店家明講「完全不回」，
  在那裡加任何東西就是把開關做假。
- **不做成「carousel 最前面插一張提示卡」。** carousel 上限 12 bubbles
  （`MAX_FLEX_CARDS`），店家編滿 12 張時提示卡會擠掉第 12 張：要嘛整包被 LINE 退
  （顧客一張都收不到），要嘛我們自己砍一張而畫面說已儲存。
- 提示文字是**對顧客說的話**，放 `src/server/flex-menu.ts` 的 `MSG` 常數
  （與 `fallbackHint`、`adBadge` 同一層），不進 `src/i18n/`。
- **預設值是 `true`**：既有店家一上線就會多收到一則。這是裁決要的效果。

**連帶的結構修正（沒有它，開關還是假的）：**
`FlexMenuOutcome` 從單數 `message` 改成 `messages: LineMessage[]`，
`line-events.ts` 整包送。留著單數欄位不改，就會出現「開關開了、第二則沒送出去」
——換一種寫法的同一顆假開關。守門測試 `grep` 全專案不得再出現 `[outcome.message]`。

### 6.1 關鍵字回覆圖片的 Storage 決策（issue #50）

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
- [ ] 上傳 JPEG/PNG 關鍵字圖後重新 GET 仍為同一 storage ref；mock LINE 收到一則 IMAGE，原圖／preview URL 與 DB 一致；停用或移除後不再送圖
- [ ] 後台 chat 頁看得到收到的訊息；回覆後手機收到（額度 -1）
- [ ] 確認預約 → 已綁定顧客的 LINE 收到通知；關掉 notifyBookingConfirmed 後不再收到
- [ ] 錯誤簽章打 webhook 回 401；正確簽章但處理中丟錯仍回 200
