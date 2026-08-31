#!/usr/bin/env node

import { appendFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const DOCS_ONLY_PATHS = [
  'README.md',
  'AGENTS.md',
  'CLAUDE.md',
];

/** A path is safe for the lightweight documentation CI route only when explicitly listed. */
export function isDocsOnlyPath(path) {
  return typeof path === 'string'
    && !/[\r\n]/.test(path)
    && (DOCS_ONLY_PATHS.includes(path)
    || path.startsWith('docs/')
    || path.startsWith('.agents/')
    || path.startsWith('.claude/'));
}

/**
 * Parse `git diff --name-status -z` without shell quoting, so filenames containing spaces
 * (or other printable characters) retain their exact paths. Renames carry old and new paths.
 */
export function parseNameStatus(output) {
  if (!Buffer.isBuffer(output)) throw new Error('Expected git diff output as a Buffer');

  const fields = output.toString('utf8').split('\0');
  if (fields.at(-1) === '') fields.pop();

  const records = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    if (!status) throw new Error('Malformed empty status');

    const kind = status[0];
    if (!['A', 'M', 'D', 'R'].includes(kind)) {
      throw new Error(`Unsupported git diff status: ${status}`);
    }

    if (kind === 'R') {
      const oldPath = fields[index++];
      const newPath = fields[index++];
      if (!oldPath || !newPath) throw new Error('Malformed rename record');
      records.push({ kind, paths: [oldPath, newPath] });
      continue;
    }

    const path = fields[index++];
    if (!path) throw new Error(`Malformed ${kind} record`);
    records.push({ kind, paths: [path] });
  }

  return records;
}

export function classifyChangeRecords(records) {
  const changedPaths = Array.isArray(records)
    ? records.flatMap((record) => (
      Array.isArray(record?.paths)
        ? record.paths.filter((path) => typeof path === 'string')
        : []
    ))
    : [];

  if (!Array.isArray(records) || records.length === 0) {
    return classifierFailure('empty-diff', 0, '', changedPaths);
  }

  const runtimeRecord = records.find((record) => (
    !['A', 'M', 'D', 'R'].includes(record.kind)
    || !Array.isArray(record.paths)
    || record.paths.length === 0
    || record.paths.some((path) => !isDocsOnlyPath(path))
  ));

  if (runtimeRecord) {
    return runtimeResult(
      records.length,
      Array.isArray(runtimeRecord.paths)
        ? runtimeRecord.paths.find((path) => !isDocsOnlyPath(path)) ?? ''
        : '',
      changedPaths,
    );
  }

  return {
    docsOnly: true,
    reason: 'docs-only',
    detail: 'allowlist-only',
    changedCount: records.length,
    runtimePath: '',
    changedPaths,
  };
}

function runtimeResult(changedCount, runtimePath, changedPaths = []) {
  return { docsOnly: false, reason: 'non-docs-change', detail: 'runtime-path', changedCount, runtimePath, changedPaths };
}

function classifierFailure(detail, changedCount = 0, runtimePath = '', changedPaths = []) {
  return { docsOnly: false, reason: 'classifier_failed', detail, changedCount, runtimePath, changedPaths };
}

/**
 * GitHub supplies commit SHAs for both supported event types. Reject anything that is
 * not a complete SHA-1. Git remains the authority for resolving
 * the revision, but an empty, malformed, or all-zero SHA (for example, the first push
 * to a branch) must fail closed before invoking git.
 */
function isUsableRevision(revision) {
  return typeof revision === 'string'
    && /^(?!0{40}$)[0-9a-f]{40}$/i.test(revision);
}

/**
 * Classify only the revisions that triggered CI. Any unexpected event, malformed payload,
 * unavailable git revision, parse error, or empty diff is deliberately a full runtime run.
 */
export function classifyEvent(eventName, event, runGit = defaultRunGit) {
  if (eventName === 'workflow_dispatch') {
    return withRevisions(classifierFailure('workflow-dispatch'));
  }

  let base;
  let head;
  if (eventName === 'pull_request') {
    base = event?.pull_request?.base?.sha;
    head = event?.pull_request?.head?.sha;
  } else if (eventName === 'push' && event?.ref === 'refs/heads/main') {
    base = event.before;
    head = event.after;
  } else {
    return withRevisions(classifierFailure('unsupported-event'));
  }

  if (!isUsableRevision(base) || !isUsableRevision(head)) {
    return withRevisions(classifierFailure('missing-revision'));
  }

  try {
    return withRevisions(classifyChangeRecords(parseNameStatus(
      runGit('diff', '--name-status', '-z', '--find-renames', base, head),
    )), base, head);
  } catch {
    return withRevisions(classifierFailure('git-or-parse-failure'), base, head);
  }
}

function withRevisions(result, baseRevision = '', headRevision = '') {
  return { ...result, baseRevision, headRevision };
}

function defaultRunGit(...args) {
  return execFileSync('git', args, { encoding: 'buffer' });
}

function writeGithubOutput(result) {
  if (!process.env.GITHUB_OUTPUT) return;
  // The environment-file protocol is line-based; newline filenames must not create outputs.
  const runtimePath = result.runtimePath.replaceAll('\r', '%0D').replaceAll('\n', '%0A');
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `docs_only=${result.docsOnly}\nreason=${result.reason}\ndetail=${result.detail}\n` +
      `changed_count=${result.changedCount}\nruntime_path=${runtimePath}\n` +
      `base_revision=${result.baseRevision}\nhead_revision=${result.headRevision}\n`,
  );
}

function writeGithubSummary(result) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  const renderPath = (path) => `\`${String(path).replaceAll(/[\r\n]/g, ' ').replaceAll('`', '\\`')}\``;
  const runtimePath = result.runtimePath ? renderPath(result.runtimePath) : 'none';
  const changedPaths = Array.isArray(result.changedPaths) ? result.changedPaths : [];
  const changedPathList = changedPaths.length > 0
    ? changedPaths.map((path) => `- ${renderPath(path)}`).join('\n')
    : '- none';
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    '## CI change classification\n\n' +
      `- Route: ${result.docsOnly ? 'docs-only lightweight' : 'full runtime'}\n` +
      `- Reason: ${result.reason}\n` +
      `- Detail: ${result.detail}\n` +
      `- Changed records: ${result.changedCount}\n` +
      '- Changed paths (including both sides of renames):\n' +
      changedPathList + '\n' +
      `- First runtime path: ${runtimePath}\n`,
  );
}

function main() {
  let event = {};
  try {
    if (!process.env.GITHUB_EVENT_PATH) throw new Error('GITHUB_EVENT_PATH is not set');
    event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  } catch {
    const result = classifierFailure('event-parse-failure');
    writeGithubOutput(result);
    writeGithubSummary(result);
    console.log(JSON.stringify(result));
    return;
  }

  const result = classifyEvent(process.env.GITHUB_EVENT_NAME, event);
  writeGithubOutput(result);
  writeGithubSummary(result);
  console.log(JSON.stringify(result));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
