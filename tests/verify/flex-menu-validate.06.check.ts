/**
 * tests/verify/flex-menu-validate.06.check.ts — Flex 主選單對 LINE 官方端點的驗證（issue #6）
 * =============================================================================
 * ## 這支檔案存在的理由
 *
 * #6 的第 6 格驗收是「Flex JSON 通過 `POST /v2/bot/message/validate/reply`」。那一格
 * 原本的打勾依據是 2026-08-25 在 `claude/deploy-vercel-project-nnno59`（`7ad9ac53`）
 * 上的歷史輸出，而那條分支**從未合進 `main`**。issue 自己把這件事寫了出來：
 *
 * > ⚠️ `scripts/verify/flex-menu-validate.cjs` 本身沒有隨本 PR 移植進 `main`……
 * > 上述輸出因此是**引用的歷史實測**，不是本輪重跑的。
 * > **這是本條打勾裡唯一不夠硬的地方，明寫在這裡而不是藏起來。**
 *
 * 這支檔案就是把那一格補硬：它 **import `main` 上現行的 `buildFlexMenuOutcome()`**，
 * 所以驗的是「現在這份程式碼產生的 JSON，LINE 收不收」，而不是某條舊分支的。
 *
 * ## 為什麼不是 `*.test.ts`、不在 `tests/unit/`
 *
 * 它打真實的 LINE API，需要真實 channel access token（Drive 憑證，不是 repo secret），
 * 所以 **CI 跑不了也不該跑**。12 分冊 §3 明訂單元測試不得碰網路。放在 `tests/verify/`
 * 並用獨立的 `vitest.verify.config.mts`，`npm test` 與 `npm run test:integration`
 * 的 include 都掃不到它。由人在需要時執行：
 *
 * ```bash
 * LINE_TOKEN='<Midao channel access token>' npm run verify:flex-menu
 * ```
 *
 * ## 安全性
 *
 * `validate/reply` 是 LINE 提供的**純驗證**端點：不送出任何訊息、不需要 replyToken、
 * 不消耗推播額度。本檔在最前與最後各查一次 `/v2/bot/message/quota/consumption`，
 * 若兩者不同就直接失敗——「它不耗額度」這句話由每一次執行自己證明，不靠記憶。
 *
 * ⚠️ 絕不要在這裡改用 `/v2/bot/message/push` 或 `/multicast` 去「順便驗一下」：
 * 那會真的發訊息給真實顧客並扣額度。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildFlexMenuOutcome, type FlexMenuOutcome } from '@/server/flex-menu';

const TOKEN = process.env.LINE_TOKEN ?? '';
const API = 'https://api.line.me';
const headers = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

async function consumption(): Promise<number> {
  const res = await fetch(`${API}/v2/bot/message/quota/consumption`, { headers });
  if (!res.ok) throw new Error(`quota/consumption ${res.status}：${await res.text()}`);
  return ((await res.json()) as { totalUsage?: number }).totalUsage ?? -1;
}

async function validateReply(messages: unknown[]): Promise<{ status: number; body: string }> {
  const res = await fetch(`${API}/v2/bot/message/validate/reply`, {
    method: 'POST', headers, body: JSON.stringify({ messages }),
  });
  return { status: res.status, body: await res.text() };
}

/** 一張最小可用的卡片；`over` 覆寫要測的那一個欄位 */
function card(n: number, over: Record<string, unknown> = {}) {
  return { title: `卡片 ${n}`, subtitle: `副標 ${n}`, imageUrl: '', linkUrl: '', ad: false, ...over };
}

/** 從 outcome 取出 messages，順便斷言它真的走到 FLEX 分支 */
function flexMessages(outcome: FlexMenuOutcome, label: string): unknown[] {
  expect(outcome.kind, `「${label}」的組裝結果不是 FLEX：${JSON.stringify(outcome)}`).toBe('FLEX');
  return (outcome as Extract<FlexMenuOutcome, { kind: 'FLEX' }>).messages;
}

let quotaBefore = -1;

beforeAll(async () => {
  if (!TOKEN) {
    throw new Error(
      '缺少 LINE_TOKEN。這支是需要真實 channel access token 的驗證資產，'
      + '請用 `LINE_TOKEN=<token> npm run verify:flex-menu` 執行（憑證見 Drive，勿寫進 repo）。',
    );
  }
  quotaBefore = await consumption();
});

afterAll(async () => {
  if (quotaBefore < 0) return; // beforeAll 就失敗了，不用再查
  const quotaAfter = await consumption();
  console.log(`QUOTA before=${quotaBefore} after=${quotaAfter}`);
  // 這一條是本檔「不會發訊息給顧客」的自我核實，不是裝飾。
  expect(quotaAfter, 'validate/reply 竟然消耗了推播額度——本檔的前提不成立，立刻停手').toBe(quotaBefore);
});

describe('main 現行 buildFlexMenuOutcome() 的輸出，LINE 官方端點收不收', () => {
  const shopName = '祕島 MIDAO';

  const cases: Array<[string, Record<string, unknown>]> = [
    ['1 張卡（無圖無連結）', { flexCards: [card(1)] }],
    ['12 張卡（carousel 上限）', { flexCards: Array.from({ length: 12 }, (_, i) => card(i + 1)) }],
    ['副標為空（不得產生空字串 text 元件）', { flexCards: [card(1, { subtitle: '' })] }],
    ['含廣告卡', { flexCards: [card(1, { ad: true }), card(2)] }],
    ['hero 圖 https ＋ https 連結', {
      flexCards: [card(1, { imageUrl: 'https://example.com/a.jpg', linkUrl: 'https://example.com/x' })],
    }],
    ['白名單 scheme：line://', { flexCards: [card(1, { linkUrl: 'line://ti/p/@786sojsi' })] }],
    ['白名單 scheme：tel:', { flexCards: [card(1, { linkUrl: 'tel:+886212345678' })] }],
    ['{shopName} 替換後的 header', {
      flexHeaderTitle: '✨ {shopName}', flexHeaderSubtitle: '{shopName} 為您服務',
      flexCards: [card(1)],
    }],
    ['flexShowTip 關閉（只有 carousel，沒有第二則提示）', {
      flexShowTip: false, flexCards: [card(1)],
    }],
  ];

  for (const [label, lineConfig] of cases) {
    it(`LINE 接受：${label}`, async () => {
      const outcome = buildFlexMenuOutcome(lineConfig, shopName);
      const messages = flexMessages(outcome, label);
      const res = await validateReply(messages);
      const bubbles = (outcome as Extract<FlexMenuOutcome, { kind: 'FLEX' }>).bubbleCount;
      console.log(`PASS-CASE ${label} [bubbles=${bubbles}, messages=${messages.length}] -> HTTP ${res.status} ${res.body}`);
      expect(res.status, `LINE 退回這個形狀：${res.body}`).toBe(200);
    });
  }

  /**
   * ⚠️ 負向對照。**沒有這兩條，上面一整排 200 沒有意義**——一個永遠回 200 的端點
   * 看起來會跟一個真的在驗的端點一模一樣（14 分冊 §6.5／§6.9 記過同一件事）。
   *
   * 這兩條刻意**繞過** `main` 的白名單（`FLEX_LINK_URL_SCHEMES` / hero 的 https-only），
   * 直接把 LINE 會退的形狀送過去。它們證明的是「200 有鑑別力」，不是我們的程式碼會產生
   * 這種東西——恰恰相反，白名單就是為了讓這種東西產生不出來。
   */
  it('LINE 退回：uri action 用 javascript:（繞過白名單直送）', async () => {
    const res = await validateReply([{
      type: 'flex', altText: 'x',
      contents: {
        type: 'bubble',
        body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: 'x' }] },
        footer: {
          type: 'box', layout: 'vertical',
          contents: [{ type: 'button', action: { type: 'uri', label: 'x', uri: 'javascript:alert(1)' } }],
        },
      },
    }]);
    console.log(`NEG-CASE javascript: -> HTTP ${res.status} ${res.body}`);
    expect(res.status).toBe(400);
    expect(res.body).toContain('invalid uri scheme');
  });

  it('LINE 退回：hero 圖 url 用 http（繞過白名單直送）', async () => {
    const res = await validateReply([{
      type: 'flex', altText: 'x',
      contents: {
        type: 'bubble',
        hero: { type: 'image', url: 'http://example.com/a.jpg', size: 'full', aspectRatio: '20:13' },
        body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: 'x' }] },
      },
    }]);
    console.log(`NEG-CASE http hero -> HTTP ${res.status} ${res.body}`);
    expect(res.status).toBe(400);
    expect(res.body).toContain('invalid uri scheme');
  });
});
