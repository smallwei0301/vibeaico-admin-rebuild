export const FROZEN_LEGACY_PRODUCT_RUNS = Object.freeze({
  '2026-09-04-product-delivery-r01': Object.freeze({
    declaredAt: '2026-09-07T02:38:45Z',
    deliveryTruthVersion: 3,
    evidenceRef: 'docs/metrics/agent-runs/2026-09-04-product-delivery-r01.closeout-observation.md',
    reason: 'Legacy v3 Run reached a natural closeout window and must remain read-only under the 2026-09-07 Owner Decision.',
  }),
});

const PRODUCT_TYPES = new Set(['SLICE', 'STANDALONE']);

function upper(value) {
  return String(value ?? '').trim().toUpperCase();
}

export function getFrozenRun(runId) {
  return FROZEN_LEGACY_PRODUCT_RUNS[String(runId ?? '').trim()] ?? null;
}

export function validateRunAdmission({ metadata = {} } = {}) {
  const runId = String(metadata.runId ?? '').trim();
  const frozen = getFrozenRun(runId);
  if (!frozen) return [];

  const deliveryType = upper(metadata.deliveryUnitType);
  const counted = upper(metadata.countInDeliveryOutcome) === 'TRUE';
  const retroactive = upper(metadata.retroactiveTrackingMigration) === 'TRUE';

  // Historical bookkeeping may reference a frozen Run only when it is explicitly
  // non-delivery. New Product membership is never admitted after the freeze.
  if (!PRODUCT_TYPES.has(deliveryType) || !counted || retroactive) return [];

  return [
    `RUN_ID ${runId} is frozen for new Product membership; start a new Delivery Truth v4 Run with an explicit closeout owner. Evidence: ${frozen.evidenceRef}`,
  ];
}
