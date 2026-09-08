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
import { buildFlexMenuOutcome } from './flex-menu';
import { buildTripCarousel, TRIP_CAROUSEL_MAX, type TripCardSource } from './trip-flex';
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
import { MODE_PRESETS, type BusinessType } from '@/config/modes';
import { keywordRepliesPage } from '@/i18n/zh-TW/pages/keyword-replies';

/** webhook 端已查好的店家列（route.ts select id, shop_code, name） */
export type WebhookTenant = {
  id: string;
  shop_code: string;
  name: string;
  /** 0015 migration；舊資料或查不到時以 LOCAL_SHOP 保底（modes.ts 的預設業態） */
  business_type?: string | null;
};

/** 店家業態（決定 richMenuCells 那一組文字與部分內建指令的回覆方式） */
function businessTypeOf(tenant: WebhookTenant): BusinessType {
  const bt = String(tenant.business_type ?? '');
  return bt in MODE_PRESETS ? (bt as BusinessType) : 'LOCAL_SHOP';
}


/* -------------------------------------------------- 內建指令的關鍵字對照表 */
/**
 * 內建意圖。前 15 個與 keyword-replies 頁「系統內建關鍵字」的 15 組 key 一一對應
 * （可被店家停用）；其後五個是 Rich Menu 才用得到、頁面上沒有開關的常駐意圖。
 */
export type BuiltinIntent =
  | 'BOOKING' | 'MY_BOOKING' | 'ORDER' | 'MENU' | 'HELP' | 'CANCEL' | 'CAMPAIGN'
  | 'COUPON' | 'PRODUCT' | 'TRIP' | 'DEPARTURE' | 'MEMBER' | 'PORTFOLIO'
  | 'NOTIFY' | 'MAP'
  | 'SERVICE' | 'CONTACT' | 'HOURS' | 'FAQ' | 'CLINIC_QUEUE';

/**
 * 系統內建關鍵字 15 組（含全部同義詞）。
 * **單一事實來源是 src/i18n/zh-TW/pages/keyword-replies.ts 的 system.groups**——
 * 那份就是後台頁面上列給店家看、可逐組停用的清單。在這裡複寫一份的話，
 * 頁面顯示「已停用」而 webhook 照回，或頁面列了同義詞而 webhook 不認得。
 */
export const SYSTEM_KEYWORD_GROUPS: Record<string, readonly string[]> = Object.fromEntries(
  keywordRepliesPage.system.groups.map((g) => [g.key, g.keywords]),
);

/**
 * Rich Menu 六格送出的文字 → 內建意圖。
 * MODE_PRESETS.richMenuCells 三業態共 18 格的每一段文字都必須在這裡（或在系統
 * 關鍵字 15 組裡）查得到，否則顧客按下去就是沒反應。
 * 有幾段刻意不在系統 15 組內（「服務項目」「會員卡」「優惠」「團次」「營業時間」
 * 「常見問題」「看診進度」「聯絡我們」），所以需要這張表補上。
 */
export const RICH_MENU_TEXT_INTENT: Record<string, BuiltinIntent> = {
  預約: 'BOOKING',
  我的預約: 'MY_BOOKING',
  服務項目: 'SERVICE',
  服務: 'SERVICE',
  會員卡: 'MEMBER',
  優惠: 'COUPON',
  聯絡我們: 'CONTACT',
  行程: 'TRIP',
  團次: 'DEPARTURE',
  我的訂單: 'ORDER',
  常見問題: 'FAQ',
  看診進度: 'CLINIC_QUEUE',
  營業時間: 'HOURS',
};

/**
 * 文字 → 內建意圖（完全比對）。
 * group 非 null 代表該意圖屬於店家可停用的 15 組之一（停用時完全不回應）。
 * 先查 Rich Menu 表：同一段文字若兩邊都有（例：「預約」），以 Rich Menu 表為準，
 * 兩者指向同一個意圖，group 仍由 15 組決定，停用開關照樣有效。
 */
export function resolveBuiltinIntent(
  text: string,
): { intent: BuiltinIntent; group: string | null } | null {
  const direct = RICH_MENU_TEXT_INTENT[text];
  if (direct) return { intent: direct, group: direct in SYSTEM_KEYWORD_GROUPS ? direct : null };
  for (const [key, words] of Object.entries(SYSTEM_KEYWORD_GROUPS)) {
    if (words.includes(text)) return { intent: key as BuiltinIntent, group: key };
  }
  return null;
}

/**
 * 店家是否關掉了這一組系統內建關鍵字。
 *
 * ⚠️ 這裡**刻意零 isFeatureActive／零 requireFeature**：「關掉內建回覆」是少做
 * 一件事，不該需要付費（14 分冊 §8.16 擁有者裁決）。付費閘門只擋「覆蓋」——
 * 店家自己編一組新的關鍵字回覆（keyword_replies 寫入端點的 requireFeature）。
 */
function isSystemGroupDisabled(lineConfig: Record<string, any>, group: string): boolean {
  const disabled = lineConfig.systemKeywordGroupsDisabled;
  return Array.isArray(disabled) && disabled.includes(group);
}

/** 內建指令 handler 的共用上下文 */
type BuiltinCtx = {
  admin: SupabaseClient;
  tenant: WebhookTenant;
  token: string;
  replyToken: string;
  userId: string;
  lineConfig: Record<string, any>;
};

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

  /* ---- 06 §3 關鍵字覆蓋補齊（richMenuCells 18 格 + 系統關鍵字 15 組）---- */
  serviceListEmpty: (url: string) =>
    `目前還沒有上架的服務項目，您可以直接留言告訴我們您的需求 😊\n${url}`,
  menuTitle: '您可以直接輸入下面這些關鍵字：',
  menuFooter: '也可以直接留言，我們看到會盡快回覆您 😊',
  cancelNoFlow:
    '目前沒有進行中的流程可以取消。\n若要更改或取消已成立的預約，請輸入「我的預約」查詢，或直接留言告訴我們。',
  campaignTitle: '目前進行中的活動：',
  campaignEmpty: '目前沒有進行中的活動，敬請期待！',
  couponTitle: '目前開放領取的優惠：',
  couponEmpty: '目前沒有開放領取的優惠票券。',
  couponHowTo: '想索取請直接留言告訴我們，我們會幫您登記 🎫',
  productTitle: '目前販售的商品：',
  productEmpty: '目前還沒有上架商品。',
  portfolioTitle: '我們的作品：',
  portfolioEmpty: '目前還沒有上傳作品。',
  /* --- 商品訂單查詢（系統關鍵字 15 組的 ORDER 組，LOCAL_SHOP／CLINIC）--- */
  orderTitle: '您最近的訂單：',
  orderEmpty: '您目前沒有訂單紀錄，歡迎輸入「商品」看看我們販售的品項！',
  /**
   * 訂單狀態與付款狀態的顧客用詞。
   *
   * ⚠️ 刻意與 `src/i18n/zh-TW/common.ts` 的 `bookingStatus` / `paymentStatus`
   * **各自維護**，不是漏抽共用：那份是後台 UI 的字典（鐵則 1 的管轄範圍），
   * 這份是 bot 對顧客說的話，與 `MSG` 其餘文案同源。兩邊剛好同字不代表同一
   * 個真相來源——後台改稱呼不該連帶改寫顧客收到的訊息。
   */
  orderStatus: {
    PENDING: '待確認',
    CONFIRMED: '已確認',
    COMPLETED: '已完成',
    CANCELLED: '已取消',
  } as Record<string, string>,
  orderPaymentStatus: {
    UNPAID: '未付款',
    PAID_ONLINE: '線上已付',
    PAID_OFFLINE: '現場已付',
    REFUNDED: '已退款',
  } as Record<string, string>,
  memberTitle: '您的會員資訊：',
  memberPoints: (n: number) => `・目前點數：${n} 點`,
  memberLevel: (name: string) => `・會員等級：${name}`,
  memberNoLevel: '・會員等級：一般會員',
  contactTitle: '聯絡我們：',
  contactEmpty: '店家的聯絡資訊還沒設定完成，您可以直接在這裡留言，我們會盡快回覆您。',
  hoursTitle: '我們的營業時間：',
  faqTitle: '常見問題：',
  faqEmpty: '目前還沒有整理常見問題，您想問什麼都可以直接留言，我們會盡快回覆 😊',
  mapTitle: '導航到我們這裡：',
  mapEmpty: '店家地址還沒設定完成，您可以直接留言詢問，我們會回覆詳細位置。',
  /* --- 行程 Flex 輪播（10 分冊 §6.1 的 TRIP 組）--- */
  tripEmptyGuide: '目前還沒有上架行程，敬請期待！',
  tripCarouselAlt: '目前開放報名的行程',
  tripPriceFrom: '最低',
  /** 沒有任何啟用方案 → 價格「不知道」，不可顯示 NT$ 0（那是捏造的已知） */
  tripPriceUnknown: '價格洽詢',
  tripBookCta: '我要預約',
  /* --- 團次／名額（10 分冊 §6.1 的 DEPARTURE 組）--- */
  departureTitle: '未來 14 天可報名的團次：',
  departureEmpty:
    '未來 14 天目前沒有開放報名的團次。\n請輸入「行程」看看有哪些行程，或直接留言告訴我們您想出發的日期，我們會幫您安排。',
  departureFull: '已額滿',
  departureSeatsLeft: (n: number) => `剩 ${n} 位`,
  /**
   * 尚未開放的功能一律用這組文案。
   * CLAUDE.md：沒建好就誠實說沒建好——沉默（顧客按了沒反應）與假裝做得到
   * （回一個編出來的進度）都不行。
   *
   * ⚠️ 這幾句的壽命由對應 Issue 決定，功能落地後**必須連同文案一起刪掉**，
   * 不要留著當備用：留著的話，下一個人讀到這組常數會以為那些功能仍未建置。
     *   notReadyOrder → issue #8 的旅遊訂單段（`tour_orders` 表尚未建立）。
     *     ⚠️ 只剩 GUIDE 用得到：LOCAL_SHOP／CLINIC 的「訂單查詢」已改查
     *     `product_orders`（見 `replyOrders()`），那半邊不再是準備中。
   */
  notReadyClinicQueue:
    '「看診進度」的即時查詢還在準備中，目前無法自動查詢。\n請直接留言或來電詢問目前的看診號碼，我們會盡快回覆您。',
  notReadyNotifyToggle:
    '店家通知的開關目前還不能在這裡自行設定。\n如果您不想再收到通知，直接留言告訴我們就可以，我們會為您處理。',
  notReadyOrder:
    '訂單查詢還在準備中，目前無法自動查詢。\n請直接留言告訴我們您的大名，我們幫您查詢。',
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
  // 完全比對優先，其次才是設成 CONTAINS 的那幾組（頁面上「訊息裡有這個字就回」
  // 是預設選項——只做 includes 比對的話，店家選了 CONTAINS 卻只有一字不差才會回）。
  const kr = pickKeywordReply(krs ?? [], text);
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

  // ④ 內建指令（06 §3 關鍵字覆蓋）
  //
  // 舊版只比對「預約」「服務」「我的預約」三個字面值，於是 MODE_PRESETS.richMenuCells
  // 發布出去的按鈕大多按下去沒反應（issue #5）。改為：先解析成內建意圖（Rich Menu
  // 表優先，其次系統關鍵字 15 組的同義詞），再交給 replyBuiltin 分派。
  //
  // 順序在 ② keyword_replies 之後：06 §3 明訂**自訂關鍵字優先於內建指令**，
  // 店家自己設的那一句必須蓋過系統回覆。
  const hit = resolveBuiltinIntent(text);
  if (hit) {
    // 店家關掉的那一組：完全不回應（連 ⑤ AI／⑥ defaultReply 都不落）。
    // 「關掉」就是關掉——落到 defaultReply 會讓顧客照樣收到訊息，那顆開關就成了假的。
    if (hit.group && isSystemGroupDisabled(lineConfig, hit.group)) return;

    const ctx: BuiltinCtx = { admin, tenant, token, replyToken, userId, lineConfig };
    const handled = await replyBuiltin(hit.intent, ctx);
    if (handled) return; // 回 false＝這家店沒有這類東西，刻意不攔截，落到 ⑤/⑥
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
    //   AI 完全不回覆，讓店家專人親自接。正常詢問（價格／時間／地址）AI 仍會正常回答。」
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

/* ------------------------------------------------------ 內建指令：共用 */
/** 回一段純文字並回報「已處理」 */
async function replyText(ctx: BuiltinCtx, text: string): Promise<boolean> {
  await lineReply(ctx.token, ctx.replyToken, [{ type: 'text', text }]);
  return true;
}

/** 這位 LINE 使用者綁定到的 customers.id（未綁定回空字串） */
async function boundCustomerId(ctx: BuiltinCtx): Promise<string> {
  const { data } = await ctx.admin
    .from('line_users')
    .select('customer_id')
    .eq('tenant_id', ctx.tenant.id)
    .eq('line_user_id', ctx.userId)
    .maybeSingle();
  return (data?.customer_id as string | null) ?? '';
}

/** tenant_settings 的 basic / business / ai 三個 jsonb（一次查完，handler 共用） */
async function loadSettingsRow(ctx: BuiltinCtx): Promise<Record<string, any>> {
  const { data } = await ctx.admin
    .from('tenant_settings')
    .select('basic, business, ai')
    .eq('tenant_id', ctx.tenant.id)
    .maybeSingle();
  return (data ?? {}) as Record<string, any>;
}

/** 營業時間摘要 */
function formatBusinessHours(biz: ReturnType<typeof businessSettingsSchema.parse>): string {
  const dayNames = ['日', '一', '二', '三', '四', '五', '六'];
  let out = `${biz.businessStart}–${biz.businessEnd}`;
  if (biz.breakStart && biz.breakEnd) out += `（休息 ${biz.breakStart}–${biz.breakEnd}）`;
  if (biz.closedDays.length)
    out += `，公休：${biz.closedDays.map((d) => `週${dayNames[d]}`).join('、')}`;
  return out;
}

/**
 * 內建意圖分派。
 * 回 false＝這家店沒有這一類東西、刻意不攔截（落到 ⑤ AI / ⑥ defaultReply）。
 * 其餘一律回一則訊息——**Rich Menu 的格子按下去必須有反應**，沒建好的功能就
 * 誠實說「還在準備中」，不能沉默（06 §3 / CLAUDE.md）。
 */
async function replyBuiltin(intent: BuiltinIntent, ctx: BuiltinCtx): Promise<boolean> {
  switch (intent) {
    case 'BOOKING':
    case 'SERVICE':
      return replyServiceListBuiltin(ctx);
    case 'MY_BOOKING':
      return replyMyBookingsBuiltin(ctx);
    case 'MENU':
      // 「選單」組（主選單／選單／功能）→ 店家發布的 Flex 輪播（06 §6）。
      // 尚未編卡片時 replyFlexMenu 自己落回下面那份文字清單。
      return replyFlexMenu(ctx);
    case 'HELP':
      // 「說明／幫助」不是 06 §6 點名的 Flex 觸發字，維持純文字關鍵字清單：
      // 顧客問「怎麼用」時，一份可以直接照打的字串清單比一組卡片有用。
      return replyMenu(ctx);
    case 'CANCEL':
      return replyText(ctx, MSG.cancelNoFlow);
    case 'CAMPAIGN':
      return replyCampaigns(ctx);
    case 'COUPON':
      return replyCoupons(ctx);
    case 'PRODUCT':
      return replyProducts(ctx);
    case 'PORTFOLIO':
      return replyPortfolios(ctx);
    case 'MEMBER':
      return replyMember(ctx);
    case 'CONTACT':
      return replyContact(ctx);
    case 'HOURS':
      return replyBusinessHours(ctx);
    case 'FAQ':
      return replyFaq(ctx);
    case 'MAP':
      return replyMap(ctx);
    case 'CLINIC_QUEUE':
      // 看診進度（叫號）尚未實作；只有診所的選單有這一格。
      return businessTypeOf(ctx.tenant) === 'CLINIC'
        ? replyText(ctx, MSG.notReadyClinicQueue)
        : false;
    case 'NOTIFY':
      // 「開啟/關閉店家通知」目前沒有儲存位置（line_users 無對應欄位），推播也
      // 還沒有讀任何開關。做一個寫得進去卻沒人讀的欄位，等於回一句做不到的
      // 「已為您開啟」——照 CLAUDE.md 誠實原則，先明說還不能自助設定。
      return replyText(ctx, MSG.notReadyNotifyToggle);

    case 'TRIP':
      // 已發布行程的 Flex 輪播（10 分冊 §6.1）。migration 0066 起查得到，
      // 不再回「準備中」。其他業態沒有行程，replyTrips 內部回 false 不攔截。
      return replyTrips(ctx);
    case 'DEPARTURE':
      // 未來 14 天可報名的團次／名額（10 分冊 §6.1）。同上，0066 起查得到。
      return replyDepartures(ctx);
    case 'ORDER':
      return replyOrders(ctx);

    default:
      return false;
  }
}

/* --------------------------------------------------- 內建指令：選單 / 說明 */
/**
 * 「選單」「主選單」「功能」→ 店家在 rich-menu-design 頁編好的 Flex 輪播（06 §6）。
 *
 * 四種結果都來自 `src/server/flex-menu.ts` 的 `buildFlexMenuOutcome()`——
 * **全專案唯一**組 Flex JSON 的地方（issue #6 的單一事實來源要求）。
 *
 * ⚠️ SILENT 與 HINT 是**兩種不同的行為，不可以合併**：
 * - HINT   → 回一句提示文字（畫面上那顆單選鈕逐字承諾了會回哪一句）
 * - SILENT → **一則 LINE 請求都不發**。所以這裡回 true（＝已處理），
 *   絕不能回 false 讓它落到 ⑤ AI／⑥ defaultReply——那樣顧客照樣會收到訊息，
 *   店家選的「完全靜默」就變成一顆假的開關。
 *   釘住這件事的斷言是「整個 mock.requests 為空」，不是「/reply 沒有被打」。
 */
async function replyFlexMenu(ctx: BuiltinCtx): Promise<boolean> {
  const outcome = buildFlexMenuOutcome(ctx.lineConfig, ctx.tenant.name);
  switch (outcome.kind) {
    case 'FLEX':
    case 'HINT':
      /*
       * ⚠️ **整包送 `outcome.messages`，不要只取第一則。**
       * `flexShowTip` 開啟時 carousel 之後還有第二則使用提示，只送第一則的話
       * 那顆開關切了什麼都不會發生——換一種寫法的同一顆假開關
       * （06 分冊 §6.2.10、14 分冊 §8.22-c）。
       * `tests/unit/flex-menu.06.test.ts` 有一條守門測試 grep 全專案不得出現
       * `[outcome.message]` 這種只送第一則的寫法。
       */
      await lineReply(ctx.token, ctx.replyToken, outcome.messages);
      return true;
    case 'SILENT':
      return true;
    case 'NO_CARDS':
      // 已啟用但店家還沒編任何卡片：不憑空生一張卡（那是編造內容），
      // 回既有的文字關鍵字清單——列出來的每個字都保證有 handler。
      return replyMenu(ctx);
  }
}

/**
 * 「說明」「幫助」→ 這家店（依業態）可用的關鍵字清單（純文字）。
 * 也是 Flex 主選單「已啟用但一張卡片都沒有」時的落點。
 * 內容取自 MODE_PRESETS.richMenuCells，所以列出來的每一個字都保證有 handler。
 */
async function replyMenu(ctx: BuiltinCtx): Promise<boolean> {
  const cells = MODE_PRESETS[businessTypeOf(ctx.tenant)].richMenuCells;
  const lines = [...new Set(cells.map((c) => c.text))].map((t) => `・${t}`);
  return replyText(ctx, `${MSG.menuTitle}\n${lines.join('\n')}\n\n${MSG.menuFooter}`);
}

/* ------------------------------------------------ 內建指令：行程 / 團次 */
/**
 * 「行程」「所有行程」「揪團」…→ 已發布行程的 **Flex 輪播**（10 分冊 §6.1）。
 *
 * Flex JSON 的組裝在 `src/server/trip-flex.ts`，這裡只負責查資料。
 * 那是**第二個 Flex 成品**（不是主選單的第二份實作）——資料來源是 `trips` 表
 * 而不是店家編的卡片，觸發字、卡片欄位、按鈕動作全都不同。
 *
 * ⚠️ **兩件事是 2026-09-07 被 local-isolated 打回來才改對的，寫在這裡免得被改回去：**
 *
 * ① **查詢失敗不可以當成「沒有行程」。** 原本這裡是 `const { data } = await …`
 *    ——把 `error` 丟掉。PostgREST 一出錯 `data` 就是 null，於是走進「沒有行程」
 *    那條路，對顧客說「目前還沒有上架行程，敬請期待！」。**那是一個捏造的已知**：
 *    我們其實沒查成功，卻告訴顧客店家沒上架。而且它是靜默的——沒有例外、沒有紅燈，
 *    店家只會收到客訴說「我明明上架了」。現在錯誤會記到 log，並回 false 讓它落到
 *    ⑤ AI／⑥ defaultReply，**不冒充「查過了，沒有」**。
 *
 * ② **不用 PostgREST 的 embed。** 原本用 `trip_plans!trip_plans_trip_id_fkey(...)`
 *    的 FK hint 來繞開 0067 加的複合 FK 造成的 ambiguous embed。問題是**FK 的名字
 *    在不同安裝路徑上不一樣**：canonical（0066 建表）與整合測試的
 *    historical overlay（0016 建表、0066 的 `create table if not exists` 因此跳過）
 *    產生的 constraint 名稱不同一組。把回覆能不能送出綁在 constraint 名字上，
 *    等於讓一個純命名的差異變成「顧客打行程完全沒反應」。改成兩次一般查詢，
 *    多一次 round-trip 換掉整類問題。
 *
 * ⚠️ **TOUR_MODULE 閘門必須在任何 tour-domain 查詢之前。**
 * 10 分冊 §6.1 的原文是「導遊模組新增內建關鍵字組，**只在租戶有 `TOUR_MODULE` 時
 * 顯示**」。少了這道閘門，訂閱已到期或從未訂閱的租戶只要資料庫還留著歷史的
 * PUBLISHED 行程，顧客就照樣從 LINE 讀得到行程與名額——**用「有沒有資料」代替
 * 「有沒有權利」**。core mutation API 早就同時擋 MANAGER 與 TOUR_MODULE（§6.1 下方），
 * 讀取路徑漏掉就等於留了一扇後門。
 *
 * 未啟用時回 `false`（不是回一句「未訂閱」）：那是店家的訂閱狀態，不是顧客的事，
 * 對顧客講「本店未訂閱行程模組」既沒用又洩漏店家的帳務狀態。回 false 讓它落到
 * ⑤ AI／⑥ defaultReply，顧客仍然有回應。
 */
async function replyTrips(ctx: BuiltinCtx): Promise<boolean> {
  if (!(await isFeatureActive(ctx.tenant.id, 'TOUR_MODULE'))) return false;

  const { data: trips, error } = await ctx.admin
    .from('trips')
    .select('id, slug, title, tagline, summary, cover_image_url')
    .eq('tenant_id', ctx.tenant.id)
    .eq('status', 'PUBLISHED')
    .order('created_at', { ascending: false })
    .limit(TRIP_CAROUSEL_MAX);

  if (error) {
    // 查不動 ≠ 沒有行程。見本函式檔頭 ①。
    console.error('[line] replyTrips 查詢 trips 失敗', error);
    return false;
  }
  if (!trips?.length) {
    // 沒有行程的一般店家（美髮沙龍收到「行程」）交給 AI／預設回覆比較自然；
    // 嚮導的 Rich Menu 有這一格，按下去必須有反應。
    return businessTypeOf(ctx.tenant) === 'GUIDE' ? replyText(ctx, MSG.tripEmptyGuide) : false;
  }

  /*
   * 各行程的最低價：只算 active 方案的 `price_per_person`（**不是 `base_price`**
   * ——0066 把舊的 base_price 併進 price_per_person）。
   * 查不到方案（或這一步出錯）就是「價格未知」→ trip-flex 顯示「價格洽詢」，
   * **不是 NT$ 0**（那會讓顧客以為免費）。價格查不到不該讓整份輪播消失，
   * 所以這一步的錯誤不 return，只當作沒有方案。
   */
  const { data: plans, error: planError } = await ctx.admin
    .from('trip_plans')
    .select('trip_id, price_per_person, active')
    .eq('tenant_id', ctx.tenant.id)
    .in('trip_id', trips.map((t: any) => t.id));
  if (planError) console.error('[line] replyTrips 查詢 trip_plans 失敗', planError);

  const minPriceByTrip = new Map<string, number>();
  for (const p of (plans ?? []) as any[]) {
    if (!p.active) continue;
    const price = Number(p.price_per_person);
    if (!Number.isFinite(price)) continue;
    const current = minPriceByTrip.get(p.trip_id);
    if (current === undefined || price < current) minPriceByTrip.set(p.trip_id, price);
  }

  const shopUrl = buildPublicBookingUrl(APP_URL, ctx.tenant.shop_code);
  const cards: TripCardSource[] = trips.map((t: any) => ({
    slug: t.slug,
    title: t.title,
    tagline: t.tagline ?? '',
    summary: t.summary ?? '',
    coverImageUrl: t.cover_image_url ?? '',
    minPrice: minPriceByTrip.has(t.id) ? minPriceByTrip.get(t.id)! : null,
  }));

  const flex = buildTripCarousel(cards, shopUrl, {
    altText: MSG.tripCarouselAlt,
    priceFrom: MSG.tripPriceFrom,
    priceUnknown: MSG.tripPriceUnknown,
    bookCta: MSG.tripBookCta,
  });
  if (!flex) return replyText(ctx, MSG.tripEmptyGuide);

  await lineReply(ctx.token, ctx.replyToken, [flex as any]);
  return true;
}

/**
 * 「團次」「名額」「出團日期」…→ 未來 14 天可報名的團次（10 分冊 §6.1）。
 *
 * 純文字而不是 Flex：顧客問的是「哪幾天還有位子」，一份可以一眼掃完的清單
 * 比一組要左右滑的卡片有用。
 *
 * ⚠️ 一樣不用 embed、一樣不把查詢失敗當成「沒有團次」，理由見 `replyTrips()` 檔頭。
 * ⚠️ 先取**已發布**行程的 id 再查團次：草稿行程的團次外流出去，等於讓顧客報名
 *    一個店家還沒打算開賣的團。先過濾再 limit，才不會被草稿團次吃掉名額。
 * ⚠️ TOUR_MODULE 閘門同樣在**任何 tour-domain 查詢之前**，理由見 `replyTrips()`。
 */
async function replyDepartures(ctx: BuiltinCtx): Promise<boolean> {
  if (businessTypeOf(ctx.tenant) !== 'GUIDE') return false;
  if (!(await isFeatureActive(ctx.tenant.id, 'TOUR_MODULE'))) return false;

  const { data: trips, error: tripError } = await ctx.admin
    .from('trips')
    .select('id, title')
    .eq('tenant_id', ctx.tenant.id)
    .eq('status', 'PUBLISHED');
  if (tripError) {
    console.error('[line] replyDepartures 查詢 trips 失敗', tripError);
    return false;
  }
  if (!trips?.length) return replyText(ctx, MSG.departureEmpty);

  const titleById = new Map<string, string>(trips.map((t: any) => [t.id, t.title]));

  const today = new Date();
  const from = today.toISOString().slice(0, 10);
  const to = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { data: departures, error } = await ctx.admin
    .from('trip_departures')
    .select('trip_id, plan_id, departs_on, start_time, capacity, seats_booked')
    .eq('tenant_id', ctx.tenant.id)
    .eq('status', 'OPEN')
    .in('trip_id', [...titleById.keys()])
    .gte('departs_on', from)
    .lte('departs_on', to)
    .order('departs_on', { ascending: true })
    .limit(SERVICE_LIST_LIMIT);
  if (error) {
    console.error('[line] replyDepartures 查詢 trip_departures 失敗', error);
    return false;
  }
  if (!departures?.length) return replyText(ctx, MSG.departureEmpty);

  // 方案名稱是錦上添花（顯示成「（標準團）」）。查不到就不顯示那一段，
  // 不讓它擋掉整份團次清單。
  const planIds = [...new Set(departures.map((d: any) => d.plan_id).filter(Boolean))];
  const planNameById = new Map<string, string>();
  if (planIds.length) {
    const { data: plans, error: planError } = await ctx.admin
      .from('trip_plans')
      .select('id, name')
      .eq('tenant_id', ctx.tenant.id)
      .in('id', planIds);
    if (planError) console.error('[line] replyDepartures 查詢 trip_plans 失敗', planError);
    for (const p of (plans ?? []) as any[]) planNameById.set(p.id, p.name);
  }

  const lines = departures.map((d: any) => {
    // capacity - seats_booked 可能因為並發而暫時為負；夾到 0，不顯示「剩 -1 位」
    const left = Math.max(0, Number(d.capacity) - Number(d.seats_booked));
    const time = typeof d.start_time === 'string' ? ` ${d.start_time.slice(0, 5)}` : '';
    const planName = planNameById.get(d.plan_id);
    const plan = planName ? `（${planName}）` : '';
    const seats = left > 0 ? MSG.departureSeatsLeft(left) : MSG.departureFull;
    return `・${d.departs_on}${time} ${titleById.get(d.trip_id) ?? ''}${plan}　${seats}`;
  });
  const shopUrl = buildPublicBookingUrl(APP_URL, ctx.tenant.shop_code);
  return replyText(ctx, `${MSG.departureTitle}\n${lines.join('\n')}\n\n${shopUrl}`);
}

/* -------------------------------------------------------- 內建指令：活動 */
async function replyCampaigns(ctx: BuiltinCtx): Promise<boolean> {
  const { data } = await ctx.admin
    .from('campaigns')
    .select('name, content')
    .eq('tenant_id', ctx.tenant.id)
    .eq('status', 'PUBLISHED')
    .order('created_at', { ascending: false })
    .limit(SERVICE_LIST_LIMIT);
  if (!data?.length) return replyText(ctx, MSG.campaignEmpty);
  const lines = data.map((c: any) => {
    const text = String((c.content as any)?.text ?? '').split('\n')[0];
    return text ? `・${c.name}：${text}` : `・${c.name}`;
  });
  return replyText(ctx, `${MSG.campaignTitle}\n${lines.join('\n')}`);
}

/* -------------------------------------------------------- 內建指令：票券 */
async function replyCoupons(ctx: BuiltinCtx): Promise<boolean> {
  const { data } = await ctx.admin
    .from('coupons')
    .select('name, description, discount_type, discount_value')
    .eq('tenant_id', ctx.tenant.id)
    .eq('status', 'PUBLISHED')
    .order('created_at', { ascending: false })
    .limit(SERVICE_LIST_LIMIT);
  if (!data?.length) return replyText(ctx, MSG.couponEmpty);
  const lines = data.map((c: any) => {
    const value = Number(c.discount_value);
    const amount =
      c.discount_type === 'PERCENT' ? `${value} 折` : `折抵 NT$${value.toLocaleString('zh-TW')}`;
    return `・${c.name}｜${amount}`;
  });
  return replyText(ctx, `${MSG.couponTitle}\n${lines.join('\n')}\n\n${MSG.couponHowTo}`);
}

/* -------------------------------------------------------- 內建指令：商品 */
async function replyProducts(ctx: BuiltinCtx): Promise<boolean> {
  const { data } = await ctx.admin
    .from('products')
    .select('name, price')
    .eq('tenant_id', ctx.tenant.id)
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .limit(SERVICE_LIST_LIMIT);
  if (!data?.length) return replyText(ctx, MSG.productEmpty);
  const lines = data.map(
    (p: any) => `・${p.name}｜NT$${Number(p.price).toLocaleString('zh-TW')}`,
  );
  return replyText(ctx, `${MSG.productTitle}\n${lines.join('\n')}`);
}

/* ------------------------------------------------------ 內建指令：訂單 */
/**
 * 「訂單查詢」組（`我的訂單` / `查看訂單` / `訂單查詢`）。
 *
 * 這一組是**系統內建 15 組之一**，三種業態的 keyword-replies 頁都列得出來、
 * 都能停用——但在 `main` 上它先前只對 GUIDE 回一句「準備中」，LOCAL_SHOP 與
 * CLINIC 直接 `return false` 落到預設回覆。也就是後台明明擺著一顆「訂單查詢」
 * 的開關，顧客打了卻什麼都查不到。
 *
 * `product_orders` 從 `0004` 就存在，後台 `/api/product-orders` 是完整可用的
 * 功能（列表／建單／出貨）——查得到卻不回答，是 PB-027 的第四種形狀（符號
 * 存在 ≠ 事情會發生）。本函式把那半邊接回來。
 *
 * ⚠️ GUIDE 仍維持 `notReadyOrder`：嚮導的「我的訂單」指的是行程訂單
 * （10 分冊 §6.1），而 `tour_orders` 表至今不存在（`0066`–`0068` 只建了
 * trips / trip_plans / trip_departures / trip_addons）。拿 `product_orders`
 * 去湊一份「旅遊訂單」是回答錯的東西，比誠實說準備中更糟。
 *
 * ⚠️ 只查**已綁定 LINE 的顧客**自己的訂單，且一律帶 `tenant_id`。未綁定就說
 * 未綁定，不拿姓名或電話去模糊比對湊出一筆「可能是您的訂單」——那會把別人的
 * 訂單金額念給不相干的人聽。
 *
 * ⚠️ 刻意不加 `isFeatureActive` 閘門，與同層的 `replyProducts()` /
 * `replyCoupons()` 一致：14 分冊 §8.16 的裁決是付費閘門擋「多做一件事」，
 * 顧客查自己已經成立的訂單不屬於那一類。（`replyTrips()` 的 TOUR_MODULE 閘門
 * 是 10 分冊 §6.1 對行程域的明文特例，不是這一層的通則。）
 */
async function replyOrders(ctx: BuiltinCtx): Promise<boolean> {
  if (businessTypeOf(ctx.tenant) === 'GUIDE') return replyText(ctx, MSG.notReadyOrder);

  const customerId = await boundCustomerId(ctx);
  if (!customerId) return replyText(ctx, MSG.myBookingsNotBound);

  const { data, error } = await ctx.admin
    .from('product_orders')
    .select('order_no, total_amount, status, payment_status, created_at')
    .eq('tenant_id', ctx.tenant.id)
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(SERVICE_LIST_LIMIT);

  // ⚠️ 查詢失敗不可以當成「您沒有訂單」——那是把故障說成事實。
  // 回 false 讓它落到 ⑤ AI／⑥ 預設回覆（有真人看得到），並留下 log。
  if (error) {
    console.error('[line] replyOrders 查詢 product_orders 失敗', error);
    return false;
  }
  if (!data?.length) return replyText(ctx, MSG.orderEmpty);

  const lines = data.map((o: any) => {
    const day = formatTaipeiDate(o.created_at);
    const paid = MSG.orderPaymentStatus[o.payment_status] ?? o.payment_status;
    // 千分位跟同一檔的 replyProducts／replyServiceList 一致用 'zh-TW'：
    // 同一個 bot 在不同關鍵字下把金額寫成不同樣子，顧客會以為是兩套系統。
    return `・${o.order_no}｜${day}｜NT$${Number(o.total_amount).toLocaleString('zh-TW')}`
      + `｜${MSG.orderStatus[o.status] ?? o.status}／${paid}`;
  });
  return replyText(ctx, `${MSG.orderTitle}\n${lines.join('\n')}`);
}

/* -------------------------------------------------------- 內建指令：作品 */
async function replyPortfolios(ctx: BuiltinCtx): Promise<boolean> {
  const { data } = await ctx.admin
    .from('portfolios')
    .select('title, description')
    .eq('tenant_id', ctx.tenant.id)
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .limit(SERVICE_LIST_LIMIT);
  if (!data?.length) return replyText(ctx, MSG.portfolioEmpty);
  const lines = data.map((p: any) => `・${p.title}`);
  const url = buildPublicBookingUrl(APP_URL, ctx.tenant.shop_code);
  return replyText(ctx, `${MSG.portfolioTitle}\n${lines.join('\n')}\n\n${url}`);
}

/* -------------------------------------------------------- 內建指令：會員 */
async function replyMember(ctx: BuiltinCtx): Promise<boolean> {
  const customerId = await boundCustomerId(ctx);
  if (!customerId) return replyText(ctx, MSG.myBookingsNotBound);

  const { data } = await ctx.admin
    .from('customers')
    .select('points, membership_levels(name)')
    .eq('tenant_id', ctx.tenant.id)
    .eq('id', customerId)
    .maybeSingle();
  const level = Array.isArray((data as any)?.membership_levels)
    ? (data as any).membership_levels[0]
    : (data as any)?.membership_levels;
  const lines = [
    MSG.memberPoints(Number(data?.points ?? 0)),
    level?.name ? MSG.memberLevel(level.name) : MSG.memberNoLevel,
  ];
  return replyText(ctx, `${MSG.memberTitle}\n${lines.join('\n')}`);
}

/* ---------------------------------------------------- 內建指令：聯絡資訊 */
async function replyContact(ctx: BuiltinCtx): Promise<boolean> {
  const row = await loadSettingsRow(ctx);
  const basic = (row.basic ?? {}) as Record<string, any>;
  const lines: string[] = [];
  const name = String(basic.tenantName || ctx.tenant.name || '');
  if (name) lines.push(`・${name}`);
  if (basic.tenantPhone) lines.push(`・電話：${basic.tenantPhone}`);
  if (basic.tenantAddress) lines.push(`・地址：${basic.tenantAddress}`);
  if (basic.tenantEmail) lines.push(`・Email：${basic.tenantEmail}`);
  if (lines.length <= 1 && !basic.tenantPhone && !basic.tenantAddress && !basic.tenantEmail)
    return replyText(ctx, MSG.contactEmpty);
  lines.push(buildPublicBookingUrl(APP_URL, ctx.tenant.shop_code));
  return replyText(ctx, `${MSG.contactTitle}\n${lines.join('\n')}`);
}

/* ---------------------------------------------------- 內建指令：營業時間 */
async function replyBusinessHours(ctx: BuiltinCtx): Promise<boolean> {
  const row = await loadSettingsRow(ctx);
  const parsed = businessSettingsSchema.safeParse(row.business ?? {});
  const biz = parsed.success ? parsed.data : businessSettingsSchema.parse({});
  return replyText(ctx, `${MSG.hoursTitle}\n${formatBusinessHours(biz)}`);
}

/* -------------------------------------------------- 內建指令：常見問題 */
/** 常見問題取自 tenant_settings.ai.faq（AI 客服設定頁店家自己填的那份，同一份資料） */
async function replyFaq(ctx: BuiltinCtx): Promise<boolean> {
  const row = await loadSettingsRow(ctx);
  const ai = aiSettingsSchema.parse(row.ai ?? {});
  const faq = (ai.faq ?? []).filter((f) => f?.q && f?.a).slice(0, 5);
  if (!faq.length) return replyText(ctx, MSG.faqEmpty);
  const blocks = faq.map((f) => `Q：${f.q}\nA：${f.a}`);
  return replyText(ctx, `${MSG.faqTitle}\n\n${blocks.join('\n\n')}`);
}

/* ------------------------------------------------------ 內建指令：地圖 */
async function replyMap(ctx: BuiltinCtx): Promise<boolean> {
  const row = await loadSettingsRow(ctx);
  const address = String((row.basic ?? {}).tenantAddress ?? '');
  if (!address) return replyText(ctx, MSG.mapEmpty);
  const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  return replyText(ctx, `${MSG.mapTitle}\n${address}\n${url}`);
}

/**
 * 「預約」「服務」「服務項目」→ active 服務清單。
 *
 * 與舊版的差別：沒有 active 服務時原本回 false（落到 ⑤/⑥）——但 Rich Menu 的
 * 第一格就是這個字，一家還沒上架服務的新店，顧客按下去會完全沒反應。改為誠實回
 * 「還沒有上架服務」並附公開頁連結：說的是實情，也保證按鈕一定有回應（06 §3）。
 */
async function replyServiceListBuiltin(ctx: BuiltinCtx): Promise<boolean> {
  const shopUrl = buildPublicBookingUrl(APP_URL, ctx.tenant.shop_code);
  const handled = await replyServiceList(ctx.admin, ctx.tenant, ctx.token, ctx.replyToken);
  if (handled) return true;
  return replyText(ctx, MSG.serviceListEmpty(shopUrl));
}

/** 「我的預約」→ 沿用既有實作 */
async function replyMyBookingsBuiltin(ctx: BuiltinCtx): Promise<boolean> {
  await replyMyBookings(ctx.admin, ctx.tenant, ctx.token, ctx.replyToken, ctx.userId);
  return true;
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
 * 單字、符號**等『明顯非詢問』訊息…正常詢問（價格／時間／地址）AI 仍會正常回答」。
 * 翻成可執行的規則，只認說明文字點名的四類，不多不少：
 *
 *   1. 純數字（含全形數字）——「1822」
 *   2. 沒有任何中日韓文字或拉丁字母 —— 純符號、純表情、亂碼「!@#$」「👍」
 *   3. 單一字元 ——「好」「1」「a」
 *   4. 只有拉丁字母且長度 ≤ 3 ——「ok」「hi」「xxx」
 *
 * ⚠️ 刻意**不做**語意判斷。這個函式的錯誤方向要選對：誤判成閒聊會讓一則真的
 * 詢問沒人回（顧客只看到已讀不回），誤判成詢問頂多是 AI 多回一句。所以規則
 * 從嚴、只攔形狀上就不可能是問句的訊息，寧可漏攔。
 *
 * 中文「價格」「地址」都是兩個中日韓字元，規則 3／4 都不會攔到；
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

  // 3. 單一字元（用 Array.from 以碼點計，避免 emoji／罕用字被算成 2）
  const codePoints = Array.from(text);
  if (codePoints.length <= 1) return true;

  // 4. 只有拉丁字母（可含空白）且 ≤ 3 個字元 ——「ok」「hi」「abc」
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
/**
 * 從該店的 keyword_replies 挑出要回的那一列。
 *
 * 完全比對優先於 CONTAINS：店家若同時設了「價格」（EXACT）與「價」（CONTAINS），
 * 顧客剛好打「價格」時應該拿到前者。CONTAINS 只在沒有任何完全比對命中時才參與。
 */
function pickKeywordReply(rows: any[], text: string): any | null {
  const exact = rows.find((r: any) => (r.keywords ?? []).some((k: string) => k === text));
  if (exact) return exact;
  return (
    rows.find(
      (r: any) =>
        (r.content ?? {}).matchType === 'CONTAINS'
        && (r.keywords ?? []).some((k: string) => k && text.includes(k)),
    ) ?? null
  );
}

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
  const text = String(c.text ?? c.replyText ?? '');
  if (!text) return null;
  // 「附加連結按鈕」是頁面上存得進去的欄位；不附在訊息裡的話，店家設了連結、
  // 顧客永遠看不到。LINE 的文字訊息會自動把 URL 變成可點的連結。
  const linkUrl = String(c.linkUrl ?? '').trim();
  if (!linkUrl) return { type: 'text', text };
  const linkLabel = String(c.linkLabel ?? '').trim();
  return { type: 'text', text: `${text}\n\n${linkLabel ? `${linkLabel}\n` : ''}${linkUrl}` };
}

const WEEKDAY_ZH = ['日', '一', '二', '三', '四', '五', '六'] as const;

/**
 * timestamptz ISO → 台北牆上時鐘（比照 src/server/tz.ts 的固定 +08:00 做法）。
 *
 * ⚠️ 位移只寫在這裡一處。`formatTaipei` 與 `formatTaipeiDate` 都由它取值——
 * 各自再寫一次 `+ 8 * 60 * 60 * 1000`，下次調整就只會改到其中一份。
 */
function taipeiWallClock(iso: string): Date {
  return new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000);
}

/** timestamptz ISO → 台北時間「M/D（週）HH:mm」 */
function formatTaipei(iso: string): string {
  const t = taipeiWallClock(iso);
  const hh = String(t.getUTCHours()).padStart(2, '0');
  const mm = String(t.getUTCMinutes()).padStart(2, '0');
  return `${formatTaipeiDate(iso)}${hh}:${mm}`;
}

/** timestamptz ISO → 台北時間「M/D（週）」（訂單只需要日期，時分對顧客沒有意義） */
function formatTaipeiDate(iso: string): string {
  const t = taipeiWallClock(iso);
  return `${t.getUTCMonth() + 1}/${t.getUTCDate()}（${WEEKDAY_ZH[t.getUTCDay()]}）`;
}
