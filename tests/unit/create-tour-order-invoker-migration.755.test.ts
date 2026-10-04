import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DIR = 'supabase/migrations';
const SUCCESSOR = '0136_issue_755_create_tour_order_invoker.sql';
const files = readdirSync(DIR).filter((name) => name.endsWith('.sql')).sort();

/** 取得某檔中 create_tour_order 定義的「型別簽名」（略過參數名稱）。 */
function definitionSignature(sql: string): string[] | null {
  const match = /create\s+or\s+replace\s+function\s+public\.create_tour_order\s*\(([\s\S]*?)\)\s*returns\s+uuid/i.exec(sql);
  if (!match) return null;
  return match[1].split(',').map((param) => {
    const parts = param.trim().split(/\s+/);
    return parts.slice(1).join(' ').replace(/^public\./, '').toLowerCase();
  });
}

function latestDefinitionBefore(name: string) {
  let latest: { file: string; types: string[] } | null = null;
  for (const file of files) {
    if (file >= name) break;
    const types = definitionSignature(readFileSync(`${DIR}/${file}`, 'utf8'));
    if (types) latest = { file, types };
  }
  return latest;
}

describe('#755 create_tour_order SECURITY INVOKER successor', () => {
  const sql = readFileSync(`${DIR}/${SUCCESSOR}`, 'utf8');
  const code = sql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');

  it('is the next migration after the previous highest one', () => {
    expect(files.at(-1)).toBe(SUCCESSOR);
    expect(files.at(-2)!.slice(0, 4)).toBe('0135');
  });

  it('only contains ALTER FUNCTION ... SECURITY INVOKER for the exact latest create_tour_order signature', () => {
    const latest = latestDefinitionBefore(SUCCESSOR);
    expect(latest?.file).toBe('0132_issue_42_seasonal_price_resolution.sql');
    expect(latest!.types).toHaveLength(10);

    const statements = code.split(';').map((s) => s.trim()).filter(Boolean);
    expect(statements).toHaveLength(1);
    const alter = /^alter\s+function\s+public\.create_tour_order\s*\(([\s\S]*?)\)\s+security\s+invoker$/i.exec(statements[0]);
    expect(alter).not.toBeNull();
    const types = alter![1].split(',').map((t) => t.trim().replace(/^public\./, '').toLowerCase());
    // 0132 的 int 與 ALTER 的 integer 是同一型別。
    const normalise = (list: string[]) => list.map((t) => (t === 'int' ? 'integer' : t));
    expect(normalise(types)).toEqual(normalise(latest!.types));
  });

  it('does not touch the function body, grants or any other object', () => {
    expect(code).not.toMatch(/create\s+(or\s+replace\s+)?function/i);
    expect(code).not.toMatch(/\b(grant|revoke|drop|insert|update|delete|set\s+search_path|security\s+definer)\b/i);
  });
});
