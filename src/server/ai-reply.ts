/**
 * src/server/ai-reply.ts — AI 客服（AI_ASSISTANT）回覆產生器
 * 規格：docs/integration/09-FEATURE-STORE.md §7.2（逐字為基底）。
 *
 * 呼叫規約（09 §7.2）：
 * - 走 reply 不走 push（不佔推播額度）；LINE replyToken 有時效，
 *   因此 API 呼叫設 10 秒逾時（AbortSignal.timeout(10_000)）。
 * - 逾時或任何失敗 → catch 後回 null（呼叫端落回 handoff / defaultReply），不重試。
 * - 回 null 也代表「AI 判定無法回答」（回覆含 UNSURE）→ 交給真人接手。
 * - ANTHROPIC_API_KEY 未設定 → 直接回 null（graceful：平台沒開 AI 也不能炸 webhook）。
 * - 團次資料由呼叫端每次即時查（不快取）—— 名額是會變的。
 *
 * ⚠️ 偏離 09 §7.2 原文一處：原文在模組頂層 `const anthropic = new Anthropic()`，
 *    但 SDK 在 key 缺失時於「建構時」就丟錯，會炸掉整個 webhook 模組載入。
 *    改為函式內、確認 ANTHROPIC_API_KEY 存在後才建構，行為不變。
 */
import Anthropic from '@anthropic-ai/sdk';
import { addCalendarDays } from '@/server/line-departures';

/** LINE 客服上下文；trips/departures 只在該租戶有 TOUR_MODULE 時才有值 */
export type ShopContext = {
  name: string;
  description: string;
  businessHours: string;
  /** 「服務項目 · 60 分鐘 · NT$800」 */
  services: string[];
  /** 「龜山島賞鯨半日遊 · 標準團 NT$1,280/人、包船 NT$18,000/團 · 宜蘭頭城」 */
  trips: string[];
  /** 未來 14 天可售團次與即時剩餘名額：「龜山島賞鯨 標準團 8/23(六) 09:00 剩 3 位」 */
  departures: string[];
  /** 行程／團次查詢失敗（#1024）：為 true 時 AI 不得把「沒資料」當成「沒開團」，一律交真人 */
  catalogUnavailable?: boolean;
  /** 團次清單被查詢上限截斷時，清單涵蓋到的最後日期（YYYY-MM-DD）；其後的日期不得說成沒開團 */
  departuresTruncatedAfter?: string;
  /** 團次查詢的日期窗（店家時區；today = from）。有行程目錄時一定有；沒有行程目錄的店家為 undefined */
  departureWindow?: { today: string; from: string; to: string };
  /** 有啟用中的 INSTANT 方案（不列固定團次）：未列出的日期不得說成沒開團，改請顧客聯絡店家確認 */
  hasInstantPlan?: boolean;
  ai: { personaNotes?: string; faq?: { q: string; a: string }[] };
  shopUrl: string; // buildPublicBookingUrl()，引導下單用
};

/** 有日期窗時的規則 2：「沒開團」只適用日期窗內（截斷時只到截斷日前一天）、上面沒列出的日期，其餘一律 UNSURE。 */
function windowRule(win: { today: string; from: string; to: string }, cut?: string): string[] {
  const head = '2. 名額、價格、日期一律以上面提供的資料為準，**絕對不要推測或編造**；';
  const end = cut ? addCalendarDays(cut, -1) : win.to;
  const outside = cut ? `${cut}（含）之後` : `${win.to} 之後`;
  if (end < win.from) {
    return [head, `   ${win.from} 起的日期、時段、名額一律只回覆「UNSURE」，不要說「那天目前沒有開團」。`];
  }
  return [
    head,
    `   只有 ${win.from}～${end} 之間、上面沒有列出的日期，才說「那天目前沒有開團」；` +
      `${outside}（或 ${win.today} 之前）的日期、時段、名額只回覆「UNSURE」。`,
  ];
}

/** 有 INSTANT 方案時的規則 2：不得說任何日期沒開團，未列出的日期請顧客聯絡店家確認可預約時段（與公開頁 instantNote 語意一致）。 */
function instantRule(shopUrl: string, win: { from: string; to: string }, cut?: string): string[] {
  return [
    '2. 名額、價格、日期一律以上面提供的資料為準，**絕對不要推測或編造**；',
    '   只能以上面列出的團次回答具體團次與名額；**不得說任何日期「沒有開團」**（部分方案需與店家確認時段）；',
    `   被問到 ${win.from}～${cut ? addCalendarDays(cut, -1) : win.to} 之間、上面沒列出的日期，請顧客聯絡店家確認可預約時段並附上 ${shopUrl}；涉及名額或價格不確定時只回覆「UNSURE」；`,
    cut
      ? `   團次清單在 ${cut} 被截斷：${cut}（含）之後的日期、時段、名額只回覆「UNSURE」；${win.to} 之後或今天之前同樣只回覆「UNSURE」。`
      : `   ${win.to} 之後（或今天之前）的日期、時段、名額只回覆「UNSURE」。`,
  ];
}

/** 組 AI 客服 system prompt（純函式，可單獨測試）。 */
export function buildAiSystemPrompt(shop: ShopContext): string {
  const faq = (shop.ai.faq ?? []).map((f) => `Q: ${f.q}\nA: ${f.a}`).join('\n\n');
  const cut = shop.departuresTruncatedAfter;
  const win = shop.departureWindow;
  const dataRule = shop.catalogUnavailable
    ? [
        '2. 行程與團次資料暫時無法取得：被問到日期、名額、價格時，只回覆「UNSURE」讓真人接手，',
        '   **絕對不要說「沒有開團」，也不要推測或編造**。',
      ]
    : win && shop.hasInstantPlan
      ? instantRule(shop.shopUrl, win, cut)
    : win
      ? windowRule(win, cut)
      : cut
        ? [
            '2. 名額、價格、日期一律以上面提供的資料為準，**絕對不要推測或編造**；',
            `   團次清單在 ${cut} 被截斷：${cut}（含）之後的日期、時段、名額只回覆「UNSURE」；`,
            `   ${cut} 之前上面沒有的日期才說「那天目前沒有開團」。`,
          ]
        : [
            '2. 名額、價格、日期一律以上面提供的資料為準，**絕對不要推測或編造**；',
            '   上面沒有的日期就說「那天目前沒有開團」。',
          ];
  return [
    `你是「${shop.name}」的 LINE 客服助理，用繁體中文、口語、簡短（100 字內）回覆顧客。`,
    `店家介紹：${shop.description}`,
    `營業時間：${shop.businessHours}`,
    shop.services.length ? `服務項目：\n${shop.services.join('\n')}` : '',
    shop.trips.length ? `行程與方案：\n${shop.trips.join('\n')}` : '',
    win && !shop.catalogUnavailable
      ? `今天是 ${win.today}（店家時區）。${win.from}～${win.to} 可報名團次（剩餘名額為即時資料）：\n${
          shop.departures.length ? shop.departures.join('\n')
            : shop.hasInstantPlan
              ? '（此期間沒有固定出發的團次；部分方案可另與店家確認時段）'
              : '（此期間沒有可報名團次）'
        }`
      : shop.departures.length
        ? `未來 14 天可報名團次（剩餘名額為即時資料）：\n${shop.departures.join('\n')}`
        : '',
    shop.ai.personaNotes ?? '',
    faq ? `常見問答：\n${faq}` : '',
    [
      '規則：',
      '1. 只回答與本店相關的問題。',
      ...dataRule,
      `3. 顧客想預約時，附上訂購連結 ${shop.shopUrl} 或請他輸入「預約」。`,
      '4. 不確定，或涉及改期／退費／客訴／議價時，只回覆「UNSURE」讓真人接手。',
    ].join('\n'),
  ].filter(Boolean).join('\n\n');
}

export async function aiReply(question: string, shop: ShopContext): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null; // 平台未開 AI → 靜默停用

  try {
    const anthropic = new Anthropic();
    const response = await anthropic.messages.create(
      {
        model: 'claude-opus-5',
        max_tokens: 1024,
        // 低 effort：客服回覆是從固定上下文答題，不需要深度推理，且 LINE reply token
        // 有時效（見上方逾時規約），latency 比推理深度重要
        output_config: { effort: 'low' },
        system: buildAiSystemPrompt(shop),
        messages: [{ role: 'user', content: question }],
      },
      // LINE replyToken 有時效：10 秒逾時，逾時丟 AbortError 進下面的 catch
      { signal: AbortSignal.timeout(10_000) },
    );
    const text = response.content.find((b) => b.type === 'text')?.text?.trim() ?? '';
    if (!text || text.includes('UNSURE')) return null; // null = 交給 handoff / defaultReply / 人工
    return text;
  } catch (e) {
    // 逾時 / 網路 / API 錯誤一律回 null（不重試）—— webhook 落回 defaultReply
    console.error('[ai-reply]', e);
    return null;
  }
}
