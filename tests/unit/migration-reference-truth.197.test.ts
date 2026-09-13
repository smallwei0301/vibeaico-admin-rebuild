import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(resolve(ROOT, dir))) {
    const rel = join(dir, entry);
    if (statSync(resolve(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(rel);
  }
  return out;
}

const canonicalNumbers = new Set(
  readdirSync(resolve(ROOT, 'supabase/migrations'))
    .filter((f) => f.endsWith('.sql'))
    .map((f) => f.slice(0, 4)),
);

/**
 * issue #197 建議處置第 3 步：修正指向不存在的 migration 的註解。
 *
 * 為什麼這件事會造成實害：一次 #28 的唯讀盤點依 `src/app/api/**` 的註解去查
 * `migration 0018`，在 `supabase/migrations/` 找不到，於是推論「欄位不存在 ⟹
 * 已合併的 PR #171 是壞的」。方法完全正確、前提也正確，**結論卻是錯的**——
 * `0018` 只存在於 historical overlay，那兩個欄位在線上一直都在。
 *
 * 所以這條測試**不禁止**提到 `0018`（它確實存在於 overlay，講它的歷史是有意義的），
 * 只要求：凡是提到一個 canonical 沒有的編號，同一段註解就必須講明它不在 canonical。
 * 不講的話，下一個人會重蹈那次誤判。
 */
describe('註解不得指向 canonical 不存在的 migration 而不加註（#197 第 3 步）', () => {
  const OVERLAY_HINTS = [
    '不在 `supabase/migrations/`',
    '沒有進 main',
    '只留在 local-only',
    'historical overlay',
    'local-migrations',
  ];

  it('canonical 目錄確實沒有 0018、而有 0079（本測試的前提）', () => {
    expect(canonicalNumbers.has('0018')).toBe(false);
    expect(canonicalNumbers.has('0079')).toBe(true);
  });

  it('0018 的欄位確實是 0079 在 canonical 落地的', () => {
    const sql = readFileSync(
      resolve(ROOT, 'supabase/migrations/0079_reconcile_category_bug_report_fields.sql'),
      'utf8',
    );
    for (const table of ['service_categories', 'product_categories']) {
      expect(sql).toContain(`alter table public.${table}`);
    }
    expect(sql).toContain('add column if not exists description');
    expect(sql).toContain('add column if not exists active');
  });

  it('每一處提到 0018 的註解都同時說明它不在 canonical', () => {
    const offenders: string[] = [];
    for (const file of walk('src')) {
      const source = readFileSync(resolve(ROOT, file), 'utf8');
      if (!/\b0018\b/.test(source)) continue;
      const lines = source.split('\n');
      lines.forEach((line, index) => {
        if (!/\b0018\b/.test(line)) return;
        // 以「提到 0018 的那一段註解」為單位判斷：取該行前後各 6 行的窗口。
        const window = lines.slice(Math.max(0, index - 6), index + 7).join('\n');
        if (!OVERLAY_HINTS.some((hint) => window.includes(hint))) {
          offenders.push(`${file}:${index + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders, '這些註解會讓下一個人查 canonical 找不到而誤判').toEqual([]);
  });
});
