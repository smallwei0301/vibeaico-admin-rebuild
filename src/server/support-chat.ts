/**
 * src/server/support-chat.ts — 右下角客服小幫手真的會回答的那一層
 * -----------------------------------------------------------------------------
 * ## 修好前的病
 *
 * `src/components/layout/SupportChatWidget.tsx` 掛在**後台每一頁**上。它開場白說
 * 「我是 VibeAI 平台的 AI 客服助理，可以幫您查 LINE 狀態、推播額度、最近異常
 * 日誌，或回答後台使用問題」，店家打字送出後，`send()` 只做兩件事：把訊息
 * `append` 到本地 state、清空輸入框。沒有任何端點、沒有任何回覆——永遠。
 *
 * 那不是「功能還沒建好」，是 00 分冊鐵則 12 定義的假成功：介面宣稱做得到，
 * 實際什麼都沒發生，而且店家沒有任何方式知道自己被已讀不回。
 *
 * ## 這一版做什麼、為什麼是這個範圍
 *
 * 依治理原則「**復原而非取消**」：不是把 widget 拿掉，也不是只掛一張
 * 「尚未開通」的告示，而是讓它**真的回答**。
 *
 * 開場白點名的四件事裡，三件的資料在這個系統裡本來就是真的：
 *
 * | 開場白宣稱 | 這一版 |
 * |---|---|
 * | LINE 狀態 | ✅ 真的讀 `tenant_settings`（憑證是否齊全、自動回覆開關、webhook 位址） |
 * | 推播額度 | ✅ 真的讀 `push_quota_usage` 與 `EXTRA_PUSH` 訂閱，算出本月已用／上限／剩餘 |
 * | 方案與權益到期 | ✅ 真的讀 `feature_subscriptions`（這一項開場白沒提，但它是實際會咬人的那一個） |
 * | 「最近異常日誌」 | ❌ **這個系統沒有任何錯誤日誌表**（全 repo 零命中）。所以開場白不再宣稱它 |
 *
 * 「回答後台使用問題」也一併從開場白拿掉：那需要一個真的語言模型，這一版沒有，
 * 寫在開場白就是下一則假成功。
 *
 * ## 為什麼是關鍵字比對，而且刻意不叫「AI」
 *
 * 這裡沒有語言模型。判定是一張寫死的關鍵字表，看得到、測得到、不會亂講。
 * 因此文案一律稱它為「小幫手」，不稱 AI——把規則比對包裝成 AI 是另一種假成功，
 * 而且是店家分辨不出來的那一種。
 *
 * 判不出來時**不猜**：回一則說明它只會這三類、並指出真人客服的去處。猜錯的成本
 * 不對稱——猜成 LINE 狀態而店家問的是退款，店家會拿到一段完全無關卻很像答案的
 * 文字，比誠實說「我看不懂」糟得多。
 *
 * ## 資料來源全部走 RLS
 *
 * `tenant_settings` / `push_quota_usage` / `feature_subscriptions` 三張表在
 * `0006_rls_policies.sql` 都有 `is_tenant_member(tenant_id)` 的 select 政策，
 * 所以這裡一律用呼叫端帶 session 的 client，**不用 service role**：這一層沒有任何
 * 需要繞過 RLS 的理由，用了就等於自己拆掉第二道防線。
 *
 * 祕密永不外流：`line_channel_secret_enc` / `line_channel_access_token_enc` 只被
 * 拿來判斷「是不是空的」，`select` 清單裡連欄位都不取——取回來再自律不輸出，
 * 遲早會有人把整包序列化出去。
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { taipeiCurrentMonthKey } from './tz';

/** 這一版真的回答得了的問題種類。`UNSUPPORTED` 是「我看不懂」，不是錯誤。 */
export type SupportIntent = 'LINE_STATUS' | 'PUSH_QUOTA' | 'ENTITLEMENT' | 'UNSUPPORTED';

/** 一條「標題：值」的事實。頁面照順序列出來，不重新排版、不加工。 */
export interface SupportFact {
  label: string;
  value: string;
  /** true = 這一項現在是有問題的，畫面上要凸顯 */
  warning?: boolean;
}

export interface SupportAnswer {
  intent: SupportIntent;
  /** 一句話結論 */
  answer: string;
  facts: SupportFact[];
  /** 後台內部連結（相對路徑），讓店家一鍵去修 */
  links: { label: string; href: string }[];
}

/**
 * 關鍵字表。**刻意寫死、刻意不做語意判斷。**
 *
 * 順序有意義：由上而下第一個命中的就是答案。`ENTITLEMENT` 排在 `PUSH_QUOTA`
 * 之後，因為「額度」同時是兩者的常用詞，而問「額度」十次有九次問的是推播。
 */
export const SUPPORT_KEYWORDS: ReadonlyArray<{ intent: SupportIntent; words: readonly string[] }> = [
  {
    intent: 'PUSH_QUOTA',
    words: ['推播額度', '推播', '額度', '配額', 'quota', '還能發', '剩幾則', '幾則'],
  },
  {
    intent: 'LINE_STATUS',
    words: ['line', 'LINE', '串接', '綁定', 'webhook', '頻道', 'channel', '官方帳號', '自動回覆'],
  },
  {
    intent: 'ENTITLEMENT',
    words: ['方案', '權益', '訂閱', '到期', '過期', '試用', '功能沒了', '功能不見'],
  },
];

/**
 * 問題 → 意圖。找不到就 `UNSUPPORTED`。
 *
 * 只做小寫化，不做斷詞：中文斷詞在這個規模只會引入一個測不完的依賴，而
 * 「包含這個詞」對一張 20 個詞的表已經夠用。
 */
export function resolveSupportIntent(question: string): SupportIntent {
  const text = String(question ?? '').toLowerCase();
  if (!text.trim()) return 'UNSUPPORTED';
  for (const row of SUPPORT_KEYWORDS) {
    if (row.words.some((w) => text.includes(w.toLowerCase()))) return row.intent;
  }
  return 'UNSUPPORTED';
}

/** 免費 200 則／月；訂閱 `EXTRA_PUSH` 後 700（09 分冊 §5，與 `consumePushQuota` 同一組數字）。 */
export const PUSH_QUOTA_FREE = 200;
export const PUSH_QUOTA_EXTRA = 700;

const yes = (v: boolean) => (v ? '已設定' : '尚未設定');

/**
 * 純函式：把已經查好的事實變成回覆。
 *
 * 與查詢分開的理由是它才是真正有分支的那一段——測它不需要資料庫，也就沒有
 * 「因為連不到 DB 所以整條沒被驗到」的空轉測試。
 */
export function buildSupportAnswer(input: {
  intent: SupportIntent;
  line?: {
    channelIdSet: boolean;
    secretSet: boolean;
    tokenSet: boolean;
    autoReplyEnabled: boolean;
    webhookUrl: string;
  };
  quota?: { used: number; limit: number; month: string; extraPush: boolean };
  entitlement?: { total: number; live: number; expired: number; nextExpiry: string | null };
}): SupportAnswer {
  if (input.intent === 'LINE_STATUS' && input.line) {
    const l = input.line;
    const ready = l.channelIdSet && l.secretSet && l.tokenSet;
    return {
      intent: 'LINE_STATUS',
      answer: ready
        ? '您的 LINE 憑證三項都已設定，機器人可以收發訊息。'
        : '您的 LINE 憑證還沒設定齊全，顧客傳訊息時機器人不會有反應。',
      facts: [
        { label: 'Channel ID', value: yes(l.channelIdSet), warning: !l.channelIdSet },
        { label: 'Channel Secret', value: yes(l.secretSet), warning: !l.secretSet },
        { label: 'Channel Access Token', value: yes(l.tokenSet), warning: !l.tokenSet },
        { label: '自動回覆', value: l.autoReplyEnabled ? '開啟' : '關閉' },
        { label: 'Webhook 網址', value: l.webhookUrl || '尚未產生', warning: !l.webhookUrl },
      ],
      links: [{ label: '前往 LINE 設定', href: '/tenant/line-settings' }],
    };
  }

  if (input.intent === 'PUSH_QUOTA' && input.quota) {
    const q = input.quota;
    const left = Math.max(0, q.limit - q.used);
    return {
      intent: 'PUSH_QUOTA',
      answer:
        left === 0
          ? `${q.month} 的推播額度已經用完，這個月不會再送出任何推播。`
          : `${q.month} 還可以推播 ${left} 則。`,
      facts: [
        { label: '統計月份（台北時間）', value: q.month },
        { label: '本月已用', value: `${q.used} 則` },
        { label: '本月上限', value: `${q.limit} 則` },
        { label: '剩餘', value: `${left} 則`, warning: left === 0 },
        { label: '加購方案 EXTRA_PUSH', value: q.extraPush ? '已訂閱' : '未訂閱' },
      ],
      links: [{ label: '前往行銷推播', href: '/tenant/marketing' }],
    };
  }

  if (input.intent === 'ENTITLEMENT' && input.entitlement) {
    const e = input.entitlement;
    return {
      intent: 'ENTITLEMENT',
      answer:
        e.expired > 0
          ? `您有 ${e.expired} 項權益已經過期，過期的功能會直接停用。`
          : e.live > 0
            ? `您目前有 ${e.live} 項有效權益。`
            : '您目前沒有任何已生效的權益訂閱。',
      facts: [
        { label: '有效中', value: `${e.live} 項` },
        { label: '已過期', value: `${e.expired} 項`, warning: e.expired > 0 },
        { label: '訂閱紀錄總數', value: `${e.total} 項` },
        {
          label: '下一個到期日',
          value: e.nextExpiry ?? '目前沒有即將到期的訂閱',
        },
      ],
      links: [{ label: '前往功能商店', href: '/tenant/feature-store' }],
    };
  }

  return {
    intent: 'UNSUPPORTED',
    answer:
      '這個問題我看不懂，所以我不猜。我目前只查得到三件事：LINE 串接狀態、本月推播額度、方案與權益到期。其他問題請直接與平台聯絡。',
    facts: [],
    links: [
      { label: 'LINE 設定', href: '/tenant/line-settings' },
      { label: '行銷推播', href: '/tenant/marketing' },
      { label: '功能商店', href: '/tenant/feature-store' },
    ],
  };
}

/**
 * 查詢 + 組答案。三種意圖各只查自己需要的那一張表。
 *
 * `client` 必須是**帶呼叫端 session 的** client：租戶邊界完全交給 RLS，這裡不再
 * 自己加 `tenant_id` 條件以外的防線，也不需要——三張表的 select 政策都是
 * `is_tenant_member(tenant_id)`。`tenantId` 仍然逐一帶上，讓「多店成員」的情況
 * 取到的是目前選定的那一家，而不是 RLS 放行的全部。
 */
export async function loadSupportAnswer(
  client: SupabaseClient,
  ctx: { tenantId: string; shopCode: string; appUrl: string },
  question: string,
): Promise<SupportAnswer> {
  const intent = resolveSupportIntent(question);

  if (intent === 'LINE_STATUS') {
    // ⚠️ select 清單裡沒有 *_enc 本身，只有「是不是 null」的判斷欄位。
    const { data, error } = await client
      .from('tenant_settings')
      .select('line, line_channel_secret_enc, line_channel_access_token_enc')
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle();
    if (error) throw error;
    const line = (data?.line ?? {}) as Record<string, unknown>;
    return buildSupportAnswer({
      intent,
      line: {
        channelIdSet: Boolean(String(line.channelId ?? '').trim()),
        secretSet: Boolean(String(data?.line_channel_secret_enc ?? '').trim()),
        tokenSet: Boolean(String(data?.line_channel_access_token_enc ?? '').trim()),
        autoReplyEnabled: line.autoReplyEnabled !== false,
        webhookUrl: ctx.appUrl ? `${ctx.appUrl}/api/line/webhook/${ctx.shopCode}` : '',
      },
    });
  }

  if (intent === 'PUSH_QUOTA') {
    const month = taipeiCurrentMonthKey();
    const [usage, extra] = await Promise.all([
      client
        .from('push_quota_usage')
        .select('used')
        .eq('tenant_id', ctx.tenantId)
        .eq('month', month)
        .maybeSingle(),
      client
        .from('feature_subscriptions')
        .select('active, expires_at')
        .eq('tenant_id', ctx.tenantId)
        .eq('code', 'EXTRA_PUSH')
        .maybeSingle(),
    ]);
    if (usage.error) throw usage.error;
    if (extra.error) throw extra.error;
    const extraActive =
      Boolean(extra.data?.active) &&
      (!extra.data?.expires_at || new Date(extra.data.expires_at as string) > new Date());
    return buildSupportAnswer({
      intent,
      quota: {
        used: Number(usage.data?.used ?? 0),
        limit: extraActive ? PUSH_QUOTA_EXTRA : PUSH_QUOTA_FREE,
        month,
        extraPush: extraActive,
      },
    });
  }

  if (intent === 'ENTITLEMENT') {
    const { data, error } = await client
      .from('feature_subscriptions')
      .select('code, active, expires_at')
      .eq('tenant_id', ctx.tenantId);
    if (error) throw error;
    const rows = data ?? [];
    const now = Date.now();
    // 與 isFeatureActive() 逐字同一條判準：過期就是無效，不看 active。
    const isLive = (r: { active?: unknown; expires_at?: unknown }) =>
      Boolean(r.active) && (!r.expires_at || new Date(r.expires_at as string).getTime() > now);
    const live = rows.filter(isLive).length;
    // 「下一個到期日」＝**還沒到的**那些裡面最早的一個。取全部裡的最大值會回一個
    // 早就過去的日期，卻擺在一個讀起來像「接下來要注意」的標題底下——那不是排序
    // 寫錯，是一則會誤導店家的答案。沒有任何未來到期日時回 null，文案照實說。
    const futureExpiries = rows
      .map((r) => r.expires_at as string | null)
      .filter((v): v is string => Boolean(v))
      .filter((v) => new Date(v).getTime() > now)
      .sort();
    return buildSupportAnswer({
      intent,
      entitlement: {
        total: rows.length,
        live,
        expired: rows.length - live,
        nextExpiry: futureExpiries[0] ?? null,
      },
    });
  }

  return buildSupportAnswer({ intent: 'UNSUPPORTED' });
}
