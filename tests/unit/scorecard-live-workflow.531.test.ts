import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { afterEach, describe, it } from 'vitest';

const workflow = fs.readFileSync('.github/workflows/agent-run-scorecard.yml', 'utf8');
const marker = '      - name: Strict live readiness for changed active v2 ledgers';
const step = workflow.slice(workflow.indexOf(marker)).split('        run: |\n')[1];
assert.ok(step, 'strict-live shell step must exist');
const shell = step.split('\n').map(line => line.replace(/^ {10}/, '')).join('\n');
const temporary = new Set<string>();

afterEach(() => {
  for (const dir of temporary) fs.rmSync(dir, { recursive: true, force: true });
  temporary.clear();
});

function fixture(status = 'IN_PROGRESS', schemaVersion = 2, name = 'run.json') {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'scorecard-531-'));
  temporary.add(cwd);
  const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'test fixture');
  const ledger = `docs/metrics/agent-runs/${name}`;
  fs.mkdirSync(path.dirname(path.join(cwd, ledger)), { recursive: true });
  fs.writeFileSync(path.join(cwd, ledger), JSON.stringify({ schemaVersion, status, revision: 0 }));
  git('add', '.');
  git('commit', '-qm', 'baseline');
  const base = git('rev-parse', 'HEAD');
  fs.mkdirSync(path.join(cwd, 'scripts/agents'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'scripts/agents/scorecard-readiness.mjs'),
    'import fs from "node:fs"; fs.writeFileSync("called.json", JSON.stringify(process.argv.slice(2))); process.exit(Number(process.env.READINESS_EXIT || 0));');
  return {
    cwd, ledger, base, git,
    change(content = JSON.stringify({ schemaVersion, status, revision: 1 })) {
      fs.writeFileSync(path.join(cwd, ledger), content);
      git('add', ledger);
      git('commit', '-qm', 'ledger change');
    },
    run(overrides: Record<string, string> = {}) {
      return spawnSync('bash', ['-c', shell], { cwd, encoding: 'utf8', env: {
        ...process.env, EVENT_NAME: 'pull_request', PR_BASE_SHA: base,
        PUSH_BEFORE_SHA: base, GITHUB_SHA: git('rev-parse', 'HEAD'), ...overrides,
      } });
    },
  };
}

describe('#531 strict-live workflow behavior', () => {
  it('watches its policy and tests and fetches complete comparison history', () => {
    for (const text of ['fetch-depth: 0', "- 'scripts/agents/scorecard-readiness.mjs'",
      "- '.github/workflows/agent-run-scorecard.yml'", "- 'tests/unit/scorecard-live-workflow*.test.ts'"]) {
      assert.ok(workflow.includes(text));
    }
  });

  for (const event of ['pull_request', 'push']) {
    it(`fails closed when a nonempty ${event} comparison base cannot be resolved`, () => {
      const f = fixture();
      const result = f.run({ EVENT_NAME: event, PR_BASE_SHA: 'missing-base', PUSH_BEFORE_SHA: 'missing-base' });
      assert.notEqual(result.status, 0);
      assert.ok(result.stderr.includes('Unable to prove changed ledgers'));
      assert.ok(!result.stdout.includes('No changed run ledger'));
    });
    it(`executes strict-live and propagates its failure on ${event}`, () => {
      const f = fixture(); f.change();
      assert.equal(f.run({ EVENT_NAME: event, READINESS_EXIT: '7' }).status, 7);
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.cwd, 'called.json'), 'utf8')), [f.ledger, '--strict-live']);
    });
  }

  it('accepts a proven empty diff without inventing a readiness execution', () => {
    const f = fixture();
    assert.equal(f.run().status, 0);
    assert.ok(!fs.existsSync(path.join(f.cwd, 'called.json')));
  });

  it('rejects absent and zero comparison bases', () => {
    const f = fixture();
    for (const base of ['', '0'.repeat(40)]) assert.notEqual(f.run({ PR_BASE_SHA: base }).status, 0);
  });

  it('preserves ledger path identity including spaces and newlines', () => {
    const f = fixture('IN_PROGRESS', 2, 'run with\nnewline.json'); f.change();
    assert.equal(f.run().status, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.cwd, 'called.json'), 'utf8')), [f.ledger, '--strict-live']);
  });

  it('does not silently approve a deleted ledger', () => {
    const f = fixture(); f.git('rm', f.ledger); f.git('commit', '-qm', 'remove');
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes('Changed ledger is missing'));
  });

  it('fails when changed ledger JSON is unreadable', () => {
    const f = fixture(); f.change('{ invalid JSON');
    assert.notEqual(f.run().status, 0);
  });

  it('leaves non-active and legacy ledgers to the existing report/schema checks', () => {
    for (const [status, version] of [['CLOSED', 2], ['IN_PROGRESS', 1]] as const) {
      const f = fixture(status, version); f.change();
      assert.equal(f.run().status, 0);
      assert.ok(!fs.existsSync(path.join(f.cwd, 'called.json')));
    }
  });
});
