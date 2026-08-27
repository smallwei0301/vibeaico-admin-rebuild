/**
 * 商品訂單頁的捏造付款連結（GitHub issue #28 家族第 ⑩ 筆，主導者複驗後追加）
 * -----------------------------------------------------------------------------
 * 判準與 #28 ②（bookings 的 `/pay/*` 死連結）相同：真實資料下 `payLink` 永遠是
 * 空字串（`src/lib/types.ts` 沒有這個欄位），那一半是誠實的。假的是**示範資料**
 * 那一半——`src/app/tenant/product-orders/page.tsx` 曾把 `payLink` 寫死成一個
 * 具體網址 `https://pay.vibeaico.com/o/PO20260820001`，複製鈕按下去會把它塞進
 * 剪貼簿並宣稱「付款連結已複製，可傳給顧客用手機刷卡」——示範店家是真實登入
 * 使用者看得到的，店家真的把這串網址傳給顧客，顧客打開會是一個不存在的頁面。
 *
 * 與 bookings 的同型缺陷不同的是：那裡可以誠實指向 issue #12（旅客
 * checkout，屆時會建 `/pay/*`）；商品訂單線上付款查過 `docs/integration/00`–
 * `13` 分冊與現有 GitHub issue（#9 只涵蓋「收款方式」設定頁本身、#12 明確限定
 * 行程／團次訂單）都沒有規劃它，所以這裡**不虛構一個追蹤項目**，只誠實標示
 * 「尚未建置」，複製鈕改為停用。
 *
 * ⚠️ 為什麼是「讀原始碼」而不是 render 測試：本專案沒有安裝
 *    @testing-library/react，vitest 單元測試跑在 node 環境
 *    （vitest.config.mts: environment: 'node'），無法掛載 React 元件。
 *    這裡測的是靜態不變條件，手法沿用 tests/unit/bug-report-wiring.28.test.ts。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { productOrdersPage as t } from '@/i18n/zh-TW/pages/product-orders';

const PAGE = 'src/app/tenant/product-orders/page.tsx';

const src = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf-8');

/** 去掉註解，避免「解釋為什麼不能這樣寫」的說明本身被誤判成違規程式碼 */
const withoutComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('商品訂單頁：示範資料不得再出現看起來可付款的具體網址', () => {
  const raw = src(PAGE);
  const code = withoutComments(raw);

  it('原始碼（含註解）完全不出現捏造的 pay.vibeaico.com 網址', () => {
    // 連註解裡都不留，避免同一個網址被複製貼上帶回實作
    expect(raw).not.toMatch(/pay\.vibeaico\.com/);
    expect(raw).not.toMatch(/PO20260820001/);
  });

  it('沒有任何看起來像 https:// 付款連結的字面量指派給 payLink', () => {
    expect(code).not.toMatch(/payLink:\s*['"]https?:\/\//);
  });

  it('示範資料仍標記「有一筆訂單原本需要線上付款」（保留代表性），但值不是網址', () => {
    const match = code.match(/const PAY_LINK_NOT_BUILT = (['"])(.*?)\1;/);
    expect(match, '找不到 PAY_LINK_NOT_BUILT 這個非網址的旗標常數').toBeTruthy();
    const value = match![2];
    expect(value.length).toBeGreaterThan(0);
    expect(value).not.toMatch(/^https?:\/\//);
    expect(code).toMatch(/payLink:\s*PAY_LINK_NOT_BUILT/);
  });

  it('複製付款連結的舊 handler（copyPayLink）已移除，不再有可觸發的假成功路徑', () => {
    expect(code).not.toMatch(/const copyPayLink = /);
    expect(code).not.toMatch(/navigator\.clipboard\.writeText\(o\.payLink\)/);
  });

  it('payLink 存在的訂單列，複製鈕改為 disabled 且文案指向 payLinkNotBuilt', () => {
    const block = code.match(/\{o\.payLink \? \(\s*<Button[\s\S]*?<\/Button>\s*\) : null\}/);
    expect(block, '找不到 payLink 對應的按鈕區塊').toBeTruthy();
    expect(block![0]).toMatch(/\bdisabled\b/);
    expect(block![0]).toMatch(/t\.actions\.payLinkNotBuilt/);
    // 舊的可點擊複製鈕不能再出現
    expect(block![0]).not.toMatch(/onClick=\{.*copyPayLink/);
  });
});

describe('商品訂單頁：文案不再承諾一件尚未建置的事（鐵則 1 + 00 分冊鐵則 12）', () => {
  it('payLinkNotBuilt 如實標示「尚未建置」，不承諾可以刷卡', () => {
    expect(t.actions.payLinkNotBuilt).toContain('尚未建置');
    expect(t.actions.payLinkNotBuilt).not.toContain('刷卡');
  });

  it('舊的 payLinkCopied／noPayLink／copyPayLinkManually 三個鍵已從字典移除', () => {
    const messages = t.messages as Record<string, unknown>;
    expect(messages.payLinkCopied).toBeUndefined();
    expect(messages.noPayLink).toBeUndefined();
    expect(messages.copyPayLinkManually).toBeUndefined();
  });

  it('全字典裡沒有任何字串同時提到「複製」與「刷卡」（=「複製連結可刷卡」這句承諾不得以任何形式存在）', () => {
    const walk = (value: unknown): string[] => {
      if (typeof value === 'string') return [value];
      if (typeof value === 'function') return [];
      if (Array.isArray(value)) return value.flatMap(walk);
      if (value && typeof value === 'object') {
        return Object.values(value as Record<string, unknown>).flatMap(walk);
      }
      return [];
    };
    const offending = walk(t).filter((s) => s.includes('複製') && s.includes('刷卡'));
    expect(offending).toEqual([]);
  });
});
