#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyAstra, routing } from './astra-review-policy.mjs';

const text = value => typeof value === 'string' && value.trim().length > 0
  && !/^(none|unknown|tbd|n\/a)$/i.test(value.trim());
const list = value => Array.isArray(value) && value.length > 0 && value.every(text)
  && new Set(value).size === value.length;
const time = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)
  ? Date.parse(value) : NaN;
const scope = value => list(value) && value.every(item => !item.startsWith('/')
  && !/[\\*?\x00-\x1f]/.test(item) && !item.split('/').some(part => ['..', '.', ''].includes(part)));
const sameSet = (a, b) => list(a) && list(b) && a.length === b.length && a.every(item => b.includes(item));

/** Prospective local packet gate; validates recorded facts, never provider identity or authority authenticity.
 * approvedAuthorities must come from the invoker's separately verified Owner/policy source, not packet data.
 * Existing ledgers and remote PR binding are deliberately not changed by this entrypoint.
 */
export function validateProductScoutPreflight(packet, { approvedAuthorities = [], now = Date.now() } = {}) {
  const errors = [];
  const fail = message => errors.push(`PRODUCT_SCOUT_PREFLIGHT_REJECTED: ${message}`);
  if (packet?.workstream === 'MODEL_GOVERNANCE') {
    if (!scope(packet.scope)) fail('complete bounded governance scope required for exemption');
    else {
      const classification = classifyAstra({ body: 'WORKSTREAM: MODEL_GOVERNANCE\nAGENT_LANE: GOVERNANCE\nFINAL_RISK_POLICY: NOT_REQUIRED_BY_OWNER_POLICY\nASTRA_RISK: NONE\nASTRA_RATIONALE: Pure governance prospective startup', changedFiles: packet.scope });
      if (!classification.isModelGovernance || classification.errors.length) fail(`pure governance classifier rejected scope: ${classification.errors.join('; ')}`);
    }
    return { status: errors.length ? 'FAIL' : 'NOT_REQUIRED', errors };
  }
  if (packet?.workstream !== 'PRODUCT_MAINLINE') fail('explicit legal workstream required');
  if (packet?.schemaVersion !== 1 || packet?.stage !== 'PRE_SOL_TRIAGE') fail('prospective schemaVersion=1 PRE_SOL_TRIAGE packet required');
  if (!text(packet?.runId) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(packet.runId) || !scope(packet?.scope)) fail('concrete runId and unique bounded relative scope required');
  const started = time(packet?.startedAt), triage = time(packet?.transitionRequestedAt);
  if (!Number.isFinite(started) || !Number.isFinite(triage) || started > triage || triage > now) fail('observed packet window required; no future triage');
  if (!text(packet?.triageActor)) fail('triage actor required');
  const catalog = packet?.catalog;
  const expected = catalog?.provider === 'OPENAI' ? routing.models.scout
    : catalog?.provider === 'ANTHROPIC' ? routing.anthropicEquivalents.scout : null;
  const observed = time(catalog?.observedAt);
  if (!expected || !list(catalog?.models) || !text(catalog?.evidenceRef)
    || !Number.isFinite(observed) || observed < started || observed > triage) fail('current provider-local catalog observation required');

  const exception = packet?.exception;
  if (exception) {
    const authority = text(exception.authorityRef) && Array.isArray(approvedAuthorities) && approvedAuthorities.find(item =>
      ['OWNER', 'POLICY'].includes(item?.type) && text(item?.ref) && item.ref === exception.authorityRef
      && item?.runId === packet.runId && sameSet(item?.scope, packet.scope)
      && item?.permission === 'SCOUT_BYPASS' && text(item?.quote)
      && Number.isFinite(time(item?.approvedAt)) && time(item.approvedAt) <= triage);
    if (!authority || !text(exception.reason)) fail('reason alone is not an exception; separately approved scoped Owner/policy authority required');
    return { status: errors.length ? 'FAIL' : 'PASS_WITH_AUTHORIZED_EXCEPTION', errors };
  }

  const scout = packet?.scout;
  const task = scout?.task;
  const scoutStart = time(scout?.startedAt), scoutEnd = time(scout?.completedAt);
  if (!text(scout?.actor) || scout?.actor === packet?.triageActor || !text(scout?.evidenceRef)
    || !Number.isFinite(scoutStart) || !Number.isFinite(scoutEnd)
    || scoutStart < observed || scoutEnd < scoutStart || scoutEnd > triage) fail('scoped scout must finish before distinct Sol triage');
  // Reuse ledger task vocabulary; concrete requested model ID is a separate packet field.
  if (!text(task?.id) || task?.requestedModel !== 'luna' || task?.count !== 1 || task?.accepted !== true
    || !text(task?.role) || !['compact', 'medium', 'large'].includes(task?.contextClass)) fail('observed accepted Luna task required');
  if (scout?.requestedModelId !== expected || !Array.isArray(catalog?.models) || !catalog.models.includes(expected)) fail('explicit available provider-local scout model request required');
  if (task?.actualModel === 'unknown') {
    if ((task.actualModelId !== undefined && task.actualModelId !== 'unknown') || scout?.servedVerified !== false) fail('unknown actual must never claim served identity verification');
  } else if (task?.actualModel !== 'luna' || task?.actualModelId !== expected
    || scout?.servedVerified !== true || !text(scout?.identityEvidenceRef)) fail('claimed served model requires separate identity evidence');
  const output = scout?.output;
  if (!Array.isArray(output) || output.length === 0 || output.some(row => !text(row?.id)
    || !text(row?.summary) || !scope(row?.scope) || !row.scope.every(item => Array.isArray(packet?.scope) && packet.scope.includes(item)))
    || new Set(output.map(row => row?.id)).size !== output.length
    || !Array.isArray(packet?.scope) || !packet.scope.every(item => output.some(row => row?.scope?.includes(item)))) fail('nonempty unique scout output must cover exactly the bounded packet scope');
  const aggregator = packet?.aggregator;
  const aggregateStart = time(aggregator?.startedAt), aggregateEnd = time(aggregator?.completedAt);
  if (!text(aggregator?.actor) || aggregator?.actor === scout?.actor || aggregator?.actor === packet?.triageActor
    || !text(aggregator?.evidenceRef) || !text(aggregator?.summary)
    || !Number.isFinite(aggregateStart) || !Number.isFinite(aggregateEnd)
    || aggregateStart < scoutEnd || aggregateEnd < aggregateStart || aggregateEnd > triage
    || !sameSet(aggregator?.sourceOutputIds, Array.isArray(output) ? output.map(row => row?.id) : [])
    || !sameSet(aggregator?.scope, packet?.scope)) fail('distinct Aggregator scoped dedup receipt must follow scout and precede triage');
  return { status: errors.length ? 'FAIL' : 'PASS', errors };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const args = process.argv.slice(2);
    if (![1, 3].includes(args.length) || (args.length === 3 && args[1] !== '--approved-authorities')) throw new Error('Usage: product-scout-preflight.mjs <packet.json> [--approved-authorities <separately-verified-authorities.json>]');
    const packet = JSON.parse(readFileSync(args[0], 'utf8'));
    const approvedAuthorities = args.length === 3 ? JSON.parse(readFileSync(args[2], 'utf8')) : [];
    const result = validateProductScoutPreflight(packet, { approvedAuthorities });
    console.log(JSON.stringify({ ...result, assurance: 'LOCAL_RECORD_VALIDATION_ONLY; authority and runtime authenticity require independent verification' }, null, 2));
    if (result.errors.length) process.exitCode = 1;
  } catch (error) { console.error(String(error)); process.exitCode = 1; }
}
