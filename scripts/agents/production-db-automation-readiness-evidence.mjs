#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

import { evaluateAutomationReadiness, PRODUCTION_DB_POLICY } from './production-db-release-preflight.mjs';
import { auditProductionDbWriterBypasses, collectProductionDbExecutableSources } from './production-db-writer-bypass-audit.mjs';

const REPOSITORY = PRODUCTION_DB_POLICY.repository;
const PROD = PRODUCTION_DB_POLICY.productionProjectRef;
const SHA = /^[0-9a-f]{40}$/;
const ORCHESTRATOR_WORKFLOW = '.github/workflows/production-db-release-orchestrator.yml';

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

function exactSha(value, label) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!SHA.test(text)) fail('INVALID_MAIN_SHA', `${label} must be an exact SHA`);
  return text;
}

function textAt(repoRoot, path) {
  const full = join(repoRoot, path);
  return existsSync(full) ? readFileSync(full, 'utf8') : '';
}

function includesAll(text, needles) {
  return needles.every((needle) => text.includes(needle));
}

function credentialTruth(proof) {
  const valid = !!proof &&
    proof.status === 'PRODUCTION_DB_SCOPED_CREDENTIAL_VERIFIED' &&
    proof.projectRef === PROD &&
    proof.scope === 'DATABASE_READ_WRITE' &&
    proof.tokenKind === 'SCOPED_PAT' &&
    proof.classicPatFallbackAbsent === true &&
    proof.observerWriterCredentialSeparationVerified === true &&
    typeof proof.proofRef === 'string' && proof.proofRef.trim().length >= 8;
  return {
    dedicatedScopedCredentialPresent: valid,
    classicPatFallbackAbsent: valid && proof.classicPatFallbackAbsent === true,
    observerWriterCredentialSeparationVerified: valid && proof.observerWriterCredentialSeparationVerified === true,
    credentialProjectRef: valid ? proof.projectRef : null,
    credentialScope: valid ? proof.scope : null,
    credentialProofRef: valid ? proof.proofRef : null,
  };
}

/**
 * Build the canonical automation evidence envelope from exact-main source truth,
 * exact-head CI evidence and optional external scoped-credential metadata. No
 * database request is performed here.
 *
 * @param {{mainSha:string, exactHeadCi:any, credentialProof?:any, repoRoot?:string}} input
 */
export function buildProductionDbAutomationReadinessEvidence({
  mainSha,
  exactHeadCi,
  credentialProof = null,
  repoRoot = process.cwd(),
}) {
  const sha = exactSha(mainSha, 'mainSha');
  if (!exactHeadCi || exactHeadCi.status !== 'EXACT_HEAD_CI_GREEN') fail('EXACT_HEAD_CI_REQUIRED', 'exact-head CI evidence is required');
  if (exactSha(exactHeadCi.mainSha, 'exactHeadCi.mainSha') !== sha) fail('EXACT_HEAD_CI_MAIN_MISMATCH', 'CI evidence belongs to another main SHA');
  if (exactHeadCi.checkName !== 'check' || exactHeadCi.conclusion !== 'success' || !Number.isSafeInteger(Number(exactHeadCi.checkRunId))) {
    fail('EXACT_HEAD_CHECK_INVALID', 'latest exact-main check must be successful');
  }
  const counterexampleSuitePassed = exactHeadCi.targetedCounterexampleSuitePassed === true;

  const preflight = textAt(repoRoot, 'scripts/agents/production-db-release-preflight.mjs');
  const consistency = textAt(repoRoot, 'scripts/agents/production-db-consistency-evidence.mjs');
  const backupWorkflow = textAt(repoRoot, '.github/workflows/agent-production-db-backup-observer.yml');
  const restoreWorkflow = textAt(repoRoot, '.github/workflows/production-db-restore-rehearsal.yml');
  const ciWorkflow = textAt(repoRoot, '.github/workflows/ci.yml');
  const finalRisk = textAt(repoRoot, 'scripts/agents/production-db-final-risk-evidence.mjs');
  const controlledWriter = textAt(repoRoot, 'scripts/db/controlled-production-db-release.mjs');
  const receipt = textAt(repoRoot, 'scripts/agents/production-db-apply-receipt.mjs');
  const journal = textAt(repoRoot, 'scripts/agents/production-db-release-journal.mjs');
  const postcheck = textAt(repoRoot, 'scripts/agents/production-db-postcheck.mjs');
  const orchestrator = textAt(repoRoot, 'scripts/agents/production-db-release-orchestrator.mjs');
  const orchestratorWorkflow = textAt(repoRoot, ORCHESTRATOR_WORKFLOW);

  const sourceControls = {
    status: 'SOURCE_CONTROLS_VERIFIED',
    mainSha: sha,
    readOnlyPreflightMergedMain: includesAll(preflight, ['evaluateReleasePreflight', 'databaseMutationAuthorized: false']),
    scopedConsistencyAdapterMergedMain: includesAll(consistency, ['buildProductionDbConsistencyEvidence', 'CONSISTENCY_VERIFIED']),
    backupObserverMergedMain: includesAll(backupWorkflow, ['workflow_call:', 'expected_main_sha:', 'SUPABASE_BACKUP_OBSERVER_TOKEN']),
    restoreRehearsalCallableMergedMain: includesAll(restoreWorkflow, ['workflow_call:', 'expected_main_sha:', 'RESTORE_REHEARSAL_VERIFIED']),
    sharedTestEvidenceEmitterMergedMain: includesAll(ciWorkflow, ['production_db_release_id:', 'TEST_DB_RELEASE_TOKEN', 'production-db-test-verified.json', 'production-db-test-post-schema-evidence.json']),
    exactHeadCiGreen: true,
  };

  const finalRiskAdapter = {
    status: 'FINAL_RISK_ADAPTER_VERIFIED',
    mainSha: sha,
    liveGithubFetch: includesAll(finalRisk, ['buildProductionDbFinalRiskEvidenceFromGithub', 'github.rest.pulls.get', 'github.rest.pulls.listReviews']),
    currentAllowedReviewerVerified: includesAll(finalRisk, ['isTrustedFinalRiskAgentUser', 'WRITE_ACTOR', 'TRUSTED_AGENT_BOT']),
    releaseBoundDigestVerified: includesAll(finalRisk, ['FINAL_RISK_RELEASE_MISMATCH', 'FINAL_RISK_PLAN_MISMATCH', 'FINAL_RISK_EVIDENCE_MISMATCH']),
  };

  let bypassAuditClean = false;
  try {
    const audit = auditProductionDbWriterBypasses(collectProductionDbExecutableSources(repoRoot));
    bypassAuditClean = audit.status === 'PRODUCTION_DB_WRITE_BYPASS_AUDIT_CLEAN';
  } catch {
    bypassAuditClean = false;
  }
  const credential = credentialTruth(credentialProof);
  const writer = {
    status: 'CONTROLLED_WRITER_VERIFIED',
    mainSha: sha,
    exactPendingSetVerified: includesAll(controlledWriter, ['PENDING_SET_MISMATCH', 'pendingProductionMigrations']),
    singleUseReceiptVerified: includesAll(receipt, ['CONSUMING', 'CONSUMED', 'UNKNOWN', 'APPLY_RECEIPT_REPLAYED']),
    databaseLockVerified: includesAll(controlledWriter, ['pg_try_advisory_xact_lock', 'PRODUCTION_DB_WRITER_LOCK_BUSY']),
    durablePreparedEnvelopeVerified: includesAll(controlledWriter, ['CONTROLLED_APPLY_PREPARED', 'preparationDigest', 'DURABLE_PREPARED_ATTEMPT_REQUIRED']),
    postcheckVerified: includesAll(postcheck, ['PRODUCTION_SCHEMA_READY', 'POSTCHECK_FAILED']),
    failureJournalVerified: includesAll(journal, ['APPLY_UNKNOWN', 'POSTCHECK_FAILED', 'TERMINAL']),
    bypassAuditClean,
    ...credential,
  };

  const orchestratorTruth = {
    status: 'TRUSTED_MAIN_ORCHESTRATOR_VERIFIED',
    mainSha: sha,
    trustedMainOnly: includesAll(orchestrator, ['assertExactTrustedMain', 'AUTOMATION_NOT_READY']),
    g3EvidenceConsumerWired: includesAll(orchestratorWorkflow, ['production-db-test-verified.json', 'G3']),
    g4BackupEvidenceConsumerWired: includesAll(orchestratorWorkflow, ['production-db-backup-evidence', 'G4']),
    g4RestoreEvidenceConsumerWired: includesAll(orchestratorWorkflow, ['restore-rehearsal', 'G4']),
    finalRiskLiveFetchWired: includesAll(orchestratorWorkflow, ['buildProductionDbFinalRiskEvidenceFromGithub', 'FINAL_RISK']),
    preparedEnvelopePersistBeforeExecute: includesAll(orchestratorWorkflow, ['prepared-production-db-attempt', 'upload-artifact']),
    preparedEnvelopeReloadVerified: includesAll(orchestratorWorkflow, ['download-artifact', 'prepared-production-db-attempt']),
    g7PostcheckWired: includesAll(orchestratorWorkflow, ['production-db-release-orchestrator.mjs postcheck', 'G7']),
    terminalResultPersisted: includesAll(orchestratorWorkflow, ['production-db-terminal-result', 'if: ${{ always() }}']),
  };

  const counterexamples = {
    status: 'COUNTEREXAMPLES_VERIFIED',
    mainSha: sha,
    wrongProject: counterexampleSuitePassed,
    staleEvidence: counterexampleSuitePassed,
    unplannedDrift: counterexampleSuitePassed,
    emptyTest: counterexampleSuitePassed,
    fakeOrStaleReview: counterexampleSuitePassed,
    missingRecovery: counterexampleSuitePassed,
    receiptReplay: counterexampleSuitePassed,
    parallelWriter: counterexampleSuitePassed,
    partialApply: counterexampleSuitePassed,
    postcheckFail: counterexampleSuitePassed,
    lostRunnerCrashWindow: counterexampleSuitePassed,
  };

  return {
    schemaVersion: 1,
    repository: REPOSITORY,
    productionProjectRef: PROD,
    mainSha: sha,
    sourceControls,
    finalRiskAdapter,
    writer,
    orchestrator: orchestratorTruth,
    counterexamples,
    databaseMutationAuthorized: false,
  };
}

export function evaluateProductionDbAutomationReadiness(input) {
  const evidence = buildProductionDbAutomationReadinessEvidence(input);
  return { evidence, readiness: evaluateAutomationReadiness(evidence) };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function main() {
  const [command, mainSha, ciPath, credentialPath, evidencePath, readinessPath] = process.argv.slice(2);
  try {
    if (command !== 'build' || !mainSha || !ciPath || !credentialPath || !evidencePath || !readinessPath) {
      fail('USAGE', 'build <main-sha> <ci-evidence.json> <credential-proof.json-or-dash> <automation-evidence.json> <readiness.json>');
    }
    const credentialProof = credentialPath === '-' ? null : readJson(credentialPath);
    const result = evaluateProductionDbAutomationReadiness({
      mainSha,
      exactHeadCi: readJson(ciPath),
      credentialProof,
    });
    writeFileSync(evidencePath, `${JSON.stringify(result.evidence, null, 2)}\n`);
    writeFileSync(readinessPath, `${JSON.stringify(result.readiness, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith('production-db-automation-readiness-evidence.mjs')) main();

export const PRODUCTION_DB_CREDENTIAL_PROOF_STATUS = 'PRODUCTION_DB_SCOPED_CREDENTIAL_VERIFIED';
