/**
 * 右下角小幫手：規則本身正確，而且元件真的接上去了
 * -----------------------------------------------------------------------------
 * 修好前的病：`SupportChatWidget` 掛在後台每一頁上，開場白宣稱「可以幫您查
 * LINE 狀態、推播額度、最近異常日誌，或回答後台使用問題」，而 `send()` 只做
 * 兩件事：append 到本地 state、清空輸入框。沒有端點、沒有回覆、永遠不會有。
 *
 * 本檔守三件事：
 *   1. 意圖判定與回覆組裝（純函式，不碰 DB）——包含「判不出來時不猜」。
 *   2. 元件真的走 service，而且**不自己組任何答案**（規則只能有一份）。
 *   3. 文案不再宣稱這個系統做不到的事（AI／異常日誌／回答後台使用問題）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  resolveSupportIntent,
  buildSupportAnswer,
  SUPPORT_KEYWORDS,
  PUSH_QUOTA_FREE,
  PUSH_QUOTA_EXTRA,
} from '@/server/support-chat';
import { common } from '@/i18n/zh-TW/common';

const widget = readFileSync('src/components/layout/SupportChatWidget.tsx', 'utf8');
const service = readFileSync('src/services/support-chat.ts', 'utf8');
const route = readFileSync('src/app/api/support-chat/ask/route.ts', 'utf8');
const server = readFileSync('src/server/support-chat.ts', 'utf8');

const LINE = {
  channelIdSet: true,
  secretSet: true,
  tokenSet: true,
  autoReplyEnabled: true,
  webhookUrl: 'https://example.test/api/line/webhook/shop-a',
};

describe('意圖判定', () => {
  it('問推播額度 → PUSH_QUOTA', () => {
    expect(resolveSupportIntent('本月還能推播幾則？')).toBe('PUSH_QUOTA');
    expect(resolveSupportIntent('推播額度剩多少')).toBe('PUSH_QUOTA');
  });

  it('問 LINE → LINE_STATUS，大小寫都認得', () => {
    expect(resolveSupportIntent('LINE 串接好了嗎')).toBe('LINE_STATUS');
    expect(resolveSupportIntent('line webhook 設定在哪')).toBe('LINE_STATUS');
  });

  it('問方案到期 → ENTITLEMENT', () => {
    expect(resolveSupportIntent('我的方案是不是過期了')).toBe('ENTITLEMENT');
  });

  it('⚠️ 判不出來時回 UNSUPPORTED，不猜一個最接近的', () => {
    expect(resolveSupportIntent('我要退款')).toBe('UNSUPPORTED');
    expect(resolveSupportIntent('你們老闆是誰')).toBe('UNSUPPORTED');
    expect(resolveSupportIntent('   ')).toBe('UNSUPPORTED');
    expect(resolveSupportIntent('')).toBe('UNSUPPORTED');
  });

  it('對照組：關鍵字表真的有東西，上面那些 UNSUPPORTED 不是因為表是空的', () => {
    expect(SUPPORT_KEYWORDS.length).toBeGreaterThanOrEqual(3);
    expect(SUPPORT_KEYWORDS.every((r) => r.words.length > 0)).toBe(true);
  });

  it('「額度」同時屬於兩類，順序決定它歸推播——這是刻意的，鎖住它', () => {
    expect(resolveSupportIntent('額度')).toBe('PUSH_QUOTA');
    expect(SUPPORT_KEYWORDS[0].intent).toBe('PUSH_QUOTA');
  });
});

describe('回覆組裝', () => {
  it('LINE 三項齊全 → 說可以收發；缺一項 → 說不會有反應，且該項標為 warning', () => {
    const okAnswer = buildSupportAnswer({ intent: 'LINE_STATUS', line: LINE });
    expect(okAnswer.answer).toContain('可以收發訊息');
    expect(okAnswer.facts.some((f) => f.warning)).toBe(false);

    const bad = buildSupportAnswer({
      intent: 'LINE_STATUS',
      line: { ...LINE, tokenSet: false },
    });
    expect(bad.answer).toContain('不會有反應');
    expect(bad.facts.find((f) => f.label === 'Channel Access Token')?.warning).toBe(true);
  });

  it('⚠️ LINE 回覆裡不得出現任何密文或憑證值', () => {
    const answer = buildSupportAnswer({ intent: 'LINE_STATUS', line: LINE });
    const dump = JSON.stringify(answer);
    for (const banned of ['channelSecret', 'channelAccessToken', '_enc']) {
      expect(dump).not.toContain(banned);
    }
  });

  it('額度用完時明說這個月不會再送出，剩餘標為 warning', () => {
    const a = buildSupportAnswer({
      intent: 'PUSH_QUOTA',
      quota: { used: PUSH_QUOTA_FREE, limit: PUSH_QUOTA_FREE, month: '2026-09', extraPush: false },
    });
    expect(a.answer).toContain('已經用完');
    expect(a.facts.find((f) => f.label === '剩餘')?.warning).toBe(true);
  });

  it('剩餘不會出現負數（用量超過上限時仍回 0）', () => {
    const a = buildSupportAnswer({
      intent: 'PUSH_QUOTA',
      quota: { used: 999, limit: PUSH_QUOTA_FREE, month: '2026-09', extraPush: false },
    });
    expect(a.facts.find((f) => f.label === '剩餘')?.value).toBe('0 則');
  });

  it('EXTRA_PUSH 訂閱後上限是 700，未訂閱是 200', () => {
    expect(PUSH_QUOTA_FREE).toBe(200);
    expect(PUSH_QUOTA_EXTRA).toBe(700);
    const a = buildSupportAnswer({
      intent: 'PUSH_QUOTA',
      quota: { used: 10, limit: PUSH_QUOTA_EXTRA, month: '2026-09', extraPush: true },
    });
    expect(a.answer).toContain('690');
  });

  it('有權益過期時明說幾項過期並標為 warning', () => {
    const a = buildSupportAnswer({
      intent: 'ENTITLEMENT',
      entitlement: { total: 18, live: 0, expired: 18, nextExpiry: null },
    });
    expect(a.answer).toContain('18 項權益已經過期');
    expect(a.facts.find((f) => f.label === '已過期')?.warning).toBe(true);
    expect(a.facts.find((f) => f.label === '下一個到期日')?.value).toContain('沒有即將到期');
  });

  it('UNSUPPORTED 明說看不懂、列出會的三件事，並給真人管道以外的入口', () => {
    const a = buildSupportAnswer({ intent: 'UNSUPPORTED' });
    expect(a.answer).toContain('我看不懂');
    expect(a.answer).toContain('不猜');
    expect(a.links.length).toBeGreaterThan(0);
  });

  it('少了對應事實時一律退回 UNSUPPORTED，不生出一則空殼答案', () => {
    expect(buildSupportAnswer({ intent: 'LINE_STATUS' }).intent).toBe('UNSUPPORTED');
    expect(buildSupportAnswer({ intent: 'PUSH_QUOTA' }).intent).toBe('UNSUPPORTED');
    expect(buildSupportAnswer({ intent: 'ENTITLEMENT' }).intent).toBe('UNSUPPORTED');
  });
});

describe('元件真的接上去了（不是本地 state 假成功）', () => {
  it('widget 呼叫 askSupport，且沒有直接 fetch', () => {
    expect(widget).toContain("from '@/services/support-chat'");
    expect(widget).toContain('askSupport(');
    expect(widget).not.toMatch(/\bfetch\(/);
  });

  it('⚠️ 舊病灶不得復活：send() 不可只 append 使用者訊息就結束', () => {
    // 修好前整個檔案裡沒有任何 await；有 await 才可能真的等一個端點。
    expect(widget).toContain('await askSupport');
  });

  it('失敗有話說，不是靜默', () => {
    expect(widget).toContain('t.failed');
    expect(common.supportChat.failed.length).toBeGreaterThan(0);
  });

  it('規則只有一份：元件不自己判斷意圖、不自己組答案', () => {
    for (const banned of ['resolveSupportIntent', 'buildSupportAnswer', 'PUSH_QUOTA_FREE']) {
      expect(widget).not.toContain(banned);
    }
  });

  it('service 走 adapt()，真分支打 /api/support-chat/ask', () => {
    expect(service).toContain('adapt<SupportAnswer>');
    expect(service).toContain("'/api/support-chat/ask'");
  });

  it('端點經 requireTenant() 與 zod 驗證，不吃無限長的問題', () => {
    expect(route).toContain('requireTenant(');
    expect(route).toContain('.max(500');
  });

  it('⚠️ 密文欄位不得出現在任何 select() 清單裡（只能當過濾條件）', () => {
    // 逐一取出 select( ... ) 的第一個字串引數，裡面一個 _enc 都不能有。
    // 「不要把密文輸出去」若只靠自律，這支端點的工作又剛好是產生要顯示的文字，
    // 遲早會有人為了 debug 把整包序列化出去。
    const selects = [...server.matchAll(/\.select\(\s*'([^']*)'/g)].map((m) => m[1]);
    expect(selects.length).toBeGreaterThan(0);
    for (const list of selects) expect(list).not.toContain('_enc');
    // 對照組：這個檔案真的有處理那兩欄，否則上面的斷言什麼都沒證到。
    expect(server).toContain('line_channel_secret_enc');
    expect(server).toContain('line_channel_access_token_enc');
  });

  it('⚠️ 「已設定」的判準必須是 <> \'\'，不是 is not null', () => {
    // `0003_tenants_and_accounts.sql:29-30` 把兩欄定義成 `text not null default ''`，
    // 未設定的實際樣子是**空字串**。第一版寫成 `.not(col,'is',null)`，於是一家從沒
    // 設定過 LINE 的店會被告知「憑證三項都已設定，機器人可以收發訊息」——把一則
    // 假成功修成另一則假成功。這條鎖住那個判準不要再被改回去。
    expect(server).toContain("neq('line_channel_secret_enc', '')");
    expect(server).toContain("neq('line_channel_access_token_enc', '')");
    expect(server).not.toContain("'is', null");
  });

  it('⚠️ 這一層不得使用 service role（三張表都有 is_tenant_member 的 select 政策）', () => {
    expect(server).not.toContain('createAdminSupabase');
    expect(route).not.toContain('createAdminSupabase');
    expect(route).toContain('t.supabase');
  });
});

describe('文案不得宣稱這個系統做不到的事', () => {
  const text = JSON.stringify(common.supportChat);

  it('不再自稱 AI（這裡沒有語言模型，只有一張關鍵字表）', () => {
    expect(text).not.toContain('AI 客服');
    expect(common.supportChat.title).not.toContain('AI');
  });

  it('不再宣稱查得到「異常日誌」——全 repo 沒有任何錯誤日誌表', () => {
    expect(text).not.toContain('異常日誌');
  });

  it('不再宣稱「回答後台使用問題」', () => {
    expect(text).not.toContain('回答後台使用問題');
  });

  it('開場白明說它只查三件事', () => {
    expect(common.supportChat.greeting).toContain('LINE 串接狀態');
    expect(common.supportChat.greeting).toContain('推播額度');
    expect(common.supportChat.greeting).toContain('權益');
  });

  it('元件內沒有中文字面量（CONVENTIONS 硬規則）', () => {
    const stripped = widget
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    expect(stripped).not.toMatch(/[一-鿿]/);
  });
});
