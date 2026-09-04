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

const DELIVERY_TYPES = new Set(['SLICE', 'STANDALONE', 'EPIC', 'GOVERNANCE']);
const ORIGINS = new Set(['OWNER', 'AGENT', 'UNKNOWN']);

function upper(value) {
  return String(value ?? '').trim().toUpperCase();
}

function shouldValidateScorecardPath(value) {
  const text = String(value ?? '').trim();
  return Boolean(text) && !isPlaceholder(text) && !/^none$/i.test(text);
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

export function validateDeliveryUnitBoundary(body = '', metadata = {}) {
  const errors = [];
  const type = upper(readField(body, 'DELIVERY_UNIT_TYPE'));
  const count = upper(readField(body, 'COUNT_IN_DELIVERY_OUTCOME'));
  const retroactive = upper(readField(body, 'RETROACTIVE_TRACKING_MIGRATION'));
  const outcome = readField(body, 'USER_VISIBLE_OUTCOME');

  if (!DELIVERY_TYPES.has(type)) errors.push('DELIVERY_UNIT_TYPE must be SLICE, STANDALONE, EPIC, or GOVERNANCE');
  if (!['TRUE', 'FALSE'].includes(count)) errors.push('COUNT_IN_DELIVERY_OUTCOME must be true or false');
  if (!['TRUE', 'FALSE'].includes(retroactive)) errors.push('RETROACTIVE_TRACKING_MIGRATION must be true or false');

  if (['EPIC', 'GOVERNANCE'].includes(type) && count !== 'FALSE') {
    errors.push(`${type} must set COUNT_IN_DELIVERY_OUTCOME=false`);
  }
  if (retroactive === 'TRUE' && count !== 'FALSE') {
    errors.push('A retroactive tracking migration must set COUNT_IN_DELIVERY_OUTCOME=false');
  }
  if (['SLICE', 'STANDALONE'].includes(type)) {
    if (count !== 'TRUE') errors.push(`${type} must set COUNT_IN_DELIVERY_OUTCOME=true`);
    if (retroactive !== 'FALSE') errors.push(`${type} counted as new delivery must set RETROACTIVE_TRACKING_MIGRATION=false`);
    if (!metadata.issueNumber) errors.push(`${type} must declare pr-lifecycle issue: <number>`);
    if (isPlaceholder(outcome) || /^none$/i.test(outcome)) {
      errors.push(`${type} must declare one USER_VISIBLE_OUTCOME`);
    }
  }

  const activeProductLane = metadata.origin === 'AGENT' &&
    metadata.state === 'ACTIVE' &&
    ['TERRA_BUILD', 'TEST_VALIDATION'].includes(metadata.lane);
  if (activeProductLane && !['SLICE', 'STANDALONE'].includes(type)) {
    errors.push('An active Product delivery lane must point to a closable SLICE or STANDALONE Issue');
  }
  if (metadata.lane === 'GOVERNANCE' && type && type !== 'GOVERNANCE') {
    errors.push('AGENT_LANE=GOVERNANCE must use DELIVERY_UNIT_TYPE=GOVERNANCE');
  }

  return [...new Set(errors)];
}

/**
 * @param {{
 *   body?: string,
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

  if (!ORIGINS.has(origin)) errors.push('WORK_ORIGIN must be OWNER, AGENT, or UNKNOWN');
  if (isPlaceholder(readField(text, 'REQUESTED_MODEL / ACTUAL_MODEL'))) {
    errors.push('REQUESTED_MODEL / ACTUAL_MODEL is required');
  }
  errors.push(...validateLaneMetadata(metadata, { action }));
  errors.push(...validateDeliveryUnitBoundary(text, metadata));

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