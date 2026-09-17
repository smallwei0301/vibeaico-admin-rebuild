import { describe, expect, it } from 'vitest';

import { routing } from '../../scripts/agents/astra-review-policy.mjs';
import { decideFinalRiskRecovery } from '../../scripts/agents/final-risk-workflow.mjs';

describe('Final Risk reviewer trust root (#533)', () => {
  it('never retries a current model outside trusted-main allowlist', () => {
    const result = decideFinalRiskRecovery({
      failureClass: 'TIMEOUT',
      sameClassAttempts: 1,
      currentModel: 'untrusted-reviewer',
      allowedModels: ['untrusted-reviewer'],
    });

    expect(result.action).toBe('DOWNGRADE_REVIEWER_MODEL');
    expect(routing.models.finalRiskDowngradeAllowedModels).toContain(result.nextModel);
    expect(result.nextModel).not.toBe('untrusted-reviewer');
  });
});
