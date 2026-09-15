import { describe, expect, it } from 'vitest';

import {
  buildProductionDbAutomationReadinessEvidence,
  evaluateProductionDbAutomationReadiness,
} from '../../scripts/agents/production-db-automation-readiness-evidence.mjs';

const MAIN = 'a'.repeat(40);
const PROD = 'egehnijjpgijmccagxac';

function ci(overrides: Record<string, unknown> = {}) {
  return {
    status: 'EXACT_HEAD_CI_GREEN',
    mainSha: MAIN,
    checkName: 'check',
    checkRunId: 34930000000,
    conclusion: 'success',
    targetedCounterexampleSuitePassed: true,
    ...overrides,
  };
}

function credential(overrides: Record<string, unknown> = {}) {
  return {
    status: 'PRODUCTION_DB_SCOPED_CREDENTIAL_VERIFIED',
    projectRef: PROD,
    scope: 'DATABASE_READ_WRITE',
    tokenKind: 'SCOPED_PAT',
    classicPatFallbackAbsent: true,
    observerWriterCredentialSeparationVerified: true,
    proofRef: 'owner-secure-bootstrap-proof-20260915',
    ...overrides,
  };
}

describe('Production DB automation readiness evidence #447', () => {
  it('stays AUTOMATION_PENDING when scoped credential proof is absent', () => {
    const { evidence, readiness } = evaluateProductionDbAutomationReadiness({
      mainSha: MAIN,
      exactHeadCi: ci(),
      credentialProof: null,
      repoRoot: process.cwd(),
    });

    expect(evidence.writer).toMatchObject({
      dedicatedScopedCredentialPresent: false,
      classicPatFallbackAbsent: false,
      observerWriterCredentialSeparationVerified: false,
      credentialProjectRef: null,
      credentialScope: null,
    });
    expect(readiness).toMatchObject({
      status: 'AUTOMATION_PENDING',
      automationReady: false,
      authorizationMode: 'POLICY_APPROVED_AUTOMATION_PENDING',
      perRunOwnerApproval: 'REQUIRED_DURING_BOOTSTRAP',
      databaseMutationAuthorized: false,
    });
    expect(readiness.blockers).toEqual(expect.arrayContaining([
      'WRITER_DEDICATEDSCOPEDCREDENTIALPRESENT_REQUIRED',
      'WRITER_CREDENTIAL_PROJECT_MISMATCH',
      'WRITER_CREDENTIAL_SCOPE_INVALID',
    ]));
  });

  it('does not accept malformed, classic, wrong-project, or wrong-scope credential metadata as proof', () => {
    const invalid = [
      credential({ status: 'SELF_ATTESTED' }),
      credential({ tokenKind: 'CLASSIC_PAT' }),
      credential({ projectRef: 'other-project' }),
      credential({ scope: 'DATABASE_READ' }),
      credential({ classicPatFallbackAbsent: false }),
      credential({ observerWriterCredentialSeparationVerified: false }),
      credential({ proofRef: 'short' }),
    ];

    for (const proof of invalid) {
      const evidence = buildProductionDbAutomationReadinessEvidence({
        mainSha: MAIN,
        exactHeadCi: ci(),
        credentialProof: proof,
        repoRoot: process.cwd(),
      });
      expect(evidence.writer.dedicatedScopedCredentialPresent).toBe(false);
      expect(evidence.writer.credentialProjectRef).toBeNull();
      expect(evidence.writer.credentialScope).toBeNull();
    }
  });

  it('still stays pending with valid credential metadata while the mutable trusted-main orchestrator workflow is absent', () => {
    const { evidence, readiness } = evaluateProductionDbAutomationReadiness({
      mainSha: MAIN,
      exactHeadCi: ci(),
      credentialProof: credential(),
      repoRoot: process.cwd(),
    });

    expect(evidence.writer).toMatchObject({
      dedicatedScopedCredentialPresent: true,
      classicPatFallbackAbsent: true,
      observerWriterCredentialSeparationVerified: true,
      credentialProjectRef: PROD,
      credentialScope: 'DATABASE_READ_WRITE',
    });
    expect(evidence.orchestrator.g3EvidenceConsumerWired).toBe(false);
    expect(evidence.orchestrator.preparedEnvelopePersistBeforeExecute).toBe(false);
    expect(readiness.automationReady).toBe(false);
    expect(readiness.blockers).toEqual(expect.arrayContaining([
      'ORCHESTRATOR_G3EVIDENCECONSUMERWIRED_REQUIRED',
      'ORCHESTRATOR_PREPAREDENVELOPEPERSISTBEFOREEXECUTE_REQUIRED',
      'ORCHESTRATOR_PREPAREDENVELOPERELOADVERIFIED_REQUIRED',
      'ORCHESTRATOR_G7POSTCHECKWIRED_REQUIRED',
    ]));
  });

  it('keeps every counterexample blocker closed when the targeted counterexample suite was not proven', () => {
    const { evidence, readiness } = evaluateProductionDbAutomationReadiness({
      mainSha: MAIN,
      exactHeadCi: ci({ targetedCounterexampleSuitePassed: false }),
      credentialProof: credential(),
      repoRoot: process.cwd(),
    });

    expect(evidence.counterexamples.wrongProject).toBe(false);
    expect(evidence.counterexamples.receiptReplay).toBe(false);
    expect(evidence.counterexamples.lostRunnerCrashWindow).toBe(false);
    expect(readiness.blockers).toEqual(expect.arrayContaining([
      'COUNTEREXAMPLE_WRONGPROJECT_REQUIRED',
      'COUNTEREXAMPLE_RECEIPTREPLAY_REQUIRED',
      'COUNTEREXAMPLE_LOSTRUNNERCRASHWINDOW_REQUIRED',
    ]));
  });

  it('rejects exact-head CI evidence for another main or a non-green required check', () => {
    expect(() => buildProductionDbAutomationReadinessEvidence({
      mainSha: MAIN,
      exactHeadCi: ci({ mainSha: 'd'.repeat(40) }),
      repoRoot: process.cwd(),
    })).toThrow(/EXACT_HEAD_CI_MAIN_MISMATCH/);

    expect(() => buildProductionDbAutomationReadinessEvidence({
      mainSha: MAIN,
      exactHeadCi: ci({ conclusion: 'failure' }),
      repoRoot: process.cwd(),
    })).toThrow(/EXACT_HEAD_CHECK_INVALID/);
  });

  it('never turns the readiness envelope itself into a Production mutation credential', () => {
    const { evidence, readiness } = evaluateProductionDbAutomationReadiness({
      mainSha: MAIN,
      exactHeadCi: ci(),
      credentialProof: credential(),
      repoRoot: process.cwd(),
    });
    expect(evidence.databaseMutationAuthorized).toBe(false);
    expect(readiness.databaseMutationAuthorized).toBe(false);
  });
});
