import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { inferMigrationRiskTier, pendingProductionMigrations } from '../../scripts/agents/production-db-release-plan.mjs';

describe('Issue #447 current-main pending migration classification', () => {
  // 0117／0118 套用 Production 後（#1091）main 已無 PENDING_APPLY；改讀釋出前 fixture 以保留分類斷言的受測對象。
  it('classifies each pending migration or explicitly fails closed on mixed-risk migrations', () => {
    const aliasMap = JSON.parse(readFileSync(resolve(process.cwd(), 'tests/fixtures/ledger-alias-map.pre-755-s0117-0118.json'), 'utf8'));
    const pending = pendingProductionMigrations(aliasMap);
    expect(pending.length).toBeGreaterThan(0);

    for (const repoFile of pending) {
      const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations', `${repoFile}.sql`), 'utf8');
      try {
        expect(['ADDITIVE', 'SCHEMA_REPAIR', 'AUTHZ', 'BACKFILL']).toContain(inferMigrationRiskTier(sql));
      } catch (error) {
        expect([
          'MIXED_RISK_MIGRATION_NOT_ADMITTED',
          'UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED',
        ]).toContain((error as { code?: string })?.code);
      }
    }
  });
});
