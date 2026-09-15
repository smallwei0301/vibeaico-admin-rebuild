#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const DEFAULT_REPO = 'smallwei0301/vibeaico-admin-rebuild';
const TERMINAL_LIFECYCLE = new Set([
  'COMPLETE', 'CLOSED', 'MERGED', 'OWNER_BLOCKED', 'SUPERSEDED',
  'VERIFIED_FIXED', 'VERIFIED_MERGED', 'VERIFIED_CLOSED',
]);
const TERMINAL_MERGE_STATUS = new Set(['MERGED', 'VERIFIED_MERGED']);
const TERMINAL_COMPLETION = new Set([
  'COMPLETE', 'CLOSED', 'OWNER_BLOCKED', 'SUPERSEDED',
  'VERIFIED_FIXED', 'VERIFIED_MERGED', 'VERIFIED_CLOSED', 'VERIFIED_COMPLETED',
]);
const WIP_STATUS_CONTEXTS = new Set(['agent wip policy', 'agent wip guard']);

const round = (value, digits = 1) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};
const labelNames = (pr) => new Set((pr?.labels ?? []).map((label) => String(label?.name ?? label).trim().toLowerCase()));
const text = (value) => String(value ?? '').trim();
const upper = (value) => text(value).toUpperCase();

function parseTimestamp(value) {
  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function median(values) {
  const ordered = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!ordered.length) return null;
  const mid = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[mid] : (ordered[mid - 1] + ordered[mid]) / 2;
}

function parseBodyField(body, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(body ?? '').match(new RegExp(`(?:^|\\n)\\s*(?:-\\s*)?${escaped}\\s*:\\s*([^\\n]+)`, 'i'));
  return match ? text(match[1]).replace(/[`*]/g, '').trim() : null;
}

export function classifyGovernancePr(pr) {
  const body = String(pr?.body ?? '');
  const labels = labelNames(pr);
  const bodyGovernance = /WORKSTREAM\s*:\s*MODEL_GOVERNANCE/i.test(body);
  const bodyProduct = /WORKSTREAM\s*:\s*PRODUCT_MAINLINE/i.test(body);
  const labelGovernance = labels.has('workstream:model-governance');
  const candidate = bodyGovernance || labelGovernance;
  const mismatch = candidate && (
    bodyGovernance !== labelGovernance ||
    (labelGovernance && bodyProduct)
  );
  return { candidate, mismatch, bodyGovernance, bodyProduct, labelGovernance };
}

function laneState(pr) {
  const bodyState = upper(parseBodyField(pr?.body, 'LANE_STATE'));
  if (bodyState) return bodyState;
  const labels = labelNames(pr);
  if (labels.has('state:active')) return 'ACTIVE';
  if (labels.has('state:parked')) return 'PARKED';
  if (labels.has('state:owner-blocked') || labels.has('owner-blocked')) return 'OWNER_BLOCKED';
  return 'UNKNOWN';
}

function lifecycleState(pr) {
  const body = String(pr?.body ?? '');
  const marker = body.match(/<!--\s*pr-lifecycle[\s\S]*?\bstate\s*:\s*([A-Z_]+)[\s\S]*?-->/i);
  if (marker) {
    const value = upper(marker[1]);
    return { present: true, terminal: TERMINAL_LIFECYCLE.has(value), source: 'pr-lifecycle', value };
  }

  const mergeStatus = upper(parseBodyField(body, 'MERGE_STATUS'));
  const completion = upper(parseBodyField(body, 'COMPLETION_CLAIM'));
  if (mergeStatus || completion) {
    const terminal = TERMINAL_MERGE_STATUS.has(mergeStatus) || TERMINAL_COMPLETION.has(completion);
    return { present: true, terminal, source: 'completion-fields', value: mergeStatus || completion };
  }
  return { present: false, terminal: false, source: null, value: null };
}

function isCiRun(run) {
  return text(run?.name).toLowerCase() === 'ci';
}

function finalHeadRuns(pr, runs) {
  const sha = text(pr?.head?.sha).toLowerCase();
  if (!sha) return [];
  return (runs ?? []).filter((run) => {
    const runSha = text(run?.head_sha).toLowerCase();
    return !runSha || runSha === sha;
  }).sort((a, b) => (parseTimestamp(a?.created_at) ?? 0) - (parseTimestamp(b?.created_at) ?? 0));
}

function normalizeStatusContext(value) {
  return text(value).toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
}

function wipStatuses(statuses) {
  return (statuses ?? [])
    .filter((status) => WIP_STATUS_CONTEXTS.has(normalizeStatusContext(status?.context)))
    .sort((a, b) => {
      const aTime = parseTimestamp(a?.created_at ?? a?.updated_at) ?? 0;
      const bTime = parseTimestamp(b?.created_at ?? b?.updated_at) ?? 0;
      return aTime - bTime;
    });
}

function statusFailureThenSuccess(statuses) {
  let sawFailure = false;
  for (const status of wipStatuses(statuses)) {
    const state = text(status?.state).toLowerCase();
    if (state === 'failure' || state === 'error') sawFailure = true;
    if (sawFailure && state === 'success') return true;
  }
  return false;
}

function percent(numerator, denominator) {
  return denominator > 0 ? round(numerator / denominator * 100, 1) : null;
}

function prTouchesWindow(pr, sinceMs, untilMs) {
  return [pr?.updated_at, pr?.merged_at, pr?.closed_at]
    .map(parseTimestamp)
    .some((value) => value !== null && value >= sinceMs && value <= untilMs);
}

/**
 * @typedef {Object} GovernanceObservationInput
 * @property {string} [repo]
 * @property {string} since
 * @property {string} until
 * @property {string} [generatedAt]
 * @property {any[]} [prs]
 * @property {Record<string, any[]>} [workflowRunsBySha]
 * @property {string[]} [workflowUnavailableShas]
 * @property {Record<string, any[]>} [statusHistoryBySha]
 * @property {string[]} [statusUnavailableShas]
 */

/**
 * Build the current observation layer for the existing Governance Scoreboard.
 * Unknown provider evidence remains null/unavailable rather than becoming zero.
 *
 * @param {GovernanceObservationInput} options
 */
export function buildGovernanceObservation(options) {
  const {
    repo = DEFAULT_REPO,
    since,
    until,
    generatedAt = new Date().toISOString(),
    prs = [],
    workflowRunsBySha = {},
    workflowUnavailableShas = [],
    statusHistoryBySha = {},
    statusUnavailableShas = [],
  } = options ?? {};

  const sinceMs = parseTimestamp(since);
  const untilMs = parseTimestamp(until);
  if (sinceMs === null || untilMs === null || sinceMs > untilMs) throw new Error('since/until must be valid ISO timestamps with since <= until');

  const governancePrs = prs
    .filter((pr) => prTouchesWindow(pr, sinceMs, untilMs))
    .filter((pr) => classifyGovernancePr(pr).candidate);
  const merged = governancePrs.filter((pr) => Boolean(pr?.merged_at));
  const open = governancePrs.filter((pr) => text(pr?.state).toLowerCase() === 'open');
  const cycleMinutes = merged.map((pr) => {
    const start = parseTimestamp(pr?.created_at);
    const end = parseTimestamp(pr?.merged_at);
    return start !== null && end !== null && end >= start ? (end - start) / 60000 : null;
  }).filter(Number.isFinite);

  const inventory = { active: 0, parked: 0, ownerBlocked: 0, unknown: 0 };
  for (const pr of open) {
    const state = laneState(pr);
    if (state === 'ACTIVE') inventory.active += 1;
    else if (state === 'PARKED') inventory.parked += 1;
    else if (state === 'OWNER_BLOCKED') inventory.ownerBlocked += 1;
    else inventory.unknown += 1;
  }

  let workstreamMismatches = 0;
  let budgetViolations = 0;
  let staleLifecycle = 0;
  let lifecycleUnknown = 0;
  for (const pr of governancePrs) {
    if (classifyGovernancePr(pr).mismatch) workstreamMismatches += 1;
    if (Number(pr?.changed_files ?? 0) > 8 || Number(pr?.additions ?? 0) + Number(pr?.deletions ?? 0) > 800) budgetViolations += 1;
    if (pr?.merged_at || text(pr?.state).toLowerCase() === 'closed') {
      const lifecycle = lifecycleState(pr);
      if (!lifecycle.present) lifecycleUnknown += 1;
      else if (!lifecycle.terminal) staleLifecycle += 1;
    }
  }

  const workflowUnavailableSet = new Set((workflowUnavailableShas ?? []).map((sha) => text(sha).toLowerCase()).filter(Boolean));
  const statusUnavailableSet = new Set((statusUnavailableShas ?? []).map((sha) => text(sha).toLowerCase()).filter(Boolean));
  const workflowHistoryComplete = governancePrs.every((pr) => !workflowUnavailableSet.has(text(pr?.head?.sha).toLowerCase()));
  const statusHistoryComplete = governancePrs.every((pr) => !statusUnavailableSet.has(text(pr?.head?.sha).toLowerCase()));

  let ciAttempts = 0;
  let redundantSameHeadReruns = 0;
  let firstPassSuccess = 0;
  let firstPassDenominator = 0;

  if (workflowHistoryComplete) {
    for (const pr of governancePrs) {
      const sha = text(pr?.head?.sha).toLowerCase();
      const runs = finalHeadRuns(pr, workflowRunsBySha[sha] ?? workflowRunsBySha[pr?.head?.sha] ?? []);
      const ciRuns = runs.filter(isCiRun);
      ciAttempts += ciRuns.length;
      redundantSameHeadReruns += Math.max(0, ciRuns.length - 1);
      if (ciRuns.length) {
        firstPassDenominator += 1;
        if (text(ciRuns[0]?.conclusion).toLowerCase() === 'success') firstPassSuccess += 1;
      }
    }
  }

  let metadataGateRecoveryCount = 0;
  if (statusHistoryComplete) {
    for (const pr of governancePrs) {
      const sha = text(pr?.head?.sha).toLowerCase();
      const statuses = statusHistoryBySha[sha] ?? statusHistoryBySha[pr?.head?.sha] ?? [];
      if (statusFailureThenSuccess(statuses)) metadataGateRecoveryCount += 1;
    }
  }

  const unavailableMetrics = [];
  if (!workflowHistoryComplete) {
    unavailableMetrics.push('ciAttempts', 'redundantSameHeadReruns', 'firstPassCi');
  }
  if (!statusHistoryComplete) unavailableMetrics.push('metadataGateRecoveryCount');

  const observation = {
    contractVersion: 1,
    surface: 'GOVERNANCE_SCOREBOARD_CURRENT_OBSERVATION',
    repo,
    since,
    until,
    generatedAt,
    dataSources: [
      'github:search/issues?is=pr&updated-window',
      'github:pull-detail',
      'github:actions/runs?head_sha=<final-head>',
      'github:commits/<final-head>/statuses',
    ],
    counts: {
      totalGovernancePrs: governancePrs.length,
      mergedGovernancePrs: merged.length,
      openGovernancePrs: open.length,
      workstreamMismatches,
      scopeBudgetViolations: budgetViolations,
      staleLifecycle,
      lifecycleUnknown,
    },
    openInventory: inventory,
    cycleTime: {
      mergedSampleCount: cycleMinutes.length,
      medianMinutes: round(median(cycleMinutes), 1),
    },
    ci: {
      attempts: workflowHistoryComplete ? ciAttempts : null,
      redundantSameHeadReruns: workflowHistoryComplete ? redundantSameHeadReruns : null,
      firstPass: workflowHistoryComplete
        ? {
          numerator: firstPassSuccess,
          denominator: firstPassDenominator,
          percent: percent(firstPassSuccess, firstPassDenominator),
        }
        : { numerator: null, denominator: null, percent: null },
      metadataGateRecoveryCount: statusHistoryComplete ? metadataGateRecoveryCount : null,
    },
    workflowHistoryUnavailablePrs: workflowUnavailableSet.size,
    statusHistoryUnavailablePrs: statusUnavailableSet.size,
    unavailableMetrics,
    comparisonEligible: governancePrs.length > 0 && merged.length > 0 && unavailableMetrics.length === 0,
  };
  return observation;
}

export function renderGovernanceObservation(observation) {
  const show = (value) => value === null || value === undefined ? 'N/A' : String(value);
  const lines = [
    '# Governance Scoreboard Current Observation',
    '',
    `- Repo: ${observation.repo}`,
    `- Window: ${observation.since} → ${observation.until}`,
    `- Comparison eligible: **${observation.comparisonEligible ? 'YES' : 'NO'}**`,
    `- Governance PRs: ${observation.counts.totalGovernancePrs} total / ${observation.counts.mergedGovernancePrs} merged / ${observation.counts.openGovernancePrs} open`,
    `- Open inventory: active ${observation.openInventory.active}, parked ${observation.openInventory.parked}, owner-blocked ${observation.openInventory.ownerBlocked}, unknown ${observation.openInventory.unknown}`,
    `- Merged PR cycle-time median: ${show(observation.cycleTime.medianMinutes)} min (n=${observation.cycleTime.mergedSampleCount})`,
    `- Workstream body/label mismatch: ${observation.counts.workstreamMismatches}`,
    `- Governance scope-budget violations: ${observation.counts.scopeBudgetViolations}`,
    `- Stale terminal lifecycle metadata: ${observation.counts.staleLifecycle} (unknown ${observation.counts.lifecycleUnknown})`,
    '',
    '## CI observation',
    '',
    `- final-head CI attempts: ${show(observation.ci.attempts)}`,
    `- redundant same-head reruns: ${show(observation.ci.redundantSameHeadReruns)}`,
    `- first-pass CI: ${show(observation.ci.firstPass.numerator)}/${show(observation.ci.firstPass.denominator)} (${show(observation.ci.firstPass.percent)}${observation.ci.firstPass.percent === null ? '' : '%'})`,
    `- metadata gate failure→success recovery: ${show(observation.ci.metadataGateRecoveryCount)}`,
    '',
    '## Unavailable metrics',
    '',
    ...(observation.unavailableMetrics.length ? observation.unavailableMetrics.map((item) => `- ${item}`) : ['- none']),
    '',
    '> This is the current-observation layer of the existing Governance Scoreboard. It is not a third 0–100 score and it does not replace historical v1/v2 replay or blocking-finding reconciliation.',
    '',
  ];
  return lines.join('\n');
}

async function githubJson(url, token) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'vibeaico-governance-observation',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`GitHub ${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

async function discoverLiveInputs({ repo, since, until, token }) {
  const sinceDate = since.slice(0, 10);
  const untilDate = until.slice(0, 10);
  const query = encodeURIComponent(`repo:${repo} is:pr updated:${sinceDate}..${untilDate}`);
  const search = await githubJson(`https://api.github.com/search/issues?q=${query}&per_page=100`, token);
  const prs = [];
  const workflowRunsBySha = {};
  const workflowUnavailableShas = [];
  const statusHistoryBySha = {};
  const statusUnavailableShas = [];
  const sinceMs = Date.parse(since);
  const untilMs = Date.parse(until);

  for (const item of search.items ?? []) {
    const detail = await githubJson(`https://api.github.com/repos/${repo}/pulls/${item.number}`, token);
    if (!prTouchesWindow(detail, sinceMs, untilMs) || !classifyGovernancePr(detail).candidate) continue;
    prs.push(detail);

    const sha = text(detail?.head?.sha).toLowerCase();
    if (!sha) continue;
    try {
      const runs = await githubJson(`https://api.github.com/repos/${repo}/actions/runs?head_sha=${encodeURIComponent(sha)}&per_page=100`, token);
      workflowRunsBySha[sha] = runs.workflow_runs ?? [];
    } catch {
      workflowUnavailableShas.push(sha);
    }
    try {
      const statuses = await githubJson(`https://api.github.com/repos/${repo}/commits/${encodeURIComponent(sha)}/statuses?per_page=100`, token);
      statusHistoryBySha[sha] = Array.isArray(statuses) ? statuses : [];
    } catch {
      statusUnavailableShas.push(sha);
    }
  }
  return { prs, workflowRunsBySha, workflowUnavailableShas, statusHistoryBySha, statusUnavailableShas };
}

function parseArgs(argv) {
  const result = { repo: process.env.GITHUB_REPOSITORY || DEFAULT_REPO, since: null, until: null, json: false, output: null };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--repo') result.repo = argv[++i];
    else if (value === '--since') result.since = argv[++i];
    else if (value === '--until') result.until = argv[++i];
    else if (value === '--output') result.output = argv[++i];
    else if (value === '--json') result.json = true;
  }
  const now = new Date();
  if (!result.until) result.until = now.toISOString();
  if (!result.since) result.since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  return result;
}

export async function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.repo || !args.repo.includes('/')) throw new Error('--repo must look like owner/name');
  if (parseTimestamp(args.since) === null || parseTimestamp(args.until) === null || Date.parse(args.since) > Date.parse(args.until)) {
    throw new Error('--since / --until must be valid ISO timestamps with since <= until');
  }
  const live = await discoverLiveInputs({ repo: args.repo, since: args.since, until: args.until, token: process.env.GITHUB_TOKEN });
  const observation = buildGovernanceObservation({ repo: args.repo, since: args.since, until: args.until, ...live });
  const output = args.json ? `${JSON.stringify(observation, null, 2)}\n` : renderGovernanceObservation(observation);
  if (args.output) {
    fs.mkdirSync(path.dirname(args.output), { recursive: true });
    fs.writeFileSync(args.output, output, 'utf8');
    console.log(args.output);
  } else process.stdout.write(output);
  return observation;
}

const entry = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (entry) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
