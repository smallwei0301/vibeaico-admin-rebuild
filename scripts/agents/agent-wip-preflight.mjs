#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { validateLocalRunLedgerChanges } from './scorecard-required-gate.mjs';
import { validateSchemaStagedRelease } from './schema-staged-release-policy.mjs';
import { isPlaceholder, readField } from './agent-wip-policy.mjs';
import {
  parseLaneMetadata,
  readFrozenCheckoutHead,
  validateActualFileOwnership,
  validateLaneMetadata,
} from './dual-terra-wip-policy.mjs';
import { parseGovernanceScopeException } from './governance-scope-budget.mjs';
import { decideLocalIsolatedTest } from '../ci/local-isolated-test-policy.mjs';

import { changeDigestOf, classifyAstra, evaluateAstra, routing, shouldEnforceFinalRisk } from './astra-review-policy.mjs';
import { nativeRoleShapeErrors } from './final-risk-cost-policy.mjs';

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

/** Local shape only; raw snapshots/locators never establish trusted canonical read-back. */
function ordinaryLocalContract(input, body, changedFiles) {
  const classification = classifyAstra({ body, changedFiles });
  const result = { ordinaryReviewRequired: false, ordinaryReviewStatus: 'NOT_REQUIRED', canonicalReadbackVerified: false, errors: [] };
  if (classification.required || classification.isModelGovernance || classification.workstream !== 'PRODUCT_MAINLINE') return result;
  const current = input.currentPr;
  if (!current && input.prospectiveFinal !== true) return { ...result, ordinaryReviewStatus: 'LOCAL_NOT_VERIFIABLE' };
  if (current && (current.body !== body || typeof current.draft !== 'boolean' || !['open', 'closed'].includes(current.state))) {
    return { ...result, ordinaryReviewStatus: 'LOCAL_NOT_VERIFIABLE', errors: ['Current PR snapshot must include exact body, state and boolean draft'] };
  }
  if (current && !shouldEnforceFinalRisk({ pullRequestState: current.state, draft: current.draft, laneState: readField(body, 'LANE_STATE') })) return result;
  result.ordinaryReviewRequired = true;
  result.ordinaryReviewStatus = 'LOCAL_CONTRACT_PENDING';
  const packet = input.ordinaryEvidence;
  if (!packet || typeof packet !== 'object') { result.errors.push('Ordinary final review requires local scope and receipt snapshots'); return result; }
  const { repository, headSha, changeDigest, builder, reviewer, review, reviewSourceRef } = packet;
  const concrete = value => typeof value === 'string' && value.trim().length >= 8 && !/^(unknown|none|pending|tbd|<.*>)$/i.test(value.trim());
  const time = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT.*Z$/.test(value) ? Date.parse(value) : NaN;
  const roleSource = value => typeof value === 'string' && value.startsWith(`https://github.com/${repository}/`)
    && /^https:\/\/github\.com\/[^/]+\/[^/]+\/(issues|pull)\/\d+#issuecomment-\d+$/.test(value);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || !/^[a-f0-9]{40}$/i.test(headSha ?? '') || /^0+$/.test(headSha ?? '')
    || !/^[a-f0-9]{64}$/i.test(changeDigest ?? '') || /^0+$/.test(changeDigest ?? '') || (current && current.head?.sha !== headSha)) result.errors.push('Ordinary local scope needs concrete repository/current head/change digest');
  if (!roleSource(readField(body, 'BUILDER_EXECUTION_RECEIPT')) || builder?.sourceRef !== readField(body, 'BUILDER_EXECUTION_RECEIPT')
    || !roleSource(reviewer?.sourceRef) || review?.reviewerExecutionReceipt !== reviewer?.sourceRef) result.errors.push('Ordinary builder/reviewer locators must reference canonical repository comments');
  for (const [record, role] of [[builder, 'BUILD'], [reviewer, 'REVIEW']]) {
    if (!record || record.role !== role || record.repository !== repository || record.headSha !== headSha || record.changeDigest !== changeDigest
      || !['actorId', 'sessionId', 'executionRef'].every(key => concrete(record[key])) || record.executionEvidence !== 'OPERATOR_ATTESTED'
      || !Number.isFinite(time(record.startedAt)) || !Number.isFinite(time(record.completedAt)) || time(record.completedAt) < time(record.startedAt)) result.errors.push(`Invalid local ${role} role receipt shape`);
  }
  if (builder && reviewer && (builder.actorId === reviewer.actorId || builder.sessionId === reviewer.sessionId
    || builder.executionRef === reviewer.executionRef || builder.sourceRef === reviewer.sourceRef || reviewer.freshContext !== true
    || time(reviewer.startedAt) < time(builder.completedAt))) result.errors.push('Ordinary local review requires different actor/session/execution and fresh context');
  const model = reviewer?.provider === 'OPENAI' ? routing.models?.audit : reviewer?.provider === 'ANTHROPIC' ? routing.anthropicEquivalents?.audit : null;
  if (!model || !concrete(reviewer?.providerEvidenceRef) || reviewer?.requestedModel !== model || review?.requestedModel !== model) result.errors.push('Ordinary local reviewer needs provider-local Sol/Opus request');
  if (!review || review.repository !== repository || review.headSha !== headSha || review.changeDigest !== changeDigest || review.policyVersion !== routing.version
    || review.verdict !== 'PASS' || review.executionRef !== reviewer?.executionRef || !concrete(review.findings) || !concrete(review.report)
    || !review.report.startsWith(`https://github.com/${repository}/`) || typeof reviewSourceRef !== 'string'
    || !reviewSourceRef.startsWith(`https://github.com/${repository}/pull/`) || !/#pullrequestreview-\d+$/.test(reviewSourceRef)) result.errors.push('Invalid local canonical sol-review packet shape');
  if (review && ((review.servedVerified !== undefined && typeof review.servedVerified !== 'boolean')
    || (review.actualModel === 'unknown' ? review.identityEvidence !== 'UNKNOWN' || review.servedVerified === true
      : review.actualModel !== model || review.identityEvidence !== 'OPERATOR_ATTESTED'))) result.errors.push('Invalid local actual identity/served verification claim');
  if (!result.errors.length) result.ordinaryReviewStatus = 'NEEDS_CANONICAL_READBACK';
  return result;
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
 * Parse `git diff --name-status --find-renames` so local preflight sees the
 * same important inventory shape as the remote guard. Rename/copy entries
 * include both old and new paths; that matters when a migration is renamed
 * away, because the historical migration path must still trigger the schema
 * staged-release policy.
 */
export function parseGitNameStatus(output = '') {
  const files = [];
  for (const rawLine of String(output ?? '').split(/\r?\n/)) {
    if (!rawLine) continue;
    const parts = rawLine.split('\t');
    const status = parts.shift()?.trim() ?? '';
    const kind = status[0] ?? '';
    if (!/^[ACDMRTUXB]$/.test(kind)) {
      throw new Error(`Unsupported git diff status: ${status || rawLine}`);
    }
    if (kind === 'R' || kind === 'C') {
      if (parts.length !== 2 || parts.some((path) => !path)) {
        throw new Error(`Malformed git rename/copy entry: ${rawLine}`);
      }
      files.push(parts[0], parts[1]);
    } else {
      if (parts.length !== 1 || !parts[0]) throw new Error(`Malformed git diff entry: ${rawLine}`);
      files.push(parts[0]);
    }
  }
  return [...new Set(files)];
}

export function discoverChangedFiles({
  base = 'origin/main',
  repositoryRoot = process.cwd(),
  runGit = (args, options) => execFileSync('git', args, options),
} = {}) {
  const ref = String(base ?? '').trim();
  if (!ref || !/^[A-Za-z0-9._/@{}~^:+-]+$/.test(ref)) {
    throw new Error('A safe git base ref is required for automatic changed-file discovery');
  }
  const output = runGit(
    ['diff', '--name-status', '--find-renames', `${ref}...HEAD`, '--'],
    { cwd: repositoryRoot, encoding: 'utf8' },
  );
  const files = parseGitNameStatus(output);
  if (!files.length) throw new Error(`No changed files found between ${ref} and HEAD`);
  return files;
}

/**
 * @param {{
 *   body?: string,
 *   currentPr?: any,
 *   prospectiveFinal?: boolean,
 *   ordinaryEvidence?: any,
 *   requireAstraClassification?: boolean,
 *   changedFiles?: string[] | null,
 *   prNumber?: number | string,
 *   headSha?: string,
 *   createdAt?: string,
 *   action?: string,
 *   repositoryRoot?: string,
 *   fileExists?: (path: import('node:fs').PathLike) => boolean,
 * }} [input]
 */
export function validatePublicationMetadata(input = {}) {
  const body = String(input.body ?? '');
  const changedFiles = Array.isArray(input.changedFiles) ? input.changedFiles : [];
  const pr = { number: Number(input.prNumber) || 1, state: 'open', body, head: { sha: String(input.headSha ?? '') } };
  const metadata = parseLaneMetadata(pr);
  const errors = [];
  const origin = upper(readField(body, 'WORK_ORIGIN'));

  if (input.requireAstraClassification !== false) {
    errors.push(...classifyAstra({ body, changedFiles, createdAt: input.createdAt }).errors);
  }
  errors.push(...missingAstraBaselines(body, changedFiles));
  if (!ORIGINS.has(origin)) errors.push('WORK_ORIGIN must be OWNER, AGENT, or UNKNOWN');
  if (isPlaceholder(readField(body, 'REQUESTED_MODEL / ACTUAL_MODEL'))) {
    errors.push('REQUESTED_MODEL / ACTUAL_MODEL is required');
  }
  errors.push(...validateLaneMetadata(metadata, { action: input.action ?? 'opened' }));
  errors.push(...validateActualFileOwnership(metadata, changedFiles));
  errors.push(...validateDeliveryUnitBoundary(body, metadata));
  errors.push(...validateBookkeepingWorkstream({ body, changedFiles }));
  if (metadata.origin === 'AGENT' && metadata.state === 'ACTIVE' && metadata.lane === 'GOVERNANCE') {
    const exception = parseGovernanceScopeException(readField(body, 'GOVERNANCE_SCOPE_EXCEPTION'));
    if (!exception.valid) errors.push(exception.error);
  }
  errors.push(...(decideLocalIsolatedTest({ body }).errors ?? []));
  return { valid: errors.length === 0, errors: [...new Set(errors)], metadata };
}

/** Optional native source packet shape only: never enables branch policy or canonical approval. */
export function validateNativeRolePreflight(packet, currentPr, policy = routing) {
  const result = { status: 'LOCAL_NOT_VERIFIABLE', canonicalReadbackVerified: false, errors: [] };
  if (!packet) return result;
  const context = { repository: packet.repository, headSha: packet.headSha, currentHeadSha: currentPr?.head?.sha,
    changeDigest: packet.changeDigest, prNumber: currentPr?.number, reviewSurface: 'PRODUCT_SOURCE_FINAL_RISK',
    roleEvidence: { builder: packet.builder, reviewer: packet.reviewer } };
  result.errors.push(...nativeRoleShapeErrors(packet.review, context, policy.nativeRolePilot));
  if (!currentPr || !shouldEnforceFinalRisk({ pullRequestState: currentPr.state, draft: currentPr.draft,
    laneState: readField(currentPr.body ?? '', 'LANE_STATE') })) result.errors.push('Native final packet requires current active non-draft PR snapshot');
  if (packet.builder?.sourceRef !== readField(currentPr?.body ?? '', 'BUILDER_EXECUTION_RECEIPT')
    || packet.review?.reviewerExecutionReceipt !== packet.reviewer?.sourceRef) result.errors.push('Native packet locators differ from current metadata');
  result.status = result.errors.length ? 'LOCAL_CONTRACT_PENDING' : 'NEEDS_CANONICAL_READBACK';
  return result;
}

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
  const errors = [];
  const ordinary = ordinaryLocalContract(input, text, changedFiles);
  errors.push(...ordinary.errors);
  const nativeRole = validateNativeRolePreflight(input.nativeRoleEvidence, input.currentPr);
  errors.push(...nativeRole.errors);
  if (input.nativeRoleEvidence && input.currentPr?.body !== text) errors.push('Native packet current PR body differs from preflight body');
  let headSha = '';
  if (upper(readField(text, 'COMPLETION_CLAIM')) === 'AUDIT_READY'
    && upper(readField(text, 'AGENT_LANE')) === 'TERRA_BUILD') {
    try { headSha = readFrozenCheckoutHead(repositoryRoot); }
    catch { errors.push('SOURCE_FREEZE requires a clean, readable current Git checkout'); }
  }
  const pr = { number: Number(prNumber) || 1, state: 'open', body: text, head: { sha: headSha } };
  const metadata = parseLaneMetadata(pr);
  // Metadata-only API callers stay compatible; the full CLI requires an inventory.
  if (changedFiles !== null) {
    errors.push(...validateLocalRunLedgerChanges({ changedFiles, repositoryRoot, body: text }));
    errors.push(...validateSchemaStagedRelease({
      body: text,
      changedFiles,
      readFile: (name) => readFileSync(resolve(repositoryRoot, name), 'utf8'),
    }));
  }
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
    rawCaptureChecked: Array.isArray(changedFiles),
    ordinaryReviewRequired: ordinary.ordinaryReviewRequired,
    ordinaryReviewStatus: ordinary.ordinaryReviewStatus,
    nativeRoleStatus: nativeRole.status,
    canonicalReadbackVerified: false,
  };
}

function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.body) {
    throw new Error('Usage: agent-wip-preflight.mjs --body <pr-body.md> [--changed-files <files.txt> | --base <git-ref>] [--number <pr>]');
  }
  if (args['changed-files'] && args.base) {
    throw new Error('Use either --changed-files or --base, not both');
  }
  const repositoryRoot = args.root ? resolve(args.root) : process.cwd();
  const body = readFileSync(args.body, 'utf8');
  const changedFiles = args['changed-files']
    ? readFileSync(args['changed-files'], 'utf8').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    : discoverChangedFiles({
        base: args.base ?? 'origin/main',
        repositoryRoot,
      });
  const result = validateWipPreflight({
    body,
    changedFiles,
    currentPr: args['current-pr-json'] ? JSON.parse(readFileSync(args['current-pr-json'], 'utf8')) : undefined,
    prospectiveFinal: args['prospective-final'] === 'true',
    ordinaryEvidence: args['ordinary-evidence'] ? JSON.parse(readFileSync(args['ordinary-evidence'], 'utf8')) : undefined,
    nativeRoleEvidence: args['native-role-evidence'] ? JSON.parse(readFileSync(args['native-role-evidence'], 'utf8')) : undefined,
    requireAstraClassification: true,
    prNumber: args.number ?? 1,
    action: args.action ?? 'opened',
    repositoryRoot,
  });

  if (result.valid) {
    console.log(`WIP_PREFLIGHT_PASS issue=${result.metadata.issueNumber ?? 'none'} lane=${result.metadata.lane || 'none'} ordinary=${result.ordinaryReviewStatus} canonicalReadbackVerified=false`);
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
