import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { captureDeliveryObservation, compareDeliveryObservations } from '../../scripts/metrics/delivery-improvement-observation.mjs';

const source = readFileSync('supabase/ledger-alias-map.json', 'utf8');
const aliasMap = JSON.parse(source);
const blob = (value: string) => createHash('sha1').update('blob ' + Buffer.byteLength(value) + '\0').update(value).digest('hex');
const applied = aliasMap.entries.filter((entry: any) => ['EXACT', 'ALIAS'].includes(entry.classification))
  .flatMap((entry: any) => entry.ledgerNames);
const pending = aliasMap.entries.filter((entry: any) => entry.classification === 'NOT_APPLIED' && entry.notAppliedReason === 'PENDING_APPLY')
  .map((entry: any) => entry.repoFile);
const timestamp = (hour: number) => '2026-10-08T' + String(hour).padStart(2, '0') + ':00:00Z';
const fact = (hour = 9): any => ({
  repo: 'smallwei0301/vibeaico-admin-rebuild',
  observedMain: 'a'.repeat(40),
  observedAt: timestamp(hour),
  aliasMapBlobSha: blob(source),
  productionLedger: { projectRef: 'egehnijjpgijmccagxac', observedAt: timestamp(hour), ledgerNames: applied },
  testLedger: { projectRef: 'nmwhwngojosmagjuvxol', observedAt: timestamp(hour), ledgerNames: [...applied, ...pending] },
  product: { coverage: 'INCOMPLETE', missing: ['FULL_PRODUCT_DELIVERY_INVENTORY', 'LIVE_PRODUCTION_ACCEPTANCE'] },
  sourceProductMerges: { coverage: 'INCOMPLETE' },
});
const captured = (hour = 9) => captureDeliveryObservation(fact(hour), aliasMap, source);
const issue = (accepted = false): any => ({
  issueNumber: 42,
  deliveryUnitType: 'SLICE',
  closedEvidenceRef: 'https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/42',
  stages: Object.fromEntries(['sourceVerified','mergedToMain','testVerified','productionSchemaReady','deployed','authenticatedAccepted'].map((key) =>
    [key, { verified: key === 'authenticatedAccepted' ? accepted : true,
      evidenceRef: 'https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/42' } ])),
});
const complete = (packet: any, accepted = false, prs: number[] = []) => {
  packet.product = { coverage: 'COMPLETE',
    inventoryEvidenceRef: 'https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/42',
    totalEligibleClosed: 1,
    items: [issue(accepted)] };
  const hour = Number(packet.observedAt.slice(11, 13));
  packet.sourceProductMerges = { coverage: 'COMPLETE',
    inventoryEvidenceRef: 'https://github.com/smallwei0301/vibeaico-admin-rebuild/pulls',
    since: timestamp(hour - 1), until: timestamp(hour),
    prs: prs.map((number) => ({
      number, evidenceRef: 'https://github.com/smallwei0301/vibeaico-admin-rebuild/pull/' + number,
      mergedAt: timestamp(hour),
    })),
  };
  return captureDeliveryObservation(packet, aliasMap, source);
};

describe('Retrospective delivery observation: no invented improvements', () => {
  it('captures source alias-map pending against real ledger-shaped readback and keeps incomplete Product unknown', () => {
    const snapshot = captured();
    assert.equal(snapshot.schema.pendingCount, pending.length);
    assert.equal(snapshot.schema.liveProductionLedgerCount, new Set(applied).size);
    assert.equal(snapshot.schema.testLedgerMissingForPending.length, 0);
    assert.equal(snapshot.schema.testLedgerIsNotTestVerified, true);
    assert.equal(snapshot.product.pendingCount, null);
    assert.equal(snapshot.sourceProductMerges.count, null);
  });

  it('rejects absent provider evidence, a wrong project, stale source blob and alleged pending already applied', () => {
    const badProject = fact();
    badProject.productionLedger.projectRef = 'nmwhwngojosmagjuvxol';
    assert.throws(() => captureDeliveryObservation(badProject, aliasMap, source), /WRONG_PROJECT/);
    const badBlob = fact();
    badBlob.aliasMapBlobSha = 'b'.repeat(40);
    assert.throws(() => captureDeliveryObservation(badBlob, aliasMap, source), /CANONICAL_MAP_BLOB_MISMATCH/);
    const contradict = fact();
    contradict.productionLedger.ledgerNames.push(pending[0]);
    assert.throws(() => captureDeliveryObservation(contradict, aliasMap, source), /PENDING_CONTRADICTS_LIVE_PRODUCTION/);
    const noProduct = fact();
    noProduct.product = { coverage: 'COMPLETE', items: [issue()] };
    assert.throws(() => captureDeliveryObservation(noProduct, aliasMap, source), /PRODUCT_INVENTORY_EVIDENCE_MISSING/);
  });

  it('compares schema-only improvements without fabricating Product improvement', () => {
    const before = captured(7);
    const target = pending[0];
    const updated = structuredClone(aliasMap);
    const entry = updated.entries.find((x: any) => x.repoFile === target);
    entry.classification = 'EXACT';
    entry.ledgerNames = [target];
    delete entry.notAppliedReason;
    const bytes = JSON.stringify(updated);
    const facts = fact(8);
    facts.aliasMapBlobSha = blob(bytes);
    facts.productionLedger.ledgerNames.push(target);
    const after = captureDeliveryObservation(facts, updated, bytes);
    const result = compareDeliveryObservations(before, after);
    assert.equal(result.schemaPending.trend, 'DOWN');
    assert.deepEqual(result.schemaPending.clearedApplied, [target]);
    assert.equal(result.productPending.trend, 'DATA_INSUFFICIENT');
    assert.equal(result.productPending.improvement, 'DATA_INSUFFICIENT');
  });

  it('will not count disappearance from a list as production delivery without applied live ledger proof', () => {
    const before = captured(7);
    const after = structuredClone(captured(8));
    after.schema.pendingNames = after.schema.pendingNames.slice(1);
    after.schema.pendingCount -= 1;
    const result = compareDeliveryObservations(before, after);
    assert.equal(result.schemaPending.trend, 'UNKNOWN_UNVERIFIED_REMOVAL');
    assert.equal(result.schemaPending.unverifiedRemoved.length, 1);
  });

  it('only claims Product improvement when the same closed slice acquires authenticated acceptance', () => {
    const before = complete(fact(7), false);
    const after = complete(fact(8), true, [820]);
    const result = compareDeliveryObservations(before, after);
    assert.equal(result.productPending.before, 1);
    assert.equal(result.productPending.after, 0);
    assert.equal(result.productPending.trend, 'DOWN');
    assert.equal(result.productPending.deployedToAuthenticatedAcceptance, 1);
    assert.equal(result.productPending.improvement, 'IMPROVED');
  });

  it('requires three comparable observations before delivery-drain mode is triggered', () => {
    const older = complete(fact(7), false);
    const before = complete(fact(8), false, [820]);
    const current = complete(fact(9), false, [821]);
    assert.equal(compareDeliveryObservations(before, current).drainMode, 'DATA_INSUFFICIENT');
    assert.equal(compareDeliveryObservations(before, current, older).drainMode, 'DELIVERY_DRAIN_MODE_REQUIRED');
    const uncertain = captured(8);
    assert.equal(compareDeliveryObservations(uncertain, current, older).drainMode, 'DATA_INSUFFICIENT');
  });

  it('rejects an impossible reverse observation sequence', () => {
    assert.throws(() => compareDeliveryObservations(captured(9), captured(8)), /COMPARISON_ORDER_INVALID/);
  });
});
