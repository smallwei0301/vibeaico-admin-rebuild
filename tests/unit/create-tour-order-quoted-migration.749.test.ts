import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const FILE = 'supabase/migrations/0137_issue_749_create_tour_order_quoted.sql';
const sql = readFileSync(FILE, 'utf8');
const code = sql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');

describe('#749 0137 create_tour_order_quoted migration', () => {
  it('新增 11 參數（10 個同 create_tour_order + p_expected_total）並回傳 uuid', () => {
    const match = /create\s+or\s+replace\s+function\s+public\.create_tour_order_quoted\s*\(([\s\S]*?)\)\s*returns\s+uuid/i.exec(code);
    expect(match).not.toBeNull();
    const params = match![1].split(',').map((p) => p.trim().split(/\s+/)[0]);
    expect(params).toHaveLength(11);
    expect(params.at(-1)).toBe('p_expected_total');
  });

  it('SECURITY INVOKER、固定 search_path，且不是 security definer', () => {
    expect(code).toMatch(/language\s+plpgsql\s+security\s+invoker\s+set\s+search_path\s*=\s*public/i);
    expect(code).not.toMatch(/security\s+definer/i);
  });

  it('只授權 service_role，並先 revoke public／anon／authenticated', () => {
    expect(code).toMatch(/revoke\s+all\s+on\s+function\s+public\.create_tour_order_quoted\([\s\S]*?\)\s+from\s+public;/i);
    expect(code).toMatch(/from\s+anon,\s*authenticated;/i);
    const grants = code.match(/grant\s+execute[\s\S]*?;/gi) ?? [];
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatch(/to\s+service_role;$/i);
  });

  it('在同一交易內呼叫 create_tour_order 並以 PRICE_CHANGED（P0004）回滾，detail 帶現價', () => {
    expect(code).toMatch(/public\.create_tour_order\(/);
    expect(code).toMatch(/is\s+distinct\s+from\s+p_expected_total/i);
    expect(code).toMatch(/raise\s+exception\s+'PRICE_CHANGED'\s+using\s+errcode\s*=\s*'P0004'/i);
    expect(code).toMatch(/json_build_object\('unitPrice'/);
  });

  it('不覆寫既有 create_tour_order（只增不改）', () => {
    expect(code).not.toMatch(/create\s+or\s+replace\s+function\s+public\.create_tour_order\s*\(/i);
    expect(code).not.toMatch(/alter\s+function\s+public\.create_tour_order\s*\(/i);
  });
});
