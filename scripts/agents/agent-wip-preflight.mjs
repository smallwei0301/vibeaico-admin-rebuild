#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { isPlaceholder, readField } from './agent-wip-policy.mjs';
import {
  parseLaneMetadata,
  validateActualFileOwnership,
  validateLaneMetadata,
} from './dual-terra-wip-policy.mjs';
import { parseGovernanceScopeException } from './governance-scope-budget.mjs';
import { decideLocalIsolatedTest } from '../ci/local-isolated-test-policy.mjs';

import { changeDigestOf, classifyAstra, evaluateAstra, routing } from './astra-review-policy.mjs';

import { validateDeliveryUnitBoundary, validateBookkeepingWorkstream } from './governance-workstream-boundary.mjs';
export { validateDeliveryUnitBoundary } from './governance-workstream-boundary.mjs';
const ORIGINS = new Set(['OWNER', 'AGENT', 'UNKNOWN']);

function upper(value) {
  return String(value ?? '').trim().toUpperCase();
}

function shouldValidateScorecardPath(value) {
  const text = String(value ?? '').trim();
  return Boolean(text) && !isPlaceholder(text) && !/^none$/i.test(text);
}

/**
 * PB-034：preflight 必須跟 CI 問同一支函式，不能自己複述規則。
 *
 * `evaluateAstra()` 產出的錯誤裡，只有一部分是**本機就能知道**的：
 * `ASTRA_TEST_BASELINE` / `ASTRA_SCHEMA_BASELINE` 這兩個欄位完全來自 PR 內文。
 * 其餘（baseSha／headSha／changeDigest／是否已有可信 attestation）要等 PR 存在、
 * 要等審查者送出 review，本機必然不知道——所以這裡用合法的替身值把那些檢查填飽，
 * 再只留下那兩個欄位的結果。多回報本機證明不了的東西，就是另一種假證據。
 *
 * 這一條是被 #397 抓出來的：本機 preflight 綠、CI 以
 * `Missing concrete testBaseline; Missing concrete schemaBaseline` 退件，
 * 因為那兩個欄位連 PR 模板都沒有列出來。
 */
function missingAstraBaselines(body, changedFiles) {
  const placeholderSha = '0'.repeat(40);
  const result = evaluateAstra({
    body,
    changedFiles,
    context: {
      repository: 'owner/repo',
      baseSha: placeholderSha,
      headSha: placeholderSha,
      changeDigest: changeDigestOf([]),
      policyVersion: routing.version,
      testBaseline: readField(body, 'ASTRA_TEST_BASELINE'),
      schemaBaseline: readField(body, 'ASTRA_SCHEMA_BASELINE'),
    },
  });
  return (result.errors ?? []).filter((error) => /^Missing concrete (testBaseline|schemaBaseline)$/.test(error));
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`--${key} requires a value`);
    result[key] = value;
    index += 1;
  }
  return result;
}

/**
 * @param {{
 *   body?: string,
 *   requireAstraClassification?: boolean,
 *   changedFiles?: string[] | null,
 *   prNumber?: number | string,
 *   action?: string,
 *   repositoryRoot?: string,
 *   fileExists?: (path: import('node:fs').PathLike) => boolean,
 * }} [input]
 */
export function validateWipPreflight(input = {}) {
  const {
    body = '',
    changedFiles = null,
    prNumber = 1,
    action = 'opened',
    repositoryRoot = process.cwd(),
    fileExists = existsSync,
  } = input;
  const text = String(body ?? '');
  const pr = { number: Number(prNumber) || 1, state: 'open', body: text };
  const metadata = parseLaneMetadata(pr);
  const errors = [];
  const origin = upper(readField(text, 'WORK_ORIGIN'));
  if (input.requireAstraClassification) {
    errors.push(...classifyAstra({ body: text, changedFiles }).errors);
  }
  errors.push(...missingAstraBaselines(text, changedFiles));

  if (!ORIGINS.has(origin)) errors.push('WORK_ORIGIN must be OWNER, AGENT, or UNKNOWN');
  if (isPlaceholder(readField(text, 'REQUESTED_MODEL / ACTUAL_MODEL'))) {
    errors.push('REQUESTED_MODEL / ACTUAL_MODEL is required');
  }
  errors.push(...validateLaneMetadata(metadata, { action }));
  errors.push(...validateDeliveryUnitBoundary(text, metadata));
  errors.push(...validateBookkeepingWorkstream({ body: text, changedFiles: changedFiles ?? [] }));

  if (
    metadata.origin === 'AGENT' &&
    metadata.state === 'ACTIVE' &&
    metadata.lane === 'GOVERNANCE'
  ) {
    const scopeException = parseGovernanceScopeException(
      readField(text, 'GOVERNANCE_SCOPE_EXCEPTION'),
    );
    if (!scopeException.valid) errors.push(scopeException.error);
  }

  if (
    metadata.origin === 'AGENT' &&
    metadata.state === 'ACTIVE' &&
    metadata.bplusMode === 'TRUE' &&
    shouldValidateScorecardPath(metadata.scorecardPath)
  ) {
    const scorecard = resolve(repositoryRoot, metadata.scorecardPath);
    if (!fileExists(scorecard)) {
      errors.push(`SCORECARD_PATH does not exist locally: ${metadata.scorecardPath}`);
    }
  }

  if (
    metadata.origin === 'AGENT' &&
    metadata.state === 'ACTIVE' &&
    metadata.lane === 'TERRA_BUILD' &&
    metadata.dualTerraPilot === 'TRUE'
  ) {
    if (!Array.isArray(changedFiles)) {
      errors.push('Active Dual Terra preflight requires --changed-files');
    } else {
      errors.push(...validateActualFileOwnership(metadata, changedFiles));
    }
  }

  /**
   * TEST_PROFILE / FINAL_CANONICAL_REQUIRED 由 scripts/ci/local-isolated-test-policy.mjs
   * 驗，不在上面那幾支裡。preflight 先前沒有涵蓋它，於是一支 preflight 通過的 PR
   * 仍然會被 CI 的 `classify` job 退掉（2026-09-11 #370：TEST_PROFILE 被填成不存在的
   * CANONICAL_TEST，正確值是 SHARED_CANONICAL）。
   *
   * PB-034 的預防是「開 PR 前跑 preflight，通過才推」。那條預防只有在 preflight 真的
   * 涵蓋 CI 會擋的規則時才成立；少涵蓋一支驗證器，預防就只是看起來有效。這裡直接
   * 呼叫**CI 用的同一支函式**，而不是在這邊複製一份合法值清單——複製一份的話，兩邊
   * 日後就會分歧，而分歧在 preflight 通過時看不出來。
   */
  errors.push(...(decideLocalIsolatedTest({ body }).errors ?? []));

  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)],
    metadata,
  };
}

function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.body) {
    throw new Error('Usage: agent-wip-preflight.mjs --body <pr-body.md> [--changed-files <files.txt>] [--number <pr>]');
  }
  const body = readFileSync(args.body, 'utf8');
  const changedFiles = args['changed-files']
    ? readFileSync(args['changed-files'], 'utf8').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    : null;
  const result = validateWipPreflight({
    body,
    changedFiles,
    requireAstraClassification: true,
    prNumber: args.number ?? 1,
    action: args.action ?? 'opened',
    repositoryRoot: args.root ? resolve(args.root) : process.cwd(),
  });

  if (result.valid) {
    console.log(`WIP_PREFLIGHT_PASS issue=${result.metadata.issueNumber ?? 'none'} lane=${result.metadata.lane || 'none'}`);
    return;
  }
  console.error('WIP_PREFLIGHT_FAILED');
  for (const error of result.errors) console.error(`- ${error}`);
  process.exitCode = 1;
}

const entry = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (entry) {
  try { runCli(); } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}