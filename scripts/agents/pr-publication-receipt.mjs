#!/usr/bin/env node

import { createHash } from 'node:crypto';

export const PUBLICATION_PREFLIGHT_RECEIPT_MARKER = '<!-- agent-publication-preflight-receipt -->';
export const PUBLICATION_PREFLIGHT_RECEIPT_VERSION = 1;
const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;

const sha256 = value => createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');
const sortKey = value => JSON.stringify(value);

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
