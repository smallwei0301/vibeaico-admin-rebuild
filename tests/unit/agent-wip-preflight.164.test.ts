import { describe, expect, it } from 'vitest';
import {
  validateDeliveryUnitBoundary,
  validateWipPreflight,
} from '../../scripts/agents/agent-wip-preflight.mjs';
import {
  buildWipErrorFingerprint,
  isDuplicateWipFailure,
  normalizeWipErrors,
  readWipEvidence,
} from '../../scripts/agents/wip-alert-fingerprint.mjs';

const productBody = `<!-- pr-lifecycle
issue: 150
state: ACTIVE
supersedes:
-->

- DELIVERY_UNIT_TYPE: SLICE
- PARENT_EPIC: #28
- COUNT_IN_DELIVERY_OUTCOME: true
- RETROACTIVE_TRACKING_MIGRATION: false
- USER_VISIBLE_OUTCOME: 管理者可下載真正的庫存 CSV
- WORK_ORIGIN: AGENT
- BPLUS_MODE: true
- RUN_ID: 2026-09-04-product-r03
- SCORECARD_PATH: docs/metrics/agent-runs/2026-09-04-product-r03.json
- AGENT_LANE: TERRA_BUILD
- LANE_STATE: ACTIVE
- ACTIVE_CANDIDATE: true
- CLOSEABILITY_SCORE: 5
- SELECTION_REASON: CLOSE_READY
- REMAINING_AUTONOMOUS_STEPS: exact-head CI and closeout
- OWNER_OR_EXTERNAL_BLOCKER: none
- CLOSURE_SWEEP_TARGET: EMPTY_WITH_SCAN
- TEST_LANE_REQUIRED: false
- RESERVE_BOUNDARY: none
- WHY_NOT_CLOSER_CANDIDATE: none
- REQUESTED_MODEL / ACTUAL_MODEL: requested=Terra; actual=Terra
- DUAL_TERRA_PILOT: false
- TERRA_SLOT: none
- TEST_PROFILE: LOCAL_ISOLATED
- TEST_ENV_ID: local-product-r03-slot-1
- FINAL_CANONICAL_REQUIRED: true
- FILE_OWNERSHIP: src/app/tenant/inventory/page.tsx
`;

const governanceBody = `<!-- pr-lifecycle
issue: 164
state: ACTIVE
supersedes:
-->

- DELIVERY_UNIT_TYPE: GOVERNANCE
- PARENT_EPIC: none
- COUNT_IN_DELIVERY_OUTCOME: false
- RETROACTIVE_TRACKING_MIGRATION: false
- USER_VISIBLE_OUTCOME: none
- WORK_ORIGIN: OWNER
- BPLUS_MODE: false
- AGENT_LANE: GOVERNANCE
- LANE_STATE: ACTIVE
- REQUESTED_MODEL / ACTUAL_MODEL: requested=GPT-5.6 Pro; actual=GPT-5.6 Pro
`;

describe('Issue #164 Agent WIP preflight', () => {
  it('passes a complete Product Slice before PR creation', () => {
    const result = validateWipPreflight({
      body: productBody,
      fileExists: () => true,
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.metadata.issueNumber).toBe(150);
  });

  it('passes bounded Owner-directed governance metadata', () => {
    const result = validateWipPreflight({ body: governanceBody });
    expect(result.valid).toBe(true);
  });

  it('catches the missing requested/actual model field seen in the retrospective', () => {
    const result = validateWipPreflight({
      body: productBody.replace(
        '- REQUESTED_MODEL / ACTUAL_MODEL: requested=Terra; actual=Terra',
        '- REQUESTED_MODEL / ACTUAL_MODEL:',
      ),
      fileExists: () => true,
    });
    expect(result.errors).toContain('REQUESTED_MODEL / ACTUAL_MODEL is required');
  });

  it('catches a non-close-ready Terra without a real WHY_NOT_CLOSER_CANDIDATE', () => {
    const result = validateWipPreflight({
      body: productBody.replace('SELECTION_REASON: CLOSE_READY', 'SELECTION_REASON: OWNER_DIRECTED'),
      fileExists: () => true,
    });
    expect(result.errors).toContain('Non-CLOSE_READY Terra selection requires WHY_NOT_CLOSER_CANDIDATE');
  });

  it('catches a missing active B+ scorecard locally', () => {
    const result = validateWipPreflight({
      body: productBody,
      fileExists: () => false,
    });
    expect(result.errors).toContain(
      'SCORECARD_PATH does not exist locally: docs/metrics/agent-runs/2026-09-04-product-r03.json',
    );
  });

  it('requires a closable Product Delivery Slice rather than an Epic', () => {
    const body = productBody
      .replace('DELIVERY_UNIT_TYPE: SLICE', 'DELIVERY_UNIT_TYPE: EPIC')
      .replace('COUNT_IN_DELIVERY_OUTCOME: true', 'COUNT_IN_DELIVERY_OUTCOME: false');
    const result = validateWipPreflight({ body, fileExists: () => true });
    expect(result.errors).toContain(
      'An active Product delivery lane must point to a closable SLICE or STANDALONE Issue',
    );
  });

  it('checks actual Dual Terra files against declared ownership', () => {
    const body = productBody
      .replace('DUAL_TERRA_PILOT: false', 'DUAL_TERRA_PILOT: true')
      .replace('TERRA_SLOT: none', 'TERRA_SLOT: 1');
    const result = validateWipPreflight({
      body,
      changedFiles: ['src/app/tenant/bookings/page.tsx'],
      fileExists: () => true,
      prNumber: 200,
    });
    expect(result.errors).toContain(
      'Dual Terra PR #200 changed files outside FILE_OWNERSHIP: src/app/tenant/bookings/page.tsx',
    );
  });

  it('fails a retroactive tracking Issue that tries to count as new output', () => {
    const errors = validateDeliveryUnitBoundary(
      productBody.replace('RETROACTIVE_TRACKING_MIGRATION: false', 'RETROACTIVE_TRACKING_MIGRATION: true'),
      { issueNumber: 150, origin: 'AGENT', state: 'ACTIVE', lane: 'TERRA_BUILD' },
    );
    expect(errors).toContain('A retroactive tracking migration must set COUNT_IN_DELIVERY_OUTCOME=false');
  });
});

describe('Issue #164 WIP alert fingerprint', () => {
  it('normalizes duplicate and reordered errors into one deterministic fingerprint', () => {
    const left = buildWipErrorFingerprint({
      prNumber: 159,
      headSha: 'a'.repeat(40),
      errors: [' Missing model ', 'Closure evidence missing', 'Missing model'],
    });
    const right = buildWipErrorFingerprint({
      prNumber: 159,
      headSha: 'A'.repeat(40),
      errors: ['Closure   evidence missing', 'Missing model'],
    });
    expect(normalizeWipErrors(['b', 'a', 'b'])).toEqual(['a', 'b']);
    expect(left).toBe(right);
    expect(left).toMatch(/^[a-f0-9]{64}$/);
  });

  it('creates a new fingerprint when the exact head or error set changes', () => {
    const base = { prNumber: 159, headSha: 'a'.repeat(40), errors: ['Missing model'] };
    expect(buildWipErrorFingerprint(base)).not.toBe(
      buildWipErrorFingerprint({ ...base, headSha: 'b'.repeat(40) }),
    );
    expect(buildWipErrorFingerprint(base)).not.toBe(
      buildWipErrorFingerprint({ ...base, errors: ['Missing model', 'Missing closure'] }),
    );
  });

  it('suppresses only the same head and same error fingerprint', () => {
    const headSha = 'c'.repeat(40);
    const fingerprint = buildWipErrorFingerprint({
      prNumber: 159,
      headSha,
      errors: ['Missing model'],
    });
    const previousBody = `- EXACT_HEAD: ${headSha}\n- ERROR_FINGERPRINT: ${fingerprint}`;
    expect(readWipEvidence(previousBody)).toEqual({ fingerprint, headSha });
    expect(isDuplicateWipFailure({ previousBody, fingerprint, headSha })).toBe(true);
    expect(isDuplicateWipFailure({ previousBody, fingerprint, headSha: 'd'.repeat(40) })).toBe(false);
  });
});
