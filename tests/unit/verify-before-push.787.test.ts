/**
 * #787（PB-038 升級）：推送前驗證入口必須在任一步失敗時非零退出，而且不執行 push。
 *
 * 每個案例都建立一組真實的 git 環境（bare remote + clone），以 VBP_TYPECHECK_CMD／VBP_TEST_CMD
 * 取代實際的 typecheck／test，最後直接讀 bare remote 的 refs 判斷「到底有沒有推上去」——
 * 不信任腳本自己印出的訊息。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(__dirname, '../../scripts/agents/verify-before-push.sh');
const BRANCH = 'feature/x';
const REAL_GIT = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim();
const dirs: string[] = [];

const gitEnv = {
  GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.com',
  GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0',
};

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...gitEnv } });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

/** bare remote + clone，clone 在 BRANCH 上有一個 commit；pushBranch=true 時遠端也已有該分支。 */
function setup({ pushBranch = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'vbp-787-'));
  dirs.push(root);
  const remote = join(root, 'remote.git');
  const work = join(root, 'work');
  git(root, 'init', '--bare', '-q', '-b', 'main', remote);
  git(root, 'clone', '-q', remote, work);
  git(work, 'checkout', '-q', '-b', BRANCH);
  writeFileSync(join(work, 'a.txt'), 'one\n');
  git(work, 'add', 'a.txt');
  git(work, 'commit', '-q', '-m', 'one');
  if (pushBranch) git(work, 'push', '-q', '-u', 'origin', BRANCH);
  return { root, remote, work };
}

function run(work: string, args: string[], env: Record<string, string> = {}) {
  return spawnSync('bash', [SCRIPT, ...args], {
    cwd: work,
    encoding: 'utf8',
    env: { ...process.env, ...gitEnv, PATH: `${join(work, '..', 'bin')}:${process.env.PATH}`, VBP_TYPECHECK_CMD: 'true', VBP_TEST_CMD: 'true', ...env },
  });
}

function remoteHead(remote: string): string {
  const r = spawnSync('git', ['--git-dir', remote, 'rev-parse', '--verify', '--quiet', `refs/heads/${BRANCH}`], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '';
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('verify-before-push.sh（#787）', () => {
  it('全部通過且帶 --push：推送到遠端', () => {
    const { remote, work } = setup();
    const r = run(work, ['--push']);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('VERIFY_PASS');
    expect(remoteHead(remote)).toBe(git(work, 'rev-parse', 'HEAD'));
  });

  it('不帶 --push：只驗證，不推送', () => {
    const { remote, work } = setup();
    const r = run(work, []);
    expect(r.status, r.stderr).toBe(0);
    expect(remoteHead(remote)).toBe('');
  });

  it('typecheck 失敗：非零退出、不推送、不跑測試', () => {
    const { root, remote, work } = setup();
    const marker = join(root, 'tests-ran');
    const r = run(work, ['--push'], { VBP_TYPECHECK_CMD: 'exit 3', VBP_TEST_CMD: `touch ${marker}` });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('typecheck 失敗');
    expect(remoteHead(remote)).toBe('');
    expect(spawnSync('test', ['-e', marker]).status).not.toBe(0);
  });

  it('unit tests 失敗（即使輸出經過管線）：非零退出、不推送', () => {
    const { remote, work } = setup();
    const r = run(work, ['--push'], { VBP_TEST_CMD: 'echo "1 failed" | tail -1; exit 1' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('unit tests 失敗');
    expect(remoteHead(remote)).toBe('');
  });

  it('管線中段失敗也會被視為失敗（pipefail）', () => {
    const { remote, work } = setup();
    const r = run(work, ['--push'], { VBP_TEST_CMD: 'set -o pipefail; false | cat' });
    expect(r.status).not.toBe(0);
    expect(remoteHead(remote)).toBe('');
  });

  it('工作樹有未 commit 的變更：非零退出、不推送', () => {
    const { remote, work } = setup();
    writeFileSync(join(work, 'a.txt'), 'dirty\n');
    const r = run(work, ['--push']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('未 commit');
    expect(remoteHead(remote)).toBe('');
  });

  it('有未追蹤的檔案：非零退出、不推送', () => {
    const { remote, work } = setup();
    writeFileSync(join(work, 'new.txt'), 'x\n');
    const r = run(work, ['--push']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('未追蹤');
    expect(remoteHead(remote)).toBe('');
  });

  it('fetch 失敗（遠端不存在）：非零退出，不以舊 ref 繼續', () => {
    const { work } = setup();
    git(work, 'remote', 'set-url', 'origin', '/nonexistent/remote.git');
    const r = run(work, ['--push']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('git fetch');
  });

  it('遠端分支已前進（非 fast-forward）：非零退出、遠端不被覆寫', () => {
    const { root, remote, work } = setup({ pushBranch: true });
    const other = join(root, 'other');
    git(root, 'clone', '-q', '-b', BRANCH, remote, other);
    writeFileSync(join(other, 'b.txt'), 'remote\n');
    git(other, 'add', 'b.txt');
    git(other, 'commit', '-q', '-m', 'remote ahead');
    git(other, 'push', '-q', 'origin', BRANCH);
    const advanced = remoteHead(remote);

    writeFileSync(join(work, 'a.txt'), 'local\n');
    git(work, 'commit', '-q', '-am', 'local');
    const r = run(work, ['--push']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('非 fast-forward');
    expect(remoteHead(remote)).toBe(advanced);
  });

  it('遠端分支已存在且本機領先：推送成功', () => {
    const { remote, work } = setup({ pushBranch: true });
    writeFileSync(join(work, 'a.txt'), 'two\n');
    git(work, 'commit', '-q', '-am', 'two');
    const r = run(work, ['--push']);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('本機 HEAD 已包含');
    expect(remoteHead(remote)).toBe(git(work, 'rev-parse', 'HEAD'));
  });

  it('驗證期間產生新 commit：拒絕推送（只推鎖定的 SHA）', () => {
    const { remote, work } = setup();
    const r = run(work, ['--push'], {
      VBP_TEST_CMD: 'echo late > late.txt && git add late.txt && git commit -q -m late',
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('新 commit 未經驗證');
    expect(remoteHead(remote)).toBe('');
  });

  it('驗證期間工作樹被改動：拒絕推送', () => {
    const { remote, work } = setup();
    const r = run(work, ['--push'], { VBP_TYPECHECK_CMD: 'echo x >> a.txt' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('驗證期間產生');
    expect(remoteHead(remote)).toBe('');
  });

  it('推送的是驗證開始時鎖定的 SHA', () => {
    const { remote, work } = setup();
    const locked = git(work, 'rev-parse', 'HEAD');
    const r = run(work, ['--push']);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain(`VERIFY_HEAD: ${BRANCH} @ ${locked}`);
    expect(remoteHead(remote)).toBe(locked);
  });

  it('新分支推送後設定 upstream（branch.<b>.remote／merge）', () => {
    const { work } = setup();
    const r = run(work, ['--push']);
    expect(r.status, r.stderr).toBe(0);
    expect(git(work, 'config', `branch.${BRANCH}.remote`)).toBe('origin');
    expect(git(work, 'config', `branch.${BRANCH}.merge`)).toBe(`refs/heads/${BRANCH}`);
  });

  it('push 成功但 upstream 設定失敗：仍回報已推送（exit 0）並警告', () => {
    const { remote, work } = setup();
    // 以 config.lock 讓 git config 寫入失敗，但 push 本身不需要寫本機 config。
    writeFileSync(join(work, '.git', 'config.lock'), '');
    const r = run(work, ['--push']);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('PUSHED');
    expect(r.stderr).toContain('UPSTREAM_WARNING');
    expect(remoteHead(remote)).toBe(git(work, 'rev-parse', 'HEAD'));
  });

  it('detached HEAD：非零退出', () => {
    const { work } = setup();
    git(work, 'checkout', '-q', '--detach');
    const r = run(work, ['--push']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('detached HEAD');
  });

  it('未知選項：非零退出', () => {
    const { work } = setup();
    const r = run(work, ['--force']);
    expect(r.status).toBe(2);
  });
});


/** A real main snapshot supplies the unchanged canonical classifier. */
function docsSetup() {
  const t = setup();
  mkdirSync(join(t.work, 'scripts/ci'), { recursive: true });
  writeFileSync(join(t.work, 'scripts/ci/classify-changes.mjs'), readFileSync(resolve(__dirname, '../../scripts/ci/classify-changes.mjs')));
  git(t.work, 'add', 'scripts/ci/classify-changes.mjs');
  git(t.work, 'commit', '-q', '-m', 'main classifier');
  git(t.work, 'push', '-q', 'origin', 'HEAD:refs/heads/main');
  // Only the identity read is stubbed; all fetch/diff/push operations use real bare Git.
  const bin = join(t.root, 'bin');
  mkdirSync(bin);
  const wrapper = join(bin, 'git');
  writeFileSync(wrapper, `#!/bin/sh
if [ "$1" = remote ] && [ "$2" = get-url ] && [ "$3" = origin ]; then
  printf '%s\\n' "\${VBP_TEST_ORIGIN_URL:-https://github.com/smallwei0301/vibeaico-admin-rebuild.git}"
else
  exec '${REAL_GIT}' "$@"
fi
`);
  chmodSync(wrapper, 0o755);
  return t;
}
function commitFile(work: string, path: string, content = 'documentation\n') {
  mkdirSync(resolve(work, path, '..'), { recursive: true });
  writeFileSync(join(work, path), content);
  git(work, 'add', path);
  git(work, 'commit', '-q', '-m', path);
}

describe('verify-before-push canonical docs route', () => {
  it.each(['.agents/skill.md', '.claude/settings.md', 'src/runtime.ts'])('main push rejects paths requiring PR: %s', (path) => {
    const { remote, work } = docsSetup();
    git(work, 'switch', '-c', 'main');
    const before = git(work, 'rev-parse', 'HEAD');
    commitFile(work, path);
    const r = run(work, ['--push']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('main');
    expect(git(work, 'ls-remote', 'origin', 'refs/heads/main').split('\t')[0]).toBe(before);
  });
  it('future CI docs allowlist growth cannot expand main publication paths', () => {
    const { work } = docsSetup();
    const classifier = 'scripts/ci/classify-changes.mjs';
    const current = readFileSync(join(work, classifier), 'utf8');
    commitFile(work, classifier, current.replace("path.startsWith('docs/')", "(path.startsWith('docs/') || path.startsWith('future-docs/'))"));
    git(work, 'push', '-q', 'origin', 'HEAD:refs/heads/main');
    git(work, 'switch', '-c', 'main');
    const before = git(work, 'rev-parse', 'HEAD');
    commitFile(work, 'future-docs/change.md');
    const r = run(work, ['--push']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('main');
    expect(git(work, 'ls-remote', 'origin', 'refs/heads/main').split('\t')[0]).toBe(before);
  });
  it('main skill-to-doc rename retains the non-documentation source boundary', () => {
    const { work } = docsSetup();
    commitFile(work, '.agents/skill.md');
    git(work, 'push', '-q', 'origin', 'HEAD:refs/heads/main');
    git(work, 'switch', '-c', 'main');
    const before = git(work, 'rev-parse', 'HEAD');
    mkdirSync(join(work, 'docs'));
    git(work, 'mv', '.agents/skill.md', 'docs/skill.md');
    git(work, 'commit', '-q', '-m', 'rename skill into docs');
    const r = run(work, ['--push']);
    expect(r.status).not.toBe(0);
    expect(git(work, 'ls-remote', 'origin', 'refs/heads/main').split('\t')[0]).toBe(before);
  });
  it('main approved documentation path retains lightweight push eligibility', () => {
    const { work } = docsSetup();
    git(work, 'switch', '-c', 'main');
    commitFile(work, 'docs/change.md');
    const head = git(work, 'rev-parse', 'HEAD');
    const r = run(work, ['--push'], { VBP_TYPECHECK_CMD: 'exit 93' });
    expect(r.status, r.stderr).toBe(0);
    expect(git(work, 'ls-remote', 'origin', 'refs/heads/main').split('\t')[0]).toBe(head);
  });
  it('main documentation with explicit failing targets does not publish', () => {
    const { work } = docsSetup();
    git(work, 'switch', '-c', 'main');
    const before = git(work, 'rev-parse', 'HEAD');
    commitFile(work, 'docs/change.md');
    const r = run(work, ['--push', '--', 'tests/unit/requested.test.ts'], { VBP_TEST_CMD: 'exit 94' });
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain('STEP: unit tests');
    expect(git(work, 'ls-remote', 'origin', 'refs/heads/main').split('\t')[0]).toBe(before);
  });
  it('main verify-only still permits checking without publishing', () => {
    const { work } = docsSetup();
    git(work, 'switch', '-c', 'main');
    commitFile(work, 'docs/change.md');
    const r = run(work, []);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('VERIFY_PASS');
  });
  it('docs-only uses lightweight verification, not npm/typecheck, and pushes exact SHA', () => {
    const { remote, work } = docsSetup();
    commitFile(work, 'docs/change.md');
    const head = git(work, 'rev-parse', 'HEAD');
    const r = run(work, ['--push'], { VBP_TYPECHECK_CMD: 'exit 93', VBP_TEST_CMD: 'exit 94' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('VERIFICATION_ROUTE: docs-only');
    expect(r.stdout).not.toContain('STEP: typecheck');
    expect(remoteHead(remote)).toBe(head);
  });
  it('non-origin push remote retains full verification', () => {
    const { remote, work } = docsSetup();
    git(work, 'remote', 'add', 'fork', remote);
    commitFile(work, 'docs/change.md');
    const r = run(work, ['--remote', 'fork', '--push'], { VBP_TYPECHECK_CMD: 'exit 93' });
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain('VERIFICATION_ROUTE: full');
    expect(remoteHead(remote)).toBe('');
  });
  it.each([
    'https://github.com/other/fork.git',
    'https://github.com.evil.example/smallwei0301/vibeaico-admin-rebuild.git',
    'https://github.com/smallwei0301/vibeaico-admin-rebuild.git/other',
    '/tmp/other-repository.git',
  ])('noncanonical effective origin URL uses full verification: %s', (url) => {
    const { remote, work } = docsSetup();
    commitFile(work, 'docs/change.md');
    const r = run(work, ['--push'], { VBP_TEST_ORIGIN_URL: url, VBP_TYPECHECK_CMD: 'exit 93' });
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain('VERIFICATION_ROUTE: full');
    expect(remoteHead(remote)).toBe('');
  });
  it.each([
    'git@github.com:smallwei0301/vibeaico-admin-rebuild.git',
    'ssh://git@github.com/smallwei0301/vibeaico-admin-rebuild.git',
  ])('canonical SSH identity retains docs route: %s', (url) => {
    const { work } = docsSetup();
    commitFile(work, 'docs/change.md');
    const r = run(work, [], { VBP_TEST_ORIGIN_URL: url, VBP_TYPECHECK_CMD: 'exit 93' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('VERIFICATION_ROUTE: docs-only');
  });
  it('explicit docs-only test targets retain the full verification path', () => {
    const { remote, work } = docsSetup();
    commitFile(work, 'docs/change.md');
    const r = run(work, ['--push', '--', 'tests/unit/requested.test.ts'], { VBP_TEST_CMD: 'exit 94' });
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain('STEP: unit tests');
    expect(remoteHead(remote)).toBe('');
  });
  it('mixed source/docs still fails full typecheck without pushing', () => {
    const { remote, work } = docsSetup();
    commitFile(work, 'docs/change.md');
    commitFile(work, 'src/change.ts', 'export const n = 1;\n');
    const r = run(work, ['--push'], { VBP_TYPECHECK_CMD: 'exit 93' });
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain('STEP: typecheck');
    expect(remoteHead(remote)).toBe('');
  });
  it('runtime fixture under docs/metrics does not use docs route', () => {
    const { remote, work } = docsSetup();
    commitFile(work, 'docs/metrics/fake.json', '{}\n');
    const r = run(work, ['--push'], { VBP_TYPECHECK_CMD: 'exit 93' });
    expect(r.status).not.toBe(0);
    expect(remoteHead(remote)).toBe('');
  });
  it('source renamed into docs still uses full verification', () => {
    const { remote, work } = docsSetup();
    mkdirSync(join(work, 'docs'));
    git(work, 'mv', 'a.txt', 'docs/a.md');
    git(work, 'commit', '-q', '-m', 'rename source');
    const r = run(work, ['--push'], { VBP_TYPECHECK_CMD: 'exit 93' });
    expect(r.status).not.toBe(0);
    expect(remoteHead(remote)).toBe('');
  });
  it('candidate cannot forge its own classifier to call source docs-only', () => {
    const { remote, work } = docsSetup();
    commitFile(work, 'scripts/ci/classify-changes.mjs', "export const classifyChangeRecords = () => ({docsOnly:true});\nexport const parseNameStatus = () => [];\n");
    commitFile(work, 'src/change.ts');
    const r = run(work, ['--push'], { VBP_TYPECHECK_CMD: 'exit 93' });
    expect(r.status).not.toBe(0);
    expect(remoteHead(remote)).toBe('');
  });
  it('empty diff does not receive docs-only exemption', () => {
    const { remote, work } = docsSetup();
    const r = run(work, ['--push'], { VBP_TYPECHECK_CMD: 'exit 93' });
    expect(r.status).not.toBe(0);
    expect(remoteHead(remote)).toBe('');
  });
  it('missing trusted classifier falls back to full gate', () => {
    const { remote, work } = docsSetup();
    git(work, 'rm', 'scripts/ci/classify-changes.mjs');
    git(work, 'commit', '-q', '-m', 'main no classifier');
    git(work, 'push', '-q', 'origin', 'HEAD:refs/heads/main');
    commitFile(work, 'docs/change.md');
    const r = run(work, ['--push'], { VBP_TYPECHECK_CMD: 'exit 93' });
    expect(r.status).not.toBe(0);
    expect(remoteHead(remote)).toBe('');
  });
  it('narrow fetch refspec cannot reuse stale origin/main docs policy', () => {
    const { root, remote, work } = docsSetup();
    git(work, 'fetch', 'origin');
    const staleMain = git(work, 'rev-parse', 'origin/main');
    git(work, 'push', '-q', 'origin', `HEAD:refs/heads/${BRANCH}`);
    const before = remoteHead(remote);
    const other = join(root, 'other-main');
    git(root, 'clone', '-q', '-b', 'main', remote, other);
    git(other, 'rm', 'scripts/ci/classify-changes.mjs');
    git(other, 'commit', '-q', '-m', 'remove classifier on live main');
    git(other, 'push', '-q', 'origin', 'main');
    git(work, 'config', '--replace-all', 'remote.origin.fetch', `+refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}`);
    commitFile(work, 'docs/change.md');
    const r = run(work, ['--push'], { VBP_TYPECHECK_CMD: 'exit 93', VBP_TEST_CMD: 'exit 94' });
    expect(git(work, 'rev-parse', 'origin/main')).toBe(staleMain);
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain('VERIFICATION_ROUTE: full');
    expect(r.stdout).toContain('STEP: typecheck');
    expect(remoteHead(remote)).toBe(before);
  });
  it('docs whitespace error is real failure and remote remains untouched', () => {
    const { remote, work } = docsSetup();
    commitFile(work, 'docs/change.md', 'bad trailing whitespace   \n');
    const r = run(work, ['--push']);
    expect(r.status).not.toBe(0);
    expect(remoteHead(remote)).toBe('');
  });
  it('dirty docs candidate remains rejected before classification', () => {
    const { remote, work } = docsSetup();
    commitFile(work, 'docs/change.md');
    writeFileSync(join(work, 'docs/change.md'), 'changed after commit\n');
    const r = run(work, ['--push']);
    expect(r.status).not.toBe(0);
    expect(remoteHead(remote)).toBe('');
  });
});
