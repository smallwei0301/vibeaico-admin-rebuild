import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const guard = fileURLToPath(new URL('../../scripts/ci/repo-integrity-guard.mjs', import.meta.url));
const migration = 'supabase/migrations/0100_original.sql';
const nextMigration = 'supabase/migrations/0101_main_only.sql';
const initialFiles: Record<string, string> = {
  'package.json': '{"private":true}\n', 'package-lock.json': '{}\n',
  'src/app/page.ts': 'export const page = 1;\n',
  'src/server/example.ts': 'export const server = 1;\n',
  [migration]: '-- original migration\n',
};

// Every test uses a real, isolated Git repository. Git output is not mocked.
// Fixture commits are constructed with a temporary index; no checkout/reset of
// the running project's branch, working tree, index, or refs is performed.
function fixture(run: (f: Fixture) => void) {
  const root = mkdtempSync(join(tmpdir(), 'repo-integrity-380-'));
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  for (const key of ['BASE_REVISION', 'HEAD_REVISION', 'NODE_OPTIONS']) delete env[key];
  Object.assign(env, {
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  });
  let sequence = 0;
  const git = (args: string[], input?: string, extra: Record<string, string> = {}) =>
    execFileSync('git', args, { cwd: root, env: { ...env, ...extra }, input,
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5_000 }).trim();
  const commit = (parent: string | null, changes: Record<string, string | null>) => {
    const index = join(root, '.git', `fixture-index-${++sequence}`);
    const extra = { GIT_INDEX_FILE: index };
    git(['read-tree', parent ?? '--empty'], undefined, extra);
    for (const [path, content] of Object.entries(changes)) {
      if (content === null) git(['update-index', '--force-remove', '--', path], undefined, extra);
      else {
        const sha = git(['hash-object', '-w', '--stdin'], content);
        git(['update-index', '--add', '--cacheinfo', '100644', sha, path], undefined, extra);
      }
    }
    const tree = git(['write-tree'], undefined, extra);
    rmSync(index, { force: true });
    return git(['commit-tree', tree, ...(parent ? ['-p', parent] : [])], `fixture ${sequence}\n`);
  };
  const check = (base?: string, head?: string, extra: Record<string, string> = {}) => {
    const result = spawnSync(process.execPath, [guard], {
      cwd: root, env: { ...env, ...(base === undefined ? {} : { BASE_REVISION: base }),
        ...(head === undefined ? {} : { HEAD_REVISION: head }), ...extra },
      encoding: 'utf8', timeout: 10_000,
    });
    assert.equal(result.error, undefined, String(result.error));
    return { ...result, report: result.stdout.trim() ? JSON.parse(result.stdout) : null };
  };
  try {
    git(['init', '-q', '-b', 'main']);
    const common = commit(null, initialFiles);
    run({ root, git, commit, check, common });
  } finally { rmSync(root, { recursive: true, force: true }); }
}
interface Fixture {
  root: string;
  git: (args: string[], input?: string, extra?: Record<string, string>) => string;
  commit: (parent: string | null, changes: Record<string, string | null>) => string;
  check: (base?: string, head?: string, extra?: Record<string, string>) => {
    status: number | null; stdout: string; stderr: string;
    report: { ok: boolean; errors: string[]; comparisonTree?: string; deletedCount?: number } | null;
  };
  common: string;
}
const pass = (result: ReturnType<Fixture['check']>) => {
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.report?.ok, true);
};
const reject = (result: ReturnType<Fixture['check']>, reason: RegExp) => {
  assert.notEqual(result.status, 0);
  assert.equal(result.report?.ok, false, result.stdout + result.stderr);
  assert.match(result.report!.errors.join('\n'), reason);
};

describe('repository integrity against prospective merge content (#380)', () => {
  it('does not mistake a concurrent main-only migration for candidate deletion', () => fixture((f) => {
    const base = f.commit(f.common, { [nextMigration]: '-- main addition\n' });
    const head = f.commit(f.common, { 'scripts/governance.txt': 'candidate\n' });
    const result = f.check(base, head);
    pass(result);
    assert.equal(result.report?.comparisonTree, f.git(['merge-tree', '--write-tree', base, head]));
    assert.equal(result.report?.deletedCount, 0);
  }));

  it('does not count 50 concurrent main-only files as mass deletion', () => fixture((f) => {
    const additions = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`docs/main-${i}.md`, 'main\n']));
    const base = f.commit(f.common, additions);
    const head = f.commit(f.common, { 'docs/candidate.md': 'candidate\n' });
    pass(f.check(base, head));
  }));

  it('keeps ancestor base/head and identical revisions valid', () => fixture((f) => {
    const head = f.commit(f.common, { [nextMigration]: '-- candidate addition\n' });
    pass(f.check(f.common, head));
    pass(f.check(head, head));
  }));

  it('accepts an already-contained head without inventing a deletion', () => fixture((f) => {
    const base = f.commit(f.common, { [nextMigration]: '-- newer main\n' });
    pass(f.check(base, f.common));
  }));

  it('accepts a disjoint candidate migration strictly newer than current main', () => fixture((f) => {
    const base = f.commit(f.common, { [nextMigration]: '-- main\n' });
    const head = f.commit(f.common, { 'supabase/migrations/0102_candidate.sql': '-- candidate\n' });
    pass(f.check(base, head));
  }));

  it('still rejects an actual existing migration deletion', () => fixture((f) => {
    const head = f.commit(f.common, { [migration]: null });
    reject(f.check(f.common, head), /existing migration removed or renamed/);
  }));

  it('still rejects an actual existing migration rename', () => fixture((f) => {
    const head = f.commit(f.common, { [migration]: null, 'supabase/migrations/0100_renamed.sql': initialFiles[migration] });
    reject(f.check(f.common, head), /existing migration removed or renamed/);
  }));

  it('still rejects an in-place migration edit on a diverged candidate', () => fixture((f) => {
    const base = f.commit(f.common, { [nextMigration]: '-- main\n' });
    const head = f.commit(f.common, { [migration]: '-- unsafe edit\n' });
    reject(f.check(base, head), /existing migration modified in place/);
  }));

  it('sees duplicate migration prefixes introduced across concurrent branches', () => fixture((f) => {
    const base = f.commit(f.common, { [nextMigration]: '-- main\n' });
    const head = f.commit(f.common, { 'supabase/migrations/0101_candidate.sql': '-- candidate\n' });
    reject(f.check(base, head), /duplicate migration prefix/);
  }));

  it('compares new candidate prefixes to current main, not just the common ancestor', () => fixture((f) => {
    const base = f.commit(f.common, { 'supabase/migrations/0102_main.sql': '-- main\n' });
    const head = f.commit(f.common, { 'supabase/migrations/0101_candidate.sql': '-- too old\n' });
    reject(f.check(base, head), /greater than base max 0102/);
  }));

  it('still rejects malformed migration names and missing required paths', () => fixture((f) => {
    reject(f.check(f.common, f.commit(f.common, { 'supabase/migrations/oops.sql': '-- invalid\n' })), /invalid migration filename/);
    reject(f.check(f.common, f.commit(f.common, { 'package-lock.json': null })), /required path is missing/);
  }));

  it('still rejects a real mass deletion', () => fixture((f) => {
    const files = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`docs/base-${i}.md`, 'base\n']));
    const base = f.commit(f.common, files);
    const head = f.commit(base, Object.fromEntries(Object.keys(files).map((path) => [path, null])));
    reject(f.check(base, head), /unexpected mass deletion: 50 files/);
  }));

  it('checks source contents in the prospective tree, including main-only source', () => fixture((f) => {
    const badSource = `${'a'.repeat(40)}\n`;
    const base = f.commit(f.common, { 'src/server/new-main.ts': badSource });
    const head = f.commit(f.common, { 'docs/candidate.md': 'candidate\n' });
    reject(f.check(base, head), /new-main.ts:1: standalone/);
    reject(f.check(f.common, f.commit(f.common, { 'src/server/bad.ts': badSource })), /bad.ts:1: standalone/);
  }));

  it('fails closed on a content conflict even though merge-tree emits a tree id', () => fixture((f) => {
    const base = f.commit(f.common, { 'src/server/example.ts': 'export const server = 2;\n' });
    const head = f.commit(f.common, { 'src/server/example.ts': 'export const server = 3;\n' });
    reject(f.check(base, head), /merge-tree/);
  }));

  it('fails closed for unrelated or unavailable history', () => fixture((f) => {
    reject(f.check(f.common, f.commit(null, initialFiles)), /merge-tree/);
    reject(f.check(f.common, 'b'.repeat(40)), /revision|commit/i);
    const base = f.commit(f.common, { 'docs/main.md': 'main\n' });
    const head = f.commit(f.common, { 'docs/head.md': 'head\n' });
    writeFileSync(join(f.root, '.git/shallow'), `${base}\n${head}\n`);
    reject(f.check(base, head), /merge-tree/);
  }));

  it('rejects explicit empty, symbolic, short and all-zero revision values', () => fixture((f) => {
    for (const value of ['', 'HEAD', f.common.slice(0, 12), '0'.repeat(40)]) {
      reject(f.check(value, f.common), /BASE_REVISION/);
      reject(f.check(f.common, value), /HEAD_REVISION/);
    }
  }));

  it('rejects a tree object passed as an exact commit revision', () => fixture((f) => {
    const tree = f.git(['rev-parse', `${f.common}^{tree}`]);
    reject(f.check(f.common, tree), /revision|commit/i);
  }));

  it('preserves local absent-variable defaults without changing refs, index or dirty files', () => fixture((f) => {
    const head = f.commit(f.common, { 'docs/head.md': 'committed\n' });
    f.git(['update-ref', 'refs/heads/main', head]);
    f.git(['read-tree', head]);
    for (const [path, text] of Object.entries(initialFiles)) {
      mkdirSync(dirname(join(f.root, path)), { recursive: true });
      writeFileSync(join(f.root, path), text);
    }
    mkdirSync(join(f.root, 'docs'), { recursive: true });
    writeFileSync(join(f.root, 'docs/head.md'), 'uncommitted change\n');
    writeFileSync(join(f.root, 'untracked.txt'), 'preserve me\n');
    const refs = f.git(['show-ref']);
    const status = f.git(['status', '--porcelain']);
    // git status can refresh index stat metadata; snapshot AFTER that observer.
    const index = readFileSync(join(f.root, '.git/index'));
    pass(f.check());
    assert.deepEqual(readFileSync(join(f.root, '.git/index')), index);
    assert.equal(f.git(['show-ref']), refs);
    assert.equal(f.git(['status', '--porcelain']), status);
    assert.equal(readFileSync(join(f.root, 'docs/head.md'), 'utf8'), 'uncommitted change\n');
    assert.equal(existsSync(join(f.root, 'untracked.txt')), true);
  }));

  it('never falls back to the old comparison if merge-tree is unavailable', () => fixture((f) => {
    const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
    const bin = join(f.root, 'deny-merge-tree');
    mkdirSync(bin);
    const wrapper = join(bin, 'git');
    writeFileSync(wrapper, `#!/bin/sh\nif [ "$1" = "merge-tree" ]; then exit 78; fi\nexec "${realGit}" "$@"\n`);
    chmodSync(wrapper, 0o755);
    reject(f.check(f.common, f.common, { PATH: `${bin}:${process.env.PATH}` }), /merge-tree/);
  }));
});
