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

function beforeLedger() {
  return [
    {
      version: '20260914060524',
      name: '0105_issue_44_traveler_risk_policies',
      created_by: 'existing-test-apply',
      idempotency_key: null,
    },
  ];
}

describe('Production DB exact-plan remote TEST validator #447', () => {
  it('hard-blocks Production and unknown targets before any network concern', () => {
    expect(() => assertTestReleaseTarget(PROD)).toThrow(/PRODUCTION_TARGET_FORBIDDEN/);
    expect(() => assertTestReleaseTarget('other-project')).toThrow(/CANONICAL_TEST_TARGET_REQUIRED/);
    expect(assertTestReleaseTarget(TEST)).toBe(TEST);
  });

  it('builds a trusted-main release plan from the current Production pending set', () => {
    const plan = buildPlan();
    expect(plan).toMatchObject({
      releaseId: RELEASE,
      mainSha: MAIN,
      productionProjectRef: PROD,
    });
    const names = plan.migrations.map((item:any) => item.repoFile);
    expect(names).toContain('0105_issue_44_traveler_risk_policies');
    expect(names).toContain('0109_issue_41_schema_precondition_assertions');
  });

  it('replays an already-ledgered TEST migration but inserts ledger identity only for an absent migration', () => {
    const plan = buildPlan();
    const aliasMap = JSON.parse(require('node:fs').readFileSync('supabase/ledger-alias-map.json', 'utf8'));
    const readCanonicalSql = (path:string) => require('node:fs').readFileSync(path, 'utf8');
    const built = buildAtomicTestReleaseValidationSql({
      plan,
      aliasMap,
      liveLedgerRows: beforeLedger(),
      readCanonicalSql,
    });
    const d105 = built.decisions.find((item:any) => item.repoFile === '0105_issue_44_traveler_risk_policies');
    const d109 = built.decisions.find((item:any) => item.repoFile === '0109_issue_41_schema_precondition_assertions');
    expect(d105).toMatchObject({ existedBefore: true });
    expect(d109).toMatchObject({ existedBefore: false });
    expect(built.sql).toContain('G3 exact-main validation 0105_issue_44_traveler_risk_policies');
    expect(built.sql).toContain('G3 exact-main validation 0109_issue_41_schema_precondition_assertions');
    expect(built.sql.match(/insert into supabase_migrations\.schema_migrations/g)?.length).toBe(1);
    expect(built.sql.indexOf('pg_try_advisory_xact_lock')).toBeLessThan(built.sql.indexOf('G3 exact-main validation 0105'));
  });

  it('fails closed on TEST ledger version collision before a mutable request is built', () => {
    const plan = buildPlan();
    const target = plan.migrations.find((item:any) => item.repoFile === '0109_issue_41_schema_precondition_assertions')!;
    const aliasMap = JSON.parse(require('node:fs').readFileSync('supabase/ledger-alias-map.json', 'utf8'));
    const readCanonicalSql = (path:string) => require('node:fs').readFileSync(path, 'utf8');
    expect(() => buildAtomicTestReleaseValidationSql({
      plan,
      aliasMap,
      liveLedgerRows: [
        ...beforeLedger(),
        { version: target.ledgerVersion, name: 'other_migration', created_by: null, idempotency_key: null },
      ],
      readCanonicalSql,
    })).toThrow(/TEST_LEDGER_VERSION_COLLISION/);
  });

  it('executes exactly one atomic TEST write between two read-only ledger captures and returns plan-bound evidence', async () => {
    const plan = buildPlan();
    const migration109 = plan.migrations.find((item:any) => item.repoFile === '0109_issue_41_schema_precondition_assertions')!;
    const calls:string[] = [];
    let readonly = 0;
    const fetchImpl = vi.fn(async (url:string|URL|Request, init?:RequestInit) => {
      const text = String(url);
      calls.push(text);
      if (text.endsWith('/database/query/read-only')) {
        readonly += 1;
        const rows = readonly === 1
          ? beforeLedger()
          : [...beforeLedger(), {
              version: migration109.ledgerVersion,
              name: '0109_issue_41_schema_precondition_assertions',
              created_by: 'vibeaico-g3-test-validator',
              idempotency_key: `g3:${RELEASE}:0109_issue_41_schema_precondition_assertions`,
            }];
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
    expect(evidence.migrations.find((item:any)=>item.repoFile.startsWith('0105_'))?.execution).toBe('REPLAY_VERIFIED');
    expect(evidence.migrations.find((item:any)=>item.repoFile.startsWith('0109_'))?.execution).toBe('APPLIED_VERIFIED');
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
