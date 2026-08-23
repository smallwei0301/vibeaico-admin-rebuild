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
  ai: { personaNotes?: string; faq?: { q: string; a: string }[] };
  shopUrl: string; // buildPublicBookingUrl()，引導下單用
};

export async function aiReply(question: string, shop: ShopContext): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null; // 平台未開 AI → 靜默停用

  const faq = (shop.ai.faq ?? []).map((f) => `Q: ${f.q}\nA: ${f.a}`).join('\n\n');
  try {
    const anthropic = new Anthropic();
    const response = await anthropic.messages.create(
      {
        model: 'claude-opus-5',
        max_tokens: 1024,
        // 低 effort：客服回覆是從固定上下文答題，不需要深度推理，且 LINE reply token
        // 有時效（見上方逾時規約），latency 比推理深度重要
        output_config: { effort: 'low' },
        system: [
          `你是「${shop.name}」的 LINE 客服助理，用繁體中文、口語、簡短（100 字內）回覆顧客。`,
          `店家介紹：${shop.description}`,
          `營業時間：${shop.businessHours}`,
          shop.services.length ? `服務項目：\n${shop.services.join('\n')}` : '',
          shop.trips.length ? `行程與方案：\n${shop.trips.join('\n')}` : '',
          shop.departures.length
            ? `未來 14 天可報名團次（剩餘名額為即時資料）：\n${shop.departures.join('\n')}`
            : '',
          shop.ai.personaNotes ?? '',
          faq ? `常見問答：\n${faq}` : '',
          [
            '規則：',
            '1. 只回答與本店相關的問題。',
            '2. 名額、價格、日期一律以上面提供的資料為準，**絕對不要推測或編造**；',
            '   上面沒有的日期就說「那天目前沒有開團」。',
            `3. 顧客想預約時，附上訂購連結 ${shop.shopUrl} 或請他輸入「預約」。`,
            '4. 不確定，或涉及改期／退費／客訴／議價時，只回覆「UNSURE」讓真人接手。',
          ].join('\n'),
        ].filter(Boolean).join('\n\n'),
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
