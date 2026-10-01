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
      provider: 'OPENAI',
      availableModels: ['gpt-6.1-sol'],
      now: '2026-10-01T00:00:01Z',
      runtimeCatalog: { provider: 'OPENAI', models: ['gpt-6.1-sol'],
        captureStartedAt: '2026-10-01T00:00:00Z', observedAt: '2026-10-01T00:00:01Z',
        evidenceRef: 'https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/533#issuecomment-101',
        providerEvidenceRef: 'https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/533#issuecomment-102' },
    });

    expect(result.action).toBe('DOWNGRADE_REVIEWER_MODEL');
    expect(routing.models.finalRiskDowngradeAllowedModels).toContain(result.nextModel);
    expect(result.nextModel).not.toBe('untrusted-reviewer');
  });

  it('parks selector recovery when current provider catalog proof is missing', () => {
    const result = decideFinalRiskRecovery({ failureClass: 'TIMEOUT', sameClassAttempts: 1,
      currentModel: 'untrusted-reviewer', modelSelectionAvailable: true,
      provider: 'OPENAI', availableModels: ['gpt-6.1-sol'] });
    expect(result.action).toBe('PARK_CURRENT_AND_CONTINUE_CLOSURE_TRIAGE');
    expect(result.nextModel).toBeNull();
  });

});
