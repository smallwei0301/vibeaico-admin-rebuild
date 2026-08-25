/**
 * scripts/verify/flex-menu-validate.cjs
 * -----------------------------------------------------------------------------
 * 把 `src/server/flex-menu.ts` 組出來的 Flex JSON 丟給 **LINE 官方的驗證端點**
 * `POST /v2/bot/message/validate/reply`，證明「我們組的這份 JSON，LINE 真的收得下」。
 *
 * 為什麼非做不可（issue #6 獨有的一條驗收，也是最有價值的一條）：
 * 我們自己的單元／整合測試只能證明「輸出符合我們以為的規格」。Flex 的規格細節
 * （text 不得空字串、色碼格式、carousel 上限、action label 長度、image 必須 HTTPS…）
 * 全在 LINE 那一端，猜錯了本地一路綠燈、店家發布成功、顧客那邊什麼都收不到——
 * 正是 CLAUDE.md 說的「後端每一步都成功，錯誤只發生在 LINE 那一端」。
 *
 * validate 端點**不會真的送出訊息，不耗每月推播額度**（15 分冊 §6）。
 *
 * ⚠️ **正向案例全綠不等於驗過了。** 一整排 200 也可能只是這個端點在蓋橡皮圖章。
 * 所以本檔一定要同時跑「負向對照」——刻意送 LINE 應該退回的 JSON，看它是不是
 * 真的會退。issue #6 的執行者發現了這件事（14 分冊 §6.9），本檔照它的形狀保留
 * 並擴充。
 *
 * 📌 **本輪（§8.20 的 linkUrl）用這個方法抓到的第一件事，是我們自己的規格寫錯了：**
 * §8.20 說「uri action 只收 https，http 會被回 invalid uri scheme」——實測 LINE
 * 對 uri action 的 http 回 **200**。那句話是把 hero **圖片** url 的限制誤植過來的。
 * 所以本檔多了第三類輸出「scheme 探測」，把 LINE 的實際回答原樣印出來，
 * 讓「哪些限制是 LINE 給的、哪些是本平台自己加的」不必再靠記憶。
 *
 * 用法：
 *   LINE_CHANNEL_ACCESS_TOKEN=<Midao 長期 token> NODE_USE_ENV_PROXY=1 \
 *     node scripts/verify/flex-menu-validate.cjs
 *
 * ⚠️ token 一律從環境變數取，不得寫進本檔（15 分冊 §3 禁令 5）。
 */
const { execFileSync } = require('node:child_process');
const { writeFileSync, mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
if (!TOKEN) {
  console.error('缺少 LINE_CHANNEL_ACCESS_TOKEN 環境變數');
  process.exit(2);
}

/**
 * 用專案自己的 TS 原始碼產生受測 JSON。
 *
 * 刻意**不在這支腳本裡重寫一份組裝邏輯**——那樣驗過的就是腳本裡的那份，
 * 不是真正會送給顧客的那份（本 issue 反覆在防的就是「同一件事寫兩份」）。
 * 這裡用 tsx 直接 import src/server/flex-menu.ts，跑的是與 webhook 完全相同的程式。
 */
function buildCases() {
  const dir = mkdtempSync(join(tmpdir(), 'flexval-'));
  const entry = join(dir, 'gen.mts');
  writeFileSync(entry, `
import { buildFlexMenuOutcome } from ${JSON.stringify(join(process.cwd(), 'src/server/flex-menu.ts'))};

const SHOP = '示範美髮沙龍';
const card = (t, extra = {}) => ({ title: t, subtitle: t + '的說明', imageUrl: '', ad: false, ...extra });

const cases = [
  ['1 張卡片（無圖）', { flexCards: [card('預約')] }],
  ['3 張卡片 + 1 張有圖 + 1 張廣告卡', { flexCards: [
    card('預約'),
    card('我的預約', { imageUrl: 'https://vibeaico-admin-rebuild.vercel.app/favicon.ico' }),
    card('本月優惠', { ad: true }),
  ] }],
  ['12 張卡片（carousel 上限）', { flexCards: Array.from({ length: 12 }, (_, i) => card('卡片' + (i + 1))) }],
  ['自訂 header 色 + {shopName} 標題與副標', {
    flexCards: [card('預約'), card('商品')],
    flexHeaderColor: '#1957D2',
    flexHeaderTitle: '✨ {shopName}',
    flexHeaderSubtitle: '{shopName} 的服務選單',
  }],
  ['副標為空（不得產生空字串 text 元件）', {
    flexCards: [{ title: '預約', subtitle: '', imageUrl: '', ad: false }],
  }],
  ['標題 20 字（LINE action label 上限）', {
    flexCards: [card('一二三四五六七八九十一二三四五六七八九十')],
  }],
  ['關閉 + HINT（純文字 fallback）', { flexMenuEnabled: false, flexMenuFallback: 'HINT' }],
  // 14 分冊 §8.20：卡片契約多了 optional linkUrl → 按鈕變 uri action
  ['廣告卡有 linkUrl（uri action，https）', { flexCards: [
    card('本月優惠', { ad: true, linkUrl: 'https://vibeaico-admin-rebuild.vercel.app/' }),
  ] }],
  ['一般卡也有 linkUrl，與沒填的卡混在同一份 carousel', { flexCards: [
    card('官網', { linkUrl: 'https://vibeaico-admin-rebuild.vercel.app/' }),
    card('預約'),
    card('本月優惠', { ad: true, linkUrl: 'https://vibeaico-admin-rebuild.vercel.app/?x=1#a' }),
  ] }],
  ['linkUrl 是空字串（不開網址 → 退回 message action，卡片不得變壞）', { flexCards: [
    card('預約', { linkUrl: '' }),
  ] }],
];

const out = [];
for (const [name, cfg] of cases) {
  const o = buildFlexMenuOutcome(cfg, SHOP);
  if (o.kind === 'FLEX' || o.kind === 'HINT') {
    out.push({ name, kind: o.kind, bubbles: o.bubbleCount ?? null, message: o.message });
  } else {
    out.push({ name, kind: o.kind, bubbles: null, message: null });
  }
}

/*
 * ---------------------------------------------------------------- 負向對照
 * 七個 200 有可能只是端點在蓋橡皮圖章。這幾條送的是**我們的防線擋掉之後就
 * 不可能出現**的 JSON，LINE 必須把它們退回；退回了，才證明上面那一串 200
 * 是「LINE 認可我們」而不是「LINE 什麼都認可」。
 *
 * ⚠️ 每一條負向案例都是**繞過本專案的防線硬做出來的**（直接改組好的 JSON），
 * 因為正常路徑根本產不出這種訊息——那正是它要證明的事。
 */
const clone = (m) => JSON.parse(JSON.stringify(m));
const oneCard = (extra) => buildFlexMenuOutcome({ flexCards: [card('本月優惠', extra)] }, SHOP).message;

const linkBase = oneCard({ linkUrl: 'https://vibeaico-admin-rebuild.vercel.app/' });
const withScheme = (uri) => {
  const m = clone(linkBase);
  m.contents.contents[0].footer.contents[0].action.uri = uri;
  return m;
};

const httpHero = clone(oneCard({ imageUrl: 'https://vibeaico-admin-rebuild.vercel.app/favicon.ico' }));
httpHero.contents.contents[0].hero.url = 'http://vibeaico-admin-rebuild.vercel.app/favicon.ico';

const neg = [
  ['uri action 用 javascript:', withScheme('javascript:alert(1)')],
  ['uri action 用 data:', withScheme('data:text/html,x')],
  ['uri action 用 ftp:', withScheme('ftp://a.example/')],
  ['hero 圖 url 用 http —— issue #6 留下的基準線，本輪重跑', httpHero],
];

/*
 * ------------------------------------------------------------ scheme 探測
 * 這一組**不做通過／失敗判定**，只記錄 LINE 對各種 scheme 的實際回答。
 *
 * 為什麼要有它：14 分冊 §8.20 寫「uri action 只收 https，http 會被回
 * invalid uri scheme」，本輪一跑才發現那是把 hero 圖片的限制誤植過來的
 * ——LINE 對 uri action 的 http 回 200。我們仍然只收 https（擁有者裁決），
 * 但那是**本平台的規則**，沒有任何外部系統會替我們擋。
 *
 * 把它印成「探測」而不是「負向對照」，是 CLAUDE.md 那條 FAIL / WARN 的分界：
 * 一條永遠亮紅的對照，跟一個永遠開著的警告一樣，只會讓人學會忽略整個面板。
 */
const probes = ['https://a.example/', 'http://a.example/', 'line://ti/p/@abc', 'tel:0212345678']
  .map((uri) => ({ name: 'uri action scheme：' + uri, message: withScheme(uri) }));

process.stdout.write(JSON.stringify({
  positive: out,
  negative: neg.map(([name, message]) => ({ name, message })),
  probes,
}));
`);
  const stdout = execFileSync('npx', ['tsx', entry], {
    cwd: process.cwd(), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
  return JSON.parse(stdout.slice(stdout.indexOf('{')));
}

/** 送一則訊息給 LINE 的 validate 端點，回傳 { status, text }。 */
async function validate(message) {
  const res = await fetch('https://api.line.me/v2/bot/message/validate/reply', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messages: [message] }),
  });
  return { status: res.status, text: await res.text() };
}

async function main() {
  const { positive, negative, probes } = buildCases();
  let failed = 0;

  console.log('=== 正向：我們真的會送給顧客的 JSON，LINE 要收得下 ===');
  for (const c of positive) {
    if (!c.message) {
      console.log(`SKIP  ${c.name} —— kind=${c.kind}，沒有訊息可驗（這是預期行為）`);
      continue;
    }
    const { status, text } = await validate(c.message);
    const bubbles = c.bubbles === null ? '-' : `${c.bubbles} bubble`;
    if (status === 200) {
      console.log(`PASS  ${c.name} [${c.kind}, ${bubbles}] → HTTP ${status} ${text || '{}'}`);
    } else {
      failed += 1;
      console.log(`FAIL  ${c.name} [${c.kind}, ${bubbles}] → HTTP ${status} ${text}`);
    }
  }

  /*
   * 負向對照的判定是**反過來的**：LINE 回 200 才叫失敗。
   * 一條負向案例意外通過，代表的不是「我們多擋了也無妨」，而是
   * 「這個 validate 端點對這一類錯誤根本不看」——上面那些 200 就少了一份重量，
   * 必須當成紅燈查清楚，不能當成好消息。
   */
  console.log('\n=== 負向對照：繞過我們的防線做出來的 JSON，LINE 必須退回 ===');
  for (const c of negative) {
    const { status, text } = await validate(c.message);
    if (status === 200) {
      failed += 1;
      console.log(`FAIL  ${c.name} → LINE 竟然收下了（HTTP 200）——這條對照失效`);
    } else {
      console.log(`REJECTED  ${c.name} → HTTP ${status} ${text}`);
    }
  }

  /*
   * 探測不計入 failed：這裡印的是「LINE 實際上怎麼回」，不是我們的斷言。
   * 讀的人要能一眼看出哪些限制是 LINE 給的、哪些是本平台自己加的。
   */
  console.log('\n=== scheme 探測（不判定通過與否，只記錄 LINE 實際的回答）===');
  for (const c of probes) {
    const { status, text } = await validate(c.message);
    const verdict = status === 200 ? 'LINE 收下' : 'LINE 退回';
    console.log(`INFO  ${c.name} → HTTP ${status}（${verdict}）${status === 200 ? '' : text}`);
  }
  console.log(
    'INFO  ↑ http 被 LINE 收下 → flexCardSchema 的 https-only 是**本平台的規則**，' +
      '不是 LINE 的限制（14 分冊 §8.20 的 ⚠️ 段落把 hero 圖的限制誤植成 uri action 的）。',
  );

  console.log(
    `\n合計 正向 ${positive.length} 條、負向對照 ${negative.length} 條、探測 ${probes.length} 條，` +
      `不符預期 ${failed} 條。`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
