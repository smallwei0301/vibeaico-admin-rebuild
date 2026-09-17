import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'vitest';
import { createRunLedgerV2 } from '../../scripts/agents/run-ledger-v2.mjs';
import { validateWipPreflight } from '../../scripts/agents/agent-wip-preflight.mjs';
import {
  productRunBinding, validateProductRunContent, validateLocalRunLedgerChanges,
  validateGithubRunLedgerChanges, validateGithubProductRunBinding,
} from '../../scripts/agents/scorecard-required-gate.mjs';

const id = '2026-09-16-cross-day-556';
const ledger = `docs/metrics/agent-runs/${id}.json`;
const body = `<!-- pr-lifecycle\nissue: 556\nstate: ACTIVE\nsupersedes:\n-->
WORKSTREAM: PRODUCT_MAINLINE
WORK_ORIGIN: OWNER
RUN_ID: ${id}
SCORECARD_PATH: ${ledger}
`;
function makeRun(): any {
  const run: any = createRunLedgerV2(id, '2026-09-16T02:00:00Z', { closeoutOwner: 'PRODUCT_MAIN_SESSION' });
  run.sources = [{ type: 'OWNER_INSTRUCTION', ref: 'issue/556', note: 'Synthetic test fixture, not actual Product evidence' }];
  run.delivery.issuesStarted = 1;
  run.modelUsage.tasks = [{ id: 'synthetic-556', requestedModel: 'unknown', actualModel: 'unknown',
    role: 'Synthetic capture fixture', count: 1, contextClass: 'compact', accepted: false,
    inputTokens: null, outputTokens: null, cachedTokens: null }];
  return run;
}
function remote(run = makeRun(), text = body): any {
  const bytes = Buffer.from(JSON.stringify(run));
  const sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  const data: any = { encoding: 'base64', sha, size: bytes.length, content: bytes.toString('base64') };
  const tree: any = { truncated: false, tree: [{ path: ledger, type: 'blob', mode: '100644', sha }] };
  const requests: any[] = [];
  return { data, tree, requests, owner: 'owner', repo: 'repo',
    current: { body: text, state: 'open', head: { sha: 'a'.repeat(40) }, changed_files: 1 },
    changedFiles: [{ filename: 'src/app/page.tsx', status: 'modified', sha: 'b'.repeat(40) }],
    github: { rest: { git: {
      getTree: async (request: any) => { requests.push(request); return { data: tree }; },
      getBlob: async (request: any) => { requests.push(request); return { data }; },
    } } } };
}

describe('#556 Product Run binding without ledger changes', () => {
  for (const origin of ['OWNER', 'AGENT', 'UNKNOWN']) {
    it(`requires Run identity for ${origin} without borrowing origin exemptions`, async () => {
      const text = body.replace('WORK_ORIGIN: OWNER', `WORK_ORIGIN: ${origin}`).replace(`RUN_ID: ${id}`, 'RUN_ID: none');
      assert.match((await validateGithubRunLedgerChanges(remote(makeRun(), text))).join('\n'), /PRODUCT_RUN_BINDING_REJECTED/);
    });
  }
  it('accepts an active cross-day Run and either existing report path, without filling terminal fields', async () => {
    const run = makeRun(); const saved = JSON.stringify(run);
    for (const suffix of ['.json', '.md']) {
      const text = body.replace(`SCORECARD_PATH: ${ledger}`, `SCORECARD_PATH: ${ledger.replace(/\.json$/, suffix)}`);
      assert.deepEqual(validateProductRunContent(text, saved), []);
      const input = remote(run, text);
      assert.deepEqual(await validateGithubRunLedgerChanges(input), []);
      assert.deepEqual(input.requests, [
        { owner: 'owner', repo: 'repo', tree_sha: 'a'.repeat(40), recursive: '1' },
        { owner: 'owner', repo: 'repo', file_sha: input.data.sha },
      ]);
    }
    assert.equal(JSON.stringify(run), saved);
    assert.equal(run.endedAt, null);
    assert.equal(run.main.endSha, null);
  });
  it('rejects empty, mismatched, closed, historical and Governance-owned Runs', () => {
    for (const mutate of [
      (r: any) => { r.runId = 'other'; },
      (r: any) => { r.sources = [{ type: 'ISSUE', ref: 'issue/55', note: 'Not this Issue' }]; },
      (r: any) => { r.sources = [{ type: 'ISSUE', ref: 'prefix-issue/556-suffix', note: 'Substring is not identity' }]; },
      (r: any) => { r.modelUsage.tasks = []; r.delivery.issuesStarted = 0; },
      (r: any) => { r.closeout.ownerRole = 'GOVERNANCE_MAIN_SESSION'; },
      (r: any) => { r.status = 'COMPLETE'; },
      (r: any) => { r.closeout.state = 'CLOSED'; },
      (r: any) => { r.deliveryTruthVersion = 3; delete r.closeout; },
      (r: any) => { r.delivery.issuesClosed = 1; },
    ]) {
      const r = makeRun(); mutate(r);
      assert.ok(validateProductRunContent(body, JSON.stringify(r)).length);
    }
  });
  it('rejects malformed or missing bytes without turning them into a fresh zero ledger', () => {
    for (const data of ['{', 'null', '{}', undefined]) assert.ok(validateProductRunContent(body, data).length);
  });
  it('rejects noncanonical IDs, mismatched report paths, duplicate declarations and missing Issue', () => {
    for (const text of [
      body.replace(`RUN_ID: ${id}`, 'RUN_ID: ../outside'),
      body.replace(ledger, 'docs/metrics/agent-runs/../other.json'),
      body.replace(ledger, 'docs/metrics/agent-runs/unrelated.json'),
      body.replace('issue: 556', 'issue: none'),
      body + `RUN_ID: ${id}\n`,
      body + `SCORECARD_PATH: ${ledger}\n`,
    ]) assert.ok(productRunBinding(text)?.errors.length);
  });
  it('fails wrong blob, size, type, path, encoding, missing head and unavailable reads without fallback', async () => {
    for (const mutate of [
      (r: any) => { r.data.sha = 'c'.repeat(40); },
      (r: any) => { r.data.size++; },
      (r: any) => { r.data.content = ''; },
      (r: any) => { r.tree.tree[0].mode = '120000'; },
      (r: any) => { r.tree.tree[0].type = 'commit'; },
      (r: any) => { r.tree.tree[0].path = 'other'; },
      (r: any) => { r.tree.tree[0].sha = 'c'.repeat(40); },
      (r: any) => { r.tree.truncated = true; },
      (r: any) => { r.tree.tree.push({ ...r.tree.tree[0] }); },
      (r: any) => { r.data.encoding = 'none'; },
      (r: any) => { r.current.head.sha = 'main'; },
      (r: any) => { r.github.rest.git.getTree = async () => { throw new Error('unavailable'); }; },
    ]) {
      const input = remote(); mutate(input);
      assert.ok((await validateGithubRunLedgerChanges(input)).length);
      assert.ok(input.requests.length <= 2);
    }
  });
  it('checks local binding on an unchanged ledger and connects the full preflight', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'binding-556-')); const target = path.join(root, ledger);
    try {
      mkdirSync(path.dirname(target), { recursive: true });
      const input = { body, changedFiles: ['src/app/page.tsx'], repositoryRoot: root };
      assert.match(validateLocalRunLedgerChanges(input).join('\n'), /PRODUCT_RUN_BINDING_REJECTED/);
      assert.match(validateWipPreflight(input).errors.join('\n'), /PRODUCT_RUN_BINDING_REJECTED/);
      writeFileSync(target, JSON.stringify(makeRun()));
      assert.deepEqual(validateLocalRunLedgerChanges(input), []);
      assert.ok(!validateWipPreflight(input).errors.some(error => error.includes('PRODUCT_RUN_BINDING_REJECTED')));
      rmSync(target); writeFileSync(path.join(root, 'outside.json'), JSON.stringify(makeRun()));
      symlinkSync(path.join(root, 'outside.json'), target);
      assert.match(validateLocalRunLedgerChanges(input).join('\n'), /unavailable/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('keeps pure Governance exempt from Product Run binding and leaves closed history alone', async () => {
    const input = remote(makeRun(), body.replace('PRODUCT_MAINLINE', 'MODEL_GOVERNANCE'));
    assert.equal(productRunBinding(input.current.body), null);
    assert.deepEqual(await validateGithubRunLedgerChanges(input), []);
    assert.deepEqual(input.requests, []);
    input.current.body = body; input.current.state = 'closed';
    assert.deepEqual(await validateGithubProductRunBinding(input), []);
    assert.deepEqual(input.requests, []);
  });
});
