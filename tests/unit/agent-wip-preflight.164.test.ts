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

const agentGovernanceBody = `<!-- pr-lifecycle
issue: 182
state: ACTIVE
supersedes: none
-->

- DELIVERY_UNIT_TYPE: GOVERNANCE
- PARENT_EPIC: none
- COUNT_IN_DELIVERY_OUTCOME: false
- RETROACTIVE_TRACKING_MIGRATION: false
- USER_VISIBLE_OUTCOME: none
- WORK_ORIGIN: AGENT
- BPLUS_MODE: true
- RUN_ID: 2026-09-04-governance-scorecard-none-r01
- SCORECARD_PATH: none
- AGENT_LANE: GOVERNANCE
- LANE_STATE: ACTIVE
- ACTIVE_CANDIDATE: true
- CLOSEABILITY_SCORE: 5
- SELECTION_REASON: GOVERNANCE
- REMAINING_AUTONOMOUS_STEPS: exact-head CI and closeout
- OWNER_OR_EXTERNAL_BLOCKER: none
- CLOSURE_SWEEP_TARGET: #182
- TEST_LANE_REQUIRED: false
- RESERVE_BOUNDARY: none
- WHY_NOT_CLOSER_CANDIDATE: none
- REQUESTED_MODEL / ACTUAL_MODEL: requested=Terra; actual=unknown
- DUAL_TERRA_PILOT: false
- TERRA_SLOT: none
- TEST_PROFILE: SOURCE_ONLY
- TEST_ENV_ID: none
- FINAL_CANONICAL_REQUIRED: false
- FILE_OWNERSHIP: scripts/agents/agent-wip-preflight.mjs, tests/unit/agent-wip-preflight.164.test.ts
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

  it.each(['none', 'NONE'])(
    'treats exact SCORECARD_PATH=%s as not applicable for active governance',
    (value) => {
      let fileChecks = 0;
      const result = validateWipPreflight({
        body: agentGovernanceBody.replace('SCORECARD_PATH: none', `SCORECARD_PATH: ${value}`),
        fileExists: () => {
          fileChecks += 1;
          return false;
        },
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(fileChecks).toBe(0);
    },
  );

  it.each(['none/child.json', 'not-none'])(
    'does not let SCORECARD_PATH=%s bypass the existence check',
    (value) => {
      let fileChecks = 0;
      const result = validateWipPreflight({
        body: agentGovernanceBody.replace('SCORECARD_PATH: none', `SCORECARD_PATH: ${value}`),
        fileExists: () => {
          fileChecks += 1;
          return false;
        },
      });
      expect(result.errors).toContain(`SCORECARD_PATH does not exist locally: ${value}`);
      expect(fileChecks).toBe(1);
    },
  );

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

/**
 * #370 帶出來的缺口：preflight 先前**不驗** TEST_PROFILE。
 *
 * TEST_PROFILE / FINAL_CANONICAL_REQUIRED 由 scripts/ci/local-isolated-test-policy.mjs
 * 驗，不在 agent-wip-policy 或 dual-terra-wip-policy 裡。於是一支 preflight 通過的 PR
 * 仍然會被 CI 的 classify job 退掉——2026-09-11 的 #370 就是這樣被退的
 * （TEST_PROFILE 填成不存在的 CANONICAL_TEST，正確值是 SHARED_CANONICAL）。
 *
 * PB-034 的預防是「開 PR 前跑 preflight，通過才推」。那條預防只有在 preflight 真的
 * 涵蓋 CI 會擋的規則時才成立；少涵蓋一支驗證器，預防就只是**看起來**有效——而這件事
 * 在 preflight 通過時完全看不出來。
 */
describe('#370 preflight 必須涵蓋 local-isolated-test-policy 的欄位', () => {
  const withProfile = (profile: string) =>
    productBody
      .replace(/- TEST_PROFILE: .*/g, '')
      .replace('- DUAL_TERRA_PILOT: false', `- TEST_PROFILE: ${profile}\n- DUAL_TERRA_PILOT: false`);

  it('擋下不存在的 TEST_PROFILE（#370 實際被 CI 退掉的那個值）', () => {
    const result = validateWipPreflight({ body: withProfile('CANONICAL_TEST') });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('TEST_PROFILE is invalid: CANONICAL_TEST');
  });

  it('放行四個合法 profile', () => {
    for (const profile of ['SOURCE_ONLY', 'SHARED_CANONICAL']) {
      const result = validateWipPreflight({ body: withProfile(profile) });
      expect(result.errors).not.toContain(`TEST_PROFILE is invalid: ${profile}`);
    }
  });

  it('本機 profile 未設 FINAL_CANONICAL_REQUIRED=true 時擋下', () => {
    // productBody 本身帶 FINAL_CANONICAL_REQUIRED: true，所以要明確翻成 false 才測得到
    // 這條規則——照原樣只會驗到「它本來就滿足」，等於什麼都沒驗。
    const body = withProfile('LOCAL_ISOLATED').replace(
      '- FINAL_CANONICAL_REQUIRED: true',
      '- FINAL_CANONICAL_REQUIRED: false',
    );
    const result = validateWipPreflight({ body });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('LOCAL_ISOLATED profiles must set FINAL_CANONICAL_REQUIRED=true');
  });

  it('本機 profile 且 FINAL_CANONICAL_REQUIRED=true 時不擋（對照組）', () => {
    const result = validateWipPreflight({ body: withProfile('LOCAL_ISOLATED') });
    expect(result.errors).not.toContain('LOCAL_ISOLATED profiles must set FINAL_CANONICAL_REQUIRED=true');
  });

  it('已退役的 profile 給出指向替代做法的訊息，而不是泛用的 invalid', () => {
    const result = validateWipPreflight({ body: withProfile('REMOTE_BRANCH_REQUIRED') });
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/retired/i);
  });
});
