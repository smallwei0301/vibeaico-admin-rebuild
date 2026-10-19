#!/usr/bin/env node

import { appendFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const DOCS_ONLY_PATHS = [
  'README.md',
  'AGENTS.md',
  'CLAUDE.md',
];

/*
 * `docs/metrics/**` lives under `docs/` but is not documentation: the Run
 * ledgers, their rendered reports, the scoreboard policy and the review
 * evidence are read as fixtures by tests/unit/governance-scoreboard.test.ts
 * and the agent-run-scorecard workflow. Routing them down the lightweight
 * documentation lane let a ledger change turn `main` red with CI green
 * (2026-09-14, PR #412). Fail closed to full runtime CI instead.
 */
const RUNTIME_FIXTURE_PREFIXES = [
  'docs/metrics/',
];

/** A path is safe for the lightweight documentation CI route only when explicitly listed. */
export function isDocsOnlyPath(path) {
  if (typeof path !== 'string' || /[\r\n]/.test(path)) return false;
  if (RUNTIME_FIXTURE_PREFIXES.some((prefix) => path.startsWith(prefix))) return false;
  return DOCS_ONLY_PATHS.includes(path)
    || path.startsWith('docs/')
    || path.startsWith('.agents/')
    || path.startsWith('.claude/');
}

/*
 * Main-push tooling-only lane (Owner 2026-10-19). Governance/metrics tooling and unit
 * tests that the shared-TEST integration + E2E job never loads need not re-run that
 * ~40 min serialized job on main. Strictly additive to docs-only: every changed path
 * must be docs-only OR under one of these prefixes, AND no changed path may be in the
 * statically computed integration/E2E reachable set. Anything else fails closed.
 */
const TOOLING_PREFIXES = ['scripts/agents/', 'scripts/metrics/', 'tests/unit/', 'docs/metrics/'];
// 跳過判定本身的模組不得因「只改它」而跳過共用 TEST（fail closed）。
const NEVER_TOOLING_PATHS = new Set(['scripts/agents/integration-reachability.mjs', 'scripts/agents/same-sha-g3-reuse.mjs']);

export function isToolingCandidatePath(path) {
  if (typeof path !== 'string' || /[\r\n]/.test(path) || path.includes('..')) return false;
  if (NEVER_TOOLING_PATHS.has(path)) return false;
  return isDocsOnlyPath(path) || TOOLING_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * @param {Array} records parsed name-status records
 * @param {() => Set<string>} computeReachable throws when reachability is uncertain
 */
export function classifyToolingOnly(records, computeReachable) {
  const no = (detail) => ({ toolingOnly: false, toolingDetail: detail });
  if (!Array.isArray(records) || records.length === 0) return no('empty-diff');
  const paths = [];
  for (const record of records) {
    if (!['A', 'M', 'D', 'R'].includes(record?.kind) || !Array.isArray(record.paths) || record.paths.length === 0) {
      return no('malformed-record');
    }
    paths.push(...record.paths);
  }
  if (paths.some((path) => typeof path !== 'string' || !isToolingCandidatePath(path))) return no('non-tooling-path');
  if (paths.every((path) => isDocsOnlyPath(path))) return no('docs-only');
  if (typeof computeReachable !== 'function') return no('reachability-unavailable');
  const scripted = paths.filter((path) => path.startsWith('scripts/agents/') || path.startsWith('scripts/metrics/') || path.startsWith('tests/unit/'));
  let reachable;
  try { reachable = computeReachable(); } catch { return no('reachability-uncertain'); }
  if (!(reachable instanceof Set)) return no('reachability-uncertain');
  const hit = scripted.find((path) => reachable.has(path));
  if (hit) return no(`integration-reachable:${hit}`);
  return { toolingOnly: true, toolingDetail: 'tooling-allowlist-unreachable' };
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

/** @param {any} records @param {{ computeReachable?: (() => Set<string>) | null }} [options] */
export function classifyChangeRecords(records, /** @type {{ computeReachable?: (() => Set<string>) | null }} */ { computeReachable = null } = {}) {
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
      classifyToolingOnly(records, computeReachable),
    );
  }

  return {
    docsOnly: true,
    toolingOnly: false,
    toolingDetail: 'docs-only',
    reason: 'docs-only',
    detail: 'allowlist-only',
    changedCount: records.length,
    runtimePath: '',
    changedPaths,
  };
}

function runtimeResult(changedCount, runtimePath, changedPaths = [], tooling = { toolingOnly: false, toolingDetail: 'non-tooling-path' }) {
  return {
    docsOnly: false, ...tooling, reason: 'non-docs-change', detail: 'runtime-path', changedCount, runtimePath, changedPaths,
  };
}

function classifierFailure(detail, changedCount = 0, runtimePath = '', changedPaths = []) {
  return { docsOnly: false, toolingOnly: false, toolingDetail: 'classifier_failed', reason: 'classifier_failed', detail, changedCount, runtimePath, changedPaths };
}

/**
 * GitHub supplies commit SHAs for both supported event types. Reject anything that is
 * not a complete SHA-1. Git remains the authority for resolving
 * the revision, but an empty, malformed, or all-zero SHA (for example, the first push
 * to a branch) must fail closed before invoking git.
 */
export function isUsableRevision(revision) {
  return typeof revision === 'string'
    && /^(?!0{40}$)[0-9a-f]{40}$/i.test(revision);
}

/**
 * Classify only the revisions that triggered CI. Any unexpected event, malformed payload,
 * unavailable git revision, parse error, or empty diff is deliberately a full runtime run.
 */
/** @param {(() => Set<string>) | null} [computeReachable] */
export function classifyEvent(eventName, event, runGit = defaultRunGit, computeReachable = null) {
  if (eventName === 'workflow_dispatch') {
    const base = event?.inputs?.base_revision;
    const head = event?.inputs?.expected_head;
    const baseRevision = typeof base === 'string' ? base : '';
    const headRevision = typeof head === 'string' ? head : '';

    // A dispatched run is used for TEST lane transitions, so it must compare the
    // exact PR base to the exact dispatched head. Never leave either revision
    // empty: the downstream integrity guard must not silently choose HEAD^.
    if (!isUsableRevision(baseRevision) || !isUsableRevision(headRevision)) {
      return withRevisions(classifierFailure('workflow-dispatch-missing-revision'));
    }

    try {
      return withRevisions(classifyChangeRecords(parseNameStatus(
        runGit('diff', '--name-status', '-z', '--find-renames', baseRevision, headRevision),
      )), baseRevision, headRevision);
    } catch {
      return withRevisions(classifierFailure('git-or-parse-failure'), baseRevision, headRevision);
    }
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
    // Only a main push may take the tooling-only lane; PRs and dispatches keep full routing.
    const reachability = eventName === 'push' ? computeReachable : null;
    return withRevisions(classifyChangeRecords(parseNameStatus(
      runGit('diff', '--name-status', '-z', '--find-renames', base, head),
    ), { computeReachable: reachability }), base, head);
  } catch {
    return withRevisions(classifierFailure('git-or-parse-failure'), base, head);
  }
}

function withRevisions(result, baseRevision = '', headRevision = '') {
  // Revisions cross a line-based GitHub output boundary. Never preserve rejected
  // dispatch input here: an embedded CR/LF could create a forged output key.
  return {
    ...result,
    baseRevision: isUsableRevision(baseRevision) ? baseRevision : '',
    headRevision: isUsableRevision(headRevision) ? headRevision : '',
  };
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
    `docs_only=${result.docsOnly}\ntooling_only=${result.toolingOnly === true}\n` +
      `tooling_detail=${String(result.toolingDetail ?? '').replaceAll(/[\r\n]/g, ' ')}\nreason=${result.reason}\ndetail=${result.detail}\n` +
      `changed_count=${result.changedCount}\nruntime_path=${runtimePath}\n` +
      `base_revision=${isUsableRevision(result.baseRevision) ? result.baseRevision : ''}\n` +
      `head_revision=${isUsableRevision(result.headRevision) ? result.headRevision : ''}\n`,
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
      `- Route: ${result.docsOnly ? 'docs-only lightweight' : result.toolingOnly ? 'tooling-only (main push skips shared TEST)' : 'full runtime'}\n` +
      `- Tooling-only: ${result.toolingOnly === true} (${result.toolingDetail ?? 'n/a'})\n` +
      `- Reason: ${result.reason}\n` +
      `- Detail: ${result.detail}\n` +
      `- Changed records: ${result.changedCount}\n` +
      '- Changed paths (including both sides of renames):\n' +
      changedPathList + '\n' +
      `- First runtime path: ${runtimePath}\n`,
  );
}

// Loaded lazily: verify-before-push.sh evaluates this file alone from a data: URL, so it
// must keep zero static relative imports.
async function main() {
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

  let computeReachable = null;
  try {
    const { computeIntegrationReachableSet } = await import('../agents/integration-reachability.mjs');
    computeReachable = () => computeIntegrationReachableSet(process.cwd());
  } catch { /* fail closed: tooling_only stays false */ }
  const result = classifyEvent(process.env.GITHUB_EVENT_NAME, event, defaultRunGit, computeReachable);
  writeGithubOutput(result);
  writeGithubSummary(result);
  console.log(JSON.stringify(result));
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
