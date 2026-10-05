import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { normalizeProductionDbImpactManifest } from '../../scripts/agents/production-db-impact-manifest.mjs';
import { CANONICAL_MIGRATION_IDENTITY, isCanonicalMigrationIdentity } from '../../scripts/agents/production-db-release-plan.mjs';
import * as identityModule from '../../scripts/agents/production-db-migration-identity.mjs';

// #777: impact manifest 與 release plan 共用同一個 migration 身分驗證器（不再各自一份寬鬆 regex）。
const root = process.cwd();
const read = (path: string) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
const entry = (repoFile: string) => ({ schemaVersion: 1, entries: [{ repoFile, impacts: [] }] });

function collectRepoFiles(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => collectRepoFiles(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'repoFile' && typeof v === 'string') out.push(v);
      else collectRepoFiles(v, out);
    }
  }
  return out;
}

describe('impact manifest uses the canonical migration identity validator (#777)', () => {
  it('release-plan re-exports the single shared validator', () => {
    expect(CANONICAL_MIGRATION_IDENTITY).toBe(identityModule.CANONICAL_MIGRATION_IDENTITY);
    expect(isCanonicalMigrationIdentity).toBe(identityModule.isCanonicalMigrationIdentity);
  });

  it('every repoFile in the committed manifest and alias map passes the canonical validator', () => {
    const manifest = read('supabase/production-db-impact-manifest.json');
    const aliasFiles = collectRepoFiles(read('supabase/ledger-alias-map.json'));
    const manifestFiles = collectRepoFiles(manifest);
    expect(manifestFiles.length).toBeGreaterThan(0);
    for (const f of [...manifestFiles, ...aliasFiles]) expect(isCanonicalMigrationIdentity(f), f).toBe(true);
    expect(() => normalizeProductionDbImpactManifest(manifest)).not.toThrow();
  });

  it.each(['0110_Issue-42', '0110_issue-42', '0110.foo', '0110', '110_issue_42', '0110_issue_42.sql', 'abcd_issue_42', '0110_issue 42'])(
    'rejects %s that the canonical regex rejects',
    (name) => {
      expect(isCanonicalMigrationIdentity(name)).toBe(false);
      expect(() => normalizeProductionDbImpactManifest(entry(name))).toThrow(/INVALID_IMPACT_REPO_FILE/);
    },
  );

  it('accepts a canonical identity', () => {
    expect(normalizeProductionDbImpactManifest(entry('0110_issue_42_plan_duration')).entries[0].repoFile).toBe('0110_issue_42_plan_duration');
  });
});
