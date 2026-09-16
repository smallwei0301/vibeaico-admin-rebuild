#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import process from 'node:process';

import { PRODUCTION_DB_POLICY } from './production-db-release-preflight.mjs';
import {
  CANONICAL_PRODUCTION_DB_WRITER_ROLE,
  createProjectBoundProductionDbTransport,
  parseProjectBoundProductionDbWriterUrl,
} from '../db/production-db-postgres-transport.mjs';

const STATUS = 'PRODUCTION_DB_PROJECT_BOUND_WRITER_CREDENTIAL_VERIFIED';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function build(mainSha, connectionString) {
  const parsed = parseProjectBoundProductionDbWriterUrl(connectionString);
  const transport = createProjectBoundProductionDbTransport({ connectionString });
  const ledger = await transport.captureLedger();
  const capabilities = (await transport.captureCredentialCapabilities())[0];
  const dedicatedRoleVerified = Boolean(
    capabilities &&
    capabilities.role_name === CANONICAL_PRODUCTION_DB_WRITER_ROLE &&
    capabilities.role_can_login === true &&
    capabilities.role_superuser === false &&
    capabilities.role_can_create_role === false &&
    capabilities.role_can_create_database === false &&
    capabilities.role_can_replicate === false &&
    capabilities.role_bypass_rls === false &&
    capabilities.public_schema_usage === true &&
    capabilities.public_schema_create === true &&
    capabilities.ledger_schema_usage === true &&
    capabilities.ledger_select === true &&
    capabilities.ledger_insert === true,
  );
  if (!dedicatedRoleVerified) throw new Error('DEDICATED_WRITER_ROLE_CAPABILITIES_NOT_VERIFIED');
  const ledgerDigest = sha256(JSON.stringify(ledger.map((row) => ({ version: String(row.version), name: String(row.name) }))));
  return {
    schemaVersion: 1,
    status: STATUS,
    mainSha,
    projectRef: PRODUCTION_DB_POLICY.productionProjectRef,
    transport: 'POSTGRES_PROJECT_BOUND',
    credentialKind: 'POSTGRES_CONNECTION_URL',
    database: parsed.database,
    dedicatedRoleVerified,
    databaseUser: parsed.role,
    migrationLedgerObserved: true,
    migrationLedgerDigest: ledgerDigest,
    classicPatFallbackAbsent: true,
    broadPatFallbackAbsent: true,
    // This job is the sole workflow location receiving the writer secret. The
    // workflow is source-tested for that isolation; this proof only attests to
    // the job context, not an unobservable claim about every other workflow.
    observerWriterCredentialSeparationVerified: process.env.WRITER_CREDENTIAL_ENVIRONMENT === 'production-db-writer',
    proofRef: `postgres-writer-proof:${mainSha}:${ledgerDigest.slice(0, 16)}`,
    databaseMutationAuthorized: false,
  };
}

async function main() {
  const [mainSha, outputPath] = process.argv.slice(2);
  if (!/^[0-9a-f]{40}$/.test(String(mainSha ?? '')) || !outputPath) throw new Error('USAGE: <exact-main-sha> <output-path>');
  try {
    const proof = await build(mainSha, process.env.PRODUCTION_DB_WRITER_URL);
    writeFileSync(outputPath, `${JSON.stringify(proof, null, 2)}\n`);
  } catch (error) {
    writeFileSync(outputPath, `${JSON.stringify({
      schemaVersion: 1,
      status: 'PRODUCTION_DB_PROJECT_BOUND_WRITER_CREDENTIAL_NOT_EVIDENCED',
      mainSha,
      projectRef: PRODUCTION_DB_POLICY.productionProjectRef,
      reason: error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[REDACTED_CONNECTION_STRING]') : 'UNKNOWN',
      databaseMutationAuthorized: false,
    }, null, 2)}\n`);
  }
}

if (process.argv[1]?.endsWith('production-db-writer-credential-proof.mjs')) main();

export { STATUS as PRODUCTION_DB_PROJECT_BOUND_WRITER_CREDENTIAL_VERIFIED };
