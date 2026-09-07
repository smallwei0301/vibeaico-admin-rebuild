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
  deliveryType = 'SLICE',
  includeDeliveryType = true,
  bplusMode = 'false',
  scorecardPath = 'none',
  activeCandidate = 'false',
  closeability = '0',
  selectionReason = 'GOVERNANCE',
  remainingSteps = 'none',
  blocker = 'none',
  closureTarget = 'none',
  testLaneRequired = 'false',
  dualTerraPilot = 'false',
  terraSlot = 'none',
  primaryIssue = '#212',
  fileOwnership = 'none',
  testProfile = 'SOURCE_ONLY',
  testEnvId = 'none',
  finalCanonicalRequired = 'false',
} = {}) {
  return `<!-- pr-lifecycle
issue: 999
state: ACTIVE
supersedes:
-->

${includeDeliveryType ? `- DELIVERY_UNIT_TYPE: ${deliveryType}` : ''}
- PARENT_EPIC: #7
- COUNT_IN_DELIVERY_OUTCOME: ${count}
- RETROACTIVE_TRACKING_MIGRATION: ${retroactive}
- USER_VISIBLE_OUTCOME: one bounded Product result
- WORK_ORIGIN: ${origin}
- BPLUS_MODE: ${bplusMode}
- RUN_ID: ${runId}
- SCORECARD_PATH: ${scorecardPath}
- AGENT_LANE: TERRA_BUILD
- LANE_STATE: ACTIVE
- ACTIVE_CANDIDATE: ${activeCandidate}
- CLOSEABILITY_SCORE: ${closeability}
- SELECTION_REASON: ${selectionReason}
- REMAINING_AUTONOMOUS_STEPS: ${remainingSteps}
- OWNER_OR_EXTERNAL_BLOCKER: ${blocker}
- CLOSURE_SWEEP_TARGET: ${closureTarget}
- TEST_LANE_REQUIRED: ${testLaneRequired}
- REQUESTED_MODEL / ACTUAL_MODEL: requested=Terra; actual=unknown
- DUAL_TERRA_PILOT: ${dualTerraPilot}
- TERRA_SLOT: ${terraSlot}
- PRIMARY_ISSUE: ${primaryIssue}
- FILE_OWNERSHIP: ${fileOwnership}
- TEST_PROFILE: ${testProfile}
- TEST_ENV_ID: ${testEnvId}
- FINAL_CANONICAL_REQUIRED: ${finalCanonicalRequired}
`;
}

function activeAgentProductBody({ deliveryType, includeDeliveryType = true } = {}) {
  return `${productBody({
    deliveryType,
    includeDeliveryType,
    origin: 'AGENT',
    bplusMode: 'true',
    scorecardPath: `docs/metrics/agent-runs/${FROZEN}.json`,
    activeCandidate: 'true',
    closeability: '5',
    selectionReason: 'CLOSE_READY',
    closureTarget: 'EMPTY_WITH_SCAN',
    fileOwnership: 'scripts/agents/run-admission-policy.mjs',
    testProfile: 'LOCAL_ISOLATED',
    testEnvId: 'AUTO_PR_999',
    finalCanonicalRequired: 'true',
  })}
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

  it('does not allow COUNT_IN_DELIVERY_OUTCOME=false to become a bypass for new Product work', () => {
    const metadata = parseLaneMetadata({
      number: 999,
      body: productBody({ count: 'false', retroactive: 'false' }),
    });
    expect(validateRunAdmission({ metadata })).toContainEqual(
      expect.stringContaining('Only RETROACTIVE_TRACKING_MIGRATION=true'),
    );
  });

  it.each([
    ['omitted', { includeDeliveryType: false }],
    ['GOVERNANCE', { deliveryType: 'GOVERNANCE' }],
    ['EPIC', { deliveryType: 'EPIC' }],
  ])('fails closed in the trusted lane path for %s delivery metadata', (_label, options) => {
    const metadata = parseLaneMetadata({
      number: 999,
      body: activeAgentProductBody(options),
    });
    expect(validateLaneMetadata(metadata)).toContainEqual(
      expect.stringContaining('active Product lanes must declare DELIVERY_UNIT_TYPE=SLICE or STANDALONE'),
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
