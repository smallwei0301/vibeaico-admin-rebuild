import { execFileSync, readFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync as runFile, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const ROOT = resolve(process.cwd());
const SCRIPT = resolve(ROOT, 'scripts/ci/vercel-ignore-build.mjs');
const tempDirs: string[] = [];

type DeploymentPolicy = Record<string, boolean>;

function runIgnore(
  env: Record<string, string>,
  cwd = ROOT,
): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [SCRIPT], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

function git(cwd: string, ...args: string[]): string {
  return runFile('git', args, { cwd, encoding: 'utf8' }).trim();
}

function commit(cwd: string, message: string): string {
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-m', message);
  return git(cwd, 'rev-parse', 'HEAD');
}

afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe('Issue #141 Vercel automatic deployment policy', () => {
  it('uses a slash-safe deny-by-default rule with only main and explicit Preview enabled', () => {
    const config = JSON.parse(readFileSync(resolve(ROOT, 'vercel.json'), 'utf8')) as {
      git: { deploymentEnabled: DeploymentPolicy };
      ignoreCommand: string;
    };

    expect(config.git.deploymentEnabled).toEqual({
      '**': false,
      main: true,
      'preview/**': true,
    });
    expect(config.git.deploymentEnabled['*']).toBeUndefined();
    expect(config.ignoreCommand).toBe('node scripts/ci/vercel-ignore-build.mjs');
  });

  it.each([
    'product/issue-42-plan-quick-edit-v1',
    'claude/project-governance-rules-vraejm',
    'governance/scorecard-cleanup',
    'ordinary-branch',
  ])('ignores an ordinary branch before doing a Git comparison: %s', (ref) => {
    const result = runIgnore({ VERCEL_GIT_COMMIT_REF: ref });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('skip automatic deployment');
  });

  it('continues an explicitly named Preview acceptance branch', () => {
    const result = runIgnore({ VERCEL_GIT_COMMIT_REF: 'preview/issue-42-acceptance' });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('build explicit acceptance branch');
  });

  it('continues main fail-safe when Vercel cannot provide comparison SHAs', () => {
    const result = runIgnore({
      VERCEL_GIT_COMMIT_REF: 'main',
      VERCEL_GIT_COMMIT_SHA: '',
      VERCEL_GIT_PREVIOUS_SHA: '',
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('build fail-safe');
  });

  it('skips a docs-only main commit but builds a runtime main commit', () => {
    const repo = mkdtempSync(join(tmpdir(), 'vercel-ignore-'));
    tempDirs.push(repo);
    git(repo, 'init');
    git(repo, 'config', 'user.email', 'ci@example.test');
    git(repo, 'config', 'user.name', 'CI');

    mkdirSync(join(repo, 'docs'), { recursive: true });
    writeFileSync(join(repo, 'docs', 'note.md'), 'baseline\n');
    const baseline = commit(repo, 'baseline docs');

    writeFileSync(join(repo, 'docs', 'note.md'), 'docs only\n');
    const docsOnly = commit(repo, 'docs only');
    const skipped = runIgnore({
      VERCEL_GIT_COMMIT_REF: 'main',
      VERCEL_GIT_PREVIOUS_SHA: baseline,
      VERCEL_GIT_COMMIT_SHA: docsOnly,
    }, repo);
    expect(skipped.status).toBe(0);
    expect(skipped.stdout).toContain('skip full build');

    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src', 'runtime.ts'), 'export const live = true;\n');
    const runtime = commit(repo, 'runtime change');
    const built = runIgnore({
      VERCEL_GIT_COMMIT_REF: 'main',
      VERCEL_GIT_PREVIOUS_SHA: docsOnly,
      VERCEL_GIT_COMMIT_SHA: runtime,
    }, repo);
    expect(built.status).toBe(1);
    expect(built.stdout).toContain('continue deployment');
  });
});
