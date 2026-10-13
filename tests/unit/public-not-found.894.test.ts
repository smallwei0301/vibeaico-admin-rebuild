/** #894：旅客公開頁找不到資料／發生錯誤的中文說明、首頁 INSTANT 方案提示（原始碼斷言）。 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../../src/app/s/[shopCode]');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const files = ['not-found.tsx', 'error.tsx', 'requests/[orderId]/not-found.tsx'];

describe('#894 public shop not-found / error', () => {
  it('檔案存在', () => {
    for (const f of files) expect(existsSync(resolve(root, f)), f).toBe(true);
  });

  it('not-found 使用 i18n 並連回首頁', () => {
    const src = read('not-found.tsx');
    expect(src).toContain('t.notFound.genericTitle');
    expect(src).toContain('t.notFound.genericDescription');
    expect(src).not.toContain('t.notFound.title');
    expect(src).not.toContain('t.notFound.description');
    expect(src).toContain('href="/"');
    expect(src).not.toContain("'use client'");
  });

  it('error.tsx 為 client、有重試、不顯示 error.message', () => {
    const src = code('error.tsx');
    expect(src.trimStart().startsWith("'use client'")).toBe(true);
    expect(src).toContain('reset()');
    expect(src).toContain('t.error.retry');
    expect(src).not.toContain('error.message');
    expect(src).not.toMatch(/\{error[.}]/);
  });

  it('申請狀態頁 not-found 使用 status 文案，且 page.tsx 仍走 notFound()', () => {
    const src = read('requests/[orderId]/not-found.tsx');
    expect(src).toContain('t.status.notFoundTitle');
    expect(src).toContain('t.status.notFoundDescription');
    expect(src).toContain('href="/"');
    const page = read('requests/[orderId]/page.tsx');
    expect(page).toContain('if (!contact) notFound()');
    expect(page).toContain('if (!order) notFound()');
  });

  it('沒有更近的 not-found 攔截其他子路由', () => {
    expect(existsSync(resolve(root, 'plans/[planId]/not-found.tsx'))).toBe(false);
    expect(existsSync(resolve(root, 'trips/not-found.tsx'))).toBe(false);
  });

  it('tsx 沒有中文字面值', () => {
    for (const f of files) expect(code(f), f).not.toMatch(/[一-鿿]/);
  });

  it('首頁處理 bookingCta none', () => {
    const src = read('page.tsx');
    expect(src).toContain("plan.bookingCta === 'none'");
    expect(src).toContain('t.trips.instantHint');
  });
});
