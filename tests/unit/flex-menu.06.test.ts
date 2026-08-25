/**
 * Flex 主選單組裝函式 — 單元測試（GitHub issue #6「修復-4」第 ① 項驗收）
 * -----------------------------------------------------------------------------
 * 受測對象：`src/server/flex-menu.ts` 的 `buildFlexMenuOutcome()` —— 全專案
 * **唯一**產生 Flex bubble/carousel JSON 的地方。這一檔驗的是「組出來的形狀對不對」
 * （純函式，node 環境可跑）；
 *   - 「存進去的卡片真的會從 webhook 出來、bubble 數＝卡片數」由
 *     tests/integration/api/flex-menu.06.test.ts 負責（需要 DB + mock LINE）
 *   - 「這份 JSON LINE 真的收得下」由 scripts/verify/flex-menu-validate.cjs
 *     打 LINE 官方的 POST /v2/bot/message/validate/reply 負責（不耗推播額度）
 *
 * ⚠️ 這裡也釘住 issue #6 的兩條結構要求，它們比任何一條輸出斷言都難自動察覺：
 *   1. **單一事實來源**：src/ 底下只有 flex-menu.ts 會組 bubble/carousel。
 *      Rich Menu 設 FLEX_POPUP 的格子不自己組一份，而是送出
 *      FLEX_POPUP_TRIGGER_TEXT → 走同一支 buildFlexMenuOutcome()。
 *   2. **12 只有一個出處**：`MAX_FLEX_CARDS`。zod 的 .max()、頁面的新增上限、
 *      文案三者引用同一個常數（同型缺陷見 src/server/paging.ts 檔頭）。
 *   3. **`uri` action 也只在 flex-menu.ts 組**（14 分冊 §8.20 加了 `linkUrl` 之後）。
 *      頁面另寫一份「組一個 uri action」是同一個分岔陷阱的新入口。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  FLEX_POPUP_TRIGGER_TEXT,
  applyShopName,
  buildFlexMenuOutcome,
  normalizeFlexCards,
  richMenuCellAction,
} from '@/server/flex-menu';
import {
  FLEX_LINK_URL_SCHEMES, MAX_FLEX_CARDS, isAllowedFlexLinkUrl, lineSettingsSchema,
} from '@/config/tenant-settings';
import { resolveBuiltinIntent } from '@/server/line-events';

const ROOT = process.cwd();
const SHOP = '示範美髮沙龍';

/** 產生 n 張可用卡片 */
const cards = (n: number, extra: Partial<{ ad: boolean; imageUrl: string }> = {}) =>
  Array.from({ length: n }, (_, i) => ({
    title: `卡片${i + 1}`, subtitle: `說明${i + 1}`, imageUrl: '', ad: false, ...extra,
  }));

/** 從 FLEX 結果取出 carousel 的 bubble 陣列 */
function bubblesOf(outcome: ReturnType<typeof buildFlexMenuOutcome>): any[] {
  expect(outcome.kind).toBe('FLEX');
  const msg = (outcome as { message: any }).message;
  expect(msg.type).toBe('flex');
  expect(msg.contents.type).toBe('carousel');
  return msg.contents.contents;
}

/** 走訪 bubble 內所有 text 元件的文字 */
function textsOf(node: any, out: string[] = []): string[] {
  if (Array.isArray(node)) { node.forEach((n) => textsOf(n, out)); return out; }
  if (node && typeof node === 'object') {
    if (node.type === 'text' && typeof node.text === 'string') out.push(node.text);
    Object.values(node).forEach((v) => textsOf(v, out));
  }
  return out;
}

describe('buildFlexMenuOutcome — 卡片張數', () => {
  it('空卡片（已啟用但一張都沒編）→ NO_CARDS，不憑空生一張卡', () => {
    const outcome = buildFlexMenuOutcome({ flexMenuEnabled: true, flexCards: [] }, SHOP);
    expect(outcome.kind).toBe('NO_CARDS');
    expect(outcome).not.toHaveProperty('message');
  });

  it('沒有 flexCards 這個鍵的老資料 → 一樣是 NO_CARDS（不是崩潰、也不是空 carousel）', () => {
    expect(buildFlexMenuOutcome({}, SHOP).kind).toBe('NO_CARDS');
  });

  it('1 張卡片 → carousel 有 1 個 bubble，bubbleCount 也是 1', () => {
    const outcome = buildFlexMenuOutcome({ flexCards: cards(1) }, SHOP);
    expect(bubblesOf(outcome)).toHaveLength(1);
    expect((outcome as { bubbleCount: number }).bubbleCount).toBe(1);
  });

  it(`${MAX_FLEX_CARDS} 張卡片 → ${MAX_FLEX_CARDS} 個 bubble（carousel 的上限，剛好塞滿）`, () => {
    const outcome = buildFlexMenuOutcome({ flexCards: cards(MAX_FLEX_CARDS) }, SHOP);
    expect(bubblesOf(outcome)).toHaveLength(MAX_FLEX_CARDS);
  });

  it(`jsonb 裡混進第 ${MAX_FLEX_CARDS + 1} 張（繞過端點寫入）→ 組裝時硬切，不送超規的 carousel 給 LINE`, () => {
    const outcome = buildFlexMenuOutcome({ flexCards: cards(MAX_FLEX_CARDS + 3) }, SHOP);
    expect(bubblesOf(outcome)).toHaveLength(MAX_FLEX_CARDS);
  });

  it('連標題都沒有的那一張才被跳過，其餘照常出現（一筆爛資料不該讓整份選單消失）', () => {
    const list = [...cards(2), { title: '', subtitle: 'x' }, ...cards(1)];
    expect(normalizeFlexCards(list)).toHaveLength(3);
  });
});

describe('buildFlexMenuOutcome — 卡片內容', () => {
  it('標題同時是 body 文字與按鈕的 label／送出文字（按鈕上寫什麼就送出什麼）', () => {
    const [bubble] = bubblesOf(buildFlexMenuOutcome({ flexCards: cards(1) }, SHOP));
    expect(textsOf(bubble.body)).toContain('卡片1');
    expect(bubble.footer.contents[0].action).toEqual({
      type: 'message', label: '卡片1', text: '卡片1',
    });
  });

  it('沒有圖片的卡片不放 hero（不塞佔位圖）；https 圖片才放', () => {
    const [noImage] = bubblesOf(buildFlexMenuOutcome({ flexCards: cards(1) }, SHOP));
    expect(noImage.hero).toBeUndefined();

    const [withImage] = bubblesOf(buildFlexMenuOutcome(
      { flexCards: cards(1, { imageUrl: 'https://example.com/a.jpg' }) }, SHOP,
    ));
    expect(withImage.hero.type).toBe('image');
    expect(withImage.hero.url).toBe('https://example.com/a.jpg');
  });

  it('http（非 https）的圖片：只丟掉那張圖，卡片本身留著（LINE 只收 HTTPS）', () => {
    const bubbles = bubblesOf(buildFlexMenuOutcome(
      { flexCards: [{ title: 'A', subtitle: '', imageUrl: 'http://example.com/a.jpg', ad: false }] },
      SHOP,
    ));
    // 卡片沒有被整張丟掉——後台看得到的卡，顧客那邊也要看得到
    expect(bubbles).toHaveLength(1);
    expect(bubbles[0].hero).toBeUndefined();
    expect(textsOf(bubbles[0])).toContain('A');
  });

  it('副標為空時不產生空字串的 text 元件（LINE 會 400）', () => {
    const [bubble] = bubblesOf(buildFlexMenuOutcome(
      { flexCards: [{ title: 'A', subtitle: '', imageUrl: '', ad: false }] }, SHOP,
    ));
    expect(textsOf(bubble)).not.toContain('');
  });

  it('含廣告卡：ad=true 的那一張多一行「廣告」標示，一般卡沒有', () => {
    const outcome = buildFlexMenuOutcome({
      flexCards: [
        { title: '一般卡', subtitle: '', imageUrl: '', ad: false },
        { title: '廣告卡', subtitle: '', imageUrl: '', ad: true },
      ],
    }, SHOP);
    const [normal, adCard] = bubblesOf(outcome);
    expect(textsOf(normal)).not.toContain('廣告');
    expect(textsOf(adCard)).toContain('廣告');
  });

  it('壞掉的 header 色碼不會被原樣送給 LINE（退回 schema 預設綠）', () => {
    const [bubble] = bubblesOf(buildFlexMenuOutcome(
      { flexCards: cards(1), flexHeaderColor: 'rgb(1,2,3)' }, SHOP,
    ));
    expect(bubble.header.backgroundColor).toBe('#06C755');
  });
});

/* ========================================================================== */
/* linkUrl —— 14 分冊 §8.20 / §8.20-b：卡片契約的 optional 連結網址            */
/* ========================================================================== */
/**
 * ⚠️ **前提變更（2026-08-25，擁有者裁決 §8.20-b「廣告卡全開」）。**
 *
 * 本組原本斷言「http 必須被擋」，那條規則是 §8.20 訂的 https-only。
 * §8.20 給的理由是「LINE 的 uri action 只收 https」——**該理由已被實測推翻**
 * （它把 hero **圖片** url 的 https-only 誤植成了 uri action 的限制）。
 * 理由消失後回頭問擁有者，裁決是「全開」：LINE 實測收什麼，本平台就收什麼。
 *
 * 所以下面幾條 http 相關的斷言是**反轉的前提**，不是把測試改到綠：
 *   舊：`parse('http://…').success === false`（該被擋）
 *   新：`parse('http://…').success === true` （該被收）
 * 三處（zod 寫入、normalizeFlexCards 讀取、cardAction 組裝）一起反轉。
 *
 * 白名單內容由實測決定，出處 `scripts/verify/flex-menu-validate.cjs`
 * 對 LINE 官方 `POST /v2/bot/message/validate/reply` 的實跑（2026-08-25）：
 *   200 收下 → 進白名單：https:// / http:// / line:// / tel: / mailto:
 *   400 退回 → 不進白名單：sms: / javascript: / data: / ftp: / file:// / 無 scheme
 *
 * 為什麼這一組仍要寫得重：
 *
 * 1. `linkUrl` 加錯的失敗模式是「後台看得到、顧客按了沒反應」，或更糟——
 *    LINE 把整包 carousel 退回，顧客一張卡都收不到。
 * 2. 判斷是**白名單**（`isAllowedFlexLinkUrl()`）不是黑名單。黑名單漏掉一個
 *    沒人想過的 scheme，那個 scheme 會直接送到顧客手上而**沒有任何測試會紅**；
 *    白名單漏掉一個合法 scheme 只是少一個功能。兩種錯的代價不對等。
 *    ⚠️ 所以下面必須有一條「白名單以外一律擋」的測試，而不是逐個列黑名單。
 * 3. 沒填網址的卡片**不得因此變成一張壞卡**——它必須原封不動地維持
 *    原本的 message action。這是最容易被改壞、也最不容易被發現的一條。
 */
describe('卡片的 linkUrl（§8.20-b 全開）：白名單內才開連結，白名單外不得把卡片弄壞', () => {
  const withLink = (linkUrl: string, ad = false) =>
    [{ title: '本月優惠', subtitle: '限時折扣', imageUrl: '', ad, linkUrl }];
  const parseCard = (linkUrl?: string) =>
    lineSettingsSchema.pick({ flexCards: true }).safeParse({
      flexCards: [{
        title: 'A', subtitle: '', imageUrl: '', ad: false,
        ...(linkUrl === undefined ? {} : { linkUrl }),
      }],
    });

  /** LINE 實測回 200 的那一組——每一個都必須被三層放行 */
  const ALLOWED = [
    'https://example.com/promo',
    'http://example.com/promo',
    'line://ti/p/@abc',
    'tel:0212345678',
    'mailto:shop@example.com',
  ];
  /**
   * LINE 實測回 400 `invalid uri scheme` 的那一組，加上白名單一定要擋的變形。
   * 變形那幾條的用途是釘住**我們的**判斷（trim + 轉小寫 + 必須以白名單 scheme 開頭），
   * 不是「LINE 沒退就放行」——兩件事不要混。
   */
  const BLOCKED = [
    // LINE 實測 400：
    'sms:0212345678',
    'javascript:alert(1)',
    'data:text/html,x',
    'ftp://a.example/',
    'file:///etc/passwd',
    '/foo',
    'a.example/foo',
    // 大小寫變形（LINE 對 JavaScript: 也回 400；白名單本來就擋）：
    'JavaScript:alert(1)',
    'JAVASCRIPT:alert(1)',
    // 空白／控制字元藏在 scheme 前後或中間：
    ' javascript:alert(1)',
    '\tjavascript:alert(1)',
    '\njavascript:alert(1)',
    'java\tscript:alert(1)',
    '\\tjavascript:alert(1)',   // 字面反斜線+t（兩個字元，不是控制字元）
  ];

  it.each(ALLOWED)('白名單 scheme %s → 按鈕是 uri action，label 仍是標題、uri 逐字相符', (url) => {
    const [bubble] = bubblesOf(buildFlexMenuOutcome({ flexCards: withLink(url) }, SHOP));
    expect(bubble.footer.contents[0].action).toEqual({
      type: 'uri', label: '本月優惠', uri: url,
    });
  });

  it.each(ALLOWED)('zod（寫入路徑）放行白名單 scheme %s', (url) => {
    expect(parseCard(url).success).toBe(true);
  });

  it.each(ALLOWED)('normalizeFlexCards（讀取路徑）保留白名單 scheme %s', (url) => {
    expect(normalizeFlexCards([
      { title: 'A', subtitle: '', imageUrl: '', ad: false, linkUrl: url },
    ])[0].linkUrl).toBe(url);
  });

  /*
   * ⚠️ 前提變更（§8.20-b）：這一條原本叫
   * 「http（非 https）的網址：只丟掉那個連結，卡片留著並退回 message action」，
   * 斷言 http 會被洗成空字串。擁有者裁決全開後 http 是**合法**的，
   * 上面三條 it.each 已經把它釘成「該被收」。
   */
  it('http 的連結網址現在會真的開（§8.20-b 反轉：舊斷言是「該被擋」）', () => {
    const [bubble] = bubblesOf(buildFlexMenuOutcome(
      { flexCards: withLink('http://example.com/promo') }, SHOP,
    ));
    expect(bubble.footer.contents[0].action.type).toBe('uri');
    expect(JSON.stringify(bubble)).toContain('http://example.com/promo');
  });

  it('沒有 linkUrl 這個鍵的老資料 → 按鈕原封不動是 message action（不得變成壞卡）', () => {
    const [bubble] = bubblesOf(buildFlexMenuOutcome(
      { flexCards: [{ title: '預約', subtitle: '', imageUrl: '', ad: false }] }, SHOP,
    ));
    expect(bubble.footer.contents[0].action).toEqual({
      type: 'message', label: '預約', text: '預約',
    });
  });

  it('linkUrl 是空字串 → 一樣退回 message action，卡片照常出現', () => {
    const bubbles = bubblesOf(buildFlexMenuOutcome({ flexCards: withLink('') }, SHOP));
    expect(bubbles).toHaveLength(1);
    expect(bubbles[0].footer.contents[0].action.type).toBe('message');
    expect(textsOf(bubbles[0])).toContain('本月優惠');
  });

  /* ---------------------------------------------------------- 白名單以外 */

  it.each(BLOCKED)('zod（寫入路徑）擋下白名單以外的 %j', (bad) => {
    expect(parseCard(bad).success, `${JSON.stringify(bad)} 不該通過`).toBe(false);
  });

  it.each(BLOCKED)('normalizeFlexCards（讀取路徑）把 %j 洗成空字串，卡片留著', (bad) => {
    const out = normalizeFlexCards([
      { title: 'A', subtitle: '', imageUrl: '', ad: false, linkUrl: bad },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].linkUrl).toBe('');
    expect(out[0].title).toBe('A');
  });

  it.each(BLOCKED)('組裝路徑：%j 退回 message action，那串字不得出現在送出的 JSON 裡', (bad) => {
    const bubbles = bubblesOf(buildFlexMenuOutcome({ flexCards: withLink(bad) }, SHOP));
    expect(bubbles).toHaveLength(1);
    expect(bubbles[0].footer.contents[0].action).toEqual({
      type: 'message', label: '本月優惠', text: '本月優惠',
    });
    expect(JSON.stringify(bubbles[0])).not.toContain(bad);
  });

  /*
   * 白名單的**負面保護**：不准用黑名單。
   * 這一條餵的是「今天沒人想得到的 scheme」——黑名單一定漏，白名單一定擋。
   * 缺了它，日後有人把 isAllowedFlexLinkUrl 改成列舉危險字串也照樣全綠。
   */
  it('白名單以外一律擋，即使是沒人列過的 scheme（證明不是黑名單）', () => {
    for (const weird of [
      'intent://scan/#Intent;scheme=zxing;end',
      'chrome://settings',
      'vbscript:msgbox(1)',
      'jar:http://a.example!/x',
      'blob:https://a.example/uuid',
      'about:blank',
      'ws://a.example/',
      'httpss://a.example/',
      'https:/a.example/',   // 只有一條斜線，不符合 https:// 前綴
      'tel/0212345678',      // 缺冒號
    ]) {
      expect(parseCard(weird).success, `${weird} 不該通過`).toBe(false);
      expect(isAllowedFlexLinkUrl(weird), `${weird} 不該進白名單`).toBe(false);
    }
  });

  it('前後空白會被去掉再判斷，也去掉再存（LINE 對前置空白的網址回 400）', () => {
    const parsed = parseCard('  https://example.com/promo  ');
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.flexCards[0].linkUrl).toBe('https://example.com/promo');

    // 讀取路徑同樣要 trim，不能把帶空白的原字串送給 LINE
    expect(normalizeFlexCards([
      { title: 'A', subtitle: '', imageUrl: '', ad: false, linkUrl: ' https://example.com/promo ' },
    ])[0].linkUrl).toBe('https://example.com/promo');
  });

  it('scheme 比對不分大小寫（LINE 對 HTTPS:// 回 200），但路徑大小寫原樣保留', () => {
    expect(isAllowedFlexLinkUrl('HTTPS://A.EXAMPLE/Promo')).toBe(true);
    const parsed = parseCard('HTTPS://A.EXAMPLE/Promo');
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.flexCards[0].linkUrl).toBe('HTTPS://A.EXAMPLE/Promo');
  });

  it('白名單常數與判斷函式一致：每個 scheme 拼上內容都放行，且清單就是實測那五個', () => {
    // 釘住清單本身——加一個沒實測過的 scheme 進去，這條會紅
    expect([...FLEX_LINK_URL_SCHEMES]).toEqual([
      'https://', 'http://', 'line://', 'tel:', 'mailto:',
    ]);
    for (const scheme of FLEX_LINK_URL_SCHEMES) {
      expect(isAllowedFlexLinkUrl(`${scheme}x`), `${scheme} 應在白名單內`).toBe(true);
    }
    // 空字串／非字串不是「可用連結」；呼叫端各自決定它代表什麼
    expect(isAllowedFlexLinkUrl('')).toBe(false);
    expect(isAllowedFlexLinkUrl(undefined)).toBe(false);
    expect(isAllowedFlexLinkUrl(null)).toBe(false);
    expect(isAllowedFlexLinkUrl(123)).toBe(false);
  });

  it('三處共用同一支判斷函式（不得各寫一份 startsWith）', () => {
    const schema = readFileSync(resolve(ROOT, 'src/config/tenant-settings.ts'), 'utf8');
    const server = readFileSync(resolve(ROOT, 'src/server/flex-menu.ts'), 'utf8');
    const page = readFileSync(resolve(ROOT, 'src/app/tenant/rich-menu-design/page.tsx'), 'utf8');

    // 唯一出處在 tenant-settings.ts，另外兩處 import 它
    expect(schema).toContain('export function isAllowedFlexLinkUrl');
    expect(server).toContain('isAllowedFlexLinkUrl');
    expect(page).toContain('isAllowedFlexLinkUrl');
    // 另外兩處不得再自己寫一份 linkUrl 的 scheme 判斷
    expect(server).not.toContain("linkUrl.startsWith('https://')");
    expect(page).not.toContain("linkUrl.trim().startsWith('https://')");
  });

  it('一張卡只有一個 action：bubble 層與 hero 都不得再掛第二個目的地', () => {
    const [bubble] = bubblesOf(buildFlexMenuOutcome({
      flexCards: [{
        title: '本月優惠', subtitle: '限時折扣',
        imageUrl: 'https://example.com/a.jpg', ad: true,
        linkUrl: 'https://example.com/promo',
      }],
    }, SHOP));
    // 一張卡兩個目的地 = 顧客按到哪裡就去哪裡，而店家只填了一個網址
    expect(bubble.action).toBeUndefined();
    expect(bubble.hero.action).toBeUndefined();
    expect(bubble.body.action).toBeUndefined();
    const uriActions = JSON.stringify(bubble).match(/"type":"uri"/g) ?? [];
    expect(uriActions).toHaveLength(1);
  });

  it('linkUrl 不是廣告卡專屬：一般卡填了也生效（契約定在卡片層級）', () => {
    const [normal, adCard] = bubblesOf(buildFlexMenuOutcome({
      flexCards: [
        { title: '官網', subtitle: '', imageUrl: '', ad: false, linkUrl: 'https://shop.example' },
        { title: '本月優惠', subtitle: '', imageUrl: '', ad: true, linkUrl: 'tel:0212345678' },
      ],
    }, SHOP));
    expect(normal.footer.contents[0].action).toEqual({
      type: 'uri', label: '官網', uri: 'https://shop.example',
    });
    expect(adCard.footer.contents[0].action).toEqual({
      type: 'uri', label: '本月優惠', uri: 'tel:0212345678',
    });
    // 廣告卡仍然有「廣告」標示（連結不取代標示）
    expect(textsOf(adCard)).toContain('廣告');
  });

  it('空字串與缺鍵都當作「不開網址」，不是錯誤', () => {
    expect(parseCard('').success).toBe(true);
    const missing = parseCard(undefined);
    expect(missing.success).toBe(true);
    expect(missing.success && missing.data.flexCards[0].linkUrl).toBe('');
  });

  it('頁面真的把 linkUrl 送進端點（不是只有一個存不進去的輸入框）', () => {
    const page = readFileSync(resolve(ROOT, 'src/app/tenant/rich-menu-design/page.tsx'), 'utf8');
    // toPayload 是頁面 → 端點契約的唯一轉換點
    expect(page).toContain('({ title, subtitle, imageUrl, ad, linkUrl })');
    // 有可編輯的輸入框（不是唯讀顯示）
    expect(page).toContain('linkUrl: e.target.value');
    // 發布前先擋白名單以外的 scheme，讓店家看中文而不是端點的 400 原文
    expect(page).toContain('t.flex.linkUrlScheme');
    expect(page).toContain('!isAllowedFlexLinkUrl(c.linkUrl)');
  });

  it('src/ 底下只有 flex-menu.ts 會組 uri action（頁面不得另寫一份組裝）', () => {
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.tsx?$/.test(full)) out.push(full);
      }
      return out;
    };
    const offenders = walk(resolve(ROOT, 'src'))
      .filter((f) => {
        const body = readFileSync(f, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        return /type:\s*'uri'/.test(body);
      })
      .map((f) => relative(ROOT, f));
    expect(offenders).toEqual(['src/server/flex-menu.ts']);
  });
});

describe('buildFlexMenuOutcome — {shopName} 替換', () => {
  it('header 標題的 {shopName} 換成店名（schema 預設值 ✨ {shopName}）', () => {
    const preset = lineSettingsSchema.parse({});
    expect(preset.flexHeaderTitle).toBe('✨ {shopName}');

    const [bubble] = bubblesOf(buildFlexMenuOutcome(
      { flexCards: cards(1), flexHeaderTitle: preset.flexHeaderTitle }, SHOP,
    ));
    expect(textsOf(bubble.header)).toContain(`✨ ${SHOP}`);
    expect(JSON.stringify(bubble)).not.toContain('{shopName}');
  });

  it('副標題的 {shopName} 也會替換，一句裡出現兩次也全部換掉', () => {
    expect(applyShopName('{shopName} 歡迎您，這裡是 {shopName}', SHOP))
      .toBe(`${SHOP} 歡迎您，這裡是 ${SHOP}`);
    const [bubble] = bubblesOf(buildFlexMenuOutcome(
      { flexCards: cards(1), flexHeaderSubtitle: '{shopName} 服務時間 10-20' }, SHOP,
    ));
    expect(textsOf(bubble.header)).toContain(`${SHOP} 服務時間 10-20`);
  });

  it('altText 也不留 {shopName}（通知列會直接顯示這一句）', () => {
    const outcome = buildFlexMenuOutcome(
      { flexCards: cards(1), flexHeaderTitle: '✨ {shopName}' }, SHOP,
    );
    expect((outcome as { message: any }).message.altText).toBe(`✨ ${SHOP}`);
  });
});

describe('buildFlexMenuOutcome — 關閉時的 HINT / SILENT 兩種行為', () => {
  it('flexMenuEnabled=false + HINT → 回一句提示文字，且逐字等於畫面上承諾的那句', () => {
    const outcome = buildFlexMenuOutcome(
      { flexMenuEnabled: false, flexMenuFallback: 'HINT', flexCards: cards(3) }, SHOP,
    );
    expect(outcome.kind).toBe('HINT');
    expect((outcome as { message: any }).message)
      .toEqual({ type: 'text', text: '請點選下方選單使用 👇' });
  });

  it('flexMenuEnabled=false + SILENT → SILENT，**完全沒有 message 可送**（呼叫端一則都不准發）', () => {
    const outcome = buildFlexMenuOutcome(
      { flexMenuEnabled: false, flexMenuFallback: 'SILENT', flexCards: cards(3) }, SHOP,
    );
    expect(outcome.kind).toBe('SILENT');
    expect(outcome).not.toHaveProperty('message');
  });

  it('關閉時就算有 12 張卡片也不組 carousel（開關真的是開關）', () => {
    for (const fallback of ['HINT', 'SILENT'] as const) {
      const outcome = buildFlexMenuOutcome(
        { flexMenuEnabled: false, flexMenuFallback: fallback, flexCards: cards(MAX_FLEX_CARDS) },
        SHOP,
      );
      expect(outcome.kind).not.toBe('FLEX');
    }
  });

  it('畫面上承諾的提示文字與 server 真的送出的那一句一致（兩處不得漂掉）', async () => {
    const { richMenuDesignPage } = await import('@/i18n/zh-TW/pages/rich-menu-design');
    const outcome = buildFlexMenuOutcome({ flexMenuEnabled: false, flexMenuFallback: 'HINT' }, SHOP);
    const sent = (outcome as { message: any }).message.text as string;
    // 單選鈕的說明是「回提示文字『…』」，顧客實際收到的必須就是引號裡那一句
    expect(
      richMenuDesignPage.flex.fallbackHint,
      `畫面說會回一句話，webhook 卻送了「${sent}」`,
    ).toContain(sent);
  });

  it('沒有 flexMenuFallback 這個鍵時預設 HINT（與 zod 的 default 一致，不會靜默）', () => {
    expect(buildFlexMenuOutcome({ flexMenuEnabled: false, flexCards: cards(1) }, SHOP).kind)
      .toBe('HINT');
    expect(lineSettingsSchema.parse({}).flexMenuFallback).toBe('HINT');
  });
});

/* ========================================================================== */
/* 結構要求 ①：Rich Menu 的 FLEX_POPUP 格子與「選單」共用同一支組裝函式          */
/* ========================================================================== */
describe('FLEX_POPUP 格子與「選單」共用同一組組裝函式（單一事實來源）', () => {
  it('一般格子送出自己的文字；FLEX_POPUP 格子改送 FLEX_POPUP_TRIGGER_TEXT', () => {
    expect(richMenuCellAction({ label: '立即預約', text: '預約' }))
      .toEqual({ type: 'message', label: '立即預約', text: '預約' });
    expect(richMenuCellAction({ label: '看看選單', text: '不重要', action: 'FLEX_POPUP' }))
      .toEqual({ type: 'message', label: '看看選單', text: FLEX_POPUP_TRIGGER_TEXT });
  });

  it('FLEX_POPUP_TRIGGER_TEXT 一定解析得到 MENU 意圖，否則按那一格完全沒反應', () => {
    const hit = resolveBuiltinIntent(FLEX_POPUP_TRIGGER_TEXT);
    expect(hit, `「${FLEX_POPUP_TRIGGER_TEXT}」不在任何關鍵字組裡`).not.toBeNull();
    expect(hit!.intent).toBe('MENU');
  });

  it('rich-menu/create 不自己組 action 物件——一律呼叫 richMenuCellAction()', () => {
    const src = readFileSync(
      resolve(ROOT, 'src/app/api/settings/line/rich-menu/create/route.ts'), 'utf8',
    );
    expect(src).toContain('richMenuCellAction(');
    expect(src, "create route 又自己寫了一份 { type: 'message' } action")
      .not.toMatch(/type:\s*'message'/);
  });

  it('line-events 的 MENU 分支呼叫 buildFlexMenuOutcome()，沒有自己組 Flex', () => {
    const src = readFileSync(resolve(ROOT, 'src/server/line-events.ts'), 'utf8');
    expect(src).toContain('buildFlexMenuOutcome(');
    expect(src).toContain("case 'MENU':");
  });

  it('src/ 底下只有 flex-menu.ts 會組 bubble / carousel（第二份組裝邏輯 = 遲早分岔）', () => {
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.tsx?$/.test(full)) out.push(full);
      }
      return out;
    };
    const offenders = walk(resolve(ROOT, 'src'))
      .filter((f) => {
        const body = readFileSync(f, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        return /type:\s*'bubble'/.test(body) || /type:\s*'carousel'/.test(body);
      })
      .map((f) => relative(ROOT, f));
    expect(offenders).toEqual(['src/server/flex-menu.ts']);
  });
});

/* ========================================================================== */
/* 結構要求 ②：12 只有一個出處                                                 */
/* ========================================================================== */
describe('卡片上限 12 的單一事實來源（MAX_FLEX_CARDS）', () => {
  it('常數就是 LINE carousel 的 bubble 上限 12', () => {
    expect(MAX_FLEX_CARDS).toBe(12);
  });

  it('zod 擋得住第 13 張（API 層），剛好 12 張放行', () => {
    const ok = lineSettingsSchema.pick({ flexCards: true }).safeParse({ flexCards: cards(12) });
    expect(ok.success).toBe(true);
    const tooMany = lineSettingsSchema.pick({ flexCards: true }).safeParse({ flexCards: cards(13) });
    expect(tooMany.success).toBe(false);
  });

  it('zod 也擋空標題（標題同時是按鈕文字，空字串會被 LINE 退回）', () => {
    const bad = lineSettingsSchema.pick({ flexCards: true }).safeParse({
      flexCards: [{ title: '   ', subtitle: '', imageUrl: '', ad: false }],
    });
    expect(bad.success).toBe(false);
  });

  it('頁面用 MAX_FLEX_CARDS 擋，沒有自己寫死一個 12（頁面層）', () => {
    const page = readFileSync(resolve(ROOT, 'src/app/tenant/rich-menu-design/page.tsx'), 'utf8');
    expect(page).toContain("import { MAX_FLEX_CARDS");
    expect(page).toContain('cards.length >= MAX_FLEX_CARDS');
    // 「最多 N 張」的文案也吃常數，不是第三份 12
    expect(page).toContain('t.flex.maxCards(MAX_FLEX_CARDS)');
  });

  it('字典裡沒有任何寫死張數上限的句子（舊的 maxCards12 / maxCards10 互相矛盾）', async () => {
    const { richMenuDesignPage } = await import('@/i18n/zh-TW/pages/rich-menu-design');
    expect(Object.keys(richMenuDesignPage.flex)).not.toContain('maxCards12');
    expect(Object.keys(richMenuDesignPage.flex)).not.toContain('maxCards10');
    expect(richMenuDesignPage.flex.maxCards(MAX_FLEX_CARDS)).toBe('最多 12 張卡片');
  });
});
