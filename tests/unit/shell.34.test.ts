import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { combineSidebarCounts, currentUserName, sidebarCounts } from '@/services/shell';
import { getSetupStatus } from '@/services/settings';
import { MOCK_SIDEBAR_COUNTS, MOCK_USER, MOCK_SETUP_STATUS } from '@/mock';

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8');

describe('src/services/shell.ts — mock 分支（NEXT_PUBLIC_USE_MOCK 預設 true）', () => {
  it('sidebarCounts() 回目前業態的 MOCK_SIDEBAR_COUNTS', async () => {
    expect(await sidebarCounts()).toEqual(MOCK_SIDEBAR_COUNTS);
  });

  it('currentUserName() 回 MOCK_USER.name（不是 email）——mock demo 維持原行為', async () => {
    expect(await currentUserName()).toBe(MOCK_USER.name);
  });

  it('mock 的 setup 進度沿用既有 getSetupStatus()，非本次改動範圍', async () => {
    expect((await getSetupStatus()).percent).toBe(MOCK_SETUP_STATUS.percent);
  });
});

describe('combineSidebarCounts — 三個來源互相獨立，一個失敗不拖垮其他兩個', () => {
  const fulfilled = <T>(value: T): PromiseFulfilledResult<T> => ({ status: 'fulfilled', value });
  const rejected = (reason: unknown): PromiseRejectedResult => ({ status: 'rejected', reason });

  it('全部成功：三個 key 都在，數字對應各自來源', () => {
    const out = combineSidebarCounts(
      fulfilled({ totalElements: 4 }),
      fulfilled({ count: 2 }),
      fulfilled([{ unread: 3 }, { unread: 0 }, { unread: 1 }]),
    );
    expect(out).toEqual({ pendingBookingBadge: 4, pendingOrderBadge: 2, unreadChatBadge: 4 });
  });

  it('bookings 失敗：不出現 pendingBookingBadge key，另外兩個照常', () => {
    const out = combineSidebarCounts(
      rejected(new Error('boom')),
      fulfilled({ count: 2 }),
      fulfilled([{ unread: 1 }]),
    );
    expect(out).not.toHaveProperty('pendingBookingBadge');
    expect(out.pendingOrderBadge).toBe(2);
    expect(out.unreadChatBadge).toBe(1);
  });

  it('chat 失敗：不出現 unreadChatBadge key，另外兩個照常', () => {
    const out = combineSidebarCounts(
      fulfilled({ totalElements: 0 }),
      fulfilled({ count: 0 }),
      rejected(new Error('boom')),
    );
    expect(out).not.toHaveProperty('unreadChatBadge');
    expect(out.pendingBookingBadge).toBe(0);
    expect(out.pendingOrderBadge).toBe(0);
  });

  it('三個都失敗：回空物件（不是塞 0，也不是丟例外）', () => {
    const out = combineSidebarCounts(
      rejected(new Error('a')),
      rejected(new Error('b')),
      rejected(new Error('c')),
    );
    expect(out).toEqual({});
  });

  it('pendingTourOrderBadge 永遠不出現在 combineSidebarCounts 的輸出裡（tour_orders 尚無資料來源，見 #34）', () => {
    const out = combineSidebarCounts(
      fulfilled({ totalElements: 9 }),
      fulfilled({ count: 9 }),
      fulfilled([{ unread: 9 }]),
    ) as Record<string, unknown>;
    expect(out).not.toHaveProperty('pendingTourOrderBadge');
  });
});

/** 取出 `export function <name>(...) { ... }` 的完整函式本體（用大括號配對，不靠字串邊界瞎猜）。 */
function extractFunctionSource(src: string, name: string): string {
  const marker = `export function ${name}(`;
  const start = src.indexOf(marker);
  if (start === -1) throw new Error(`找不到 export function ${name}`);
  const firstBrace = src.indexOf('{', start);
  let depth = 0;
  for (let i = firstBrace; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`${name} 大括號沒配對`);
}

describe('src/services/shell.ts 原始碼 — real 分支不讀 MOCK_*，且刻意不生 pendingTourOrderBadge', () => {
  const src = read('src/services/shell.ts');

  it('sidebarCounts() 的 real 分支（adapt 的第二個參數）不出現任何 MOCK_ 前綴的 binding', () => {
    const fnSrc = extractFunctionSource(src, 'sidebarCounts');
    const realBranch = fnSrc.slice(fnSrc.indexOf('async () => {'));
    expect(realBranch).not.toMatch(/\bMOCK_[A-Z_]+\b/);
  });

  it('currentUserName() 的 real 分支（adapt 的第二個參數）不出現任何 MOCK_ 前綴的 binding', () => {
    const fnSrc = extractFunctionSource(src, 'currentUserName');
    const realBranch = fnSrc.slice(fnSrc.indexOf('async () => {'));
    expect(realBranch).not.toMatch(/\bMOCK_[A-Z_]+\b/);
  });

  it('combineSidebarCounts() 的函式本體沒有寫死 pendingTourOrderBadge 的數字（該 key 名只出現在函式尾的說明性註解裡，見上一個檔頭 comment）', () => {
    const fnSrc = extractFunctionSource(src, 'combineSidebarCounts');
    const codeOnly = fnSrc.replace(/\/\/.*$/gm, ''); // 拿掉行內 // 註解，只看真的程式碼
    expect(codeOnly).not.toContain('pendingTourOrderBadge');
  });

  it('currentUserName() 的 real 分支顯示 email，不是憑空生一個顯示名稱', () => {
    const fnSrc = extractFunctionSource(src, 'currentUserName');
    expect(fnSrc).toMatch(/me\.email/);
  });
});

describe('src/components/layout/Topbar.tsx — setupPercent/userName 的誠實 unknown 狀態（#34）', () => {
  const src = read('src/components/layout/Topbar.tsx');

  it('setupPercent 可以是 null（尚未知道），不是永遠 number', () => {
    expect(src).toMatch(/setupPercent:\s*number\s*\|\s*null/);
  });

  it('userName 可以是 null（尚未知道），不是永遠 string', () => {
    expect(src).toMatch(/userName:\s*string\s*\|\s*null/);
  });

  it('setupPercent 為 null 時畫面顯示「--」，不是生一個假百分比', () => {
    expect(src).toContain("setupPercent === null ? '--'");
  });

  it('userName 為 null 時退回 common.topbar.userFallback（不是 MOCK_USER.name）', () => {
    expect(src).toContain('userName ?? common.topbar.userFallback');
    expect(src).not.toContain('MOCK_USER');
  });
});

describe('src/components/layout/AppShell.tsx — Sidebar/Topbar 的外框值分 mock/real 兩條路（#34）', () => {
  const src = read('src/components/layout/AppShell.tsx');

  it('不再無條件把 MOCK_SIDEBAR_COUNTS 傳給 Sidebar', () => {
    expect(src).not.toMatch(/counts=\{MOCK_SIDEBAR_COUNTS\}/);
  });

  it('不再無條件把 MOCK_SETUP_STATUS.percent / MOCK_USER.name 傳給 Topbar', () => {
    expect(src).not.toMatch(/setupPercent=\{MOCK_SETUP_STATUS\.percent\}/);
    expect(src).not.toMatch(/userName=\{MOCK_USER\.name\}/);
  });

  it('real 分支呼叫 shell service（sidebarCounts / currentUserName）與 getSetupStatus，且各自獨立 catch', () => {
    expect(src).toContain('sidebarCounts().then(setCounts).catch(');
    expect(src).toContain('currentUserName().then(setUserName).catch(');
    expect(src).toContain('getSetupStatus().then(');
  });

  it('applyMockMode 只在 if (USE_MOCK) 區塊內呼叫（real 模式不會踩到 GUIDE 預設資料集）', () => {
    const idx = src.indexOf('applyMockMode(businessType)');
    expect(idx).toBeGreaterThan(-1);
    const before = src.slice(0, idx);
    const guardIdx = before.lastIndexOf('if (!USE_MOCK) return;');
    expect(guardIdx).toBeGreaterThan(-1);
    // 確認這個 guard 距離呼叫處不遠（同一個 effect 裡），不是別處無關的 guard。
    expect(idx - guardIdx).toBeLessThan(400);
  });
});
