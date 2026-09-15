#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { readField } from './agent-wip-policy.mjs';
import { validateWipPreflight } from './agent-wip-preflight.mjs';

const normalize = (value) => String(value ?? '').trim();
const upper = (value) => normalize(value).toUpperCase();

/**
 * Profiles reduce author input, not repository evidence.
 * The materialized PR body still contains explicit legacy-compatible metadata,
 * so existing remote guards keep reading the same contract.
 */
export const PR_METADATA_PROFILES = Object.freeze({
  GOVERNANCE_SOURCE_ONLY: Object.freeze({
    fixed: Object.freeze({
      WORKSTREAM: 'MODEL_GOVERNANCE',
      DELIVERY_UNIT_TYPE: 'GOVERNANCE',
      COUNT_IN_DELIVERY_OUTCOME: 'false',
      RETROACTIVE_TRACKING_MIGRATION: 'false',
      USER_VISIBLE_OUTCOME: 'none',
      BPLUS_MODE: 'false',
      RUN_ID: 'none',
      SCORECARD_PATH: 'none',
      AGENT_LANE: 'GOVERNANCE',
      ACTIVE_CANDIDATE: 'false',
      TEST_LANE_REQUIRED: 'false',
      RESERVE_BOUNDARY: 'none',
      WHY_NOT_CLOSER_CANDIDATE: 'none',
      ASTRA_RISK: 'NONE',
      FINAL_RISK_POLICY: 'NOT_REQUIRED_BY_OWNER_POLICY',
      ASTRA_TEST_BASELINE: 'none',
      ASTRA_SCHEMA_BASELINE: 'none',
      DUAL_TERRA_PILOT: 'false',
      TERRA_SLOT: 'none',
      PRIMARY_ISSUE: 'none',
      TEST_PROFILE: 'SOURCE_ONLY',
      FINAL_CANONICAL_REQUIRED: 'false',
      PAID_PREVIEW_BRANCH_STATUS: 'DEFERRED_NOT_IN_CONSIDERATION',
      MIGRATION_TOUCH: 'false',
      AUTH_TOUCH: 'false',
      STORAGE_TOUCH: 'false',
    }),
    defaults: Object.freeze({
      'REQUESTED_MODEL / ACTUAL_MODEL': 'requested=not_requested; actual=unknown',
      TEST_ENV_ID: 'none',
      LOCAL_SLOT_HEALTH: 'NOT_APPLICABLE',
      MIGRATION_LEDGER_STATUS: 'NOT_CHECKED',
      ISOLATION_CANARY_STATUS: 'NOT_RUN',
      ISOLATED_TEST_STATUS: 'NOT_RUN',
      CANONICAL_TEST_STATUS: 'NOT_RUN',
      TEST_CLEANUP_STATUS: 'NOT_RUN',
    }),
  }),
  PRODUCT_TERRA_BUILD: Object.freeze({
    fixed: Object.freeze({
      WORKSTREAM: 'PRODUCT_MAINLINE',
      BPLUS_MODE: 'true',
      AGENT_LANE: 'TERRA_BUILD',
      LANE_STATE: 'ACTIVE',
      ACTIVE_CANDIDATE: 'true',
      COUNT_IN_DELIVERY_OUTCOME: 'true',
      RETROACTIVE_TRACKING_MIGRATION: 'false',
    }),
    defaults: Object.freeze({}),
  }),
});

export function profileName(body = '') {
  return upper(readField(body, 'PR_PROFILE'));
}

function equalMetadataValue(actual, expected) {
  return upper(actual) === upper(expected);
}

function profileGeneratedRows(body, profile) {
  const rows = [];
  const errors = [];
  const fixed = profile.fixed ?? {};
  const defaults = profile.defaults ?? {};

  for (const [field, expected] of Object.entries(fixed)) {
    const explicit = readField(body, field);
    if (explicit && !equalMetadataValue(explicit, expected)) {
      errors.push(`PR_PROFILE conflicts with explicit ${field}: expected ${expected}, got ${explicit}`);
      continue;
    }
    if (!explicit) rows.push([field, expected, 'fixed']);
  }

  for (const [field, fallback] of Object.entries(defaults)) {
    const explicit = readField(body, field);
    if (!explicit) rows.push([field, fallback, 'default']);
  }

  return { rows, errors };
}

function dynamicRows(body, profile) {
  const rows = [];
  const errors = [];
  if (profile === 'PRODUCT_TERRA_BUILD') {
    const runId = readField(body, 'RUN_ID').trim();
    if (runId) {
      const expected = `docs/metrics/agent-runs/${runId}.json`;
      const explicit = readField(body, 'SCORECARD_PATH').trim();
      if (explicit && explicit !== expected) {
        errors.push(`PR_PROFILE conflicts with explicit SCORECARD_PATH: expected ${expected}, got ${explicit}`);
      } else if (!explicit) {
        rows.push(['SCORECARD_PATH', expected, 'derived']);
      }
    }
  }
  return { rows, errors };
}

export function materializeProfileBody(body = '') {
  const input = String(body ?? '');
  const name = profileName(input);
  if (!name) {
    return { valid: false, profile: '', body: input, generated: [], errors: ['PR_PROFILE is required'] };
  }
  const profile = PR_METADATA_PROFILES[name];
  if (!profile) {
    return {
      valid: false,
      profile: name,
      body: input,
      generated: [],
      errors: [`Unknown PR_PROFILE: ${name}. Allowed: ${Object.keys(PR_METADATA_PROFILES).join(', ')}`],
    };
  }

  const base = profileGeneratedRows(input, profile);
  const dynamic = dynamicRows(input, name);
  const errors = [...base.errors, ...dynamic.errors];
  if (errors.length) return { valid: false, profile: name, body: input, generated: [], errors };

  const rows = [...base.rows, ...dynamic.rows];
  if (!rows.length) return { valid: true, profile: name, body: input, generated: [], errors: [] };

  const generated = rows.map(([field, value]) => `- ${field}: ${value}`);
  const output = `${input.trimEnd()}\n\n<!-- profile-generated metadata; edit the compact inputs above, then rematerialize -->\n## Generated metadata (${name})\n${generated.join('\n')}\n`;
  return { valid: true, profile: name, body: output, generated: rows.map(([field]) => field), errors: [] };
}

export function validateProfileBody({
  body = '',
  changedFiles = null,
  prNumber = 1,
  action = 'opened',
  repositoryRoot = process.cwd(),
  fileExists = existsSync,
} = {}) {
  const materialized = materializeProfileBody(body);
  if (!materialized.valid) {
    return { ...materialized, preflight: null };
  }

  const preflight = validateWipPreflight({
    body: materialized.body,
    changedFiles,
    requireAstraClassification: true,
    prNumber,
    action,
    repositoryRoot,
    fileExists,
  });
  return {
    ...materialized,
    valid: preflight.valid,
    errors: preflight.errors,
    preflight,
  };
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

function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.body) {
    throw new Error('Usage: pr-metadata-profile.mjs --body <compact-pr-body.md> --output <materialized-pr-body.md> [--changed-files <files.txt>] [--number <pr>]');
  }
  if (!args.output) throw new Error('--output is required so the materialized body is explicit before PR creation');

  const body = readFileSync(args.body, 'utf8');
  const changedFiles = args['changed-files']
    ? readFileSync(args['changed-files'], 'utf8').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    : null;
  const result = validateProfileBody({
    body,
    changedFiles,
    prNumber: args.number ?? 1,
    action: args.action ?? 'opened',
    repositoryRoot: args.root ? resolve(args.root) : process.cwd(),
  });

  if (!result.valid) {
    console.error(`PR_METADATA_PROFILE_FAILED profile=${result.profile || 'none'}`);
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }

  writeFileSync(args.output, result.body, 'utf8');
  console.log(`PR_METADATA_PROFILE_PASS profile=${result.profile} generated=${result.generated.length} output=${args.output}`);
}

const entry = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (entry) {
  try { runCli(); } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
