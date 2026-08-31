import { describe, expect, it } from 'vitest';
import {
  classifyChangeRecords,
  classifyEvent,
  parseNameStatus,
} from '../../scripts/ci/classify-changes.mjs';

const output = (...parts: string[]) => Buffer.from(parts.join('\0'));
const baseSha = 'a'.repeat(40);
const headSha = 'b'.repeat(40);

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

  it('fails closed for dispatch, missing revisions, non-main pushes, and git errors', () => {
    const noGit = () => { throw new Error('git failed'); };

    expect(classifyEvent('workflow_dispatch', {}, noGit)).toMatchObject({ docsOnly: false, reason: 'classifier_failed', detail: 'workflow-dispatch' });
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
});
