#!/usr/bin/env node
/**
 * Read-only retrospective evidence ledger. This does not execute migrations,
 * inspect customer data, grade Product Runs, or bypass the existing scorers.
 * Input facts must come from current-main and live provider readback.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { pendingProductionMigrations } from '../agents/production-db-release-plan.mjs';

const REPO = 'smallwei0301/vibeaico-admin-rebuild';
const PRODUCTION = 'egehnijjpgijmccagxac';
const TEST = 'nmwhwngojosmagjuvxol';
const SHA = /^[0-9a-f]{40}$/;
const LIVE_URL = /^https:\/\/(?:github\.com|supabase\.com|vercel\.com|[a-z0-9.-]+\.vercel\.app)\/\S+$/i;
const fail = (code) => { throw new Error('DELIVERY_OBSERVATION_' + code); };
const uniqueNames = (items, key) => {
  if (!Array.isArray(items) || items.some((value) => typeof value !== 'string' || !/^[a-z0-9_][a-z0-9_.-]*$/i.test(value))) fail(key + '_INVALID');
  if (new Set(items).size !== items.length) fail(key + '_DUPLICATE');
  return [...items].sort();
};
const utc = (value, key) => {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value) || !Number.isFinite(Date.parse(value))) fail(key + '_INVALID');
  return value;
};
const url = (value, key) => { if (!LIVE_URL.test(String(value ?? ''))) fail(key + '_EVIDENCE_MISSING'); return value; };
const fileSha = (value) => {
  const raw = Buffer.from(String(value));
  return createHash('sha1').update('blob ' + raw.length + '\0').update(raw).digest('hex');
};

function readProvider(packet, project, label) {
  if (!packet || packet.projectRef !== project) fail(label + '_WRONG_PROJECT');
  const observedAt = utc(packet.observedAt, label + '_OBSERVED_AT');
  return { projectRef: project, observedAt, ledgerNames: uniqueNames(packet.ledgerNames, label + '_LEDGER') };
}

function readProduct(product = {}) {
  const coverage = product.coverage === 'COMPLETE' ? 'COMPLETE' : 'INCOMPLETE';
  const missing = uniqueNames(product.missing ?? [], 'PRODUCT_MISSING');
  if (coverage !== 'COMPLETE') {
    return { coverage, pendingCount: null, items: [], missing: missing.length ? missing : ['FULL_PRODUCT_DELIVERY_INVENTORY'] };
  }
  url(product.inventoryEvidenceRef, 'PRODUCT_INVENTORY');
  if (!Array.isArray(product.items) || !Number.isSafeInteger(product.totalEligibleClosed) || product.totalEligibleClosed !== product.items.length) fail('PRODUCT_INVENTORY_DENOMINATOR_MISSING_OR_INCONSISTENT');
  const seen = new Set();
  const items = product.items.map((item) => {
    const number = item?.issueNumber;
    if (!Number.isSafeInteger(number) || number <= 0 || seen.has(number)) fail('PRODUCT_ISSUE_ID_INVALID_OR_DUPLICATE');
    seen.add(number);
    if (!['SLICE', 'STANDALONE'].includes(item.deliveryUnitType)) fail('PRODUCT_DELIVERY_UNIT_NOT_ELIGIBLE');
    url(item.closedEvidenceRef, 'PRODUCT_CLOSED_ISSUE');
    const stages = {};
    for (const stage of ['sourceVerified', 'mergedToMain', 'testVerified', 'productionSchemaReady', 'deployed', 'authenticatedAccepted']) {
      const state = item?.stages?.[stage];
      if (typeof state?.verified !== 'boolean') fail('PRODUCT_STAGE_' + stage + '_UNKNOWN');
      if (state.verified) url(state.evidenceRef, 'PRODUCT_STAGE_' + stage);
      stages[stage] = { verified: state.verified, evidenceRef: state.verified ? state.evidenceRef : null };
    }
    return { issueNumber: number, deliveryUnitType: item.deliveryUnitType, closedEvidenceRef: item.closedEvidenceRef, stages };
  }).sort((a, b) => a.issueNumber - b.issueNumber);
  return {
    coverage, inventoryEvidenceRef: product.inventoryEvidenceRef, totalEligibleClosed: product.totalEligibleClosed, missing: [],
    pendingCount: items.filter((item) => !['sourceVerified', 'mergedToMain', 'deployed', 'productionSchemaReady', 'authenticatedAccepted'].every((key) => item.stages[key].verified)).length, items,
  };
}

function readProductMerges(source = {}) {
  if (source.coverage !== 'COMPLETE') return { coverage: 'INCOMPLETE', count: null, prs: [] };
  url(source.inventoryEvidenceRef, 'PRODUCT_MERGE_INVENTORY');
  const since = utc(source.since, 'PRODUCT_MERGE_SINCE');
  const until = utc(source.until, 'PRODUCT_MERGE_UNTIL');
  if (Date.parse(since) >= Date.parse(until)) fail('PRODUCT_MERGE_WINDOW_INVALID');
  if (!Array.isArray(source.prs)) fail('PRODUCT_MERGE_LIST_MISSING');
  const prs = source.prs.map((pr) => {
    if (!Number.isSafeInteger(pr?.number) || pr.number <= 0) fail('PRODUCT_MERGE_NUMBER_INVALID');
    url(pr.evidenceRef, 'PRODUCT_MERGE');
    const mergedAt = utc(pr.mergedAt, 'PRODUCT_MERGED_AT');
    if (Date.parse(mergedAt) < Date.parse(since) || Date.parse(mergedAt) > Date.parse(until)) fail('PRODUCT_MERGE_OUTSIDE_WINDOW');
    return { number: pr.number, evidenceRef: pr.evidenceRef, mergedAt };
  });
  if (new Set(prs.map((pr) => pr.number)).size !== prs.length) fail('PRODUCT_MERGE_DUPLICATE');
  return { coverage: 'COMPLETE', since, until, count: prs.length, inventoryEvidenceRef: source.inventoryEvidenceRef, prs };
}

export function captureDeliveryObservation(facts, aliasMap, aliasMapBytes) {
  if (facts?.repo !== REPO || !SHA.test(facts?.observedMain ?? '')) fail('MAIN_IDENTITY_MISSING');
  const observedAt = utc(facts?.observedAt, 'OBSERVED_AT');
  if (!SHA.test(facts?.aliasMapBlobSha ?? '') || facts.aliasMapBlobSha !== fileSha(aliasMapBytes)) fail('CANONICAL_MAP_BLOB_MISMATCH');
  if (aliasMap?.schemaVersion !== 1 || !Array.isArray(aliasMap?.entries)) fail('CANONICAL_MAP_INVALID');
  const prod = readProvider(facts.productionLedger, PRODUCTION, 'PRODUCTION');
  const test = readProvider(facts.testLedger, TEST, 'TEST');
  if (Date.parse(prod.observedAt) > Date.parse(observedAt) || Date.parse(test.observedAt) > Date.parse(observedAt)) fail('READBACK_AFTER_OBSERVATION');
  const productionNames = new Set(prod.ledgerNames);
  const pending = pendingProductionMigrations(aliasMap);
  if (pending.some((item) => productionNames.has(item))) fail('PENDING_CONTRADICTS_LIVE_PRODUCTION');
  const applied = [];
  for (const item of aliasMap.entries) {
    if (!['EXACT', 'ALIAS'].includes(item.classification)) continue;
    const names = item.ledgerNames;
    if (!Array.isArray(names) || !names.length || !names.some((name) => productionNames.has(name))) {
      fail('APPLIED_MIGRATION_NOT_IN_LIVE_LEDGER');
    }
    applied.push(item.repoFile);
  }
  const testNames = new Set(test.ledgerNames);
  const product = readProduct(facts.product);
  const sourceProductMerges = readProductMerges(facts.sourceProductMerges);
  if (sourceProductMerges.coverage === 'COMPLETE' && sourceProductMerges.until !== observedAt) fail('PRODUCT_MERGE_WINDOW_NOT_AT_OBSERVATION');
  return {
    schemaVersion: 1, repo: REPO, observedMain: facts.observedMain, observedAt,
    aliasMapBlobSha: facts.aliasMapBlobSha,
    schema: {
      scope: 'CANONICAL_ALIAS_MAP_PENDING_APPLY',
      projectRef: PRODUCTION, readbackAt: prod.observedAt,
      liveProductionLedgerCount: prod.ledgerNames.length,
      liveProductionLedgerNames: prod.ledgerNames,
      pendingCount: pending.length, pendingNames: [...pending].sort(),
      appliedNames: uniqueNames(applied, 'APPLIED_NAMES'),
      testProjectRef: TEST, testReadbackAt: test.observedAt,
      testLedgerPresentForPending: pending.filter((name) => testNames.has(name)).sort(),
      testLedgerMissingForPending: pending.filter((name) => !testNames.has(name)).sort(),
      testLedgerIsNotTestVerified: true,
    },
    product,
    sourceProductMerges,
  };
}

function checkPair(previous, current) {
  if (previous?.schemaVersion !== 1 || current?.schemaVersion !== 1 ||
      previous.repo !== REPO || current.repo !== REPO ||
      !SHA.test(previous.observedMain ?? '') || !SHA.test(current.observedMain ?? '') ||
      !Array.isArray(previous.schema?.pendingNames) || !Array.isArray(current.schema?.pendingNames) ||
      !Array.isArray(current.schema?.appliedNames) || !Array.isArray(current.schema?.liveProductionLedgerNames)) fail('COMPARISON_SNAPSHOT_INVALID');
  if (Date.parse(utc(previous.observedAt, 'PREVIOUS_AT')) >= Date.parse(utc(current.observedAt, 'CURRENT_AT'))) fail('COMPARISON_ORDER_INVALID');
  const before = new Set(uniqueNames(previous.schema.pendingNames, 'PREVIOUS_PENDING'));
  const after = new Set(uniqueNames(current.schema.pendingNames, 'CURRENT_PENDING'));
  const removed = [...before].filter((name) => !after.has(name)).sort();
  const verifiedApplied = new Set(current.schema.appliedNames);
  const clearingWithoutEvidence = removed.filter((name) => !verifiedApplied.has(name));
  const cleared = removed.filter((name) => verifiedApplied.has(name));
  const newlyPending = [...after].filter((name) => !before.has(name)).sort();
  const schemaTrend = clearingWithoutEvidence.length ? 'UNKNOWN_UNVERIFIED_REMOVAL'
    : after.size < before.size ? 'DOWN' : after.size > before.size ? 'UP' : 'FLAT';
  const oldProduct = previous.product ?? {};
  const newProduct = current.product ?? {};
  let productTrend = 'DATA_INSUFFICIENT', pendingDelta = null, toReady = null, toAccepted = null;
  if (oldProduct.coverage === 'COMPLETE' && newProduct.coverage === 'COMPLETE' &&
      Number.isSafeInteger(oldProduct.pendingCount) && Number.isSafeInteger(newProduct.pendingCount) &&
      Array.isArray(oldProduct.items) && Array.isArray(newProduct.items)) {
    const oldItems = new Map(oldProduct.items.map((item) => [item.issueNumber, item]));
    const newItems = new Map(newProduct.items.map((item) => [item.issueNumber, item]));
    const expectedOldPending = oldProduct.items.filter((item) => !['sourceVerified', 'mergedToMain', 'deployed', 'productionSchemaReady', 'authenticatedAccepted'].every((key) => item.stages?.[key]?.verified)).length;
    const expectedNewPending = newProduct.items.filter((item) => !['sourceVerified', 'mergedToMain', 'deployed', 'productionSchemaReady', 'authenticatedAccepted'].every((key) => item.stages?.[key]?.verified)).length;
    if ([...oldItems.keys()].every((number) => newItems.has(number)) &&
        newItems.size === newProduct.items.length && oldItems.size === oldProduct.items.length &&
        expectedOldPending === oldProduct.pendingCount && expectedNewPending === newProduct.pendingCount &&
        oldProduct.totalEligibleClosed === oldItems.size && newProduct.totalEligibleClosed === newItems.size) {
      pendingDelta = newProduct.pendingCount - oldProduct.pendingCount;
      productTrend = pendingDelta < 0 ? 'DOWN' : pendingDelta > 0 ? 'UP' : 'FLAT';
      toReady = 0;
      toAccepted = 0;
      for (const [number, older] of oldItems) {
        const newer = newItems.get(number);
        if (older.stages.testVerified.verified && !older.stages.productionSchemaReady.verified &&
            newer.stages.productionSchemaReady.verified) toReady += 1;
        if (older.stages.deployed.verified && !older.stages.authenticatedAccepted.verified &&
            newer.stages.authenticatedAccepted.verified) toAccepted += 1;
      }
    }
  }
  const improvement = productTrend === 'DATA_INSUFFICIENT' ? 'DATA_INSUFFICIENT'
    : pendingDelta < 0 || toReady > 0 || toAccepted > 0 ? 'IMPROVED' : 'NOT_IMPROVED';
  return {
    from: previous.observedAt, to: current.observedAt,
    schemaPending: { before: before.size, after: after.size, trend: schemaTrend,
      clearedApplied: cleared, newlyPending, unverifiedRemoved: clearingWithoutEvidence },
    productPending: { before: oldProduct.pendingCount ?? null, after: newProduct.pendingCount ?? null,
      delta: pendingDelta, trend: productTrend, testToProductionReady: toReady,
      deployedToAuthenticatedAcceptance: toAccepted, improvement },
  };
}

export function compareDeliveryObservations(previous, current, older = null) {
  const latest = checkPair(previous, current);
  let drainMode = 'DATA_INSUFFICIENT';
  if (older) {
    const first = checkPair(older, previous);
    const complete = [first, latest].every((item) => item.productPending.trend !== 'DATA_INSUFFICIENT') &&
      [previous, current].every((item) => item.sourceProductMerges?.coverage === 'COMPLETE') &&
      previous.sourceProductMerges.since === older.observedAt && previous.sourceProductMerges.until === previous.observedAt &&
      current.sourceProductMerges.since === previous.observedAt && current.sourceProductMerges.until === current.observedAt;
    if (complete) {
      const notDown = [first, latest].every((item) => item.productPending.delta >= 0);
      const sourceAdvanced = [previous, current].every((item) => item.sourceProductMerges.count > 0);
      drainMode = notDown && sourceAdvanced ? 'DELIVERY_DRAIN_MODE_REQUIRED' : 'NOT_TRIGGERED';
    }
  }
  return { ...latest, drainMode, note: 'Schema migration debt and Product pending are separate; source-only CI and TEST ledger presence never equal authenticated Production acceptance.' };
}

function cli(args) {
  const [command, ...files] = args;
  if (command === 'capture' && files.length === 2) {
    const raw = readFileSync(files[0], 'utf8');
    const mapBytes = readFileSync(files[1], 'utf8');
    return captureDeliveryObservation(JSON.parse(raw), JSON.parse(mapBytes), mapBytes);
  }
  if (command === 'compare' && (files.length === 2 || files.length === 3)) {
    const snapshots = files.map((file) => JSON.parse(readFileSync(file, 'utf8')));
    return compareDeliveryObservations(snapshots[0], snapshots[1], snapshots[2] ?? null);
  }
  fail('USAGE_CAPTURE_FACTS_ALIAS_MAP_OR_COMPARE_PREVIOUS_CURRENT_OLDER');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { process.stdout.write(JSON.stringify(cli(process.argv.slice(2)), null, 2) + '\n'); }
  catch (error) { process.stderr.write(String(error?.message ?? error) + '\n'); process.exitCode = 1; }
}
