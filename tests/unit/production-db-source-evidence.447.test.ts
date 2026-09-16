import { describe, expect, it, vi } from 'vitest';

import {
  buildProductionDbSourceEvidence,
  buildProductionDbSourceEvidenceFromGithub,
} from '../../scripts/agents/production-db-source-evidence.mjs';
import { buildProductionDbReleasePlan } from '../../scripts/agents/production-db-release-plan.mjs';

const MAIN = 'a'.repeat(40);
const SQL = 'create table if not exists public.source_evidence_guard(id bigint primary key);';
const REPO_FILE = '0998_source_evidence_guard';
const PATH = `supabase/migrations/${REPO_FILE}.sql`;

function aliasMap() {
  return {
    schemaVersion: 1,
    entries: [{
      repoFile: REPO_FILE,
      classification: 'NOT_APPLIED',
      notAppliedReason: 'PENDING_APPLY',
      ledgerNames: [],
    }],
  };
}

function readCanonicalSql(path: string) {
  if (path !== PATH) throw new Error(`unexpected path ${path}`);
  return SQL;
}

function plan() {
  return buildProductionDbReleasePlan({
    releaseId: 'release-20260915-source',
    mainSha: MAIN,
    plannedAt: '2026-09-15T00:40:00Z',
    aliasMap: aliasMap(),
    readCanonicalSql,
  });
}

function green(id = 10, completedAt = '2026-09-15T00:42:00Z') {
  return {
    id,
    name: 'check',
    head_sha: MAIN,
    status: 'completed',
    conclusion: 'success',
    completed_at: completedAt,
    details_url: `https://github.com/smallwei0301/vibeaico-admin-rebuild/actions/runs/${id}`,
  };
}

describe('Production DB exact-main source evidence #447', () => {
  it('emits SOURCE_VERIFIED only from canonical plan bytes + latest exact-head green check', () => {
    expect(buildProductionDbSourceEvidence({
      plan: plan(),
      currentMainSha: MAIN,
      checkRuns: [green()],
      aliasMap: aliasMap(),
      readCanonicalSql,
    })).toMatchObject({
      status: 'SOURCE_VERIFIED',
      mainSha: MAIN,
      exactHeadCheck: { name: 'check', id: 10, conclusion: 'success' },
      migrationCount: 1,
      databaseMutationAuthorized: false,
    });
  });

  it('rejects a release plan after main advances', () => {
    expect(() => buildProductionDbSourceEvidence({
      plan: plan(),
      currentMainSha: 'd'.repeat(40),
      checkRuns: [green()],
      aliasMap: aliasMap(),
      readCanonicalSql,
    })).toThrow(/SOURCE_MAIN_MISMATCH/);
  });

  it('uses the latest exact-head check and does not let an older green run hide a newer failure', () => {
    const newerFailure = {
      ...green(11, '2026-09-15T00:43:00Z'),
      conclusion: 'failure',
    };
    expect(() => buildProductionDbSourceEvidence({
      plan: plan(),
      currentMainSha: MAIN,
      checkRuns: [green(10, '2026-09-15T00:42:00Z'), newerFailure],
      aliasMap: aliasMap(),
      readCanonicalSql,
    })).toThrow(/SOURCE_CHECK_NOT_GREEN/);
  });

  it('rejects stale or missing exact-head check identity', () => {
    expect(() => buildProductionDbSourceEvidence({
      plan: plan(), currentMainSha: MAIN,
      checkRuns: [{ ...green(), head_sha: 'd'.repeat(40) }],
      aliasMap: aliasMap(), readCanonicalSql,
    })).toThrow(/SOURCE_CHECK_MISSING/);
  });

  it('rejects canonical migration bytes that no longer match the locked plan', () => {
    expect(() => buildProductionDbSourceEvidence({
      plan: plan(), currentMainSha: MAIN, checkRuns: [green()], aliasMap: aliasMap(),
      readCanonicalSql: () => `${SQL}\nselect 1;`,
    })).toThrow(/MIGRATION_BYTES_MISMATCH/);
  });

  it('reconstructs main and checks from the live GitHub client instead of caller-provided verdicts', async () => {
    const getBranch = vi.fn(async () => ({ data: { commit: { sha: MAIN } } }));
    const listForRef = vi.fn();
    const github = {
      rest: { repos: { getBranch }, checks: { listForRef } },
      paginate: vi.fn(async (method: any) => {
        expect(method).toBe(listForRef);
        return [green(42)];
      }),
    };
    const result = await buildProductionDbSourceEvidenceFromGithub({
      github,
      owner: 'smallwei0301',
      repo: 'vibeaico-admin-rebuild',
      plan: plan(),
      aliasMap: aliasMap(),
      readCanonicalSql,
    });
    expect(result).toMatchObject({ status: 'SOURCE_VERIFIED', exactHeadCheck: { id: 42 } });
    expect(getBranch).toHaveBeenCalledWith({ owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', branch: 'main' });
    expect(github.paginate).toHaveBeenCalledWith(listForRef, expect.objectContaining({ ref: MAIN, check_name: 'check' }));
  });
});
