/**
 * 「頁面／元件直接吃 mock 常數」靜態鎖 — issue #34（乙）
 * -----------------------------------------------------------------------------
 * 守的 bug：`AppShell` 無條件把 `MOCK_SIDEBAR_COUNTS` / `MOCK_SETUP_STATUS.percent` /
 * `MOCK_USER.name` 送進畫面，**完全沒有 USE_MOCK 分支**。`NEXT_PUBLIC_USE_MOCK=false`
 * 之後它不會報錯、不會變空，只是繼續顯示同一組數字——而且沒有任何測試會紅，
 * 因為測試也拿得到同一組常數（14 分冊 §10.2）。
 *
 * 本檔鎖兩件事：
 *
 *   ① **MOCK_* 常數的直接 import**（issue #34 與 14 分冊 §10.4 第 4 點的字面範圍）：
 *      `src/app/tenant/**` 與 `src/components/**` 底下，凡 `import { MOCK_… } from '@/mock'`
 *      的每一處都要在 `ALLOWED` 白名單裡，且**每一條都有理由與歸屬 issue**。
 *      新增一處而不登記 → 紅。
 *
 *   ② **AppShell 那三個值不得再直接吃 mock 常數**（變異測試的目標）：
 *      把 real 分支改回 `counts={MOCK_SIDEBAR_COUNTS}` 之類的寫法就會紅。
 *
 * ⚠️ **本檔沒有覆蓋到的（誠實列出，不要以為打勾就代表全站乾淨）**：
 *   · 頁面**自己宣告**的假資料常數（`const MOCK_BLOCK_TIMES = …`、
 *     `const CAMPAIGNS_LOCAL_SHOP = …` 這種），它們不經過 `@/mock`，本檔的
 *     import 掃描抓不到。`block-times` 就是這型（issue #34 內文把它寫成
 *     「直接 import MOCK_*」，實際查證 `src/app/tenant/block-times/page.tsx`
 *     沒有任何 `from '@/mock'`）。
 *   · `byMode()` 取用的頁內假資料：`byMode` 不是 MOCK_* 常數，但它承載的
 *     正是同一種東西。第 ② 組 `BYMODE_IMPORTERS` 只是**盤點快照**（防止再長出
 *     新的一處），**不是核可清單**——其中幾處目前沒有歸屬 issue，見該常數的註解。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SCAN_DIRS = ['src/app/tenant', 'src/components'];

/* -------------------------------------------------------------------------- */
/* 掃描                                                                        */
/* -------------------------------------------------------------------------- */

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

const FILES = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)))
  .map((f) => relative(ROOT, f).replace(/\\/g, '/'))
  .sort();

/** 檔案裡所有 `import { … } from '@/mock'` 的具名 binding（含 `as` 前的原名） */
function mockImportBindings(file: string): string[] {
  const src = readFileSync(join(ROOT, file), 'utf-8');
  const bindings: string[] = [];
  const re = /import\s*\{([^}]*)\}\s*from\s*['"]@\/mock['"]/g;
  for (const m of src.matchAll(re)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0].trim();
      if (name) bindings.push(name);
    }
  }
  return bindings;
}

const mockConstImporters = new Map<string, string[]>();
const byModeImporters: string[] = [];
for (const file of FILES) {
  const bindings = mockImportBindings(file);
  if (bindings.length === 0) continue;
  const consts = bindings.filter((b) => b.startsWith('MOCK_'));
  if (consts.length > 0) mockConstImporters.set(file, consts.sort());
  if (bindings.some((b) => b === 'byMode')) byModeImporters.push(file);
}

/* -------------------------------------------------------------------------- */
/* ① MOCK_* 常數白名單 —— 每一條都要有理由與歸屬 issue                          */
/* -------------------------------------------------------------------------- */

type Allowance = { bindings: string[]; reason: string; owner: string };

const ALLOWED: Record<string, Allowance> = {
  'src/components/layout/AppShell.tsx': {
    bindings: ['MOCK_TENANTS'],
    reason:
      '示範店家清單：real 模式下附在「自己的店」後面，選到才把整站資料源臨時切回 '
      + 'src/mock（setDemoMode）。有明確分支，不是無條件吃假資料。',
    owner: '#34（本 issue 建立分支；示範店家機制是刻意設計，長期保留、不拆）',
  },
  'src/app/tenant/customers/page.tsx': {
    bindings: ['MOCK_CUSTOMERS'],
    reason:
      '標籤下拉的選項從假顧客推導：real 模式下會列出這家店根本沒有的標籤。',
    owner: '#7（營運頁假成功批次接線，customers 那一列）',
  },
};

describe('靜態鎖：src/app/tenant/** 與 src/components/** 不得直接吃 MOCK_* 常數', () => {
  it('每一處直接 import MOCK_* 的位置都在白名單裡（新增一處未登記即紅）', () => {
    const undeclared = [...mockConstImporters.entries()]
      .filter(([file]) => !ALLOWED[file])
      .map(([file, consts]) => `${file} → ${consts.join(', ')}`);
    expect(
      undeclared,
      '新的「頁面／元件直接吃 MOCK_* 常數」：這個模式在 USE_MOCK=false 之後'
      + '不會報錯，只會安靜地顯示假資料。要嘛改走 src/services/*，'
      + '要嘛登記進 ALLOWED 並寫上理由與歸屬 issue。',
    ).toEqual([]);
  });

  it('白名單登記的 binding 與實際相符（多 import 一個常數也要紅）', () => {
    for (const [file, allowance] of Object.entries(ALLOWED)) {
      const actual = mockConstImporters.get(file);
      expect(actual, `${file}：白名單有登記，但檔案已不再 import MOCK_*，請把這條刪掉`)
        .toBeDefined();
      expect(actual, `${file}：實際 import 的 MOCK_* 與白名單登記不一致`)
        .toEqual([...allowance.bindings].sort());
    }
  });

  it('白名單每一條都有理由與歸屬 issue（沒有歸屬的不准進白名單）', () => {
    for (const [file, allowance] of Object.entries(ALLOWED)) {
      expect(allowance.reason.trim().length, `${file}：缺理由`).toBeGreaterThan(10);
      expect(allowance.owner, `${file}：缺歸屬 issue（要寫成 #<編號>）`).toMatch(/#\d+/);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* ② AppShell 的三個外框值                                                     */
/* -------------------------------------------------------------------------- */

const APP_SHELL = 'src/components/layout/AppShell.tsx';
const appShellSrc = readFileSync(join(ROOT, APP_SHELL), 'utf-8');
/** 去掉註解：本檔的註解本來就會提到那三個常數名 */
const appShellCode = appShellSrc
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

describe('AppShell：外框三值必須走 service，不得直接吃 mock 常數', () => {
  it.each([
    ['MOCK_SIDEBAR_COUNTS', 'counts'],
    ['MOCK_SETUP_STATUS', 'setupPercent'],
    ['MOCK_USER', 'userName'],
  ])('%s 不得出現在 AppShell（它餵的是 %s）', (constName) => {
    expect(
      appShellCode,
      `${constName} 又回到 AppShell 了：這三個值每一頁都會顯示、不需要任何互動，`
      + '寫死的話 USE_MOCK=false 之後不會有任何跡象。改回 src/services/* 取得。',
    ).not.toContain(constName);
  });

  it.each([
    ['counts', 'sidebarCounts'],
    ['setupPercent', 'getSetupStatus'],
    ['userName', 'currentUser'],
  ])('%s 由 service 函式 %s() 供給', (_prop, fn) => {
    expect(appShellCode).toContain(`${fn}(`);
  });

  it('三個值的初始狀態是 null（「還不知道」），不可先給 0 或任何百分比', () => {
    for (const state of ['counts', 'setupPercent', 'userName']) {
      const m = appShellCode.match(
        new RegExp(`const \\[${state}, set\\w+\\] = React\\.useState[^(]*\\(([^)]*)\\)`),
      );
      expect(m, `AppShell 找不到 ${state} 的 useState`).not.toBeNull();
      expect(m![1].trim(), `${state} 的初始值必須是 null（載入中≠0）`).toBe('null');
    }
  });
});

/* -------------------------------------------------------------------------- */
/* ③ byMode 頁內假資料的盤點快照（**不是**核可清單）                            */
/* -------------------------------------------------------------------------- */

/**
 * `byMode()` 不是 MOCK_* 常數，所以不在 issue #34 的白名單規則裡；但它承載的
 * 是同一種東西——頁內假資料。這份清單只是**快照**，作用是「再長出新的一處就紅」，
 * 不代表以下每一處都被核可。歸屬狀況（2026-08-25 盤點）：
 *
 *   #7 營運頁接線批次：campaigns / marketing / staff / shop-design / customers
 *   有明確分支、屬正常用法：dashboard（showSampleData＝USE_MOCK||isDemoMode）、
 *     services 與 recurring-bookings（service 的 mock 分支回 null 時才用頁內資料）
 *   **未歸屬**（本輪盤出，已回報，尚無 issue）：
 *     bookings（BOOKING_EXTRAS_* 的「已收金額」——schema 沒有 paid_amount 欄位，
 *       14 分冊 §6.14「沒有做的事」已記，但沒有 issue 認領）
 *     coupons（COUPON_EXTRAS_*）、membership-levels（LEVEL_EXTRAS_*）
 *   這三處是「假欄位混在真資料列裡」，比整頁假資料更難發現，需要一個 issue。
 */
const BYMODE_IMPORTERS = [
  'src/app/tenant/bookings/page.tsx',
  // campaigns / marketing 已於 issue #7 (乙) 接線：頁內 byMode 假資料整組搬進
  // src/services/campaigns.ts、src/services/marketing.ts 的 mock 分支，頁面不再 import byMode。
  'src/app/tenant/coupons/page.tsx',
  'src/app/tenant/dashboard/page.tsx',
  'src/app/tenant/membership-levels/page.tsx',
  'src/app/tenant/recurring-bookings/page.tsx',
  'src/app/tenant/services/page.tsx',
  // 2026-08-26（issue #7 乙）：shop-design 頁移出這份快照——它的公開頁內容
  // 已改吃 `tenant_settings.branding`（migration 0021），三種業態的示範內容
  // 移進 `services/settings.ts` 的 mock 分支，頁面不再 import byMode。
  // 快照守的是「不得再增加」，少一個是這條鎖要的方向。
  'src/app/tenant/staff/page.tsx',
];

describe('盤點快照：byMode() 頁內假資料的使用位置不得再增加', () => {
  it('新增一個 byMode 頁面即紅（要先想清楚 real 模式下那些欄位要顯示什麼）', () => {
    expect(byModeImporters.sort()).toEqual([...BYMODE_IMPORTERS].sort());
  });
});
