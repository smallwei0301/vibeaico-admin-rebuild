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
process.stdout.write(JSON.stringify(out));
`);
  const stdout = execFileSync('npx', ['tsx', entry], {
    cwd: process.cwd(), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
  return JSON.parse(stdout.slice(stdout.indexOf('[')));
}

async function main() {
  const cases = buildCases();
  let failed = 0;

  for (const c of cases) {
    if (!c.message) {
      console.log(`SKIP  ${c.name} —— kind=${c.kind}，沒有訊息可驗（這是預期行為）`);
      continue;
    }
    const res = await fetch('https://api.line.me/v2/bot/message/validate/reply', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messages: [c.message] }),
    });
    const text = await res.text();
    const bubbles = c.bubbles === null ? '-' : `${c.bubbles} bubble`;
    if (res.status === 200) {
      console.log(`PASS  ${c.name} [${c.kind}, ${bubbles}] → HTTP ${res.status} ${text || '{}'}`);
    } else {
      failed += 1;
      console.log(`FAIL  ${c.name} [${c.kind}, ${bubbles}] → HTTP ${res.status} ${text}`);
    }
  }

  console.log(`\n合計 ${cases.length} 個案例，LINE 拒絕 ${failed} 個。`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
