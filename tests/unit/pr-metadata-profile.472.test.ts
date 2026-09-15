import { describe, expect, it } from 'vitest';

import {
  materializeProfileBody,
  validateProfileBody,
} from '../../scripts/agents/pr-metadata-profile.mjs';
import { readField } from '../../scripts/agents/agent-wip-policy.mjs';

const governanceCompact = (extra = '') => `
<!-- pr-lifecycle
issue: 472
state: ACTIVE
supersedes:
-->
PR_PROFILE: GOVERNANCE_SOURCE_ONLY
WORK_ORIGIN: OWNER
LANE_STATE: ACTIVE
CLOSEABILITY_SCORE: 5
SELECTION_REASON: GOVERNANCE
REMAINING_AUTONOMOUS_STEPS: exact-head CI, merge, main reread
OWNER_OR_EXTERNAL_BLOCKER: none
CLOSURE_SWEEP_TARGET: #472
GOVERNANCE_SCOPE_EXCEPTION: none
ASTRA_RATIONALE: pure source-only governance metadata tooling; no Product or provider behavior
${extra}
`;

const productCompact = (extra = '') => `
<!-- pr-lifecycle
issue: 42
state: ACTIVE
supersedes:
-->
PR_PROFILE: PRODUCT_TERRA_BUILD
WORK_ORIGIN: AGENT
RUN_ID: 2026-09-15-profile-r01
CLOSEABILITY_SCORE: 4
SELECTION_REASON: CLOSE_READY
REMAINING_AUTONOMOUS_STEPS: focused tests, source CI, merge
OWNER_OR_EXTERNAL_BLOCKER: none
CLOSURE_SWEEP_TARGET: #42
WHY_NOT_CLOSER_CANDIDATE: none
REQUESTED_MODEL / ACTUAL_MODEL: requested=claude-sonnet-5; actual=claude-sonnet-5
DELIVERY_UNIT_TYPE: SLICE
PARENT_EPIC: #42
USER_VISIBLE_OUTCOME: one bounded visible Product result
TEST_LANE_REQUIRED: false
TEST_PROFILE: SOURCE_ONLY
FINAL_CANONICAL_REQUIRED: false
MIGRATION_TOUCH: false
AUTH_TOUCH: false
STORAGE_TOUCH: false
ASTRA_RISK: NONE
ASTRA_RATIONALE: bounded non-sensitive Product source change
FINAL_RISK_POLICY: BY_PRODUCT_RISK_CLASSIFICATION
${extra}
`;

describe('PR metadata profiles (#472)', () => {
  it('materializes governance constants instead of requiring repeated manual fields', () => {
    const result = materializeProfileBody(governanceCompact());
    expect(result.valid).toBe(true);
    expect(result.profile).toBe('GOVERNANCE_SOURCE_ONLY');
    expect(result.generated.length).toBeGreaterThan(20);
    expect(readField(result.body, 'WORKSTREAM')).toBe('MODEL_GOVERNANCE');
    expect(readField(result.body, 'AGENT_LANE')).toBe('GOVERNANCE');
    expect(readField(result.body, 'TEST_PROFILE')).toBe('SOURCE_ONLY');
    expect(readField(result.body, 'ASTRA_RISK')).toBe('NONE');
    expect(readField(result.body, 'DELIVERY_UNIT_TYPE')).toBe('GOVERNANCE');
  });

  it('lets a reliable explicit model value override the governance unknown default', () => {
    const result = materializeProfileBody(governanceCompact(
      'REQUESTED_MODEL / ACTUAL_MODEL: requested=claude-opus-5; actual=claude-opus-5',
    ));
    expect(result.valid).toBe(true);
    expect(readField(result.body, 'REQUESTED_MODEL / ACTUAL_MODEL')).toContain('actual=claude-opus-5');
  });

  it('fails closed when an explicit value conflicts with a fixed governance profile value', () => {
    const result = materializeProfileBody(governanceCompact('ASTRA_RISK: PAYMENT_CONSISTENCY'));
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('PR_PROFILE conflicts with explicit ASTRA_RISK');
  });

  it('rejects an unknown profile instead of silently falling back', () => {
    const result = materializeProfileBody('PR_PROFILE: MAGIC_FAST_PATH\nWORK_ORIGIN: OWNER');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Unknown PR_PROFILE');
  });

  it('runs the existing preflight against the materialized governance body', () => {
    const result = validateProfileBody({
      body: governanceCompact(),
      changedFiles: ['docs/metrics/example.md'],
      prNumber: 472,
      fileExists: () => true,
    });
    expect(result.valid, result.errors.join('\n')).toBe(true);
    expect(result.preflight?.valid).toBe(true);
  });

  it('derives Product SCORECARD_PATH from RUN_ID but leaves risk and TEST choices explicit', () => {
    const result = materializeProfileBody(productCompact());
    expect(result.valid).toBe(true);
    expect(readField(result.body, 'WORKSTREAM')).toBe('PRODUCT_MAINLINE');
    expect(readField(result.body, 'BPLUS_MODE')).toBe('true');
    expect(readField(result.body, 'AGENT_LANE')).toBe('TERRA_BUILD');
    expect(readField(result.body, 'LANE_STATE')).toBe('ACTIVE');
    expect(readField(result.body, 'ACTIVE_CANDIDATE')).toBe('true');
    expect(readField(result.body, 'SCORECARD_PATH')).toBe(
      'docs/metrics/agent-runs/2026-09-15-profile-r01.json',
    );
    expect(readField(result.body, 'TEST_PROFILE')).toBe('SOURCE_ONLY');
    expect(readField(result.body, 'ASTRA_RISK')).toBe('NONE');
  });

  it('fails closed when Product SCORECARD_PATH contradicts the RUN_ID-derived path', () => {
    const result = materializeProfileBody(productCompact(
      'SCORECARD_PATH: docs/metrics/agent-runs/some-other-run.json',
    ));
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('PR_PROFILE conflicts with explicit SCORECARD_PATH');
  });

  it('keeps legacy explicit bodies untouched by requiring opt-in PR_PROFILE', () => {
    const result = materializeProfileBody('WORKSTREAM: MODEL_GOVERNANCE\nAGENT_LANE: GOVERNANCE');
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(['PR_PROFILE is required']);
  });
});
