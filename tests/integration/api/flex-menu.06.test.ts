/**
 * Flex 主選單端到端整合測試（GitHub issue #6「修復-4」第 ②③ 項驗收）
 * -----------------------------------------------------------------------------
 * 這一檔要證的是**那條對顧客有意義的鏈路**，不是端點會不會回 200：
 *
 *   rich-menu-design 頁 Flex 分頁
 *     → src/services/settings.ts 的 saveFlexMenu()
 *     → POST /api/settings/line/flex-menu
 *     → tenant_settings.line.flexCards（jsonb）
 *     → LINE webhook 分支 ④ MENU（顧客打「選單」）
 *     → src/server/flex-menu.ts 的 buildFlexMenuOutcome()
 *     → mock LINE 收到 Flex，**bubble 數 ＝ 卡片數**
 *
 * 14 分冊 §2 根因 B：改動前這三層只有一層——端點存得下開關與顏色，卻**沒有欄位
 * 可以存卡片**；webhook 完全沒有任何 flexMenu* 引用；頁面的「發布」只是一個
 * toast。三層各自看起來都沒壞，合起來卻完全不通，而且沒有任何一層的測試會紅。
 *
 * ⚠️ 兩條刻意寫得比較重的斷言，理由都在 CLAUDE.md：
 * 1. **bubble 數 ＝ 卡片數**。只驗「收到一則 flex」不夠——組裝時少送一張、
 *    多送一張、或把 carousel 送成單一 bubble，都會讓店家編的東西與顧客看到的
 *    不一致，而畫面照樣顯示「已儲存」。
 * 2. **SILENT ＝ 整個 mock.requests 為空**，不是「/reply 沒有被打」。
 *    push / multicast 偷跑的話只翻 /reply 抓不到（寫法沿用
 *    tests/integration/api/keyword-replies.05.test.ts 的 lineCallsFor()）。
 *
 * 前置資料與清理紀律比照 keyword-replies.05 / line-webhook.06：beforeAll 快照
 * SHOP_A 的 tenant_settings（line jsonb + 兩個 *_enc），afterAll 一律還原，
 * 並刪掉本檔造出的 chat_messages / line_users。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A } from '../../fixtures';
import { LineMockServer, type RecordedLineRequest } from '../../helpers/line-mock';
import { drainWebhook } from '../../helpers/line-webhook';
import { loginAs, type AuthedApi } from '../../helpers/auth';
import { encryptSecret } from '@/server/crypto';
import { MAX_FLEX_CARDS, type FlexCard } from '@/config/tenant-settings';
import { FLEX_POPUP_TRIGGER_TEXT } from '@/server/flex-menu';

const BASE_URL = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';

/** 本檔專用測試憑證（明文只存在測試裡；寫進 DB 前會 encryptSecret） */
const CHANNEL_SECRET = 'itest-line-channel-secret-a06flex';
const CHANNEL_TOKEN = 'itest-line-access-token-a06flex';

/** 本檔專用 LINE user id（避免與 line-webhook.06 / keyword-replies.05 互踩） */
const USER = 'Uflexmenu06itest00000000000000001';

/** 「都沒命中」時分支 ⑥ 的回覆——有它才分得出「命中了」與「沒命中」 */
const DEFAULT_REPLY = '【itest#6】這是分支⑥的預設回覆，代表沒有任何 handler 命中';

let admin: SupabaseClient;
let api: AuthedApi;
const mock = new LineMockServer();

let settingsSnapshot: {
  line: unknown;
  line_channel_secret_enc: string;
  line_channel_access_token_enc: string;
} | null = null;

function sign(rawBody: string): string {
  return createHmac('sha256', CHANNEL_SECRET).update(rawBody).digest('base64');
}

/** 以顧客身分送一則文字訊息給 webhook，回傳 mock LINE 在這一輪收到的全部請求 */
async function lineCallsFor(text: string): Promise<RecordedLineRequest[]> {
  mock.reset();
  const replyToken = `rt-${Math.random().toString(36).slice(2)}`;
  const raw = JSON.stringify({
    destination: 'Umockbot',
    events: [{
      type: 'message',
      replyToken,
      source: { type: 'user', userId: USER },
      message: { id: `m-${replyToken}`, type: 'text', text },
    }],
  });
  const res = await fetch(`${BASE_URL}/api/line/webhook/${SHOP_A.shopCode}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-line-signature': sign(raw) },
    body: raw,
  });
  expect(res.status, `webhook 對「${text}」回了 ${res.status}`).toBe(200);
  /*
   * issue #31 之後 webhook 是「驗簽完立刻回 200、事件處理在 after() 裡跑」，
   * 所以拿到 200 的當下 reply 還沒送到 mock LINE。少了這一行，本檔 38 案會紅 16 案。
   * 用 route 自己的排空訊號等，不用 sleep 猜（理由見 tests/helpers/line-webhook.ts 檔頭）。
   */
  await drainWebhook(SHOP_A.shopCode, BASE_URL);
  return [...mock.requests];
}

/** 顧客打一段字 → mock LINE 收到的那一則 reply message（沒回覆＝null） */
async function replyMessageFor(text: string): Promise<any | null> {
  const calls = await lineCallsFor(text);
  const replies = calls.filter((c) => c.path.startsWith('/v2/bot/message/reply'));
  if (replies.length === 0) return null;
  expect(replies, `對「${text}」回了不只一則`).toHaveLength(1);
  const messages = replies[0].body?.messages ?? [];
  expect(messages, `對「${text}」的 reply 沒有 messages`).toHaveLength(1);
  return messages[0];
}

/** 頁面「發布」走的那一條：service 的 saveFlexMenu() → 這支端點（形狀完全相同） */
async function publishViaApi(patch: Record<string, unknown>) {
  const res = await api.post('/api/settings/line/flex-menu', patch);
  return { status: res.status, body: await res.json() };
}

/** service role 直查 line jsonb（驗「真的存進去了」，不是只回 200） */
async function readLineJsonb(): Promise<Record<string, any>> {
  const { data, error } = await admin
    .from('tenant_settings').select('line').eq('tenant_id', SHOP_A.id).single();
  expect(error).toBeNull();
  return (data?.line ?? {}) as Record<string, any>;
}

/*
 * ⚠️ 前提變更（14 分冊 §8.20 擁有者裁決）：卡片契約從四欄擴為
 * `{title, subtitle, imageUrl, ad, linkUrl}`。`linkUrl` 在 zod 是 optional
 * （`.default('')`），但 **parse 之後的形狀恆有這個鍵**，所以：
 *   - 這個 helper 補上 `linkUrl: ''`（＝這張卡不開網址）；
 *   - 下方「逐欄相符」的斷言跟著補這一欄。
 * 這不是把斷言放寬——`toEqual` 仍是逐欄全等，只是欄位數變了。
 * 真正的「送什麼就存什麼」由新增的 linkUrl 案例守住。
 */
const card = (title: string, extra: Partial<FlexCard> = {}): FlexCard =>
  ({ title, subtitle: `${title}的說明`, imageUrl: '', ad: false, linkUrl: '', ...extra });

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  if (!process.env.LINE_API_BASE) {
    throw new Error(
      '缺少 LINE_API_BASE：本檔需要 .env.test 設 LINE_API_BASE=http://localhost:4123 ' +
        '與 LINE_DATA_API_BASE=http://localhost:4123（見 line-webhook.06.test.ts 的同段說明）。',
    );
  }
  expect(process.env.SETTINGS_ENCRYPTION_KEY).toBeTruthy();

  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await mock.start();

  const { data: snap, error: e0 } = await admin
    .from('tenant_settings')
    .select('line, line_channel_secret_enc, line_channel_access_token_enc')
    .eq('tenant_id', SHOP_A.id)
    .single();
  expect(e0).toBeNull();
  settingsSnapshot = snap as typeof settingsSnapshot;

  const { error: e1 } = await admin
    .from('tenant_settings')
    .update({
      line_channel_secret_enc: encryptSecret(CHANNEL_SECRET),
      line_channel_access_token_enc: encryptSecret(CHANNEL_TOKEN),
      line: {
        autoReplyEnabled: true,
        defaultReply: DEFAULT_REPLY,
        systemKeywordGroupsDisabled: [],
        campaignKeywordEnabled: false,
      },
    })
    .eq('tenant_id', SHOP_A.id);
  expect(e1).toBeNull();

  // 分支 ② 早於 ④：留著自訂關鍵字會遮住「選單」的內建指令
  await admin.from('keyword_replies').delete().eq('tenant_id', SHOP_A.id);

  api = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
});

afterAll(async () => {
  await admin.from('chat_messages').delete().eq('tenant_id', SHOP_A.id).eq('line_user_id', USER);
  await admin.from('line_users').delete().eq('tenant_id', SHOP_A.id).eq('line_user_id', USER);
  if (settingsSnapshot) {
    await admin
      .from('tenant_settings')
      .update({
        line: settingsSnapshot.line ?? {},
        line_channel_secret_enc: settingsSnapshot.line_channel_secret_enc,
        line_channel_access_token_enc: settingsSnapshot.line_channel_access_token_enc,
      })
      .eq('tenant_id', SHOP_A.id);
  }
  await mock.stop();
});

/* ========================================================================== */
/* ① 儲存層：卡片真的進了 line jsonb，secret 仍不在 jsonb 裡                    */
/* ========================================================================== */
describe('儲存層：POST /api/settings/line/flex-menu 收得下 flexCards', () => {
  it('存 3 張卡 → service role 直查 line jsonb 的 flexCards 逐欄相符', async () => {
    const cards: FlexCard[] = [
      { title: '預約', subtitle: '選擇服務與時段', imageUrl: '', ad: false, linkUrl: '' },
      { title: '我的預約', subtitle: '查詢或取消', imageUrl: 'https://example.com/a.png', ad: false, linkUrl: '' },
      { title: '本月優惠', subtitle: '限時折扣', imageUrl: '', ad: true, linkUrl: 'https://example.com/promo' },
    ];
    const { status } = await publishViaApi({
      flexMenuEnabled: true, flexMenuFallback: 'HINT', flexCards: cards,
    });
    expect(status).toBe(200);

    const line = await readLineJsonb();
    // 逐欄相符：只驗「有一個叫 flexCards 的鍵」抓不到「欄位被洗掉」這種缺陷
    expect(line.flexCards).toEqual(cards);
    expect(line.flexMenuEnabled).toBe(true);
    expect(line.flexMenuFallback).toBe('HINT');
  });

  it('秘密欄位仍然不在 jsonb 裡（存 flexCards 不得順手把 token 寫進去）', async () => {
    await publishViaApi({ flexCards: [card('預約')] });
    const line = await readLineJsonb();
    expect(line.channelSecret).toBeUndefined();
    expect(line.channelAccessToken).toBeUndefined();
    // token 仍在專屬的加密欄位
    const { data } = await admin
      .from('tenant_settings')
      .select('line_channel_access_token_enc').eq('tenant_id', SHOP_A.id).single();
    expect(String(data?.line_channel_access_token_enc ?? '')).not.toBe('');
  });

  it('只送 flexCards 不會洗掉同一個 jsonb 裡的其他設定（partial patch 語意）', async () => {
    await publishViaApi({ flexCards: [card('預約')] });
    const line = await readLineJsonb();
    expect(line.defaultReply).toBe(DEFAULT_REPLY);
    expect(line.campaignKeywordEnabled).toBe(false);
  });

  it(`第 ${MAX_FLEX_CARDS + 1} 張被端點擋下（400），且 DB 不留半套`, async () => {
    const good = Array.from({ length: 2 }, (_, i) => card(`保留${i + 1}`));
    await publishViaApi({ flexCards: good });

    const tooMany = Array.from({ length: MAX_FLEX_CARDS + 1 }, (_, i) => card(`超量${i + 1}`));
    const { status } = await publishViaApi({ flexCards: tooMany });
    expect(status).toBe(400);

    // 被擋下就是完全沒寫：DB 還是先前那兩張
    const line = await readLineJsonb();
    expect(line.flexCards).toEqual(good);
  });

  it(`剛好 ${MAX_FLEX_CARDS} 張放行`, async () => {
    const full = Array.from({ length: MAX_FLEX_CARDS }, (_, i) => card(`滿載${i + 1}`));
    expect((await publishViaApi({ flexCards: full })).status).toBe(200);
    expect((await readLineJsonb()).flexCards).toHaveLength(MAX_FLEX_CARDS);
  });

  it('空標題被擋下（標題同時是按鈕文字，空的會被 LINE 整包退回）', async () => {
    const { status } = await publishViaApi({
      flexCards: [{ title: '   ', subtitle: '', imageUrl: '', ad: false }],
    });
    expect(status).toBe(400);
  });

  it('非 https 的圖片網址被擋下（LINE 的 image 元件只收 HTTPS）', async () => {
    const { status } = await publishViaApi({
      flexCards: [{ title: 'A', subtitle: '', imageUrl: 'http://example.com/a.png', ad: false }],
    });
    expect(status).toBe(400);
  });

  /* --- linkUrl（14 分冊 §8.20 擁有者裁決） --------------------------------- */

  it('存得下 linkUrl：廣告卡與一般卡的網址都逐欄回得來', async () => {
    const cards: FlexCard[] = [
      { title: '官網', subtitle: '看更多', imageUrl: '', ad: false, linkUrl: 'https://shop.example/' },
      { title: '本月優惠', subtitle: '限時', imageUrl: '', ad: true, linkUrl: 'https://ad.example/x?a=1' },
      { title: '預約', subtitle: '不開網址', imageUrl: '', ad: false, linkUrl: '' },
    ];
    expect((await publishViaApi({ flexCards: cards })).status).toBe(200);
    expect((await readLineJsonb()).flexCards).toEqual(cards);
  });

  /*
   * ⚠️ **前提變更（2026-08-25，擁有者裁決 §8.20-b「廣告卡全開」）。**
   * 本檔原有一條「非 https 的連結網址被端點擋下（400）」——那條規則的理由
   * （「LINE 的 uri action 只收 https」）已被實測推翻（那是 hero **圖片** url 的
   * 限制被誤植）。理由消失後擁有者重裁「全開」：LINE 實測收什麼，端點就收什麼。
   * 於是 http 從「該回 400」反轉成「該回 200 並存得下」，就是下面這一條。
   */
  it('http 的連結網址現在存得下（§8.20-b 反轉：舊斷言是「該被端點擋下 400」）', async () => {
    const cards: FlexCard[] = [
      { title: 'A', subtitle: '', imageUrl: '', ad: false, linkUrl: 'http://example.com/x' },
    ];
    expect((await publishViaApi({ flexCards: cards })).status).toBe(200);
    expect((await readLineJsonb()).flexCards).toEqual(cards);
  });

  it('line:／tel:／mailto: 也存得下（白名單＝LINE 實測收下的那一組）', async () => {
    const cards: FlexCard[] = [
      { title: '加好友', subtitle: '', imageUrl: '', ad: false, linkUrl: 'line://ti/p/@abc' },
      { title: '打電話', subtitle: '', imageUrl: '', ad: false, linkUrl: 'tel:0212345678' },
      { title: '寄信', subtitle: '', imageUrl: '', ad: false, linkUrl: 'mailto:shop@example.com' },
    ];
    expect((await publishViaApi({ flexCards: cards })).status).toBe(200);
    expect((await readLineJsonb()).flexCards).toEqual(cards);
  });

  /*
   * 白名單以外一律 400，且 DB 不留半套。
   * 逐條列出來是為了讓紅燈直接指出是哪一個 scheme 漏了；
   * javascript:／data:／ftp:／file:／sms: 是 LINE 實測會退的
   * （400 invalid uri scheme，見 scripts/verify/flex-menu-validate.cjs），
   * 端點擋它們是「不要等 LINE 把整包 carousel 退回」。
   * 大小寫與空白變形則是**我們的**白名單在擋，與 LINE 怎麼回無關。
   */
  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    ' javascript:alert(1)',
    '\tjavascript:alert(1)',
    'data:text/html,x',
    'ftp://a.example/',
    'file:///etc/passwd',
    'sms:0212345678',
    '/foo',
  ])('白名單以外的連結網址 %j 被端點擋下（400），且 DB 不留半套', async (bad) => {
    const good = [card('保留')];
    await publishViaApi({ flexCards: good });

    const { status } = await publishViaApi({
      flexCards: [{ title: 'A', subtitle: '', imageUrl: '', ad: false, linkUrl: bad }],
    });
    expect(status).toBe(400);
    expect((await readLineJsonb()).flexCards).toEqual(good);
  });

  it('GET /api/settings 回讀得到剛存的卡片（頁面重新整理後卡片還在）', async () => {
    const cards = [card('預約'), card('商品')];
    await publishViaApi({ flexCards: cards });
    const res = await api.get('/api/settings');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.line.flexCards).toEqual(cards);
    // 同一份回應裡 secret 仍是遮罩，不會因為多了 flexCards 就漏出明文
    expect(String(body.data.line.channelAccessToken)).not.toContain(CHANNEL_TOKEN);
  });
});

/* ========================================================================== */
/* ② 最關鍵的一條：API 存卡片 → webhook 收「選單」→ Flex，bubble 數＝卡片數      */
/* ========================================================================== */
describe('端到端：API 存卡片 → 顧客打「選單」→ mock LINE 收到 Flex（bubble 數＝卡片數）', () => {
  beforeEach(async () => {
    await publishViaApi({ flexMenuEnabled: true, flexMenuFallback: 'HINT' });
  });

  // 1 / 3 / 12 三個張數都跑一次：只測一個張數的話，「固定送 3 個 bubble」這種
  // 寫法照樣會綠（而且畫面完全正常）。
  for (const n of [1, 3, MAX_FLEX_CARDS]) {
    it(`存 ${n} 張卡片 → 顧客打「選單」→ 收到 flex，carousel 有 ${n} 個 bubble`, async () => {
      const cards = Array.from({ length: n }, (_, i) => card(`整測卡${i + 1}`));
      expect((await publishViaApi({ flexCards: cards })).status).toBe(200);

      const msg = await replyMessageFor('選單');
      expect(msg, '顧客打「選單」完全沒有回應').not.toBeNull();
      expect(msg.type).toBe('flex');
      expect(msg.contents.type).toBe('carousel');
      expect(
        msg.contents.contents,
        `店家存了 ${n} 張卡，顧客卻收到 ${msg.contents.contents.length} 個 bubble`,
      ).toHaveLength(n);

      // bubble 的內容真的是店家編的那幾張（順序也一樣）
      const titles = msg.contents.contents.map(
        (b: any) => b.footer.contents[0].action.text,
      );
      expect(titles).toEqual(cards.map((c) => c.title));
    });
  }

  it('改卡片再發布一次 → 顧客拿到的是改後的內容（不是快取或舊值）', async () => {
    await publishViaApi({ flexCards: [card('舊卡片')] });
    expect((await replyMessageFor('選單')).contents.contents[0].footer.contents[0].action.text)
      .toBe('舊卡片');

    await publishViaApi({ flexCards: [card('新卡片一'), card('新卡片二')] });
    const msg = await replyMessageFor('選單');
    expect(msg.contents.contents).toHaveLength(2);
    expect(msg.contents.contents[0].footer.contents[0].action.text).toBe('新卡片一');
  });

  it('存有 linkUrl 的卡片 → 顧客收到的那一張按鈕是 uri action，網址逐字相符', async () => {
    /*
     * §8.20 那條鏈路的終點：店家在後台填的網址，要真的出現在顧客手上那則訊息裡。
     * 只驗「端點回 200 且 jsonb 有這個鍵」不夠——組裝層漏讀一個欄位，
     * DB 照樣是對的、畫面照樣顯示已儲存，顧客按下去卻只是送出一段文字。
     */
    await publishViaApi({
      flexCards: [
        { title: '本月優惠', subtitle: '限時', imageUrl: '', ad: true, linkUrl: 'https://ad.example/x?a=1' },
        card('預約'),
      ],
    });
    const msg = await replyMessageFor('選單');
    expect(msg.type).toBe('flex');
    const [adBubble, plainBubble] = msg.contents.contents;
    expect(adBubble.footer.contents[0].action).toEqual({
      type: 'uri', label: '本月優惠', uri: 'https://ad.example/x?a=1',
    });
    // 沒填網址的那一張不受影響——仍然是送出標題的 message action
    expect(plainBubble.footer.contents[0].action).toEqual({
      type: 'message', label: '預約', text: '預約',
    });
  });

  it('非 https 的白名單連結也走完整條鏈路到顧客手上（§8.20-b 全開的終點）', async () => {
    /*
     * 只驗端點回 200 不夠：組裝層若還留著一份 https-only 的判斷，
     * DB 是對的、後台顯示已儲存，顧客按下去卻只是送出一段文字——
     * 那是本專案反覆抓到的「假成功」形狀，所以這條一路驗到 reply 訊息。
     */
    await publishViaApi({
      flexCards: [
        { title: '打電話', subtitle: '', imageUrl: '', ad: false, linkUrl: 'tel:0212345678' },
        { title: '加好友', subtitle: '', imageUrl: '', ad: false, linkUrl: 'line://ti/p/@abc' },
        { title: '官網', subtitle: '', imageUrl: '', ad: false, linkUrl: 'http://shop.example/' },
      ],
    });
    const msg = await replyMessageFor('選單');
    expect(msg.contents.contents.map((b: any) => b.footer.contents[0].action)).toEqual([
      { type: 'uri', label: '打電話', uri: 'tel:0212345678' },
      { type: 'uri', label: '加好友', uri: 'line://ti/p/@abc' },
      { type: 'uri', label: '官網', uri: 'http://shop.example/' },
    ]);
  });

  it('MENU 組的三個同義詞（主選單／選單／功能）都拿得到同一份 Flex', async () => {
    await publishViaApi({ flexCards: [card('預約'), card('商品')] });
    for (const word of ['主選單', '選單', '功能']) {
      const msg = await replyMessageFor(word);
      expect(msg, `「${word}」沒有觸發 Flex 主選單`).not.toBeNull();
      expect(msg.type).toBe('flex');
      expect(msg.contents.contents).toHaveLength(2);
    }
  });

  it('FLEX_POPUP 格子送出的文字（FLEX_POPUP_TRIGGER_TEXT）走的是同一條路徑', async () => {
    // Rich Menu 設 FLEX_POPUP 的格子＝送出這段文字。這一條把
    // 「頁面設定 → LINE 上的 action → webhook 回覆」整條接起來驗：
    // 兩處若各寫一份組裝邏輯，這裡拿到的東西遲早會與上面那幾條不一樣。
    await publishViaApi({ flexCards: [card('預約'), card('商品'), card('聯絡我們')] });
    const msg = await replyMessageFor(FLEX_POPUP_TRIGGER_TEXT);
    expect(msg.type).toBe('flex');
    expect(msg.contents.contents).toHaveLength(3);
  });

  it('{shopName} 換成真的店名（header 標題的樣板不得原樣送給顧客）', async () => {
    await publishViaApi({ flexCards: [card('預約')], flexHeaderTitle: '✨ {shopName} 主選單' });
    const msg = await replyMessageFor('選單');
    expect(JSON.stringify(msg)).not.toContain('{shopName}');

    const { data } = await admin.from('tenants').select('name').eq('id', SHOP_A.id).single();
    expect(JSON.stringify(msg)).toContain(`✨ ${data!.name} 主選單`);
  });

  it('一張卡都沒有時落回文字關鍵字清單（不憑空生一張卡，也不沉默）', async () => {
    await publishViaApi({ flexCards: [] });
    const msg = await replyMessageFor('選單');
    expect(msg, '沒有卡片時顧客打「選單」完全沒反應').not.toBeNull();
    expect(msg.type).toBe('text');
    expect(msg.text).not.toBe(DEFAULT_REPLY);
    expect(String(msg.text)).toContain('關鍵字');
  });
});

/* ========================================================================== */
/* ③ flexMenuEnabled=false 的兩種行為：HINT 回提示、SILENT 零請求               */
/* ========================================================================== */
describe('關閉 Flex 主選單：HINT 與 SILENT 是兩種不同的行為', () => {
  beforeEach(async () => {
    await publishViaApi({ flexCards: [card('預約'), card('商品')] });
  });

  it('HINT → 回一句提示文字（不是 Flex，也不是 defaultReply）', async () => {
    await publishViaApi({ flexMenuEnabled: false, flexMenuFallback: 'HINT' });
    const msg = await replyMessageFor('選單');
    expect(msg).not.toBeNull();
    expect(msg.type).toBe('text');
    expect(msg.text).toBe('請點選下方選單使用 👇');
    expect(msg.text).not.toBe(DEFAULT_REPLY);
  });

  it('SILENT → **整個 mock.requests 為空**（bot 真的閉嘴，一則請求都沒發）', async () => {
    await publishViaApi({ flexMenuEnabled: false, flexMenuFallback: 'SILENT' });
    const calls = await lineCallsFor('選單');
    expect(
      calls.map((c) => `${c.method} ${c.path}`),
      '選了「完全靜默」卻仍有請求送往 LINE（reply / push / multicast 任一都算）',
    ).toEqual([]);
  });

  it('SILENT 不得落到分支 ⑤ AI／⑥ defaultReply（那會讓開關變成一顆假的開關）', async () => {
    await publishViaApi({ flexMenuEnabled: false, flexMenuFallback: 'SILENT' });
    expect(await replyMessageFor('選單')).toBeNull();
    // 對照組：其他文字仍照常落到 ⑥，證明「零請求」是 MENU 這一支造成的，
    // 不是整個 webhook 或憑證壞掉了
    const other = await replyMessageFor('請問你們幾點打烊');
    expect(other?.text).toBe(DEFAULT_REPLY);
  });

  it('關閉狀態下就算存了 12 張卡也不會送 Flex（開關優先於卡片）', async () => {
    const full = Array.from({ length: MAX_FLEX_CARDS }, (_, i) => card(`滿載${i + 1}`));
    await publishViaApi({ flexCards: full, flexMenuEnabled: false, flexMenuFallback: 'HINT' });
    const msg = await replyMessageFor('選單');
    expect(msg.type).toBe('text');
  });

  it('重新啟用 → 卡片原封不動地回來（關閉不等於刪除）', async () => {
    await publishViaApi({ flexMenuEnabled: false, flexMenuFallback: 'SILENT' });
    expect(await replyMessageFor('選單')).toBeNull();

    await publishViaApi({ flexMenuEnabled: true });
    const msg = await replyMessageFor('選單');
    expect(msg.type).toBe('flex');
    expect(msg.contents.contents).toHaveLength(2);
  });
});

/* ========================================================================== */
/* ④ 與既有分派順序的關係（#5 那輪釘住的行為不得被本輪打壞）                     */
/* ========================================================================== */
describe('不打壞 #5 已釘住的分派順序', () => {
  beforeEach(async () => {
    await admin.from('keyword_replies').delete().eq('tenant_id', SHOP_A.id);
    await publishViaApi({
      flexMenuEnabled: true, flexMenuFallback: 'HINT', flexCards: [card('預約')],
    });
  });

  it('店家自訂的「選單」關鍵字（分支 ②）仍然贏過 Flex 主選單（分支 ④）', async () => {
    const res = await api.post('/api/settings/line/keyword-replies', {
      keywords: ['選單'],
      replyType: 'TEXT',
      content: { text: '本店選單請看門口立牌', matchType: 'EXACT' },
      active: true,
      sortOrder: 0,
    });
    expect(res.status).toBe(200);

    const msg = await replyMessageFor('選單');
    expect(msg.type).toBe('text');
    expect(msg.text).toBe('本店選單請看門口立牌');
  });

  it('停用 MENU 這一組系統關鍵字 → 完全沒有回應（零請求），不論 Flex 是否啟用', async () => {
    const { data } = await admin
      .from('tenant_settings').select('line').eq('tenant_id', SHOP_A.id).single();
    await admin.from('tenant_settings')
      .update({ line: { ...((data?.line ?? {}) as object), systemKeywordGroupsDisabled: ['MENU'] } })
      .eq('tenant_id', SHOP_A.id);

    expect(await lineCallsFor('選單')).toEqual([]);

    await admin.from('tenant_settings')
      .update({ line: { ...((data?.line ?? {}) as object), systemKeywordGroupsDisabled: [] } })
      .eq('tenant_id', SHOP_A.id);
  });

  it('「說明／幫助」仍是純文字關鍵字清單（06 §6 只指名「選單」走 Flex）', async () => {
    const msg = await replyMessageFor('說明');
    expect(msg.type).toBe('text');
    expect(String(msg.text)).toContain('關鍵字');
  });
});
