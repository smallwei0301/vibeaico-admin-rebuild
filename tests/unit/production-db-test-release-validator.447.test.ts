import { describe, expect, it, vi } from 'vitest';

import {
  assertTestReleaseTarget,
  buildAtomicTestReleaseValidationSql,
  buildTestReleasePlanFromCheckout,
  validateProductionDbReleasePlanOnTest,
} from '../../scripts/db/validate-production-db-release-on-test.mjs';

const MAIN = 'a'.repeat(40);
const PLANNED_AT = '2026-09-15T00:10:00Z';
const TEST = 'nmwhwngojosmagjuvxol';
const PROD = 'egehnijjpgijmccagxac';
const RELEASE = 'release-20260915-447';

function fakeGitRunner(command: string, args: string[]) {
  const gitArgs = args.slice(2);
  if (gitArgs[0] === 'fetch') return { status: 0, stdout: '', stderr: '' };
  if (gitArgs[0] === 'rev-parse' && (gitArgs[1] === 'HEAD' || gitArgs[1] === 'origin/main')) {
    return { status: 0, stdout: `${MAIN}\n`, stderr: '' };
  }
  return { status: 1, stdout: '', stderr: `unexpected git args: ${gitArgs.join(' ')}` };
}

function buildPlan() {
  return buildTestReleasePlanFromCheckout({
    releaseId: RELEASE,
    mainSha: MAIN,
    plannedAt: PLANNED_AT,
    repoRoot: process.cwd(),
    runner: fakeGitRunner as any,
  });
}

function replayMigration(plan:any) {
  if (!plan.migrations?.length) throw new Error('test fixture requires at least one current PENDING_APPLY migration');
  return plan.migrations[0];
}

function beforeLedger(plan:any) {
  const replay = replayMigration(plan);
  return [
    {
      version: '20260914060524',
      name: replay.repoFile,
      created_by: 'existing-test-apply',
      idempotency_key: null,
    },
  ];
}

function expectedPostLedger(plan:any) {
  const replay = replayMigration(plan);
  return [
    ...beforeLedger(plan),
    ...plan.migrations
      .filter((item:any) => item.repoFile !== replay.repoFile)
      .map((item:any) => ({
        version: item.ledgerVersion,
        name: item.repoFile,
        created_by: 'vibeaico-g3-test-validator',
        idempotency_key: `g3:${RELEASE}:${item.repoFile}`,
      })),
  ];
}

describe('Production DB exact-plan remote TEST validator #447', () => {
  it('hard-blocks Production and unknown targets before any network concern', () => {
    expect(() => assertTestReleaseTarget(PROD)).toThrow(/PRODUCTION_TARGET_FORBIDDEN/);
    expect(() => assertTestReleaseTarget('other-project')).toThrow(/CANONICAL_TEST_TARGET_REQUIRED/);
    expect(assertTestReleaseTarget(TEST)).toBe(TEST);
  });

  it('builds a trusted-main release plan from the current Production pending set without hardcoding migration names', () => {
    const plan = buildPlan();
    expect(plan).toMatchObject({
      releaseId: RELEASE,
      mainSha: MAIN,
      productionProjectRef: PROD,
    });
    expect(plan.migrations.length).toBeGreaterThan(0);
    expect(new Set(plan.migrations.map((item:any) => item.repoFile)).size).toBe(plan.migrations.length);
  });

  it('replays one already-ledgered TEST migration but inserts ledger identity for every other absent pending migration', () => {
    const plan = buildPlan();
    const replay = replayMigration(plan);
    const absent = plan.migrations.find((item:any) => item.repoFile !== replay.repoFile)!;
    expect(absent).toBeTruthy();
    const aliasMap = JSON.parse(require('node:fs').readFileSync('supabase/ledger-alias-map.json', 'utf8'));
    const readCanonicalSql = (path:string) => require('node:fs').readFileSync(path, 'utf8');
    const built = buildAtomicTestReleaseValidationSql({
      plan,
      aliasMap,
      liveLedgerRows: beforeLedger(plan),
      readCanonicalSql,
    });
    const replayDecision = built.decisions.find((item:any) => item.repoFile === replay.repoFile);
    const absentDecision = built.decisions.find((item:any) => item.repoFile === absent.repoFile);
    expect(replayDecision).toMatchObject({ existedBefore: true });
    expect(absentDecision).toMatchObject({ existedBefore: false });
    expect(built.sql).toContain(`G3 exact-main validation ${replay.repoFile}`);
    expect(built.sql).toContain(`G3 exact-main validation ${absent.repoFile}`);
    const absentCount = plan.migrations.length - 1;
    expect(built.sql.match(/insert into supabase_migrations\.schema_migrations/g)?.length).toBe(absentCount);
    expect(built.sql.indexOf('pg_try_advisory_xact_lock')).toBeLessThan(built.sql.indexOf(`G3 exact-main validation ${replay.repoFile}`));
  });

  it('fails closed on TEST ledger version collision before a mutable request is built', () => {
    const plan = buildPlan();
    const replay = replayMigration(plan);
    const target = plan.migrations.find((item:any) => item.repoFile !== replay.repoFile)!;
    const aliasMap = JSON.parse(require('node:fs').readFileSync('supabase/ledger-alias-map.json', 'utf8'));
    const readCanonicalSql = (path:string) => require('node:fs').readFileSync(path, 'utf8');
    expect(() => buildAtomicTestReleaseValidationSql({
      plan,
      aliasMap,
      liveLedgerRows: [
        ...beforeLedger(plan),
        { version: target.ledgerVersion, name: 'other_migration', created_by: null, idempotency_key: null },
      ],
      readCanonicalSql,
    })).toThrow(/TEST_LEDGER_VERSION_COLLISION/);
  });

  it('executes exactly one atomic TEST write between two read-only ledger captures and returns plan-bound evidence', async () => {
    const plan = buildPlan();
    const replay = replayMigration(plan);
    const calls:string[] = [];
    let readonly = 0;
    const fetchImpl = vi.fn(async (url:string|URL|Request, init?:RequestInit) => {
      const text = String(url);
      calls.push(text);
      if (text.endsWith('/database/query/read-only')) {
        readonly += 1;
        const rows = readonly === 1 ? beforeLedger(plan) : expectedPostLedger(plan);
        return new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      expect(text).toContain(`/projects/${TEST}/database/query`);
      const query = JSON.parse(String(init?.body)).query;
      expect(query).toContain('pg_try_advisory_xact_lock');
      return new Response('[]', { status: 200 });
    });

    const evidence = await validateProductionDbReleasePlanOnTest({
      plan,
      token: 'scoped-test-db-release-token',
      projectRef: TEST,
      sourceRunId: '34910000000',
      sourceRunAttempt: 1,
      repoRoot: process.cwd(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      runner: fakeGitRunner as any,
    });

    expect(calls.filter((url)=>url.endsWith('/database/query/read-only')).length).toBe(2);
    expect(calls.filter((url)=>url.endsWith('/database/query')).length).toBe(1);
    expect(evidence).toMatchObject({
      status: 'TEST_RELEASE_PLAN_VERIFIED',
      testProjectRef: TEST,
      mainSha: MAIN,
      planDigest: plan.planDigest,
      releaseId: RELEASE,
      sourceRunId: '34910000000',
      sourceRunAttempt: 1,
      testMutationPerformed: true,
      productionMutationPerformed: false,
      databaseMutationAuthorized: false,
    });
    expect(evidence.migrations.find((item:any)=>item.repoFile === replay.repoFile)?.execution).toBe('REPLAY_VERIFIED');
    for (const item of evidence.migrations.filter((item:any)=>item.repoFile !== replay.repoFile)) {
      expect(item.execution).toBe('APPLIED_VERIFIED');
    }
  });

  it('rejects Production target with zero network calls even when a token is supplied', async () => {
    const fetchImpl = vi.fn();
    await expect(validateProductionDbReleasePlanOnTest({
      plan: buildPlan(),
      token: 'token',
      projectRef: PROD,
      sourceRunId: '1',
      sourceRunAttempt: 1,
      repoRoot: process.cwd(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      runner: fakeGitRunner as any,
    })).rejects.toThrow(/PRODUCTION_TARGET_FORBIDDEN/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
