import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { validateRunLedger } from './run-ledger.mjs';
import { validateRunLedgerV2 } from './run-ledger-v2.mjs';
import { analyzeScorecardReadiness } from './scorecard-readiness.mjs';

export const isRunLedgerPath = (name) => typeof name === 'string'
  && name.startsWith('docs/metrics/agent-runs/') && name.endsWith('.json');
const canonicalPath = (name) => path.posix.normalize(name) === name
  && !name.includes('\\') && !name.includes('\0');
const failure = (name, reason) => [`SCORECARD_CAPTURE_REJECTED ${name}: ${reason}`];

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
    // Historical files not changed by this PR never reach this function.
    if (run.schemaVersion !== 2 || !['IN_PROGRESS', 'CLOSURE_RECOVERY'].includes(run.status)) return [];
    const result = analyzeScorecardReadiness(run);
    return [...result.validationErrors, ...result.rawCaptureGaps, ...result.consistencyWarnings]
      .flatMap(error => failure(name, error));
  } catch { return failure(name, 'ledger validation could not be completed'); }
}

/** @param {{changedFiles?: string[] | null, repositoryRoot?: string}} [input] */
export function validateLocalRunLedgerChanges({ changedFiles, repositoryRoot = process.cwd() } = {}) {
  if (!Array.isArray(changedFiles) || changedFiles.some(name => typeof name !== 'string')) {
    return failure('inventory', 'complete changed-file paths required');
  }
  const errors = [];
  for (const name of [...new Set(changedFiles)].filter(isRunLedgerPath)) {
    if (!canonicalPath(name)) { errors.push(...failure(name, 'non-canonical ledger path')); continue; }
    try {
      const target = path.resolve(realpathSync(repositoryRoot), name);
      if (realpathSync(target) !== target) throw new Error('symlink is not a ledger file');
      errors.push(...validateRunLedgerContent(name, new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(target))));
    } catch { errors.push(...failure(name, 'regular ledger file unavailable')); }
  }
  return errors;
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
      if (data?.encoding !== 'base64' || typeof data.content !== 'string') throw new Error('missing bytes');
      const bytes = Buffer.from(data.content, 'base64');
      const digest = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
      if (digest !== file.sha || data.sha !== file.sha || data.size !== bytes.length) throw new Error('incomplete bytes');
      errors.push(...validateRunLedgerContent(file.filename, new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    } catch { errors.push(...failure(file.filename, 'exact blob evidence unavailable')); }
  }
  return errors;
}
