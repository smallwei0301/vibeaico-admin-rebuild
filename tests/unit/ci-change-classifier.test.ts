import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  classifyChangeRecords,
  classifyEvent,
  parseNameStatus,
} from '../../scripts/ci/classify-changes.mjs';

const output = (...parts: string[]) => Buffer.from(parts.join('\0'));
const baseSha = 'a'.repeat(40);
const headSha = 'b'.repeat(40);
const classifierScript = resolve(process.cwd(), 'scripts/ci/classify-changes.mjs');

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

describe('CI change classifier', () => {
  it('accepts only the explicit documentation allowlist, including spaces', () => {
    const records = parseNameStatus(output(
      'M', 'docs/CI policy with spaces.md',
      'A', 'README.md',
      'D', 'AGENTS.md',
      'M', 'CLAUDE.md',
      'A', '.agents/skills/ci/SKILL.md',
      'M', '.claude/settings.json',
    ));

    expect(classifyChangeRecords(records)).toMatchObject({ docsOnly: true, reason: 'docs-only', changedCount: 6 });
  });

  it('treats exact dependency, seed, and deleted runtime paths as full CI', () => {
    expect(classifyChangeRecords(parseNameStatus(output('A', 'package-lock.json'))))
      .toMatchObject({ docsOnly: false, reason: 'non-docs-change', runtimePath: 'package-lock.json' });
    expect(classifyChangeRecords(parseNameStatus(output('A', 'scripts/test/seed.mjs'))))
      .toMatchObject({ docsOnly: false, reason: 'non-docs-change', runtimePath: 'scripts/test/seed.mjs' });
    expect(classifyChangeRecords(parseNameStatus(output('D', 'src/old.ts'))))
      .toMatchObject({ docsOnly: false, reason: 'non-docs-change', runtimePath: 'src/old.ts' });
  });

  it('fails closed for runtime, workflow, and root files outside the allowlist', () => {
    for (const path of ['src/app/page.tsx', '.github/workflows/ci.yml', 'package.json', 'docs-archive/readme.md', 'docs/unsafe\nname.md']) {
      const records = parseNameStatus(output('M', path));
      expect(classifyChangeRecords(records)).toMatchObject({ docsOnly: false, reason: 'non-docs-change', runtimePath: path });
    }
  });

  it('checks both old and new paths of a rename', () => {
    expect(classifyChangeRecords(parseNameStatus(output(
      'R100', 'docs/old name.md', 'docs/new name.md',
    )))).toMatchObject({ docsOnly: true, reason: 'docs-only' });

    expect(classifyChangeRecords(parseNameStatus(output(
      'R100', 'src/runtime.ts', 'docs/runtime notes.md',
    )))).toMatchObject({ docsOnly: false, reason: 'non-docs-change', runtimePath: 'src/runtime.ts' });

    expect(classifyChangeRecords(parseNameStatus(output(
      'R100', 'docs/runtime notes.md', 'src/runtime.ts',
    )))).toMatchObject({ docsOnly: false, reason: 'non-docs-change', runtimePath: 'src/runtime.ts' });
  });

  it('fails closed for empty or malformed diffs', () => {
    expect(classifyChangeRecords([])).toMatchObject({ docsOnly: false, reason: 'classifier_failed', detail: 'empty-diff', changedCount: 0 });
    expect(classifyChangeRecords([{ kind: 'M', paths: null }])).toMatchObject({
      docsOnly: false,
      reason: 'non-docs-change',
      runtimePath: '',
    });
    expect(() => parseNameStatus(output('R100', 'docs/old.md'))).toThrow('rename');
    expect(() => parseNameStatus(output('Q', 'docs/unknown.md'))).toThrow('Unsupported');
  });

  it('uses PR base-to-head and main push before-to-after revisions', () => {
    const calls: string[][] = [];
    const runGit = (...args: string[]) => {
      calls.push(args);
      return output('M', 'docs/runbook.md');
    };

    expect(classifyEvent('pull_request', {
      pull_request: { base: { sha: baseSha }, head: { sha: headSha } },
    }, runGit)).toMatchObject({ docsOnly: true, reason: 'docs-only' });
    expect(calls).toEqual([['diff', '--name-status', '-z', '--find-renames', baseSha, headSha]]);

    calls.length = 0;
    expect(classifyEvent('push', { ref: 'refs/heads/main', before: baseSha, after: headSha }, runGit))
      .toMatchObject({ docsOnly: true, reason: 'docs-only' });
    expect(calls).toEqual([['diff', '--name-status', '-z', '--find-renames', baseSha, headSha]]);
  });

  it('uses the explicit base for a workflow_dispatch merge commit', () => {
    const calls: string[][] = [];
    const mergeCommitSha = 'c'.repeat(40);
    const runGit = (...args: string[]) => {
      calls.push(args);
      return output('A', 'supabase/migrations/0084_dispatch.sql');
    };

    expect(classifyEvent('workflow_dispatch', {
      inputs: {
        dispatch_reason: 'lane_transition',
        base_revision: baseSha,
        expected_head: mergeCommitSha,
      },
    }, runGit)).toMatchObject({
      docsOnly: false,
      reason: 'non-docs-change',
      baseRevision: baseSha,
      headRevision: mergeCommitSha,
    });
    expect(calls).toEqual([[
      'diff', '--name-status', '-z', '--find-renames', baseSha, mergeCommitSha,
    ]]);
  });

  it('fails closed for dispatch without explicit revisions, non-main pushes, and git errors', () => {
    const noGit = () => { throw new Error('git failed'); };

    expect(classifyEvent('workflow_dispatch', {
      inputs: { dispatch_reason: 'lane_transition', base_revision: baseSha },
    }, noGit)).toMatchObject({
      docsOnly: false,
      reason: 'classifier_failed',
      detail: 'workflow-dispatch-missing-revision',
    });
    expect(classifyEvent('pull_request', { pull_request: { base: {} } }, noGit))
      .toMatchObject({ docsOnly: false, reason: 'classifier_failed', detail: 'missing-revision' });
    expect(classifyEvent('push', { ref: 'refs/heads/feature', before: baseSha, after: headSha }, noGit))
      .toMatchObject({ docsOnly: false, reason: 'classifier_failed', detail: 'unsupported-event' });
    expect(classifyEvent('push', { ref: 'refs/heads/main', before: baseSha, after: headSha }, noGit))
      .toMatchObject({ docsOnly: false, reason: 'classifier_failed', detail: 'git-or-parse-failure' });
  });


  it('fails closed before git for invalid extracted PR and main-push revisions', () => {
    const gitCalls: string[][] = [];
    const runGit = (...args: string[]) => {
      gitCalls.push(args);
      return output('M', 'docs/runbook.md');
    };

    const cases = [
      {
        eventName: 'pull_request',
        event: { pull_request: { base: { sha: baseSha }, head: { sha: '0'.repeat(40) } } },
      },
      {
        eventName: 'push',
        event: { ref: 'refs/heads/main', before: '0'.repeat(40), after: headSha },
      },
      {
        eventName: 'push',
        event: { ref: 'refs/heads/main', before: baseSha, after: 'not-a-sha' },
      },
    ];

    for (const { eventName, event } of cases) {
      expect(classifyEvent(eventName, event, runGit)).toMatchObject({
        docsOnly: false,
        reason: 'classifier_failed',
        detail: 'missing-revision',
      });
      expect(gitCalls).toEqual([]);
    }
  });

  it('never forwards rejected dispatch revisions through the GitHub output protocol', () => {
    for (const badRevision of ['', 'HEAD', `${baseSha}\ndocs_only=true`, `${baseSha}\r\nhead_revision=${headSha}`]) {
      const directory = mkdtempSync(join(tmpdir(), 'ci-classifier-output-'));
      try {
        const eventPath = join(directory, 'event.json');
        const outputPath = join(directory, 'github-output.txt');
        writeFileSync(eventPath, JSON.stringify({
          inputs: { base_revision: badRevision, expected_head: headSha },
        }));

        execFileSync(process.execPath, [classifierScript], {
          cwd: directory,
          env: {
            ...process.env,
            GITHUB_EVENT_NAME: 'workflow_dispatch',
            GITHUB_EVENT_PATH: eventPath,
            GITHUB_OUTPUT: outputPath,
          },
        });

        expect(readFileSync(outputPath, 'utf8')).toBe(
          'docs_only=false\nreason=classifier_failed\ndetail=workflow-dispatch-missing-revision\n' +
          'changed_count=0\nruntime_path=\nbase_revision=\nhead_revision=\n',
        );
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  });

  it('classifies a real two-parent merge using the PR base and merge candidate', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ci-classifier-merge-'));
    try {
      git(directory, 'init', '--initial-branch=main');
      git(directory, 'config', 'user.email', 'ci@example.test');
      git(directory, 'config', 'user.name', 'CI test');
      mkdirSync(join(directory, 'docs'));
      writeFileSync(join(directory, 'docs', 'base.md'), 'base\n');
      git(directory, 'add', '.');
      git(directory, 'commit', '-m', 'base');

      git(directory, 'checkout', '-b', 'candidate');
      writeFileSync(join(directory, 'docs', 'candidate.md'), 'candidate\n');
      git(directory, 'add', '.');
      git(directory, 'commit', '-m', 'candidate docs');

      git(directory, 'checkout', 'main');
      writeFileSync(join(directory, 'docs', 'main.md'), 'main\n');
      git(directory, 'add', '.');
      git(directory, 'commit', '-m', 'main docs');
      const prBase = git(directory, 'rev-parse', 'HEAD');
      git(directory, 'merge', '--no-ff', 'candidate', '-m', 'merge candidate');
      const mergeHead = git(directory, 'rev-parse', 'HEAD');
      expect(git(directory, 'rev-list', '--parents', '-n', '1', 'HEAD').split(' ')).toHaveLength(3);

      const eventPath = join(directory, 'event.json');
      const outputPath = join(directory, 'github-output.txt');
      writeFileSync(eventPath, JSON.stringify({
        inputs: { base_revision: prBase, expected_head: mergeHead },
      }));
      execFileSync(process.execPath, [classifierScript], {
        cwd: directory,
        env: {
          ...process.env,
          GITHUB_EVENT_NAME: 'workflow_dispatch',
          GITHUB_EVENT_PATH: eventPath,
          GITHUB_OUTPUT: outputPath,
        },
      });

      expect(readFileSync(outputPath, 'utf8')).toContain(`docs_only=true\n`);
      expect(readFileSync(outputPath, 'utf8')).toContain(`base_revision=${prBase}\nhead_revision=${mergeHead}\n`);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
