import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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

function write(root: string, path: string, content: string) {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function completeSyntheticRepo() {
  const root = mkdtempSync(join(tmpdir(), 'production-db-readiness-'));
  write(root, 'scripts/agents/production-db-release-preflight.mjs', 'evaluateReleasePreflight\ndatabaseMutationAuthorized: false');
  write(root, 'scripts/agents/production-db-consistency-evidence.mjs', 'buildProductionDbConsistencyEvidence\nCONSISTENCY_VERIFIED');
  write(root, '.github/workflows/agent-production-db-backup-observer.yml', 'workflow_call:\nexpected_main_sha:\nSUPABASE_BACKUP_OBSERVER_TOKEN');
  write(root, '.github/workflows/production-db-restore-rehearsal.yml', 'workflow_call:\nexpected_main_sha:\nRESTORE_REHEARSAL_VERIFIED');
  write(root, '.github/workflows/ci.yml', 'production_db_release_id:\nTEST_DB_RELEASE_TOKEN\nproduction-db-test-verified.json\nproduction-db-test-post-schema-evidence.json');
  write(root, 'scripts/agents/production-db-final-risk-evidence.mjs', 'buildProductionDbFinalRiskEvidenceFromGithub\ngithub.rest.pulls.get\ngithub.rest.pulls.listReviews\nisTrustedFinalRiskAgentUser\nWRITE_ACTOR\nTRUSTED_AGENT_BOT\nFINAL_RISK_RELEASE_MISMATCH\nFINAL_RISK_PLAN_MISMATCH\nFINAL_RISK_EVIDENCE_MISMATCH');
  write(root, 'scripts/agents/production-db-apply-receipt.mjs', 'CONSUMING\nCONSUMED\nUNKNOWN\nAPPLY_RECEIPT_REPLAY');
  write(root, 'scripts/agents/production-db-release-journal.mjs', 'APPLY_UNKNOWN\nPOSTCHECK_FAILED\nPRODUCTION_SCHEMA_READY\nWRITER_RETRY_BLOCKED');
  write(root, 'scripts/agents/production-db-postcheck.mjs', 'PRODUCTION_SCHEMA_READY\nPOSTCHECK_FAILED');
  write(root, 'scripts/agents/production-db-release-orchestrator.mjs', 'assertExactTrustedMain\nAUTOMATION_NOT_READY');
  write(root, '.github/workflows/production-db-release-orchestrator.yml', [
    'G3', 'production-db-test-verified.json', 'G4', 'production-db-backup-evidence', 'restore-rehearsal',
    'buildProductionDbFinalRiskEvidenceFromGithub', 'FINAL_RISK', 'prepared-production-db-attempt',
    'upload-artifact', 'download-artifact', 'production-db-release-orchestrator.mjs postcheck', 'G7',
    'production-db-terminal-result', 'if: ${{ always() }}',
  ].join('\n'));
  write(root, 'scripts/db/controlled-production-db-release.mjs', [
    '/database/query', 'PENDING_SET_MISMATCH', 'pendingProductionMigrations', 'pg_try_advisory_xact_lock',
    'PRODUCTION_DB_WRITER_LOCK_BUSY', 'CONTROLLED_APPLY_PREPARED', 'preparationDigest',
    'DURABLE_PREPARED_ATTEMPT_REQUIRED',
  ].join('\n'));
  write(root, 'scripts/db/run-migrations.mjs', [
    '/database/query', "targetEnvironment === 'PRODUCTION'", 'PRODUCTION_CONTROLLED_WRITER_REQUIRED',
    'executeMigrationPlan({',
  ].join('\n'));
  write(root, 'scripts/db/validate-production-db-release-on-test.mjs', [
    "const TEST_PROJECT_REF = 'nmwhwngojosmagjuvxol';",
    "const PRODUCTION_PROJECT_REF = 'egehnijjpgijmccagxac';",
    'PRODUCTION_TARGET_FORBIDDEN', 'TEST_DB_RELEASE_TOKEN',
    'async function executeAtomicTestRelease() {', 'assertTestReleaseTarget(projectRef);', 'return `/database/query`;', '}',
  ].join('\n'));
  write(root, 'scripts/db/schema-fingerprint-diff.mjs', '/database/query/read-only\nSCHEMA_OBSERVER_TOKEN\n拒絕 broad SUPABASE_ACCESS_TOKEN fallback');
  write(root, 'scripts/agents/production-db-g3-post-test-schema.mjs', [
    "if (process.env.SUPABASE_ACCESS_TOKEN) fail('BROAD_SCHEMA_TOKEN_FORBIDDEN'",
    'SCHEMA_OBSERVER_TOKEN', "environment: 'TEST'", "comparisonClaim: 'CAPTURE_ONLY_G2_COMPARISON_REQUIRED'",
  ].join('\n'));
  return root;
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

  it('recognizes the current trusted-main orchestrator wiring when externally verified credential metadata is supplied', () => {
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
      singleUseReceiptVerified: true,
      failureJournalVerified: true,
    });
    expect(evidence.orchestrator).toMatchObject({
      trustedMainOnly: true,
      g3EvidenceConsumerWired: true,
      g4BackupEvidenceConsumerWired: true,
      g4RestoreEvidenceConsumerWired: true,
      finalRiskLiveFetchWired: true,
      preparedEnvelopePersistBeforeExecute: true,
      preparedEnvelopeReloadVerified: true,
      g7PostcheckWired: true,
      terminalResultPersisted: true,
    });
    expect(readiness).toMatchObject({
      status: 'AUTOMATION_READY',
      automationReady: true,
      authorizationMode: 'POLICY_GATED_ACTIVE',
      perRunOwnerApproval: 'NOT_REQUIRED',
      blockers: [],
      databaseMutationAuthorized: false,
    });
  });

  it('can become AUTOMATION_READY only when every canonical source, credential, orchestrator, CI and counterexample condition is present', () => {
    const root = completeSyntheticRepo();
    try {
      const { evidence, readiness } = evaluateProductionDbAutomationReadiness({
        mainSha: MAIN,
        exactHeadCi: ci(),
        credentialProof: credential(),
        repoRoot: root,
      });
      expect(evidence.sourceControls).toMatchObject({
        readOnlyPreflightMergedMain: true,
        scopedConsistencyAdapterMergedMain: true,
        backupObserverMergedMain: true,
        restoreRehearsalCallableMergedMain: true,
        sharedTestEvidenceEmitterMergedMain: true,
        exactHeadCiGreen: true,
      });
      expect(evidence.writer).toMatchObject({
        exactPendingSetVerified: true,
        singleUseReceiptVerified: true,
        databaseLockVerified: true,
        durablePreparedEnvelopeVerified: true,
        postcheckVerified: true,
        failureJournalVerified: true,
        bypassAuditClean: true,
        dedicatedScopedCredentialPresent: true,
      });
      expect(evidence.orchestrator).toMatchObject({
        trustedMainOnly: true,
        g3EvidenceConsumerWired: true,
        g4BackupEvidenceConsumerWired: true,
        g4RestoreEvidenceConsumerWired: true,
        finalRiskLiveFetchWired: true,
        preparedEnvelopePersistBeforeExecute: true,
        preparedEnvelopeReloadVerified: true,
        g7PostcheckWired: true,
        terminalResultPersisted: true,
      });
      expect(readiness).toMatchObject({
        status: 'AUTOMATION_READY',
        automationReady: true,
        authorizationMode: 'POLICY_GATED_ACTIVE',
        perRunOwnerApproval: 'NOT_REQUIRED',
        blockers: [],
        databaseMutationAuthorized: false,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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
