import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, it } from 'vitest';
import { attachActualChangedFiles, createSourceFreeze, createSourceFreezeFromGit, parseLaneMetadata,
  sourceFreezeError, summarizeActiveLanes, validateGlobalWip } from '../../scripts/agents/dual-terra-wip-policy.mjs';

import { validateWipPreflight } from '../../scripts/agents/agent-wip-preflight.mjs';
import { createRunLedgerV2 } from '../../scripts/agents/run-ledger-v2.mjs';

const head = 'a'.repeat(40);
function carrier(number: number, issue: number, lane = 'TERRA_BUILD', tail = false) {
  return { number, state: 'open', head: { sha: head }, body: `<!-- pr-lifecycle
issue: ${issue}
state: ACTIVE
-->
WORK_ORIGIN: AGENT
WORKSTREAM: PRODUCT_MAINLINE
BPLUS_MODE: true
RUN_ID: 2026-09-16-fixture
SCORECARD_PATH: docs/metrics/agent-runs/2026-09-16-fixture.json
AGENT_LANE: ${lane}
LANE_STATE: ACTIVE
ACTIVE_CANDIDATE: ${lane !== 'TEST_VALIDATION'}
CLOSEABILITY_SCORE: 4
SELECTION_REASON: CLOSE_READY
REMAINING_AUTONOMOUS_STEPS: tests and review
OWNER_OR_EXTERNAL_BLOCKER: none
CLOSURE_SWEEP_TARGET: EMPTY_WITH_SCAN
TEST_LANE_REQUIRED: ${lane === 'TEST_VALIDATION'}
REQUESTED_MODEL / ACTUAL_MODEL: requested=Terra; actual=unknown
DUAL_TERRA_PILOT: true
TERRA_SLOT: ${number % 2 ? 1 : 2}
TEST_PROFILE: LOCAL_ISOLATED
TEST_ENV_ID: local-${number}
FINAL_CANONICAL_REQUIRED: true
FILE_OWNERSHIP: src/feature-${number}
COMPLETION_CLAIM: ${tail ? 'AUDIT_READY' : 'IN_PROGRESS'}
SOURCE_FREEZE: ${createSourceFreeze(head)}` };
}

describe('#497 source freeze and delivery identity', () => {
  for (const mutation of ['missing', 'old-head', 'missing-live-head', 'expired', 'future', 'writing', 'duplicate']) {
    it(`cannot free a BUILD slot with ${mutation} freeze evidence`, () => {
      const tail = carrier(3, 43, 'TERRA_BUILD', true);
      const receipt = JSON.parse(createSourceFreeze(head));
      if (mutation === 'missing') tail.body = tail.body.replace(/^SOURCE_FREEZE:.*$/m, '');
      if (mutation === 'old-head') tail.head.sha = 'b'.repeat(40);
      if (mutation === 'missing-live-head') tail.head.sha = '';
      if (mutation === 'expired') receipt.at = '2020-01-01T00:00:00Z';
      if (mutation === 'future') receipt.at = '2099-01-01T00:00:00Z';
      if (mutation === 'writing') receipt.writes = 'WRITING';
      if (['expired', 'future', 'writing'].includes(mutation)) tail.body = tail.body.replace(/^SOURCE_FREEZE:.*$/m, `SOURCE_FREEZE: ${JSON.stringify(receipt)}`);
      if (mutation === 'duplicate') tail.body += `\nSOURCE_FREEZE: ${createSourceFreeze(head)}`;
      const summary = summarizeActiveLanes([carrier(1, 41), carrier(2, 42), tail]);
      assert.equal(summary.activeTerra.length, 3);
      assert.equal(summary.verifyingTerra.length, 0);
      assert.ok(validateGlobalWip(summary).some(error => error.includes('SOURCE_FREEZE')));
      assert.ok(validateGlobalWip(summary).some(error => error.includes('max is 2')));
    });
  }
  it('allows the same shape only with current frozen identity and original qualification', () => {
    const summary = summarizeActiveLanes([carrier(1, 41), carrier(2, 42), carrier(3, 43, 'TERRA_BUILD', true)]);
    assert.equal(summary.activeTerra.length, 2);
    assert.equal(summary.verifyingTerra.length, 1);
    assert.deepEqual(validateGlobalWip(summary), []);
  });
  it('revokes the vacancy when the writer resumes without changing its head', () => {
    const pr = carrier(3, 43, 'TERRA_BUILD', true);
    pr.body = pr.body.replace('COMPLETION_CLAIM: AUDIT_READY', 'COMPLETION_CLAIM: IN_PROGRESS');
    assert.equal(summarizeActiveLanes([pr]).activeTerra.length, 1);
  });
  it('counts a TEST-only delivery and deduplicates its matching source carrier, not unrelated Runs', () => {
    const test = carrier(2, 41, 'TEST_VALIDATION');
    assert.equal(summarizeActiveLanes([test]).activeCandidates.length, 1);
    const summary = summarizeActiveLanes([carrier(1, 41), test]);
    assert.equal(summary.activeCandidateCarriers.length, 2);
    assert.equal(summary.activeCandidates.length, 1);
    const differentRun = { ...test, number: 3, body: test.body.replaceAll('2026-09-16-fixture', '2026-09-16-other') };
    assert.equal(summarizeActiveLanes([carrier(1, 41), differentRun]).activeCandidates.length, 2);
  });
  it('still blocks a fourth delivery, two TEST holders and two writers on one Issue', () => {
    const four = [carrier(1, 41), carrier(2, 42), carrier(3, 43, 'TERRA_BUILD', true), carrier(4, 44, 'TEST_VALIDATION')];
    assert.ok(validateGlobalWip(summarizeActiveLanes(four)).includes('ACTIVE_CANDIDATE count is 4; max is 3'));
    assert.ok(validateGlobalWip(summarizeActiveLanes([carrier(1, 41, 'TEST_VALIDATION'), carrier(2, 41, 'TEST_VALIDATION')])).some(e => e.includes('TEST_VALIDATION')));
    assert.ok(validateGlobalWip(summarizeActiveLanes([carrier(1, 41), carrier(2, 41)])).some(e => e.includes('different primary Issues')));
  });
  it('does not count closed carriers or collapse missing primary identities', () => {
    const a = carrier(1, 41, 'TEST_VALIDATION');
    const b = carrier(2, 41, 'TEST_VALIDATION');
    a.body = a.body.replace('issue: 41', 'issue: unknown');
    b.body = b.body.replace('issue: 41', 'issue: unknown');
    assert.equal(summarizeActiveLanes([a, b]).activeCandidates.length, 2);
    assert.equal(summarizeActiveLanes([{ ...a, state: 'closed' }]).activeTest.length, 0);
  });
  for (const [leftPath, rightPath] of [
    ['supabase/migrations/0001.sql', 'supabase/migrations/0002.sql'],
    ['src/server/auth/a.ts', 'src/server/auth/b.ts'],
    ['src/server/payment.ts', 'src/server/refund.ts'],
    ['src/server/line/a.ts', 'src/server/line/b.ts'],
  ]) {
    it(`rejects disjoint files on one mutable boundary: ${leftPath}`, () => {
      const a = carrier(1, 41); const b = carrier(2, 42);
      a.body = a.body.replace('src/feature-1', leftPath);
      b.body = b.body.replace('src/feature-2', rightPath);
      const summary = summarizeActiveLanes([a, b]);
      attachActualChangedFiles(summary, { 1: [leftPath], 2: [rightPath] });
      assert.ok(validateGlobalWip(summary).some(error => error.includes('Shared mutable boundary')));
    });
  }
  it('checks expiry deterministically without converting an unknown head to evidence', () => {
    const at = '2026-09-16T00:00:00Z';
    assert.equal(sourceFreezeError({ headSha: head, sourceFreeze: createSourceFreeze(head, at) }, Date.parse(at)), null);
    assert.throws(() => createSourceFreeze('0'.repeat(40), at));
    assert.equal(parseLaneMetadata({}).headSha, '');
  });
  it('runs the real preflight with current Git identity and refuses resumed local writes', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight497-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
    try {
      git('init', '-q'); git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'test');
      fs.mkdirSync(path.join(cwd, 'docs/metrics/agent-runs'), { recursive: true });
      const run: any = createRunLedgerV2('2026-09-16-fixture', new Date().toISOString(), { closeoutOwner: 'PRODUCT_MAIN_SESSION' });
      run.sources = [{ type: 'ISSUE', ref: 'issue/43', note: 'Synthetic preflight fixture, not Product history' }];
      run.delivery.issuesStarted = 1;
      run.modelUsage.tasks = [{ id: 'synthetic-497', requestedModel: 'unknown', actualModel: 'unknown',
        role: 'Synthetic preflight fixture', count: 1, contextClass: 'compact', accepted: false,
        inputTokens: null, outputTokens: null, cachedTokens: null }];
      fs.writeFileSync(path.join(cwd, 'docs/metrics/agent-runs/2026-09-16-fixture.json'), JSON.stringify(run));
      git('add', '.'); git('commit', '-qm', 'fixture');
      const receipt = createSourceFreezeFromGit(cwd, true);
      const body = carrier(3, 43, 'TERRA_BUILD', true).body.replace(/^SOURCE_FREEZE:.*$/m, `SOURCE_FREEZE: ${receipt}`)
        + '\nDELIVERY_UNIT_TYPE: SLICE\nCOUNT_IN_DELIVERY_OUTCOME: true\nRETROACTIVE_TRACKING_MIGRATION: false'
        + '\nUSER_VISIBLE_OUTCOME: isolated test fixture only\nASTRA_RISK: NONE\nASTRA_RATIONALE: neutral isolated fixture without provider or security changes';
      const input = { body, changedFiles: ['src/feature-3/file.ts'], repositoryRoot: cwd, requireAstraClassification: true };
      const good = validateWipPreflight(input);
      assert.equal(good.valid, true, good.errors.join('; '));
      assert.equal(good.metadata.headSha, git('rev-parse', 'HEAD'));
      fs.writeFileSync(path.join(cwd, 'resumed-write'), 'dirty');
      const bad = validateWipPreflight(input);
      assert.equal(bad.valid, false);
      assert.ok(bad.errors.some(error => error.includes('SOURCE_FREEZE')));
    } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
  });
  it('generates receipts from real clean Git and refuses tracked and untracked writes', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'freeze497-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
    try {
      git('init', '-q'); git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'test');
      fs.writeFileSync(path.join(cwd, 'source'), 'original'); git('add', '.'); git('commit', '-qm', 'fixture');
      assert.throws(() => createSourceFreezeFromGit(cwd));
      const receipt = JSON.parse(createSourceFreezeFromGit(cwd, true));
      assert.equal(receipt.head, git('rev-parse', 'HEAD'));
      fs.writeFileSync(path.join(cwd, 'untracked'), 'new');
      assert.throws(() => createSourceFreezeFromGit(cwd, true));
      fs.rmSync(path.join(cwd, 'untracked'));
      fs.writeFileSync(path.join(cwd, 'source'), 'changed');
      assert.throws(() => createSourceFreezeFromGit(cwd, true));
      git('add', '.'); git('commit', '-qm', 'real source change');
      assert.notEqual(JSON.parse(createSourceFreezeFromGit(cwd, true)).head, receipt.head);
    } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
  });
});
