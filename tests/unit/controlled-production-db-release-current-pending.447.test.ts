import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { inferMigrationRiskTier, pendingProductionMigrations } from '../../scripts/agents/production-db-release-plan.mjs';

describe('Issue #447 current-main pending migration classification', () => {
  it('derives pending set from the alias map instead of hard-coding migration numbers', () => {
    const aliasMap = JSON.parse(readFileSync(resolve(process.cwd(), 'supabase/ledger-alias-map.json'), 'utf8'));
    const pending = pendingProductionMigrations(aliasMap);
    expect(pending.length).toBeGreaterThan(0);
    for (const repoFile of pending) {
      const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations', `${repoFile}.sql`), 'utf8');
      expect(['ADDITIVE', 'SCHEMA_REPAIR', 'AUTHZ', 'BACKFILL']).toContain(inferMigrationRiskTier(sql));
    }
  });
});
