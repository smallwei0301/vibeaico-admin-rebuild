#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { parseLaneMetadata } from './agent-wip-policy.mjs';
import { scoreRunCurrent, renderCurrentMarkdown } from './score-run-current.mjs';
import { scoreRun, renderMarkdown } from './score-run.mjs';

export const PUBLICATION_PREFLIGHT_RECEIPT_MARKER = '<!-- agent-publication-preflight-receipt -->';
export const PUBLICATION_PREFLIGHT_RECEIPT_VERSION = 1;
const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;

const sha256 = value => createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');
const sortKey = value => JSON.stringify(value);

/** Reproduce paired reports from immutable exact-head blobs before a Draft receives PASS. */
export async function validateGithubChangedRunReports({ github, owner, repo, current, changedFiles } = {}) {
  const prefix = 'docs/metrics/agent-runs/';
  const isPairedPath = path => typeof path === 'string' && path.startsWith(prefix) && /\.(json|md)$/.test(path);
  const pairedFiles = Array.isArray(changedFiles) ? changedFiles.filter(file =>
    isPairedPath(file?.filename) || isPairedPath(file?.previous_filename)) : [];
  if (!pairedFiles.length) return [];
  const fail = (path, reason) => `PUBLICATION_REPORT_REJECTED ${path}: ${reason}`;
  if (!SHA40.test(current?.head?.sha ?? '') || changedFiles.length !== current?.changed_files) {
    return [fail('inventory', 'complete exact-head inventory required')];
  }
  try {
    const { data } = await github.rest.git.getTree({ owner, repo, tree_sha: current.head.sha, recursive: '1' });
    if (data?.truncated !== false || !Array.isArray(data.tree)) throw new Error('incomplete exact-head tree');
    const read = async (path, expectedSha) => {
      const entries = data.tree.filter(entry => entry.path === path);
      if (entries.length !== 1 || entries[0].type !== 'blob' || !['100644', '100755'].includes(entries[0].mode)
        || !SHA40.test(entries[0].sha) || (expectedSha && entries[0].sha !== expectedSha)) {
        throw new Error(`regular exact-head blob unavailable: ${path}`);
      }
      const { data: blob } = await github.rest.git.getBlob({ owner, repo, file_sha: entries[0].sha });
      if (blob?.encoding !== 'base64' || blob.sha !== entries[0].sha || !Number.isSafeInteger(blob.size)) {
        throw new Error(`exact blob evidence unavailable: ${path}`);
      }
      const bytes = Buffer.from(String(blob.content ?? '').replace(/\s/g, ''), 'base64');
      const actualSha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
      if (bytes.length !== blob.size || actualSha !== entries[0].sha) throw new Error(`exact blob digest mismatch: ${path}`);
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    };
    const errors = [];
    const pairedPaths = pairedFiles.flatMap(file => [file.filename, file.previous_filename].filter(isPairedPath));
    for (const ledgerPath of [...new Set(pairedPaths.map(path => path.replace(/\.md$/, '.json')))]) {
      const reportPath = ledgerPath.replace(/\.json$/, '.md');
      try {
        const ledgerFile = pairedFiles.find(file => file.filename === ledgerPath);
        const reportFile = pairedFiles.find(file => file.filename === reportPath);
        if ([ledgerFile, reportFile].some(file => file && (!['added', 'modified', 'renamed'].includes(file.status) || !SHA40.test(file.sha)))) {
          throw new Error('changed paired blob unavailable');
        }
        const run = JSON.parse(await read(ledgerPath, ledgerFile?.sha));
        const report = await read(reportPath, reportFile?.sha);
        const expected = run.schemaVersion === 2
          ? renderCurrentMarkdown(run, scoreRunCurrent(run))
          : run.schemaVersion === 1 ? renderMarkdown(run, scoreRun(run)) : null;
        if (expected === null) throw new Error('unsupported ledger schema');
        if (report !== expected) errors.push(fail(reportPath, 'canonical report differs from exact-head ledger'));
      } catch (error) {
        errors.push(fail(reportPath, error?.message?.includes('regular exact-head blob unavailable')
          ? 'canonical report unavailable on exact head' : `canonical report validation failed: ${error?.message ?? 'unknown'}`));
      }
    }
    return errors;
  } catch (error) {
    return [fail('inventory', `exact-head report evidence unavailable: ${error?.message ?? 'unknown'}`)];
  }
}

// The policy starts when its owning PR is merged into main, not when a live PR base later advances.
export const PUBLICATION_ROLLOUT_PR = 736;
export function publicationPolicyApplies({ origin, createdAt, rolloutMergedAt } = {}) {
  if (origin !== 'AGENT') return false;
  const created = Date.parse(createdAt);
  const merged = Date.parse(rolloutMergedAt);
  if (!Number.isFinite(created) || !Number.isFinite(merged)) {
    throw new Error('PUBLICATION_ROLLOUT_UNVERIFIED: canonical PR creation or policy merge time is unavailable');
  }
  return created >= merged;
}

/** Main pushes must refresh receipts bound to the base, including PRs with an empty body. */
export async function resolvePublicationBaseWakeup({ github, owner, repo, baseRef } = {}) {
  let pulls;
  try { pulls = await github.paginate(github.rest.pulls.list, { owner, repo, state: 'open', per_page: 100 }); }
  catch { throw new Error('PUBLICATION_BASE_WAKEUP_UNAVAILABLE: canonical open PR inventory could not be read'); }
  if (!Array.isArray(pulls) || pulls.some(pr => !Number.isSafeInteger(pr?.number) || pr.number < 1 ||
    !['open', 'closed'].includes(pr.state) || (pr.body !== null && typeof pr.body !== 'string') ||
    typeof pr.base?.ref !== 'string' || typeof pr.base?.repo?.full_name !== 'string')) {
    throw new Error('PUBLICATION_BASE_WAKEUP_UNAVAILABLE: malformed canonical PR inventory');
  }
  const numbers = pulls.filter(pr => {
    if (pr.state !== 'open' || pr.base.repo.full_name !== `${owner}/${repo}` || pr.base.ref !== baseRef) return false;
    const origin = parseLaneMetadata(pr).origin;
    // Ambiguous or missing metadata is rechecked instead of silently exempting a possible Agent PR.
    return origin !== 'OWNER' && origin !== 'UNKNOWN';
  }).map(pr => pr.number);
  return { numbers: [...new Set(numbers)].sort((a, b) => a - b), associationIncomplete: false };
}

/** @param {{body?: string, files?: Array<{filename?: string, previous_filename?: string, previousFilename?: string, status?: string, sha?: string}>, baseSha?: string, headSha?: string}} [input] */
export function publicationContract({ body = '', files = [], baseSha = '', headSha = '' } = {}) {
  if (!SHA40.test(baseSha) || !SHA40.test(headSha)) throw new Error('publication receipt requires exact base/head SHA');
  const inventory = files.map(file => ({
    filename: String(file?.filename ?? ''),
    previousFilename: String(file?.previous_filename ?? file?.previousFilename ?? ''),
    status: String(file?.status ?? ''),
    sha: String(file?.sha ?? ''),
  })).sort((a, b) => sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0);
  if (!inventory.length || inventory.some(file => !file.filename)) throw new Error('publication receipt requires complete changed-file inventory');
  const bodySha256 = sha256(body);
  const filesSha256 = sha256(JSON.stringify(inventory));
  const contractSha256 = sha256(JSON.stringify({
    version: PUBLICATION_PREFLIGHT_RECEIPT_VERSION,
    baseSha, headSha, bodySha256, filesSha256,
  }));
  return { version: PUBLICATION_PREFLIGHT_RECEIPT_VERSION, baseSha, headSha, bodySha256, filesSha256, contractSha256 };
}

function field(body, name) {
  const escaped = name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  return String(body ?? '').match(new RegExp(`^[ \\t]*${escaped}[ \\t]*:[ \\t]*(.+)$`, 'mi'))?.[1]?.trim() ?? '';
}

export function renderPublicationReceipt({ prNumber, contract } = {}) {
  if (!Number.isInteger(Number(prNumber)) || Number(prNumber) < 1 || !contract) throw new Error('prNumber and contract are required');
  return [
    PUBLICATION_PREFLIGHT_RECEIPT_MARKER,
    'PUBLICATION_PREFLIGHT_RECEIPT',
    `VERSION: ${contract.version}`,
    `PR: #${Number(prNumber)}`,
    `BASE_SHA: ${contract.baseSha}`,
    `HEAD_SHA: ${contract.headSha}`,
    `BODY_SHA256: ${contract.bodySha256}`,
    `FILES_SHA256: ${contract.filesSha256}`,
    `CONTRACT_SHA256: ${contract.contractSha256}`,
    'RESULT: PASS',
  ].join('\n');
}

export function parsePublicationReceipt(body = '') {
  const text = String(body ?? '');
  if (!text.includes(PUBLICATION_PREFLIGHT_RECEIPT_MARKER) || !text.includes('PUBLICATION_PREFLIGHT_RECEIPT')) return null;
  return {
    version: Number(field(text, 'VERSION')),
    prNumber: Number(field(text, 'PR').replace(/^#/, '')),
    baseSha: field(text, 'BASE_SHA'),
    headSha: field(text, 'HEAD_SHA'),
    bodySha256: field(text, 'BODY_SHA256'),
    filesSha256: field(text, 'FILES_SHA256'),
    contractSha256: field(text, 'CONTRACT_SHA256'),
    result: field(text, 'RESULT').toUpperCase(),
  };
}

/**
 * @param {any[]} comments
 * @param {{prNumber?: number, contract?: any}} [expectedInput]
 */
export function findMatchingPublicationReceipt(comments = [], { prNumber, contract } = {}) {
  const expected = contract ?? {};
  return comments.find(comment => {
    if (comment?.user?.login !== 'github-actions[bot]' || comment?.user?.type !== 'Bot') return false;
    const receipt = parsePublicationReceipt(comment?.body);
    return receipt &&
      receipt.version === PUBLICATION_PREFLIGHT_RECEIPT_VERSION &&
      receipt.prNumber === Number(prNumber) &&
      receipt.result === 'PASS' &&
      SHA40.test(receipt.baseSha) && SHA40.test(receipt.headSha) &&
      SHA256.test(receipt.bodySha256) && SHA256.test(receipt.filesSha256) && SHA256.test(receipt.contractSha256) &&
      ['baseSha', 'headSha', 'bodySha256', 'filesSha256', 'contractSha256'].every(key => receipt[key] === expected[key]);
  }) ?? null;
}
