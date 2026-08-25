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
import { MAX_FLEX_CARDS, lineSettingsSchema } from '@/config/tenant-settings';
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
