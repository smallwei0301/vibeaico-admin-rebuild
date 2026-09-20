import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildReviewBundleManifest, assertReviewBundle } from '../../scripts/agents/production-db-review-bundle.mjs';
import { releasePlanDigestOf } from '../../scripts/agents/production-db-release-plan.mjs';
import { releaseEvidenceDigestOf } from '../../scripts/agents/production-db-release-preflight.mjs';

function fixture(): any {
  const identity = {
    schemaVersion: 1, releaseId: 'release-20260920-review', mainSha: 'a'.repeat(40),
    repository: 'smallwei0301/vibeaico-admin-rebuild', productionProjectRef: 'egehnijjpgijmccagxac', riskTier: 'ADDITIVE',
  };
  const plan: any = { ...identity, plannedAt: '2026-09-20T00:00:00.000Z', migrations: [{
    repoFile: '0126_example', path: 'supabase/migrations/0126_example.sql', sha256: 'c'.repeat(64), ledgerVersion: '20260920000000', riskTier: 'ADDITIVE',
  }] };
  plan.planDigest = releasePlanDigestOf(plan);
  const evidence = { mainSha: identity.mainSha, planDigest: plan.planDigest, databaseMutationAuthorized: false };
  const packet = { ...identity, planDigest: plan.planDigest,
    source: { ...evidence, status: 'SOURCE_VERIFIED' },
    consistency: { ...evidence, status: 'CONSISTENCY_VERIFIED', unexplainedDifferences: 0, observedAt: '2026-09-20T00:01:00Z' },
    test: { ...evidence, status: 'TEST_VERIFIED', sourceRunId: '34930000002', sourceRunAttempt: 1, executedTests: 12, cleanup: 'PASSED', policySkip: false },
    recovery: { ...evidence, status: 'RECOVERY_VERIFIED', storageObjectsCovered: false }, data: { note: 'review only' },
  };
  const args: any = { plan, packet, releaseId: identity.releaseId, mainSha: identity.mainSha, repository: identity.repository,
    readinessRunId: '34930000001', g3RunId: '34930000002', runId: '34930000003', runAttempt: '2' };
  args.manifest = buildReviewBundleManifest(args);
  args.run = { id: 34930000003, run_attempt: 2, repository: { full_name: identity.repository },
    name: 'production-db-release-orchestrator', path: '.github/workflows/production-db-release-orchestrator.yml',
    event: 'workflow_dispatch', head_branch: 'main', head_sha: identity.mainSha, status: 'completed', conclusion: 'success' };
  args.jobs = ['admission', 'collect', 'prepare', 'execute'].map((name, index) => ({
    id: 100 + index, name, run_id: args.run.id, run_attempt: 2, status: 'completed', conclusion: index < 2 ? 'success' : 'skipped',
  }));
  args.jobs.push(...['g2 / read-only-three-way', 'g4-backup / capture', 'g4-restore / local-logical-restore-canary'].map((name, index) => ({
    id: 200 + index, name, run_id: args.run.id, run_attempt: 2, status: 'completed', conclusion: 'success',
  })));
  return args;
}

// Independent canonical digest oracle, including every field.
function canonical(value: any): any {
  return Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
}
const hash = (value: any) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

describe('collect review bundle #589', () => {
  it('returns a read-only manifest with full canonical hashes and validates live provenance without changing inputs', () => {
    const f = fixture();
    const before = JSON.stringify(f);
    expect(f.manifest).toMatchObject({ schemaVersion: 1, mode: 'collect', databaseMutationAuthorized: false,
      packetSha256: hash(f.packet), planSha256: hash(f.plan), evidenceDigest: releaseEvidenceDigestOf(f.packet) });
    expect(assertReviewBundle(f)).toBe(true);
    expect(JSON.stringify(f)).toBe(before);
    for (const key of ['releaseId', 'readinessRunId', 'g3RunId', 'runId', 'runAttempt']) expect(typeof f.manifest[key]).toBe('string');
    expect(buildReviewBundleManifest({ ...f, runId: 34930000003, runAttempt: 2 })).toEqual(f.manifest);
    expect(buildReviewBundleManifest({ ...f, plan: canonical(f.plan), packet: canonical(f.packet) })).toEqual(f.manifest);
  });

  for (const key of ['readinessRunId', 'g3RunId', 'runId', 'runAttempt']) {
    it.each([undefined, null, '', '0', '01', '../2', ' 2', '2\n', '-1', '1.5', '1e3', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, {}, true])(`rejects unsafe ${key}: %j`, (value) => {
      expect(() => buildReviewBundleManifest({ ...fixture(), [key]: value })).toThrow(new RegExp(key));
    });
  }

  it.each(['../release', '', 'x', 'release\n', undefined])('rejects unsafe releaseId %j', (releaseId) => {
    expect(() => buildReviewBundleManifest({ ...fixture(), releaseId })).toThrow(/releaseId/);
  });

  for (const target of ['plan', 'packet']) {
    for (const key of ['releaseId', 'mainSha', 'repository', 'planDigest', 'productionProjectRef', 'riskTier', 'schemaVersion']) {
      it(`rejects mismatched ${target}.${key}`, () => {
        const f = fixture(); f[target][key] = 'different';
        expect(() => buildReviewBundleManifest(f)).toThrow(/REVIEW_BUNDLE_INVALID/);
      });
    }
    it(`hashes all ${target} fields even when the evidence digest is unchanged`, () => {
      const f = fixture(); f[target].extra = { newField: 'tampered' };
      expect(() => assertReviewBundle(f)).toThrow(new RegExp(`${target}Sha256`));
    });
    it(`rejects nested mutation authority in ${target}`, () => {
      const f = fixture(); f[target].extra = [{ databaseMutationAuthorized: true }];
      expect(() => buildReviewBundleManifest(f)).toThrow(/cannot authorize mutation/);
    });
  }

  it('rejects changed migration bytes and packet evidence', () => {
    const f = fixture(); f.plan.migrations[0].sha256 = 'd'.repeat(64);
    expect(() => assertReviewBundle(f)).toThrow(/planSha256/);
    const g = fixture(); g.packet.test.executedTests = 0;
    expect(() => assertReviewBundle(g)).toThrow(/packetSha256/);
  });

  for (const key of ['releaseId', 'mainSha', 'readinessRunId', 'g3RunId', 'runId', 'repository']) {
    it(`rejects swapped requested ${key}`, () => {
      const f = fixture(); f[key] = key.endsWith('Id') && key !== 'releaseId' ? '999' : 'different';
      expect(() => assertReviewBundle(f)).toThrow(/REVIEW_BUNDLE_INVALID/);
    });
  }
  for (const key of ['schemaVersion', 'mode', 'repository', 'releaseId', 'mainSha', 'planDigest', 'readinessRunId', 'g3RunId', 'runId', 'runAttempt', 'packetSha256', 'planSha256', 'evidenceDigest', 'databaseMutationAuthorized']) {
    it(`rejects tampered or missing manifest.${key}`, () => {
      const f = fixture(); f.manifest[key] = 'tampered';
      expect(() => assertReviewBundle(f)).toThrow(new RegExp(key));
      delete f.manifest[key]; expect(() => assertReviewBundle(f)).toThrow(new RegExp(key));
    });
  }
  it.each(['id', 'run_attempt', 'repository', 'name', 'path', 'event', 'head_branch', 'head_sha', 'status', 'conclusion'])('rejects wrong or missing live run %s', (key) => {
    const f = fixture(); f.run[key] = key === 'repository' ? { full_name: 'attacker/fork' } : '999';
    expect(() => assertReviewBundle(f)).toThrow(/REVIEW_BUNDLE_INVALID/);
    delete f.run[key]; expect(() => assertReviewBundle(f)).toThrow(/REVIEW_BUNDLE_INVALID/);
  });
  it('rejects a rerun even when every live job belongs to the new attempt', () => {
    const f = fixture(); f.run.run_attempt = 3; f.jobs.forEach((job: any) => { job.run_attempt = 3; });
    expect(() => assertReviewBundle(f)).toThrow(/manifest.runAttempt/);
  });
  it.each(['collect', 'prepare', 'execute'])('requires exactly one correctly concluded %s job', (name) => {
    for (const change of ['missing', 'duplicate', 'failed', 'success', 'skipped']) {
      if ((name === 'collect' && change === 'success') || (name !== 'collect' && change === 'skipped')) continue;
      const f = fixture(); const job = f.jobs.find((j: any) => j.name === name);
      if (change === 'missing') f.jobs = f.jobs.filter((j: any) => j !== job);
      else if (change === 'duplicate') f.jobs.push({ ...job });
      else job.conclusion = change;
      expect(() => assertReviewBundle(f)).toThrow(/REVIEW_BUNDLE_INVALID/);
    }
  });
  it.each(['run_id', 'run_attempt', 'status', 'name'])('rejects mixed or incomplete live job %s', (key) => {
    const f = fixture(); f.jobs[1][key] = '999';
    expect(() => assertReviewBundle(f)).toThrow(/REVIEW_BUNDLE_INVALID/);
    delete f.jobs[1][key]; expect(() => assertReviewBundle(f)).toThrow(/REVIEW_BUNDLE_INVALID/);
  });
  it('rejects successful writer jobs regardless of their display name', () => {
    const f = fixture(); f.jobs.push({ ...f.jobs[0], name: 'renamed production writer' });
    expect(() => assertReviewBundle(f)).toThrow(/writer execution is forbidden/);
  });
  it.each(['g2 / writer', 'g4-backup / capture extra', 'g4-restore / execute', 'collect / writer', 'postcheck'])('rejects unknown successful job %s', (name) => {
    const f = fixture(); f.jobs.push({ ...f.jobs[0], name });
    expect(() => assertReviewBundle(f)).toThrow(/writer execution is forbidden/);
  });
  it.each([undefined, null, [], {}])('rejects missing job evidence %j', (jobs) => {
    expect(() => assertReviewBundle({ ...fixture(), jobs })).toThrow(/jobs/);
  });
  it('rejects non-JSON artifacts and missing inputs with actionable errors', () => {
    for (const bad of [undefined, NaN, Infinity, () => true, new Date()]) {
      const f = fixture(); f.packet.data.bad = bad;
      expect(() => buildReviewBundleManifest(f)).toThrow(/packet.data.bad/);
    }
    const f = fixture(); f.packet.data.cycle = f.packet;
    expect(() => buildReviewBundleManifest(f)).toThrow(/acyclic JSON/);
    expect(() => buildReviewBundleManifest()).toThrow(/plan/);
    expect(() => assertReviewBundle()).toThrow(/manifest/);
  });
});
