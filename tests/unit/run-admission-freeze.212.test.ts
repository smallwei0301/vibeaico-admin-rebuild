import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateWipPreflight } from '../../scripts/agents/agent-wip-preflight.mjs';
import {
  parseLaneMetadata,
  validateLaneMetadata,
} from '../../scripts/agents/dual-terra-wip-policy.mjs';
import {
  FROZEN_LEGACY_PRODUCT_RUNS,
  validateRunAdmission,
} from '../../scripts/agents/run-admission-policy.mjs';

const FROZEN = '2026-09-04-product-delivery-r01';

function productBody({
  runId = FROZEN,
  count = 'true',
  retroactive = 'false',
  origin = 'OWNER',
} = {}) {
  return `<!-- pr-lifecycle
issue: 999
state: ACTIVE
supersedes:
-->

- DELIVERY_UNIT_TYPE: SLICE
- PARENT_EPIC: #7
- COUNT_IN_DELIVERY_OUTCOME: ${count}
- RETROACTIVE_TRACKING_MIGRATION: ${retroactive}
- USER_VISIBLE_OUTCOME: one bounded Product result
- WORK_ORIGIN: ${origin}
- BPLUS_MODE: false
- RUN_ID: ${runId}
- AGENT_LANE: TERRA_BUILD
- LANE_STATE: ACTIVE
- REQUESTED_MODEL / ACTUAL_MODEL: requested=Terra; actual=unknown
`;
}

describe('Issue #212 legacy Run admission freeze', () => {
  it('records the frozen legacy Run with an immutable evidence sidecar', () => {
    expect(FROZEN_LEGACY_PRODUCT_RUNS[FROZEN]).toMatchObject({
      deliveryTruthVersion: 3,
      evidenceRef: 'docs/metrics/agent-runs/2026-09-04-product-delivery-r01.closeout-observation.md',
    });
  });

  it('blocks a new counted Product Slice from joining the frozen Run', () => {
    const metadata = parseLaneMetadata({ number: 999, body: productBody() });
    expect(validateRunAdmission({ metadata })).toEqual([
      expect.stringContaining('is frozen for new Product membership'),
    ]);
    expect(validateLaneMetadata(metadata)).toContainEqual(
      expect.stringContaining('start a new Delivery Truth v4 Run'),
    );
  });

  it('blocks the same mistake in local PR preflight before GitHub Actions', () => {
    const result = validateWipPreflight({ body: productBody(), prNumber: 999 });
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining('RUN_ID 2026-09-04-product-delivery-r01 is frozen'),
    );
  });

  it('allows a new Product Slice to use a different Run', () => {
    const metadata = parseLaneMetadata({
      number: 999,
      body: productBody({ runId: '2026-09-07-product-delivery-r02' }),
    });
    expect(validateRunAdmission({ metadata })).toEqual([]);
  });

  it('allows explicitly non-counted historical bookkeeping to reference the old Run', () => {
    const metadata = parseLaneMetadata({
      number: 999,
      body: productBody({ count: 'false', retroactive: 'true' }),
    });
    expect(validateRunAdmission({ metadata })).toEqual([]);
  });

  it('keeps the legacy ledger bytes semantically read-only and stores terminal context outside it', () => {
    const root = process.cwd();
    const ledger = JSON.parse(readFileSync(
      resolve(root, 'docs/metrics/agent-runs/2026-09-04-product-delivery-r01.json'),
      'utf8',
    ));
    const observation = readFileSync(
      resolve(root, 'docs/metrics/agent-runs/2026-09-04-product-delivery-r01.closeout-observation.md'),
      'utf8',
    );
    expect(ledger.status).toBe('IN_PROGRESS');
    expect(ledger.endedAt).toBeNull();
    expect(ledger.main.endSha).toBeNull();
    expect(observation).toContain('FROZEN_LEGACY_V3 / HISTORICAL_NON_COMPARABLE / NOT_GRADED');
    expect(observation).toContain('blob: a0fbe424b589201c4cec6db902fbb4d20924f02a');
  });

  it('keeps the trusted-main WIP Guard on the lane-policy path that enforces the freeze', () => {
    const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/agent-wip-guard.yml'), 'utf8');
    const lanePolicy = readFileSync(resolve(process.cwd(), 'scripts/agents/dual-terra-wip-policy.mjs'), 'utf8');
    expect(workflow).toContain("'scripts/agents/dual-terra-wip-policy.mjs'");
    expect(workflow).toContain('policy.validateLaneMetadata(metadata');
    expect(lanePolicy).toContain("import { validateRunAdmission } from './run-admission-policy.mjs';");
    expect(lanePolicy).toContain('...validateRunAdmission({ metadata })');
  });
});
