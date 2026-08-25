/**
 * 靜態鎖：「目錄／訂單」是父層級概念，跨頁引用一律走 MODE_PRESETS（issue #29）
 * -----------------------------------------------------------------------------
 * 依據：`docs/integration/14-GAP-AUDIT.md` §8.13（擁有者 2026-08-25 的架構裁決）。
 *
 *   服務項目和預約管理這兩個應該是同一個父層級，按照三種模式使用三種子層級，
 *   例如嚮導就是行程相關，醫院目前還沒設計。其他功能有關係到服務時，應該是
 *   連結到父層級的服務項目。
 *
 * `MODE_PRESETS` 早就定義了 `catalogHref` / `ordersHref`，三種模式的值也填好了，
 * 但在 issue #29 之前**一個呼叫端都沒有**——於是嚮導租戶的儀表板／行事曆／商品
 * 訂單頁把他導去 `/tenant/bookings`、`/tenant/services`，那兩頁在他的
 * `hiddenNavKeys` 裡，按下去進到一個他選單裡根本不存在的頁面。
 *
 * ⚠️ 本檔存在的理由不是那十一個連結——那誰都會改。是 §7 反覆講的
 * 「補了一半」：`src/i18n/zh-TW/pages/dashboard.ts:53-54` 的註解證明有人早在做
 * 開店步驟時就發現過同一件事，用 `byMode()` 修掉那一處就走了，留下十幾個同型的。
 * 沒有鎖，下一個人會再種回來。所以這裡鎖的是**型態**，不是那幾行。
 *
 * 鎖三件事：
 *   1. 不變式：每種模式的 catalogHref / ordersHref 必須落在**該模式看得見的**
 *      側邊欄葉節點上（這是「嚮導不會走進死路」的機器可驗版本）。
 *   2. 路徑字面量：`src/app/tenant/**` 與 `src/i18n/zh-TW/pages/**` 底下，除了
 *      該路徑**自己的頁面檔**，不得出現 `/tenant/services`、`/tenant/bookings`、
 *      `/tenant/trips`、`/tenant/tour-orders`。
 *   3. 文案字面量：同樣範圍內不得寫死「服務項目」「預約管理」這兩個**父層級的
 *      名稱**（四個子層級頁面自己的檔案除外，見 OWNERS）。
 *
 * 頁面無法在 unit test 掛載（12 分冊 §3：單元測試不碰 DOM），靜態讀原始碼是
 * 14 分冊 §7.2「判準的第四層：可自動化的靜態鎖」指定的替代手法，與
 * tests/unit/category-action-order.28.test.ts 同一套做法。
 *
 * 「嚮導在瀏覽器裡真的不會走進死路」由 scripts/verify/mode-parent-links.cjs
 * 的 Playwright 實測補上（本檔只保證原始碼層面不會再長回來）。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

import { BUSINESS_TYPES, MODE_PRESETS, hiddenNavKeys } from '@/config/modes';
import { NAV, isGroup } from '@/config/nav';
import { catalogLabel, ordersLabel } from '@/i18n/zh-TW/nav';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const posix = (p: string) => p.split(sep).join('/');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/* -------------------------------------------------------------------------- */
/* 掃描範圍                                                                     */
/* -------------------------------------------------------------------------- */
/*
 * 只掃「跨頁」會發生的兩個地方：租戶頁面與頁面文案。
 * `src/config/nav.ts` 與 `src/config/modes.ts` **刻意不在範圍內**——那兩支正是
 * 路徑的單一真相來源，字面量本來就該寫在那裡。
 */
const SCAN_ROOTS = ['src/app/tenant', 'src/i18n/zh-TW/pages'];

function walk(rel: string): string[] {
  const abs = join(ROOT, rel);
  const out: string[] = [];
  for (const name of readdirSync(abs)) {
    const childRel = `${rel}/${name}`;
    if (statSync(join(ROOT, childRel)).isDirectory()) out.push(...walk(childRel));
    else if (/\.tsx?$/.test(name)) out.push(childRel);
  }
  return out;
}

const SCANNED = SCAN_ROOTS.flatMap(walk).map(posix).sort();

/* -------------------------------------------------------------------------- */
/* 註解不算違規：鎖的是「送到瀏覽器的連結與文字」                                  */
/* -------------------------------------------------------------------------- */
/*
 * 一段解釋「為什麼不准寫死 /tenant/bookings」的註解不會把任何人導去任何地方，
 * 而本檔要求的正是把理由寫在程式碼旁邊。所以先剝掉註解再比對——剝除時追蹤字串
 * 與樣板字面量，避免把 'https://…' 裡的 `//` 當成註解切掉。
 */
function stripComments(src: string): string {
  let out = '';
  let mode: 'code' | 'sq' | 'dq' | 'tpl' = 'code';
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    const d = src[i + 1];
    if (mode === 'code') {
      if (c === '/' && d === '/') {
        while (i < src.length && src[i] !== '\n') i += 1;
        out += '\n';
        continue;
      }
      if (c === '/' && d === '*') {
        i += 2;
        while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
        i += 1;
        continue;
      }
      if (c === "'") mode = 'sq';
      else if (c === '"') mode = 'dq';
      else if (c === '`') mode = 'tpl';
      out += c;
      continue;
    }
    if (c === '\\') {
      out += c + (src[i + 1] ?? '');
      i += 1;
      continue;
    }
    if ((mode === 'sq' && c === "'") || (mode === 'dq' && c === '"') || (mode === 'tpl' && c === '`')) {
      mode = 'code';
    }
    out += c;
  }
  return out;
}

const CODE = new Map(SCANNED.map((f) => [f, stripComments(read(f))]));

/* -------------------------------------------------------------------------- */
/* 「頁面自己」的定義                                                            */
/* -------------------------------------------------------------------------- */
/*
 * §8.13 規則 3：「頁面自己的檔案內連到自己不受此限」。
 *
 * 四個**子層級**頁面各自擁有自己的路徑與名稱：
 *   - 路徑 `/tenant/<seg>` 屬於 `src/app/tenant/<seg>/**` 與
 *     `src/i18n/zh-TW/pages/<seg>.ts`（含 `[id]` 之類的子路由）。
 *   - 「服務項目」「預約管理」這兩個**父層級名稱**屬於四個子層級頁面全體：
 *     它們就是這兩個概念本身，替自己命名不是「跨頁引用」。
 */
const SUB_LEVEL_SEGMENTS = ['services', 'bookings', 'trips', 'tour-orders'] as const;

const ownerFilesOf = (seg: string) => ({
  dir: `src/app/tenant/${seg}/`,
  i18n: `src/i18n/zh-TW/pages/${seg}.ts`,
});

const ownsRoute = (file: string, seg: string) => {
  const o = ownerFilesOf(seg);
  return file.startsWith(o.dir) || file === o.i18n;
};

/** 四個子層級頁面的檔案全體（父層級**名稱**的擁有者） */
const isSubLevelFile = (file: string) => SUB_LEVEL_SEGMENTS.some((seg) => ownsRoute(file, seg));

/* -------------------------------------------------------------------------- */
/* 文案例外清單（每一條都要有理由；沒有理由的例外＝把鎖關掉）                       */
/* -------------------------------------------------------------------------- */
/*
 * ⚠️ 這是 allow-list 不是 to-do list：列在這裡的檔案**目前**允許出現字面量，
 * 但下面三條的第 1、2、4 項是**已知同型缺口**，只是不在 issue #29 的施工白名單
 * 內（#29 明列的 5 處文案不含它們，且另有兩個 agent 正在同一個 worktree 施工）。
 * 排到修的時候把該行刪掉，鎖會立刻要求它改成佔位符。
 */
const WORD_EXCEPTIONS: { file: string; reason: string }[] = [
  {
    file: 'src/i18n/zh-TW/pages/ai-settings.ts',
    reason:
      'AI 知識庫來源清單「所有服務項目與價格」是同型的跨頁引用，issue #29 的 5 處'
      + '文案清單未列、不在本輪白名單；已回報待排。',
  },
  {
    file: 'src/i18n/zh-TW/pages/register.ts',
    reason:
      '註冊頁三選一卡片在**說明 LOCAL_SHOP 這個模式本身**（「用『服務項目』排預約」），'
      + '不是跨頁引用——此時使用者還沒有模式。永久例外。',
  },
  {
    file: 'src/i18n/zh-TW/pages/recurring-bookings.ts',
    reason:
      'issue #29 明列不在範圍：該頁對 GUIDE 隱藏。'
      + '（惟 CLINIC 看得到此頁且應為「診療項目」，已回報。）',
  },
];
const WORD_EXCEPTION_FILES = new Set(WORD_EXCEPTIONS.map((e) => e.file));

/* ========================================================================== */

describe('§8.13 父層級不變式：目錄／訂單一定落在該模式看得見的頁面', () => {
  it('每種模式的 catalogHref / ordersHref 都是該模式**沒有被隱藏**的側邊欄葉節點', () => {
    for (const bt of BUSINESS_TYPES) {
      const hidden = new Set(hiddenNavKeys(bt));
      const leaves = NAV.flatMap((e) => (isGroup(e) ? e.children : [e]));
      const visible = leaves.filter((l) => !hidden.has(l.key));

      for (const slot of ['catalog', 'orders'] as const) {
        const href = MODE_PRESETS[bt][`${slot}Href`];
        const key = MODE_PRESETS[bt][`${slot}NavKey`];

        const leaf = leaves.find((l) => l.key === key);
        expect(leaf, `${bt}.${slot}NavKey='${key}' 在 NAV 裡不存在`).toBeTruthy();
        expect(leaf!.href, `${bt}.${slot}Href 與 ${slot}NavKey 指的不是同一頁`).toBe(href);

        expect(
          visible.some((l) => l.href === href),
          `${bt} 的${slot === 'catalog' ? '目錄' : '訂單'} ${href} 不在 ${bt} 的側邊欄裡`
          + `（hiddenNavKeys: ${[...hidden].join(', ')}）——這正是嚮導按下去進到死路的成因`,
        ).toBe(true);
      }
    }
  });

  it('三種模式的目錄／訂單名稱各自不同，且不是寫死的「服務項目」', () => {
    expect(catalogLabel('LOCAL_SHOP')).toBe('服務項目');
    expect(catalogLabel('GUIDE')).toBe('行程與方案');
    expect(catalogLabel('CLINIC')).toBe('診療項目');

    expect(ordersLabel('LOCAL_SHOP')).toBe('預約列表');
    expect(ordersLabel('GUIDE')).toBe('旅遊訂單');
    // CLINIC 子層級的頁面仍借 LOCAL_SHOP 的 bookings 實作，但名稱已由
    // 14 分冊 §8.17（擁有者裁決）收斂為「掛號紀錄」。
    expect(ordersLabel('CLINIC')).toBe('掛號紀錄');
  });
});

describe('靜態鎖：跨頁不得寫死子層級路徑', () => {
  it('src/app/tenant/** 與 src/i18n/zh-TW/pages/** 只有頁面自己可以出現 /tenant/{services,bookings,trips,tour-orders}', () => {
    const violations: string[] = [];

    for (const file of SCANNED) {
      const code = CODE.get(file)!;
      for (const seg of SUB_LEVEL_SEGMENTS) {
        const literal = `/tenant/${seg}`;
        if (!code.includes(literal)) continue;
        if (ownsRoute(file, seg)) continue;
        const line = code.split('\n').findIndex((l) => l.includes(literal)) + 1;
        violations.push(
          `${file}（第 ${line} 行附近）寫死了 ${literal}`
          + ` → 請改成 MODE_PRESETS[businessType].${seg === 'services' || seg === 'trips' ? 'catalogHref' : 'ordersHref'}`,
        );
      }
    }

    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('掃描範圍不是空的（避免規則靜悄悄失效）', () => {
    expect(SCANNED.length).toBeGreaterThan(30);
    expect(SCANNED).toContain('src/app/tenant/dashboard/page.tsx');
    expect(SCANNED).toContain('src/i18n/zh-TW/pages/staff.ts');
  });
});

describe('靜態鎖：跨頁不得寫死「服務項目」「預約管理」', () => {
  it('父層級的名稱只有四個子層級頁面自己可以寫死，其餘要走 catalogLabel / ordersLabel 或 {catalog} 佔位符', () => {
    const violations: string[] = [];

    for (const file of SCANNED) {
      if (isSubLevelFile(file) || WORD_EXCEPTION_FILES.has(file)) continue;
      const code = CODE.get(file)!;
      for (const word of ['服務項目', '預約管理'] as const) {
        if (!code.includes(word)) continue;
        const line = code.split('\n').findIndex((l) => l.includes(word)) + 1;
        violations.push(
          `${file}（第 ${line} 行附近）寫死了「${word}」`
          + ' → 文案請寫 {catalog} / {orders} / {navBooking} 佔位符，'
          + '由頁面在 render 期以 resolveNavTerms(text, businessType) 展開',
        );
      }
    }

    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('例外清單的每一條都指向真實檔案，且都寫了理由', () => {
    for (const e of WORD_EXCEPTIONS) {
      expect(SCANNED, `例外 ${e.file} 已不在掃描範圍，請刪掉這條`).toContain(e.file);
      expect(e.reason.length, `例外 ${e.file} 沒有理由`).toBeGreaterThan(20);
    }
  });
});

describe('靜態鎖：快捷操作不得回到模組層 const', () => {
  /*
   * 模組求值早於 AppShell 呼叫 applyMockMode / 設定 BusinessTypeProvider，
   * 所以任何在模組層算出來的模式相依值都會**凍住錯的模式**
   * （CLAUDE.md「mode-aware mock data」的同一個陷阱）。
   * `QUICK_ACTIONS` 原本正是這樣一個 const，把兩條子層級路徑寫死在裡面。
   */
  const dashboard = read('src/app/tenant/dashboard/page.tsx');

  it('儀表板沒有模組層的 QUICK_ACTIONS 常數', () => {
    expect(dashboard).not.toMatch(/^const QUICK_ACTIONS/m);
  });

  it('快捷操作由 render 期帶著當下 businessType 解析', () => {
    expect(dashboard).toMatch(/function buildQuickActions\(businessType: BusinessType\)/);
    expect(dashboard).toMatch(/const businessType = useBusinessType\(\);/);
    expect(dashboard).toMatch(/const quickActions = buildQuickActions\(businessType\);/);
  });
});

/*
 * ---------------------------------------------------------------------------
 * 2026-08-25 追加：上面那組「跨頁不得寫死『服務項目』『預約管理』」的鎖，鎖的是
 * **側邊欄那兩個詞**。但同一種缺陷還有另一個形狀——寫死的是「預約」本身：
 *
 *   product-orders.ts:61  '本單為預約現場加購（至預約列表查看）'
 *
 * 連結是對的（走 `MODE_PRESETS[...].ordersHref`），**名字不對**：嚮導租戶的側邊欄
 * 裡叫「旅遊訂單」，畫面卻叫他去「預約列表」。issue #16 的驗收執行者在跑三模式
 * Playwright 時看到的——腳本檢查的是「連結有沒有落在該模式看得見的頁面」，
 * 落點是對的所以不會 MISS，是人看到文字才發現的。
 *
 * 值得記的是**為什麼上面那組鎖抓不到**：它鎖的是兩個具體字串。這一處用的是第三個
 * 字串，鎖自然照不到。字串黑名單只擋得住已經想到的那幾個詞——所以這裡改用正向斷言：
 * **跨頁引用一律走佔位符**，而不是再往黑名單加一個詞。
 */
describe('靜態鎖：跨頁引用一律走佔位符，不得寫死任何一種模式的說法', () => {
  /** 這些 i18n 檔會指涉「訂單／預約」這個父層級概念，必須用 {orders} / {navBooking}。 */
  const CROSS_PAGE_KEYS: Array<[string, string[]]> = [
    ['src/i18n/zh-TW/pages/product-orders.ts', ['fromBooking', 'relatedBooking']],
  ];

  for (const [file, keys] of CROSS_PAGE_KEYS) {
    for (const key of keys) {
      it(`${file} 的 ${key} 用佔位符而非寫死「預約」`, () => {
        const src = readFileSync(file, 'utf-8');
        const line = src.split('\n').find((l) => l.includes(`${key}:`));
        expect(line, `找不到 ${key}`).toBeTruthy();
        // 正向：必須含佔位符
        expect(line).toMatch(/\{orders\}|\{navBooking\}|\{catalog\}/);
        // 負向：佔位符之外不得再出現寫死的「預約」二字
        const withoutPlaceholders = line!.replace(/\{(orders|navBooking|catalog)\}/g, '');
        expect(
          withoutPlaceholders.replace(/\/\*.*/, ''),
          `${key} 仍寫死「預約」——嚮導租戶會看到他選單裡沒有的名字`,
        ).not.toMatch(/預約/);
      });
    }
  }

  it('頁面真的在 render 期展開這些佔位符（沒展開就會把 {orders} 原樣印給店家看）', () => {
    const page = readFileSync('src/app/tenant/product-orders/page.tsx', 'utf-8');
    expect(page).toContain('resolveNavTerms');
    // 三個使用點都要包起來，漏一個就會漏出大括號
    expect(page).toMatch(/resolveNavTerms\(t\.labels\.fromBooking,/);
    expect(page).toMatch(/resolveNavTerms\(f\.relatedBooking,/);
    const rawUses = page.match(/\{t\.labels\.fromBooking\}|\{f\.relatedBooking\}/g) ?? [];
    expect(rawUses, `有 ${rawUses.length} 處直接渲染未展開的字串`).toHaveLength(0);
  });
});
