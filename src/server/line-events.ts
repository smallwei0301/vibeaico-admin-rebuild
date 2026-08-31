/**
 * src/server/line-events.ts — LINE webhook 事件分派（handleEvent）
 * 規格：docs/integration/06-LINE-INTEGRATION.md §3 的分派表。
 *
 * 呼叫端：src/app/api/line/webhook/[shopCode]/route.ts（事件迴圈逐一 try/catch）。
 * 這裡丟出的任何錯誤只會被 log，webhook 永遠回 200（LINE 才不會重送）。
 *
 * message(text) 事件的優先序（命中即回覆並停止）：
 *   ① 進行中的下單對話（chat_sessions）② keyword_replies ③ campaigns
 *   ④ 內建指令 ⑤ AI 客服（09 分冊 §7）⑥ defaultReply ⑦ 不回。
 *   無論是否回覆，一律先寫入 chat_messages（direction='IN'）。
 *
 * 佔位（本波不實作，落點見各處註解）：
 * - chat_sessions 下單對話 → 10 分冊 §6.2（Phase 9/10，表併入 0012 之後）
 * - 「行程」輪播 → trips 表尚不存在（Phase 10）
 * - 自動綁定（06 §4.2）：LINE 端個資收集流程收到手機號 → 比對 customers.phone
 *   自動綁定／建新顧客。該流程屬 chat_sessions 個資收集（Phase 9/10），本波
 *   僅支援後台手動綁定（B-5 bind-line 端點），此處不實作。
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { lineReply, lineProfile } from './line';
import { isFeatureActive } from './features';
import { aiReply, type ShopContext } from './ai-reply';
import {
  notifySettingsSchema,
  privacySettingsSchema,
  aiSettingsSchema,
  businessSettingsSchema,
  buildPublicBookingUrl,
} from '@/config/tenant-settings';
import { APP_URL } from '@/config/env';

/** webhook 端已查好的店家列（route.ts select id, shop_code, name） */
export type WebhookTenant = { id: string; shop_code: string; name: string };

/* ------------------------------------------------------------------ 文案 */
/**
 * Bot 對顧客說的話（內建指令與引導文案）— server 端 zh-TW 常數。
 * 比照 src/server/email/templates.ts 先例：這是對「顧客」的訊息，不屬於
 * 後台 UI 的 src/i18n（鐵則 1 管的是頁面元件的 copy）。
 */
const MSG = {
  serviceListTitle: '我們目前提供的服務：',
  serviceListFooter: (url: string) =>
    `想預約請直接告訴我們時間與服務，或到線上預約頁：\n${url}`,
  myBookingsTitle: '您接下來的預約：',
  myBookingsNotBound:
    '還沒有找到您的顧客資料，請提供您的大名與電話，我們幫您查詢與建檔！',
  myBookingsEmpty: '您目前沒有即將到來的預約，歡迎輸入「預約」查看服務項目！',
  statusPending: '（待確認）',
} as const;

/** 服務清單最多列出筆數（06 §3 內建指令 MVP） */
const SERVICE_LIST_LIMIT = 10;

/* ------------------------------------------------------------------ 分派 */
export async function handleEvent(
  admin: SupabaseClient,
  tenant: WebhookTenant,
  token: string,
  lineConfig: Record<string, any>,
  ev: any,
): Promise<void> {
  switch (ev?.type) {
    case 'follow':
      return onFollow(admin, tenant, token, ev);
    case 'unfollow':
      return onUnfollow(admin, tenant, ev);
    case 'message':
      return onMessage(admin, tenant, token, lineConfig, ev);
    case 'postback':
      // 保留：data 格式 action=xxx&…（10 分冊 §6.2 的聊天內下單流程）。MVP 先 log。
      console.log('[line-events] postback', tenant.id, ev.postback?.data ?? '');
      return;
    default:
      return; // 其他事件（join/leave/beacon…）MVP 忽略
  }
}

/* ---------------------------------------------------------------- follow */
async function onFollow(
  admin: SupabaseClient,
  tenant: WebhookTenant,
  token: string,
  ev: any,
): Promise<void> {
  const userId: string = ev.source?.userId ?? '';
  if (!userId) return;

  // 取暱稱頭像；個別失敗（被封鎖過 / API 錯誤）不擋 upsert
  let profile: any = {};
  try {
    profile = await lineProfile(token, userId);
  } catch (e) {
    console.error('[line-events] lineProfile', tenant.id, e);
  }

  // 0005：line_users 主鍵 = (tenant_id, line_user_id)
  await admin.from('line_users').upsert(
    {
      tenant_id: tenant.id,
      line_user_id: userId,
      display_name: profile?.displayName ?? '',
      picture_url: profile?.pictureUrl ?? '',
      followed: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'tenant_id,line_user_id' },
  );

  const { data: row } = await admin
    .from('tenant_settings')
    .select('notify, privacy')
    .eq('tenant_id', tenant.id)
    .maybeSingle();
  const notify = notifySettingsSchema.parse(row?.notify ?? {});
  const privacy = privacySettingsSchema.parse(row?.privacy ?? {});

  const texts: string[] = [];
  if (notify.welcomeMessageText) texts.push(notify.welcomeMessageText); // 空則略過
  // 加好友時即收集個資（未延後）→ 追加個資收集引導
  if (!privacy.deferProfileCollectionEnabled && notify.profileCollectIntroText)
    texts.push(notify.profileCollectIntroText);

  if (texts.length && ev.replyToken)
    await lineReply(token, ev.replyToken, texts.map((text) => ({ type: 'text', text })));
}

/* -------------------------------------------------------------- unfollow */
async function onUnfollow(admin: SupabaseClient, tenant: WebhookTenant, ev: any): Promise<void> {
  const userId: string = ev.source?.userId ?? '';
  if (!userId) return;
  await admin
    .from('line_users')
    .update({ followed: false, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenant.id)
    .eq('line_user_id', userId);
}

/* --------------------------------------------------------------- message */
async function onMessage(
  admin: SupabaseClient,
  tenant: WebhookTenant,
  token: string,
  lineConfig: Record<string, any>,
  ev: any,
): Promise<void> {
  const userId: string = ev.source?.userId ?? '';
  const msg = ev.message ?? {};

  // 無論是否回覆，都先寫入 chat_messages（direction='IN'）——後台 chat 頁的資料來源
  await admin.from('chat_messages').insert({
    tenant_id: tenant.id,
    line_user_id: userId,
    direction: 'IN',
    message_type: msg.type ?? 'text',
    content: msg.type === 'text' ? { text: msg.text ?? '' } : msg,
  });

  // image / sticker / video…：只寫 chat_messages
  if (msg.type !== 'text') return;

  const text = String(msg.text ?? '').trim();
  const replyToken: string = ev.replyToken ?? '';
  if (!text || !replyToken) return;

  // ① 進行中的下單對話 —— chat_sessions 表尚不存在（10 分冊 §6.2，Phase 9/10）。
  //    佔位：屆時查 chat_sessions(tenant_id, line_user_id) 有 step 就交給下單流程，
  //    命中即 return。現在直接往下走。

  // ② keyword_replies（active，keywords 陣列「完全比對」，任一命中即回覆）
  const { data: krs } = await admin
    .from('keyword_replies')
    .select('keywords, reply_type, content')
    .eq('tenant_id', tenant.id)
    .eq('active', true)
    .order('sort_order', { ascending: true });
  const kr = (krs ?? []).find((r: any) => (r.keywords ?? []).includes(text));
  if (kr) {
    const m = keywordReplyMessage(kr);
    if (m) {
      await lineReply(token, replyToken, [m]);
      return;
    }
  }

  // ③ campaigns（PUBLISHED 且 keyword 相符；lineConfig.campaignKeywordEnabled 預設 true）
  if (lineConfig.campaignKeywordEnabled !== false) {
    const { data: camps } = await admin
      .from('campaigns')
      .select('name, content')
      .eq('tenant_id', tenant.id)
      .eq('status', 'PUBLISHED')
      .eq('keyword', text)
      .limit(1);
    const camp = camps?.[0];
    if (camp) {
      // content 為 jsonb（text / image / flex）；MVP 取 text，無則以活動名稱代替
      const t = (camp.content as any)?.text ?? camp.name;
      await lineReply(token, replyToken, [{ type: 'text', text: String(t) }]);
      return;
    }
  }

  // ④ 內建指令（MVP）
  if (text === '預約' || text === '服務') {
    const handled = await replyServiceList(admin, tenant, token, replyToken);
    if (handled) return; // 該店沒有 active 服務時不攔截，落到 ⑤/⑥
  }
  if (text === '行程') {
    // trips / trip_plans / trip_departures 表尚不存在（10 分冊，Phase 10 補行程 Flex 輪播，
    // 資料來源 = 11 分冊 catalog 統一查詢）。佔位：不在此攔截，讓訊息落到
    // ⑤ AI / ⑥ defaultReply（自動回覆開啟時顧客會收到 defaultReply）。
  }
  if (text === '我的預約') {
    await replyMyBookings(admin, tenant, token, replyToken, userId);
    return;
  }

  // ⑤ AI 客服（09 分冊 §7：AI_ASSISTANT 訂閱有效 且 ai.enabled）
  if (await isFeatureActive(tenant.id, 'AI_ASSISTANT')) {
    const { data: row } = await admin
      .from('tenant_settings')
      .select('ai, basic, business')
      .eq('tenant_id', tenant.id)
      .maybeSingle();
    const ai = aiSettingsSchema.parse(row?.ai ?? {});
    // 嚴格模式（issue #27 ①）：ai-settings 頁那顆開關的說明文字寫著
    // 「開啟後，顧客若打純數字（如 1822）、亂碼、單字、符號等『明顯非詢問』訊息，
    //   AI 完全不回覆，讓店家專人親自接。正常詢問（價格/時間/地址）AI 仍會正常回答。」
    // 這裡是那句話唯一的生效點；沒有它，開關就只是一顆存得起來但什麼都不做的鈕。
    // 只跳過分支 ⑤（AI 不回覆），⑥ 的靜態罐頭回覆歸 line-settings 管（§8.1 分家），
    // 本處不代它決定。
    if (ai.enabled && !(ai.strictMode && isLikelyChitchat(text))) {
      const shop = await buildShopContext(admin, tenant, row?.basic, row?.business, ai);
      const answer = await aiReply(text, shop);
      if (answer) {
        await lineReply(token, replyToken, [{ type: 'text', text: answer }]);
        // AI 回覆同樣寫入 chat_messages（direction='OUT'，message_type='ai'）——
        // 店家在後台聊天頁看得到 AI 幫他回了什麼（09 §7.2 規約）
        await admin.from('chat_messages').insert({
          tenant_id: tenant.id,
          line_user_id: userId,
          direction: 'OUT',
          message_type: 'ai',
          content: { text: answer },
        });
        return;
      }
      // AI 判定無法回答（UNSURE）或失敗：優先用店家設定的真人接手文案，
      // 沒設定才落回 ⑥ defaultReply（09 §7「落回 defaultReply / 引導人工」）
      if (ai.handoffMessage) {
        await lineReply(token, replyToken, [{ type: 'text', text: ai.handoffMessage }]);
        return;
      }
    }
  }

  // ⑥ 自動回覆（lineConfig.autoReplyEnabled 預設 true）
  if (lineConfig.autoReplyEnabled !== false && lineConfig.defaultReply) {
    await lineReply(token, replyToken, [
      { type: 'text', text: String(lineConfig.defaultReply) },
    ]);
    return;
  }

  // ⑦ 都沒有 → 不回
}

/* ------------------------------------------------------- 內建指令：服務 */
/** 「預約」「服務」→ active 服務清單（名稱+價格+時長，最多 10 筆）+ 結尾引導語 */
async function replyServiceList(
  admin: SupabaseClient,
  tenant: WebhookTenant,
  token: string,
  replyToken: string,
): Promise<boolean> {
  const { data: svcs } = await admin
    .from('services')
    .select('name, price, duration_minutes')
    .eq('tenant_id', tenant.id)
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .limit(SERVICE_LIST_LIMIT);
  if (!svcs?.length) return false;

  const lines = svcs.map(
    (s: any) =>
      `・${s.name}｜NT$${Number(s.price).toLocaleString('zh-TW')}｜${s.duration_minutes} 分鐘`,
  );
  const shopUrl = buildPublicBookingUrl(APP_URL, tenant.shop_code); // 公開頁 Phase 8 落地
  await lineReply(token, replyToken, [
    {
      type: 'text',
      text: `${MSG.serviceListTitle}\n${lines.join('\n')}\n\n${MSG.serviceListFooter(shopUrl)}`,
    },
  ]);
  return true;
}

/* --------------------------------------------------- 內建指令：我的預約 */
/** 「我的預約」→ 已綁定顧客的未來 PENDING/CONFIRMED bookings 文字清單；未綁定→引導 */
async function replyMyBookings(
  admin: SupabaseClient,
  tenant: WebhookTenant,
  token: string,
  replyToken: string,
  userId: string,
): Promise<void> {
  const { data: lu } = await admin
    .from('line_users')
    .select('customer_id')
    .eq('tenant_id', tenant.id)
    .eq('line_user_id', userId)
    .maybeSingle();
  if (!lu?.customer_id) {
    await lineReply(token, replyToken, [{ type: 'text', text: MSG.myBookingsNotBound }]);
    return;
  }

  // Phase 10：這裡要合併 tour_orders（10 分冊 §6.1 的 MY_BOOKING/ORDER 合併規則）
  const { data: bs } = await admin
    .from('bookings')
    .select('start_at, status, services(name)')
    .eq('tenant_id', tenant.id)
    .eq('customer_id', lu.customer_id)
    .in('status', ['PENDING', 'CONFIRMED'])
    .gte('start_at', new Date().toISOString())
    .order('start_at', { ascending: true })
    .limit(10);
  if (!bs?.length) {
    await lineReply(token, replyToken, [{ type: 'text', text: MSG.myBookingsEmpty }]);
    return;
  }

  const lines = bs.map((b: any) => {
    const svc = Array.isArray(b.services) ? b.services[0] : b.services;
    const suffix = b.status === 'PENDING' ? MSG.statusPending : '';
    return `・${formatTaipei(b.start_at)}｜${svc?.name ?? ''}${suffix}`;
  });
  await lineReply(token, replyToken, [
    { type: 'text', text: `${MSG.myBookingsTitle}\n${lines.join('\n')}` },
  ]);
}

/**
 * 「明顯非詢問」判定 —— ai-settings 頁「嚴格模式」開關的實作（issue #27 ①）。
 *
 * 判準逐字取自那顆開關自己的說明文字：「顧客若打**純數字（如 1822）、亂碼、
 * 單字、符號**等『明顯非詢問』訊息…正常詢問（價格/時間/地址）AI 仍會正常回答」。
 * 翻成可執行的規則，只認說明文字點名的四類，不多不少：
 *
 *   1. 純數字（含全形數字）—— 「1822」
 *   2. 沒有任何中日韓文字或英文字母 —— 純符號、純表情、亂碼「!@#$」「👍」
 *   3. 單一字元 —— 「好」「1」「a」
 *   4. 只有英文字母且長度 ≤ 3 —— 「ok」「hi」「xxx」
 *
 * ⚠️ 刻意**不做**語意判斷。這個函式的錯誤方向要選對：誤判成閒聊會讓一則真的
 * 詢問沒人回（顧客只看到已讀不回），誤判成詢問頂多是 AI 多回一句。所以規則
 * 從嚴、只攔形狀上就不可能是問句的訊息，寧可漏攔。
 *
 * 中文「價格」「地址」都是兩個中日韓字元，規則 3/4 都不會攔到；
 * 「多少錢」「幾點開」同理。
 */
export function isLikelyChitchat(raw: string): boolean {
  const text = raw.trim();
  if (!text) return true;                                  // 空白訊息本來就無從回答

  // 1. 純數字（半形 0-9 與全形 ０-９，允許中間有空白／連字號，如「0912-345-678」）
  if (/^[0-9０-９\s-]+$/.test(text)) return true;

  // 2. 完全沒有文字（中日韓 or 拉丁字母）——純符號／表情／標點
  const hasWordChar = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}A-Za-z]/u
    .test(text);
  if (!hasWordChar) return true;

  // 3. 單一字元（用 Array.from 以碼點計，避免 emoji/罕用字被算成 2）
  const codePoints = Array.from(text);
  if (codePoints.length <= 1) return true;

  // 4. 只有拉丁字母（可含空白）且 ≤ 3 個字元——「ok」「hi」「abc」
  if (/^[A-Za-z\s]+$/.test(text) && codePoints.length <= 3) return true;

  return false;
}

/* ------------------------------------------------------------ AI context */
/**
 * 組 AI 客服的 ShopContext（09 §7.2）。
 * services 由 services 表即時組；trips/departures：資料表尚不存在（10 分冊），
 * 先回空陣列 —— Phase 10 改接 11 分冊 catalog 端點的同一組查詢（規格明定
 * 不得另外實作一份查詢，確保 AI 講的與商店頁、LINE 輪播完全一致）。
 */
async function buildShopContext(
  admin: SupabaseClient,
  tenant: WebhookTenant,
  basicRaw: unknown,
  businessRaw: unknown,
  ai: { personaNotes?: string; faq?: { q: string; a: string }[] },
): Promise<ShopContext> {
  // basicSettingsSchema 有必填欄位（tenantName/shopCode），老店 jsonb 可能整包空
  // → 不能 parse，逐欄 fallback 到 tenants 列
  const basic = (basicRaw ?? {}) as Record<string, any>;
  const parsed = businessSettingsSchema.safeParse(businessRaw ?? {});
  const biz = parsed.success ? parsed.data : businessSettingsSchema.parse({});

  const { data: svcs } = await admin
    .from('services')
    .select('name, duration_minutes, price')
    .eq('tenant_id', tenant.id)
    .eq('active', true)
    .order('sort_order', { ascending: true });
  const services = (svcs ?? []).map(
    (s: any) =>
      `${s.name} · ${s.duration_minutes} 分鐘 · NT$${Number(s.price).toLocaleString('zh-TW')}`,
  );

  // 營業時間摘要（perDayMode 逐日時段的完整表述留給 Phase 10 的 catalog 整合）
  const dayNames = ['日', '一', '二', '三', '四', '五', '六'];
  let businessHours = `${biz.businessStart}–${biz.businessEnd}`;
  if (biz.breakStart && biz.breakEnd)
    businessHours += `（休息 ${biz.breakStart}–${biz.breakEnd}）`;
  if (biz.closedDays.length)
    businessHours += `，公休：${biz.closedDays.map((d) => `週${dayNames[d]}`).join('、')}`;

  return {
    name: basic.tenantName || tenant.name,
    description: String(basic.tenantDescription ?? ''),
    businessHours,
    services,
    trips: [], // trips 表尚不存在（Phase 10 接 catalog 統一查詢）
    departures: [], // 同上：未來 14 天團次與即時剩餘名額（每次即時查、不快取）
    ai: { personaNotes: ai.personaNotes, faq: ai.faq },
    // 公開商店頁 Phase 8 落地；URL 規則以 tenant-settings.ts 的 helper 為單一事實來源
    shopUrl: buildPublicBookingUrl(APP_URL, tenant.shop_code),
  };
}

/* ----------------------------------------------------------------- utils */
/** keyword_replies 列 → LINE message 物件（TEXT / IMAGE / FLEX；組不出來回 null） */
function keywordReplyMessage(r: { reply_type: string; content: any }): any | null {
  const c = r.content ?? {};
  if (r.reply_type === 'IMAGE' && c.imageUrl)
    return {
      type: 'image',
      originalContentUrl: c.imageUrl,
      previewImageUrl: c.previewImageUrl ?? c.imageUrl,
    };
  if (r.reply_type === 'FLEX' && c.contents)
    return { type: 'flex', altText: String(c.altText ?? '訊息'), contents: c.contents };
  // TEXT（content 形狀以 keyword-replies 寫入端點為準；相容 text / replyText 兩種鍵）
  const text = c.text ?? c.replyText ?? '';
  return text ? { type: 'text', text: String(text) } : null;
}

/** timestamptz ISO → 台北時間「M/D（週）HH:mm」（比照 src/server/tz.ts 的固定 +08:00 做法） */
function formatTaipei(iso: string): string {
  const t = new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000);
  const wd = ['日', '一', '二', '三', '四', '五', '六'][t.getUTCDay()];
  const hh = String(t.getUTCHours()).padStart(2, '0');
  const mm = String(t.getUTCMinutes()).padStart(2, '0');
  return `${t.getUTCMonth() + 1}/${t.getUTCDate()}（${wd}）${hh}:${mm}`;
}
