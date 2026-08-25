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
 * ④ 的關鍵字覆蓋（06 §3「2026-08-24 補列」的規格，本次補齊）：
 *   - `MODE_PRESETS.richMenuCells`（src/config/modes.ts）三種業態共 18 格送出的
 *     文字，每一段都必須有 handler。**發布出去的按鈕文字沒有 handler ＝ 顧客
 *     按了沒反應**，這正是「按 Bot 沒反應」的來源之一；兩邊引用同一份常數，
 *     tests/unit/line-keyword-coverage.test.ts 以列舉方式強制覆蓋，改 cells
 *     少 handler 會自動紅。
 *   - 系統關鍵字 15 組（src/i18n/zh-TW/pages/keyword-replies.ts 的 system.groups）
 *     含全部同義詞都要命中；該組被店家停用（line.systemKeywordGroupsDisabled）
 *     時完全不回應。
 *   - 尚未建的功能（團次名額、看診進度、行程訂單、店家通知開關）一律誠實回
 *     「尚未開放」，不沉默、也不假裝做得到（CLAUDE.md 誠實原則）。
 *
 * 佔位（本波不實作，落點見各處註解）：
 * - chat_sessions 下單對話 → 10 分冊 §6.2（Phase 9/10，表併入 0012 之後）
 * - 「行程」輪播 → trips/trip_plans 表 0016 已建（2026-08-24 勘誤：原註「表尚不
 *   存在」已過時），輪播可動工；團次（departures）仍屬 Phase 8b
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
import { MODE_PRESETS, type BusinessType } from '@/config/modes';
import { keywordRepliesPage } from '@/i18n/zh-TW/pages/keyword-replies';

/** webhook 端已查好的店家列（route.ts select id, shop_code, name, business_type） */
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

  /* ---- 以下為 06 §3 關鍵字覆蓋補齊（richMenuCells 18 格 + 系統關鍵字 15 組）---- */
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
  tripTitle: '目前開放報名的行程：',
  tripEmptyGuide: '目前還沒有上架行程，敬請期待！',
  orderTitle: '您最近的訂單：',
  orderEmpty: '您目前沒有訂單紀錄。',
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

  /**
   * 尚未開放的功能一律用這組文案。
   * CLAUDE.md：沒建好就誠實說沒建好——沉默（顧客按了沒反應）與假裝做得到
   * （回一個編出來的進度）都不行。
   */
  notReadyDeparture:
    '「團次／出團日期」的名額查詢還在準備中，目前無法自動查詢。\n請輸入「行程」看看有哪些行程，或直接留言告訴我們您想出發的日期，我們會幫您安排。',
  notReadyClinicQueue:
    '「看診進度」的即時查詢還在準備中，目前無法自動查詢。\n請直接留言或來電詢問目前的看診號碼，我們會盡快回覆您。',
  notReadyTourOrder:
    '行程訂單的自動查詢還在準備中。\n請直接留言告訴我們您的大名與電話，我們幫您查詢報名狀態。',
  notReadyNotifyToggle:
    '店家通知的開關目前還不能在這裡自行設定。\n如果您不想再收到通知，直接留言告訴我們就可以，我們會為您處理。',
} as const;

/** 清單類回覆最多列出筆數（06 §3 內建指令 MVP） */
const SERVICE_LIST_LIMIT = 10;

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

  // ② keyword_replies（active；EXACT 完全比對、CONTAINS 含此字即命中——見 pickKeywordReply）
  const { data: krs } = await admin
    .from('keyword_replies')
    .select('keywords, reply_type, content')
    .eq('tenant_id', tenant.id)
    .eq('active', true)
    .order('sort_order', { ascending: true });
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

  // ④ 內建指令（06 §3 補列的關鍵字覆蓋規格：richMenuCells 18 格 + 系統關鍵字 15 組）
  const hit = resolveBuiltinIntent(text);
  if (hit) {
    // 停用的系統關鍵字組＝顧客打這些字「完全沒有回應」（頁面停用確認視窗的原話），
    // 因此這裡直接 return，不落到 ⑤ AI / ⑥ defaultReply。
    if (hit.group && (await isSystemGroupDisabled(tenant, lineConfig, hit.group))) return;
    const handled = await replyBuiltin(hit.intent, { admin, tenant, token, replyToken, userId });
    if (handled) return;
    // handled=false 只有一種情況：這家店本來就沒有這一類東西（例：美髮沙龍收到
    // 「行程」），交給 ⑤ AI / ⑥ defaultReply 比硬回一句「目前沒有行程」自然。
  }

  // ⑤ AI 客服（09 分冊 §7：AI_ASSISTANT 訂閱有效 且 ai.enabled）
  if (await isFeatureActive(tenant.id, 'AI_ASSISTANT')) {
    const { data: row } = await admin
      .from('tenant_settings')
      .select('ai, basic, business')
      .eq('tenant_id', tenant.id)
      .maybeSingle();
    const ai = aiSettingsSchema.parse(row?.ai ?? {});
    if (ai.enabled) {
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

/* ------------------------------------------------- 內建指令：分派與共用工具 */

interface BuiltinCtx {
  admin: SupabaseClient;
  tenant: WebhookTenant;
  token: string;
  replyToken: string;
  userId: string;
}

/**
 * 該組系統關鍵字是否已被店家停用。
 *
 * 生效條件（keyword-replies 頁的文案原話：「停用/覆蓋屬『自訂關鍵字回覆』功能
 * 範圍，需訂閱才會對顧客生效（設定隨時可先存）」）：未訂閱 KEYWORD_REPLY 時，
 * 設定存得下來，但顧客端維持系統預設行為。這裡照那句話實作——**不是**設定存了
 * 就一定生效，否則頁面顯示的「尚未生效」就變成謊話。
 */
async function isSystemGroupDisabled(
  tenant: WebhookTenant,
  lineConfig: Record<string, any>,
  group: string,
): Promise<boolean> {
  const disabled = lineConfig.systemKeywordGroupsDisabled;
  if (!Array.isArray(disabled) || !disabled.includes(group)) return false;
  return isFeatureActive(tenant.id, 'KEYWORD_REPLY');
}

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

/** 營業時間摘要（AI 上下文與「營業時間」內建指令共用同一份表述） */
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
      return replyServiceList(ctx);
    case 'MY_BOOKING':
      return replyMyBookings(ctx);
    case 'ORDER':
      return replyOrders(ctx);
    case 'MENU':
    case 'HELP':
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
    case 'TRIP':
      return replyTrips(ctx);
    case 'DEPARTURE':
      // 團次／名額屬 Phase 8b（trip_departures 表尚未建）。嚮導的選單有這一格，
      // 一定要有回應；其他業態不攔截。
      return businessTypeOf(ctx.tenant) === 'GUIDE'
        ? replyText(ctx, MSG.notReadyDeparture)
        : false;
    case 'CLINIC_QUEUE':
      // 看診進度（叫號）尚未實作；只有診所的選單有這一格。
      return businessTypeOf(ctx.tenant) === 'CLINIC'
        ? replyText(ctx, MSG.notReadyClinicQueue)
        : false;
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
    case 'NOTIFY':
      // 「開啟/關閉店家通知」目前沒有儲存位置（line_users 無對應欄位），推播也
      // 還沒有讀任何開關。做一個寫得進去卻沒人讀的欄位，等於回一句做不到的
      // 「已為您開啟」——照 CLAUDE.md 誠實原則，先明說還不能自助設定。
      return replyText(ctx, MSG.notReadyNotifyToggle);
    default:
      return false;
  }
}

/* --------------------------------------------------- 內建指令：選單 / 說明 */
/**
 * 「選單」「主選單」「功能」「說明」「幫助」→ 這家店（依業態）可用的關鍵字清單。
 *
 * ⚠️ 06 §6 要求「選單」關鍵字回 flex-menu 設定組出的 Flex Message——那一項
 * （flex-menu 三層）不在本次範圍，08 清單另列一項。這裡回的是純文字清單，
 * 內容取自 MODE_PRESETS.richMenuCells，所以列出來的每一個字都保證有 handler。
 */
async function replyMenu(ctx: BuiltinCtx): Promise<boolean> {
  const cells = MODE_PRESETS[businessTypeOf(ctx.tenant)].richMenuCells;
  const lines = [...new Set(cells.map((c) => c.text))].map((t) => `・${t}`);
  return replyText(ctx, `${MSG.menuTitle}\n${lines.join('\n')}\n\n${MSG.menuFooter}`);
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
    const amount = c.discount_type === 'PERCENT' ? `${value} 折` : `折抵 NT$${value.toLocaleString('zh-TW')}`;
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

/* -------------------------------------------------------- 內建指令：行程 */
/**
 * 「行程」「所有行程」…→ 已發布的行程清單。
 * 表 0016 已建；Flex 輪播（06 §3 原文的「行程輪播」）屬後續美化，先回文字清單，
 * 至少讓嚮導的選單第一格按下去有東西看。
 */
async function replyTrips(ctx: BuiltinCtx): Promise<boolean> {
  const { data } = await ctx.admin
    .from('trips')
    .select('title, tagline, summary')
    .eq('tenant_id', ctx.tenant.id)
    .eq('status', 'PUBLISHED')
    .order('created_at', { ascending: false })
    .limit(SERVICE_LIST_LIMIT);
  if (!data?.length) {
    // 沒有行程的一般店家（美髮沙龍收到「行程」）交給 AI／預設回覆比較自然；
    // 嚮導的選單有這一格，必須有回應。
    return businessTypeOf(ctx.tenant) === 'GUIDE' ? replyText(ctx, MSG.tripEmptyGuide) : false;
  }
  const lines = data.map((t: any) => {
    const sub = String(t.tagline || t.summary || '').split('\n')[0];
    return sub ? `・${t.title}：${sub}` : `・${t.title}`;
  });
  const url = buildPublicBookingUrl(APP_URL, ctx.tenant.shop_code);
  return replyText(ctx, `${MSG.tripTitle}\n${lines.join('\n')}\n\n${url}`);
}

/* -------------------------------------------------------- 內建指令：訂單 */
async function replyOrders(ctx: BuiltinCtx): Promise<boolean> {
  // 嚮導的「我的訂單」是行程訂單（tour_orders 表屬 Phase 8b，尚未建）
  if (businessTypeOf(ctx.tenant) === 'GUIDE') return replyText(ctx, MSG.notReadyTourOrder);

  const customerId = await boundCustomerId(ctx);
  if (!customerId) return replyText(ctx, MSG.myBookingsNotBound);

  const { data } = await ctx.admin
    .from('product_orders')
    .select('order_no, total_amount, status, created_at')
    .eq('tenant_id', ctx.tenant.id)
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(SERVICE_LIST_LIMIT);
  if (!data?.length) return replyText(ctx, MSG.orderEmpty);

  const statusText: Record<string, string> = {
    PENDING: '待確認', CONFIRMED: '已確認', COMPLETED: '已完成', CANCELLED: '已取消',
  };
  const lines = data.map(
    (o: any) =>
      `・${o.order_no}｜NT$${Number(o.total_amount).toLocaleString('zh-TW')}｜${statusText[o.status] ?? o.status}`,
  );
  return replyText(ctx, `${MSG.orderTitle}\n${lines.join('\n')}`);
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

/* ------------------------------------------------------- 內建指令：服務 */
/**
 * 「預約」「服務」「服務項目」→ active 服務清單（名稱+價格+時長，最多 10 筆）+ 引導語。
 *
 * 沒有 active 服務時原本回 false（落到 ⑤/⑥）——但 Rich Menu 的第一格就是這個字，
 * 一家還沒上架服務的新店，顧客按下去會完全沒反應。改為誠實回「還沒有上架服務」
 * 並附公開頁連結：說的是實情，也保證按鈕一定有回應（06 §3）。
 */
async function replyServiceList(ctx: BuiltinCtx): Promise<boolean> {
  const { data: svcs } = await ctx.admin
    .from('services')
    .select('name, price, duration_minutes')
    .eq('tenant_id', ctx.tenant.id)
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .limit(SERVICE_LIST_LIMIT);
  const shopUrl = buildPublicBookingUrl(APP_URL, ctx.tenant.shop_code); // 公開頁 Phase 8 落地
  if (!svcs?.length) return replyText(ctx, MSG.serviceListEmpty(shopUrl));

  const lines = svcs.map(
    (s: any) =>
      `・${s.name}｜NT$${Number(s.price).toLocaleString('zh-TW')}｜${s.duration_minutes} 分鐘`,
  );
  return replyText(
    ctx,
    `${MSG.serviceListTitle}\n${lines.join('\n')}\n\n${MSG.serviceListFooter(shopUrl)}`,
  );
}

/* --------------------------------------------------- 內建指令：我的預約 */
/** 「我的預約」→ 已綁定顧客的未來 PENDING/CONFIRMED bookings 文字清單；未綁定→引導 */
async function replyMyBookings(ctx: BuiltinCtx): Promise<boolean> {
  const customerId = await boundCustomerId(ctx);
  if (!customerId) return replyText(ctx, MSG.myBookingsNotBound);

  // Phase 10：這裡要合併 tour_orders（10 分冊 §6.1 的 MY_BOOKING/ORDER 合併規則）
  const { data: bs } = await ctx.admin
    .from('bookings')
    .select('start_at, status, services(name)')
    .eq('tenant_id', ctx.tenant.id)
    .eq('customer_id', customerId)
    .in('status', ['PENDING', 'CONFIRMED'])
    .gte('start_at', new Date().toISOString())
    .order('start_at', { ascending: true })
    .limit(SERVICE_LIST_LIMIT);
  if (!bs?.length) return replyText(ctx, MSG.myBookingsEmpty);

  const lines = bs.map((b: any) => {
    const svc = Array.isArray(b.services) ? b.services[0] : b.services;
    const suffix = b.status === 'PENDING' ? MSG.statusPending : '';
    return `・${formatTaipei(b.start_at)}｜${svc?.name ?? ''}${suffix}`;
  });
  return replyText(ctx, `${MSG.myBookingsTitle}\n${lines.join('\n')}`);
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

  // 營業時間摘要（perDayMode 逐日時段的完整表述留給 Phase 10 的 catalog 整合）；
  // 與「營業時間」內建指令共用同一支 formatBusinessHours，兩處講的話才會一致。
  const businessHours = formatBusinessHours(biz);

  return {
    name: basic.tenantName || tenant.name,
    description: String(basic.tenantDescription ?? ''),
    businessHours,
    services,
    trips: [], // 表 0016 已建但 catalog 統一查詢未做（11 分冊）；補上前誠實回空
    departures: [], // 同上：未來 14 天團次與即時剩餘名額（每次即時查、不快取）
    ai: { personaNotes: ai.personaNotes, faq: ai.faq },
    // 公開商店頁 Phase 8 落地；URL 規則以 tenant-settings.ts 的 helper 為單一事實來源
    shopUrl: buildPublicBookingUrl(APP_URL, tenant.shop_code),
  };
}

/* ----------------------------------------------------------------- utils */
/**
 * 自訂關鍵字比對（06 §3 分支 ②）。
 *
 * 規格原文只寫「keywords 完全比對」，但關鍵字回覆頁的「觸發方式」自原站起就有
 * EXACT／CONTAINS 兩種、**預設還是 CONTAINS**（「訊息裡有這個字就回（建議）」）。
 * 只做完全比對的話：店家選了「包含」、畫面顯示已儲存，顧客打「請問價格多少」
 * 卻永遠沒有回應——頁面存得下來的設定，webhook 就必須認得。
 *
 * 順序：先找完全相同（較精確），再找包含；同類型內依 sort_order（查詢已排序）。
 * 沒有 matchType 的舊列（或由其他途徑寫入的列）視為 EXACT，行為與過去一致。
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

/** timestamptz ISO → 台北時間「M/D（週）HH:mm」（比照 src/server/tz.ts 的固定 +08:00 做法） */
function formatTaipei(iso: string): string {
  const t = new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000);
  const wd = ['日', '一', '二', '三', '四', '五', '六'][t.getUTCDay()];
  const hh = String(t.getUTCHours()).padStart(2, '0');
  const mm = String(t.getUTCMinutes()).padStart(2, '0');
  return `${t.getUTCMonth() + 1}/${t.getUTCDate()}（${wd}）${hh}:${mm}`;
}
