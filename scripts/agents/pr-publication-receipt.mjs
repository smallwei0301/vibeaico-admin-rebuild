#!/usr/bin/env node

import { createHash } from 'node:crypto';

export const PUBLICATION_PREFLIGHT_RECEIPT_MARKER = '<!-- agent-publication-preflight-receipt -->';
export const PUBLICATION_PREFLIGHT_RECEIPT_VERSION = 1;
const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;

const sha256 = value => createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');
const sortKey = value => JSON.stringify(value);

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
    const origins = [...String(pr.body ?? '').matchAll(/^\s*WORK_ORIGIN\s*:\s*(AGENT|OWNER|UNKNOWN)\s*$/gmi)];
    // Ambiguous metadata is rechecked instead of silently treating a possible Agent PR as exempt.
    return origins.length !== 1 || origins[0][1].toUpperCase() === 'AGENT';
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
