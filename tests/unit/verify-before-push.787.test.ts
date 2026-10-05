/**
 * #787（PB-038 升級）：推送前驗證入口必須在任一步失敗時非零退出，而且不執行 push。
 *
 * 每個案例都建立一組真實的 git 環境（bare remote + clone），以 VBP_TYPECHECK_CMD／VBP_TEST_CMD
 * 取代實際的 typecheck／test，最後直接讀 bare remote 的 refs 判斷「到底有沒有推上去」——
 * 不信任腳本自己印出的訊息。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(__dirname, '../../scripts/agents/verify-before-push.sh');
const BRANCH = 'feature/x';
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
    env: { ...process.env, ...gitEnv, VBP_TYPECHECK_CMD: 'true', VBP_TEST_CMD: 'true', ...env },
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
