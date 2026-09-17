import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { validateRunLedger } from './run-ledger.mjs';
import { validateRunLedgerV2 } from './run-ledger-v2.mjs';
import { analyzeScorecardReadiness } from './scorecard-readiness.mjs';
import { readField, readLifecycleIssue } from './agent-wip-policy.mjs';

export const isRunLedgerPath = (name) => typeof name === 'string'
  && name.startsWith('docs/metrics/agent-runs/') && name.endsWith('.json');
const canonicalPath = (name) => path.posix.normalize(name) === name
  && !name.includes('\\') && !name.includes('\0');
const failure = (name, reason) => [`SCORECARD_CAPTURE_REJECTED ${name}: ${reason}`];

// Product work must be bound even when its PR does not edit a ledger. Origin is not an exemption.
const bindingFailure = (reason) => [`PRODUCT_RUN_BINDING_REJECTED: ${reason}`];
export function productRunBinding(body = '') {
  if (readField(body, 'WORKSTREAM').toUpperCase() !== 'PRODUCT_MAINLINE') return null;
  const runId = readField(body, 'RUN_ID');
  const scorecard = readField(body, 'SCORECARD_PATH');
  const issue = readLifecycleIssue(body);
  const errors = [];
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(runId)
    || /^(none|unknown|null|undefined)$/i.test(runId)) errors.push(...bindingFailure('concrete RUN_ID required'));
  const ledgerPath = `docs/metrics/agent-runs/${runId}.json`;
  // The existing Markdown scorecard points to the same authoritative JSON, never arbitrary files.
  if (![ledgerPath, ledgerPath.replace(/\.json$/, '.md')].includes(scorecard)) {
    errors.push(...bindingFailure('SCORECARD_PATH must identify the RUN_ID JSON or its generated Markdown'));
  }
  if (!issue) errors.push(...bindingFailure('pr-lifecycle issue identity required'));
  return { runId, ledgerPath, issue, errors };
}

/** Validate the same bytes on both paths. This verifies recorded facts, not runtime model identity. */
export function validateProductRunContent(body, content) {
  const binding = productRunBinding(body);
  if (!binding) return [];
  if (binding.errors.length) return binding.errors;
  const errors = validateRunLedgerContent(binding.ledgerPath, content);
  if (errors.length) return errors;
  const run = JSON.parse(content);
  if (run.schemaVersion !== 2 || run.deliveryTruthVersion !== 4
    || !['IN_PROGRESS', 'CLOSURE_RECOVERY'].includes(run.status)
    || run.closeout?.state !== 'OPEN'
    || !['PRODUCT_MAIN_SESSION', 'OWNER'].includes(run.closeout?.ownerRole)) {
    return bindingFailure('an active Product-owned v4 Run is required; historical/closed Runs cannot be borrowed');
  }
  if (run.runId !== binding.runId) errors.push(...bindingFailure('ledger runId differs from RUN_ID'));
  if (!run.sources.some(source => source.ref === `issue/${binding.issue}`)) {
    errors.push(...bindingFailure(`Run sources must include exact issue/${binding.issue}`));
  }
  if (run.delivery.issuesStarted < 1 || !run.modelUsage.tasks.some(task => task.count > 0)) {
    errors.push(...bindingFailure('Product PR needs observed task activity; an empty Run is not capture evidence'));
  }
  return errors;
}

function readLocalLedger(repositoryRoot, name) {
  const target = path.resolve(realpathSync(repositoryRoot), name);
  if (realpathSync(target) !== target) throw new Error('symlink is not a ledger file');
  return new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(target));
}

function decodeExactBlob(data, expectedSha) {
  if (data?.encoding !== 'base64' || typeof data.content !== 'string'
    || !/^[a-f0-9]{40}$/.test(expectedSha ?? '')) throw new Error('missing bytes');
  const bytes = Buffer.from(data.content, 'base64');
  const digest = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  if (digest !== expectedSha || data.sha !== expectedSha || data.size !== bytes.length) throw new Error('incomplete bytes');
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export function validateLocalProductRunBinding({ body = '', repositoryRoot = process.cwd() } = {}) {
  const binding = productRunBinding(body);
  if (!binding) return [];
  if (binding.errors.length) return binding.errors;
  try { return validateProductRunContent(body, readLocalLedger(repositoryRoot, binding.ledgerPath)); }
  catch { return bindingFailure('bound regular JSON ledger unavailable'); }
}

/** @param {{github?: any, owner?: string, repo?: string, current?: any}} [input] */
export async function validateGithubProductRunBinding({ github, owner, repo, current } = {}) {
  if (current?.state === 'closed') return [];
  const binding = productRunBinding(current?.body ?? '');
  if (!binding) return [];
  if (binding.errors.length) return binding.errors;
  if (!/^[a-f0-9]{40}$/.test(current?.head?.sha ?? '')) return bindingFailure('exact PR head required');
  try {
    // Tree modes do not follow symlinks, unlike the Contents endpoint.
    const { data: tree } = await github.rest.git.getTree({ owner, repo,
      tree_sha: current.head.sha, recursive: '1' });
    if (tree.truncated !== false || !Array.isArray(tree.tree)) throw new Error('incomplete tree');
    const entries = tree.tree.filter(entry => entry.path === binding.ledgerPath);
    if (entries.length !== 1 || entries[0].type !== 'blob'
      || !['100644', '100755'].includes(entries[0].mode)
      || !/^[a-f0-9]{40}$/.test(entries[0].sha ?? '')) throw new Error('not a regular ledger');
    const { data } = await github.rest.git.getBlob({ owner, repo, file_sha: entries[0].sha });
    return validateProductRunContent(current.body, decodeExactBlob(data, entries[0].sha));
  } catch { return bindingFailure('exact-head bound JSON ledger unavailable; no mutable-ref or historical fallback'); }
}

// Both entrypoints feed bytes to the same existing validators; no candidate code is executed.
export function validateRunLedgerContent(name, content) {
  if (!isRunLedgerPath(name)) return [];
  if (!canonicalPath(name)) return failure(name, 'non-canonical ledger path');
  if (typeof content !== 'string') return failure(name, 'ledger bytes unavailable');
  let run;
  try { run = JSON.parse(content); } catch { return failure(name, 'invalid JSON'); }
  try {
    const errors = run?.schemaVersion === 1 ? validateRunLedger(run)
      : run?.schemaVersion === 2 ? validateRunLedgerV2(run)
        : ['unsupported or missing schemaVersion'];
    if (errors.length) return errors.flatMap(error => failure(name, error));
    // Bound active Product Runs are rechecked; unrelated historical files are not loaded.
    if (run.schemaVersion !== 2 || !['IN_PROGRESS', 'CLOSURE_RECOVERY'].includes(run.status)) return [];
    const result = analyzeScorecardReadiness(run);
    return [...result.validationErrors, ...result.rawCaptureGaps, ...result.consistencyWarnings]
      .flatMap(error => failure(name, error));
  } catch { return failure(name, 'ledger validation could not be completed'); }
}

/** @param {{changedFiles?: string[] | null, repositoryRoot?: string, body?: string}} [input] */
export function validateLocalRunLedgerChanges({ changedFiles, repositoryRoot = process.cwd(), body = '' } = {}) {
  if (!Array.isArray(changedFiles) || changedFiles.some(name => typeof name !== 'string')) {
    return failure('inventory', 'complete changed-file paths required');
  }
  const errors = [];
  for (const name of [...new Set(changedFiles)].filter(isRunLedgerPath)) {
    if (!canonicalPath(name)) { errors.push(...failure(name, 'non-canonical ledger path')); continue; }
    try {
      errors.push(...validateRunLedgerContent(name, readLocalLedger(repositoryRoot, name)));
    } catch { errors.push(...failure(name, 'regular ledger file unavailable')); }
  }
  errors.push(...validateLocalProductRunBinding({ body, repositoryRoot }));
  return [...new Set(errors)];
}

/** @param {{github?: any, owner?: string, repo?: string, current?: any, changedFiles?: any[] | null}} [input] */
export async function validateGithubRunLedgerChanges({ github, owner, repo, current, changedFiles } = {}) {
  if (!Array.isArray(changedFiles) || !Number.isInteger(current?.changed_files)
    || changedFiles.length !== current.changed_files
    || changedFiles.some(file => !file || typeof file.filename !== 'string')
    || new Set(changedFiles.map(file => file.filename)).size !== changedFiles.length
    || !/^[a-f0-9]{40}$/.test(current?.head?.sha ?? '')) {
    return failure('inventory', 'complete exact-head changed-file inventory required');
  }
  const errors = [];
  for (const file of changedFiles) {
    if (isRunLedgerPath(file.previous_filename) && file.previous_filename !== file.filename) {
      errors.push(...failure(file.previous_filename, 'changed ledger is absent after rename'));
    }
    if (!isRunLedgerPath(file.filename)) continue;
    if (!canonicalPath(file.filename) || !['added', 'modified', 'renamed'].includes(file.status)
      || !/^[a-f0-9]{40}$/.test(file.sha ?? '')) {
      errors.push(...failure(file.filename, 'regular changed ledger blob unavailable'));
      continue;
    }
    try {
      // Immutable blob from the fully paginated live PR diff, not a mutable branch or body claim.
      const { data } = await github.rest.git.getBlob({ owner, repo, file_sha: file.sha });
      errors.push(...validateRunLedgerContent(file.filename, decodeExactBlob(data, file.sha)));
    } catch { errors.push(...failure(file.filename, 'exact blob evidence unavailable')); }
  }
  errors.push(...await validateGithubProductRunBinding({ github, owner, repo, current }));
  return [...new Set(errors)];
}
