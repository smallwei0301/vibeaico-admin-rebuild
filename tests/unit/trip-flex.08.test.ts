/**
 * 行程 Flex 輪播組裝函式 — 單元測試（GitHub issue #8「修復-6」的 LINE 段）
 * -----------------------------------------------------------------------------
 * 受測對象：`src/server/trip-flex.ts` 的 `buildTripCarousel()`。
 * 規格：`docs/integration/10-TOUR-DOMAIN.md` §6.1
 *      「『行程』關鍵字 → 已發布行程的 Flex 輪播：封面／標語／最低價／我要預約」
 *
 * ⚠️ 這一檔的重點**不是**「JSON 長得漂亮」，而是三件會讓顧客真的收不到東西、
 * 或收到假資訊的事。每一條都對應一個具體的失敗模式：
 *
 *   1. **LINE 會整包退回的形狀** —— hero 的 `url` 只收 https、text 元件不收空字串、
 *      carousel 超過 12 bubble。這三件事任一發生，顧客收到的**不是「少一張卡」
 *      而是「一張都沒有」**。
 *   2. **捏造的已知** —— 沒有任何啟用方案時 `minPrice` 是 `null`，顯示 `NT$ 0`
 *      會讓顧客以為免費。
 *   3. **副標的來源** —— `public.trips` 一度沒有 `tagline` 欄位（0066），副標
 *      只能取自 `summary`；讀一個不存在的欄位會讓每張卡永遠少一行，而且沒有
 *      任何東西會紅。`0089`（issue #259）補上欄位之後改回「標語優先，其次簡介」，
 *      下面那一組斷言連同 fallback 一起釘住。
 */
import { describe, expect, it } from 'vitest';
import { buildTripCarousel, TRIP_CAROUSEL_MAX, type TripCardSource } from '@/server/trip-flex';

const SHOP_URL = 'https://vibeaico.com/shop/midao';

const LABELS = {
  altText: '目前開放報名的行程',
  priceFrom: '最低',
  priceUnknown: '價格洽詢',
  bookCta: '我要預約',
};

const trip = (over: Partial<TripCardSource> = {}): TripCardSource => ({
  slug: 'guishan-island',
  title: '龜山島賞鯨一日遊',
  tagline: '',
  summary: '搭船出海尋找飛旋海豚，登島走完 401 高地。',
  coverImageUrl: '',
  minPrice: 2800,
  ...over,
});

const build = (trips: TripCardSource[], shopUrl = SHOP_URL) =>
  buildTripCarousel(trips, shopUrl, LABELS) as any;

/** 走訪整棵樹，收集所有 text 元件的字串 */
function textsOf(node: any, out: string[] = []): string[] {
  if (Array.isArray(node)) { node.forEach((n) => textsOf(n, out)); return out; }
  if (node && typeof node === 'object') {
    if (node.type === 'text' && typeof node.text === 'string') out.push(node.text);
    Object.values(node).forEach((v) => textsOf(v, out));
  }
  return out;
}

const bubblesOf = (msg: any): any[] => msg.contents.contents;

describe('buildTripCarousel — 張數與邊界', () => {
  it('空陣列 → null（呼叫端自己決定回什麼，不在這裡替它編一張卡）', () => {
    expect(buildTripCarousel([], SHOP_URL, LABELS)).toBeNull();
  });

  it('1 個行程 → carousel 有 1 個 bubble', () => {
    const msg = build([trip()]);
    expect(msg.type).toBe('flex');
    expect(msg.contents.type).toBe('carousel');
    expect(bubblesOf(msg)).toHaveLength(1);
  });

  it('剛好 12 個 → 12 個 bubble（LINE carousel 的上限，剛好塞滿）', () => {
    const msg = build(Array.from({ length: 12 }, (_, i) => trip({ slug: `t${i}` })));
    expect(bubblesOf(msg)).toHaveLength(12);
    expect(TRIP_CAROUSEL_MAX).toBe(12);
  });

  it('13 個 → 截到 12（超過會被 LINE 整包退回，那是「一張都收不到」）', () => {
    const msg = build(Array.from({ length: 13 }, (_, i) => trip({ slug: `t${i}` })));
    expect(bubblesOf(msg)).toHaveLength(TRIP_CAROUSEL_MAX);
  });

  it('altText 用呼叫端給的那一句（通知列會直接顯示它）', () => {
    expect(build([trip()]).altText).toBe(LABELS.altText);
  });
});

describe('buildTripCarousel — 封面圖只收 https', () => {
  it('沒有封面 → 整個 hero 省略，不塞佔位圖', () => {
    const [b] = bubblesOf(build([trip({ coverImageUrl: '' })]));
    expect(b.hero).toBeUndefined();
  });

  it('http 封面 → 也省略（LINE 的 image 元件只收 https，收下就整包 400）', () => {
    const [b] = bubblesOf(build([trip({ coverImageUrl: 'http://example.com/a.jpg' })]));
    expect(b.hero).toBeUndefined();
  });

  it('https 封面 → 放 hero，url 逐字相同且已 trim', () => {
    const [b] = bubblesOf(build([trip({ coverImageUrl: '  https://example.com/a.jpg  ' })]));
    expect(b.hero.type).toBe('image');
    expect(b.hero.url).toBe('https://example.com/a.jpg');
  });

  it('HTTPS 大寫也算 https（LINE 對 scheme 不分大小寫）', () => {
    const [b] = bubblesOf(build([trip({ coverImageUrl: 'HTTPS://example.com/a.jpg' })]));
    expect(b.hero).toBeDefined();
  });
});

describe('buildTripCarousel — 價格：不知道就不要編一個', () => {
  it('minPrice=null（沒有任何啟用方案）→ 顯示「價格洽詢」，不得出現 NT$ 0', () => {
    const texts = textsOf(bubblesOf(build([trip({ minPrice: null })])));
    expect(texts).toContain(LABELS.priceUnknown);
    expect(texts.join('|')).not.toContain('NT$ 0');
  });

  it('minPrice=2800 → 「最低 NT$ 2,800」（千分位）', () => {
    const texts = textsOf(bubblesOf(build([trip({ minPrice: 2800 })])));
    expect(texts).toContain('最低 NT$ 2,800');
  });

  it('minPrice=0 是真的免費，與「不知道」不同：顯示 NT$ 0 而不是價格洽詢', () => {
    const texts = textsOf(bubblesOf(build([trip({ minPrice: 0 })])));
    expect(texts).toContain('最低 NT$ 0');
    expect(texts).not.toContain(LABELS.priceUnknown);
  });

  it('NaN / Infinity 當作「不知道」，不得把 NaN 送給 LINE', () => {
    for (const bad of [NaN, Infinity]) {
      const texts = textsOf(bubblesOf(build([trip({ minPrice: bad })])));
      expect(texts).toContain(LABELS.priceUnknown);
      expect(texts.join('|')).not.toContain('NaN');
    }
  });
});

describe('buildTripCarousel — 副標：標語優先，其次簡介（#259／0089）', () => {
  it('標語有值 → 用標語，不用簡介', () => {
    const texts = textsOf(bubblesOf(build([
      trip({ tagline: '一天走完龜山島與 401 高地', summary: '搭船出海尋找飛旋海豚。' }),
    ])));
    expect(texts).toContain('一天走完龜山島與 401 高地');
    expect(texts).not.toContain('搭船出海尋找飛旋海豚。');
  });

  it('標語為空或只有空白 → 退回簡介（0089 之前的既有列都是空字串）', () => {
    for (const tagline of ['', '   ']) {
      const texts = textsOf(bubblesOf(build([trip({ tagline, summary: '簡介第一行' })])));
      expect(texts, `tagline=${JSON.stringify(tagline)} 沒有退回簡介`).toContain('簡介第一行');
    }
  });

  it('標語與簡介都空 → 不產生空字串 text 元件', () => {
    const texts = textsOf(bubblesOf(build([trip({ tagline: '', summary: '' })])));
    expect(texts.every((t) => t.trim().length > 0)).toBe(true);
  });

  it('標語超過 60 字 → 一樣截斷（截斷是對副標做的，不是對 summary 做的）', () => {
    const long = 'ゐ'.repeat(80);
    const texts = textsOf(bubblesOf(build([trip({ tagline: long, summary: '簡介' })])));
    const sub = texts.find((t) => t.startsWith('ゐ'))!;
    expect(sub.length).toBe(60);
    expect(sub.endsWith('…')).toBe(true);
  });

  it('summary 有值 → 取第一行當副標', () => {
    const texts = textsOf(bubblesOf(build([trip({ summary: '第一行\n第二行' })])));
    expect(texts).toContain('第一行');
    expect(texts).not.toContain('第二行');
  });

  it('summary 為空 → **不產生空字串 text 元件**（LINE 會回 may not be empty）', () => {
    const texts = textsOf(bubblesOf(build([trip({ summary: '' })])));
    expect(texts).not.toContain('');
    expect(texts.every((t) => t.length > 0)).toBe(true);
  });

  it('summary 只有空白 → 同樣不產生副標', () => {
    const texts = textsOf(bubblesOf(build([trip({ summary: '   \n  ' })])));
    expect(texts.every((t) => t.trim().length > 0)).toBe(true);
  });

  it('超過 60 字 → 截斷並補刪節號（不讓一張卡吃掉整個畫面）', () => {
    const long = 'あ'.repeat(80);
    const texts = textsOf(bubblesOf(build([trip({ summary: long })])));
    const sub = texts.find((t) => t.startsWith('あ'))!;
    expect(sub.length).toBe(60);
    expect(sub.endsWith('…')).toBe(true);
  });
});

describe('buildTripCarousel — 按鈕指向商店頁的該行程', () => {
  it('uri = {shopUrl}/trip/{slug}，label 用呼叫端給的 CTA', () => {
    const [b] = bubblesOf(build([trip({ slug: 'guishan-island' })]));
    expect(b.footer.contents[0].action).toEqual({
      type: 'uri', label: LABELS.bookCta, uri: `${SHOP_URL}/trip/guishan-island`,
    });
  });

  it('shopUrl 尾端多一個斜線也不會變成兩條斜線', () => {
    const [b] = bubblesOf(build([trip()], `${SHOP_URL}/`));
    expect(b.footer.contents[0].action.uri).toBe(`${SHOP_URL}/trip/guishan-island`);
  });

  it('slug 有需要跳脫的字元時做 encode（否則 LINE 會退回 invalid uri）', () => {
    const [b] = bubblesOf(build([trip({ slug: '龜山島 一日遊' })]));
    const { uri } = b.footer.contents[0].action;
    expect(uri).toBe(`${SHOP_URL}/trip/${encodeURIComponent('龜山島 一日遊')}`);
    expect(uri).not.toContain(' ');
  });

  it('有封面時 hero 也可以點，且與按鈕指到同一個地方（不是兩個目的地）', () => {
    const [b] = bubblesOf(build([trip({ coverImageUrl: 'https://example.com/a.jpg' })]));
    expect(b.hero.action.uri).toBe(b.footer.contents[0].action.uri);
  });
});

describe('buildTripCarousel — 整份 JSON 不含 LINE 會退回的東西', () => {
  it('混合資料的一整份 carousel：沒有空字串 text、沒有非 https 的 hero', () => {
    const msg = build([
      trip({ slug: 'a', summary: '', coverImageUrl: '', minPrice: null }),
      trip({ slug: 'b', summary: '有簡介', coverImageUrl: 'http://x/a.jpg', minPrice: 1500 }),
      trip({ slug: 'c', summary: '也有簡介', coverImageUrl: 'https://x/a.jpg', minPrice: 0 }),
    ]);
    const bubbles = bubblesOf(msg);
    expect(bubbles).toHaveLength(3);
    expect(textsOf(bubbles).every((t) => t.length > 0)).toBe(true);
    for (const b of bubbles) {
      if (b.hero) expect(String(b.hero.url).toLowerCase().startsWith('https://')).toBe(true);
    }
  });

  it('每個 bubble 都有 body 與 footer 按鈕（卡片不會有「按不動」的）', () => {
    for (const b of bubblesOf(build([trip({ slug: 'a' }), trip({ slug: 'b' })]))) {
      expect(b.type).toBe('bubble');
      expect(b.body.contents.length).toBeGreaterThan(0);
      expect(b.footer.contents[0].type).toBe('button');
      expect(b.footer.contents[0].action.uri).toMatch(/^https:\/\//);
    }
  });
});
