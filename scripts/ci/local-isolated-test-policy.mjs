#!/usr/bin/env node

import { readFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const TEST_PROFILES = Object.freeze({
  SOURCE_ONLY: 'SOURCE_ONLY',
  LOCAL_ISOLATED: 'LOCAL_ISOLATED',
  LOCAL_ISOLATED_CANARY: 'LOCAL_ISOLATED_CANARY',
  REMOTE_BRANCH_REQUIRED: 'REMOTE_BRANCH_REQUIRED',
  SHARED_CANONICAL: 'SHARED_CANONICAL',
});

const LOCAL_PROFILES = new Set([
  TEST_PROFILES.LOCAL_ISOLATED,
  TEST_PROFILES.LOCAL_ISOLATED_CANARY,
]);

const CANARY_BARRIER_DELAY_SECONDS = 360;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function readMetadataField(body = '', field) {
  const pattern = new RegExp(
    `^[ \\t]*[-*]?[ \\t]*${escapeRegExp(field)}[ \\t]*:[ \\t]*(.*?)[ \\t]*$`,
    'mi',
  );
  return (String(body).match(pattern)?.[1] ?? '').trim();
}

function upper(value) {
  return String(value ?? '').trim().toUpperCase();
}

export function isLocalProfile(profile) {
  return LOCAL_PROFILES.has(upper(profile));
}

export function classifyRiskPaths(paths = []) {
  const normalized = paths.map((path) => String(path).replaceAll('\\', '/'));
  const reasons = [];

  if (normalized.some((path) => path.startsWith('supabase/migrations/'))) reasons.push('DATABASE_MIGRATION');
  if (normalized.some((path) => /(^|\/)(auth|middleware)(\/|\.|$)/i.test(path))) reasons.push('AUTH');
  if (normalized.some((path) => /(^|\/)(storage|upload)(\/|\.|$)/i.test(path))) reasons.push('STORAGE');

  return {
    remoteBranchRecommended: reasons.length > 0,
    reasons: [...new Set(reasons)],
  };
}

export function decideLocalIsolatedTest({
  eventName = '',
  body = '',
  inputProfile = '',
  inputExpectedHead = '',
  inputFinalCanonicalRequired = '',
  actualHead = '',
  headRepoFullName = '',
  repositoryFullName = '',
  nowEpochSeconds = Math.floor(Date.now() / 1000),
} = {}) {
  const profile = upper(inputProfile || readMetadataField(body, 'TEST_PROFILE') || TEST_PROFILES.SOURCE_ONLY);
  const finalCanonicalRequired = upper(
    inputFinalCanonicalRequired || readMetadataField(body, 'FINAL_CANONICAL_REQUIRED'),
  );
  const errors = [];
  const isForkPullRequest =
    eventName === 'pull_request' &&
    Boolean(repositoryFullName) &&
    Boolean(headRepoFullName) &&
    headRepoFullName !== repositoryFullName;

  if (!Object.hasOwn(TEST_PROFILES, profile)) {
    errors.push(`TEST_PROFILE is invalid: ${profile || 'missing'}`);
  }

  if (eventName === 'workflow_dispatch') {
    if (!inputExpectedHead || inputExpectedHead !== actualHead) {
      errors.push(`expected_head must equal the dispatched branch head (${actualHead || 'unknown'})`);
    }
  }

  if (LOCAL_PROFILES.has(profile) && finalCanonicalRequired !== 'TRUE') {
    errors.push('LOCAL_ISOLATED profiles must set FINAL_CANONICAL_REQUIRED=true');
  }

  const runLocal = LOCAL_PROFILES.has(profile) && errors.length === 0 && !isForkPullRequest;
  const slots = profile === TEST_PROFILES.LOCAL_ISOLATED_CANARY ? ['a', 'b'] : ['a'];
  const canaryBarrierEpoch =
    profile === TEST_PROFILES.LOCAL_ISOLATED_CANARY
      ? nowEpochSeconds + CANARY_BARRIER_DELAY_SECONDS
      : null;
  const reason = isForkPullRequest
    ? 'fork_pr_requires_trusted_manual_dispatch'
    : runLocal
      ? profile === TEST_PROFILES.LOCAL_ISOLATED_CANARY
        ? 'two_slot_canary'
        : 'per_pr_local_isolated'
      : errors.length
        ? 'invalid_local_test_contract'
        : 'profile_does_not_request_local_test';

  return {
    runLocal,
    profile,
    finalCanonicalRequired: finalCanonicalRequired === 'TRUE',
    slots,
    canaryBarrierEpoch,
    reason,
    errors,
    exactHead: actualHead || null,
  };
}

function writeOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  appendFileSync(outputPath, `${name}=${value}\n`, 'utf8');
}

function cli() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error('GITHUB_EVENT_PATH is required');
  const event = JSON.parse(readFileSync(eventPath, 'utf8'));
  const eventName = process.env.GITHUB_EVENT_NAME ?? '';
  const body = event.pull_request?.body ?? '';
  const actualHead = event.pull_request?.head?.sha ?? process.env.GITHUB_SHA ?? '';
  const inputs = event.inputs ?? {};

  const decision = decideLocalIsolatedTest({
    eventName,
    body,
    inputProfile: inputs.test_profile ?? '',
    inputExpectedHead: inputs.expected_head ?? '',
    inputFinalCanonicalRequired: inputs.final_canonical_required ?? '',
    actualHead,
    headRepoFullName: event.pull_request?.head?.repo?.full_name ?? '',
    repositoryFullName: event.repository?.full_name ?? process.env.GITHUB_REPOSITORY ?? '',
  });

  writeOutput('run_local', String(decision.runLocal));
  writeOutput('profile', decision.profile);
  writeOutput('slots', JSON.stringify(decision.slots));
  writeOutput('reason', decision.reason);
  writeOutput('exact_head', decision.exactHead ?? '');
  writeOutput('final_canonical_required', String(decision.finalCanonicalRequired));
  writeOutput('canary_barrier_epoch', decision.canaryBarrierEpoch ?? '');

  console.log(`[local-test-policy] profile=${decision.profile} run=${decision.runLocal} reason=${decision.reason}`);
  if (decision.errors.length) {
    for (const error of decision.errors) console.error(`[local-test-policy] ${error}`);
    process.exitCode = 1;
  }
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entry) cli();
