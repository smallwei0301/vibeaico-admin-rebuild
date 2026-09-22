// tests/unit/e2e-target-guard.27.test.ts
//
// 把「E2E 目標資料庫安全鎖」本身釘住（Issue #27 驗收）。
//
// 為什麼安全鎖也要有測試：這支鎖唯一的工作就是在指錯資料庫時擋下來，而那個
// 情境**平常永遠不會發生**——也就是說它壞掉了不會有任何人發現，直到真的有一
// 輪驗收打進正式資料庫為止。所以「拒絕 Production／放行 TEST」必須由一支每次
// `npm test` 都會跑的測試證明，而不是靠讀程式碼相信它。

import { describe, expect, it } from 'vitest';
import {
  PRODUCTION_SUPABASE_PROJECT_REF,
  TEST_SUPABASE_PROJECT_REF,
  assertTestSupabaseTarget,
  isAdmittedLocalIsolatedTarget,
  projectRefFromCookieNames,
  projectRefFromSupabaseUrl,
} from '../e2e-target-guard';

const TEST_COOKIE = `sb-${TEST_SUPABASE_PROJECT_REF}-auth-token`;
const PROD_COOKIE = `sb-${PRODUCTION_SUPABASE_PROJECT_REF}-auth-token`;

function localEvidence(overrides: Record<string, string | undefined> = {}) {
  return {
    testProfile: 'LOCAL_ISOLATED',
    testSupabaseUrl: 'http://127.0.0.1:54321',
    localProjectId: 'vibeaico-681-a',
    testEnvId: 'local-pr-681-a',
    ...overrides,
  };
}

describe('projectRefFromCookieNames', () => {
  it('從 sb-<ref>-auth-token 取出專案 ref', () => {
    expect(projectRefFromCookieNames(['other', TEST_COOKIE])).toBe(TEST_SUPABASE_PROJECT_REF);
  });

  it('token 過大被切成 .0/.1 分片時也認得', () => {
    expect(projectRefFromCookieNames([`${PROD_COOKIE}.0`, `${PROD_COOKIE}.1`]))
      .toBe(PRODUCTION_SUPABASE_PROJECT_REF);
  });

  it('找不到 auth cookie → null（目標不明）', () => {
    expect(projectRefFromCookieNames([])).toBeNull();
    expect(projectRefFromCookieNames(['sb-foo-bar', 'session'])).toBeNull();
  });

  it('同時出現兩個不同 ref → null（自相矛盾，一樣不可信）', () => {
    expect(projectRefFromCookieNames([TEST_COOKIE, PROD_COOKIE])).toBeNull();
  });
});

describe('projectRefFromSupabaseUrl', () => {
  it('取 https://<ref>.supabase.co 的 ref', () => {
    expect(projectRefFromSupabaseUrl(`https://${TEST_SUPABASE_PROJECT_REF}.supabase.co`))
      .toBe(TEST_SUPABASE_PROJECT_REF);
  });

  it('空值或壞掉的 URL → null', () => {
    expect(projectRefFromSupabaseUrl(undefined)).toBeNull();
    expect(projectRefFromSupabaseUrl('')).toBeNull();
    expect(projectRefFromSupabaseUrl('not a url')).toBeNull();
  });
});

describe('assertTestSupabaseTarget', () => {
  it('TEST 專案 → 放行', () => {
    expect(() => assertTestSupabaseTarget(TEST_SUPABASE_PROJECT_REF, 'https://preview.example'))
      .not.toThrow();
  });

  it('只放行兩種 workflow-issued LOCAL_ISOLATED loopback identity', () => {
    const prLocal = localEvidence();
    const schemaLocal = localEvidence({
      localProjectId: 'schema-proof-35718956244-1',
      testEnvId: 'local-schema-35718956244',
    });
    expect(isAdmittedLocalIsolatedTarget('127', prLocal)).toBe(true);
    expect(isAdmittedLocalIsolatedTarget('127', schemaLocal)).toBe(true);
    expect(() => assertTestSupabaseTarget('127', 'local admin', prLocal)).not.toThrow();
    expect(() => assertTestSupabaseTarget('127', 'schema local admin', schemaLocal)).not.toThrow();
  });

  it('拒絕偽裝成 LOCAL_ISOLATED 的 remote、Production、缺失或不配對 evidence', () => {
    const rejected = [
      ['remote URL', 'remote', localEvidence({ testSupabaseUrl: 'https://remote.example' })],
      ['Production ref', PRODUCTION_SUPABASE_PROJECT_REF, localEvidence()],
      ['missing project identity', '127', localEvidence({ localProjectId: undefined })],
      ['mismatched slot', '127', localEvidence({ testEnvId: 'local-pr-681-b' })],
      ['mismatched ref', 'localhost', localEvidence()],
      ['URL credentials', '127', localEvidence({ testSupabaseUrl: 'http://user:pass@127.0.0.1:54321' })],
      ['URL query', '127', localEvidence({ testSupabaseUrl: 'http://127.0.0.1:54321?unsafe=1' })],
    ] as const;
    for (const [, ref, evidence] of rejected) {
      expect(isAdmittedLocalIsolatedTarget(ref, evidence)).toBe(false);
      expect(() => assertTestSupabaseTarget(ref, 'untrusted target', evidence)).toThrow();
    }
  });

  it('Production 專案 → 硬失敗，訊息要指名正式資料庫', () => {
    let thrown: unknown;
    try {
      assertTestSupabaseTarget(PRODUCTION_SUPABASE_PROJECT_REF, 'https://vibeaico.com');
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain('錯誤的資料庫');
    expect(message).toContain('已中止');
    expect(message).toContain(PRODUCTION_SUPABASE_PROJECT_REF);
    expect(message).toContain('正式 Production 資料庫');
    expect(message).toContain(TEST_SUPABASE_PROJECT_REF);
  });

  it('不認得的專案 → 也硬失敗（白名單制，不是黑名單）', () => {
    expect(() => assertTestSupabaseTarget('someotherprojectref', 'https://elsewhere.example'))
      .toThrow(/錯誤的資料庫/);
  });

  it('判定不出來（null）→ 硬失敗，且說清楚是「目標不明」', () => {
    expect(() => assertTestSupabaseTarget(null, 'https://preview.example'))
      .toThrow(/無法確定/);
  });
});
