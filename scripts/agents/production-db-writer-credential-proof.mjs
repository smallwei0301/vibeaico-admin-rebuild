#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import process from 'node:process';

import { PRODUCTION_DB_POLICY } from './production-db-release-preflight.mjs';
import {
  CANONICAL_PRODUCTION_DB_OWNER_ROLE,
  assertDedicatedProductionDbWriterCapabilities,
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
  const [ledger, capabilities] = await Promise.all([
    transport.captureLedger(),
    transport.captureCredentialCapabilities(),
  ]);
  const verification = assertDedicatedProductionDbWriterCapabilities(capabilities);
  const catalogFingerprint = await transport.captureCatalogFingerprint();

  const ledgerDigest = sha256(JSON.stringify(ledger.map((row) => ({ version: String(row.version), name: String(row.name) }))));
  return {
    schemaVersion: 2,
    status: STATUS,
    mainSha,
    projectRef: PRODUCTION_DB_POLICY.productionProjectRef,
    transport: 'POSTGRES_PROJECT_BOUND',
    transportMode: parsed.transportMode,
    credentialKind: 'POSTGRES_CONNECTION_URL',
    database: parsed.database,
    databaseUser: parsed.role,
    ownerRole: CANONICAL_PRODUCTION_DB_OWNER_ROLE,
    ...verification,
    migrationLedgerObserved: true,
    migrationLedgerDigest: ledgerDigest,
    catalogFingerprint,
    classicPatFallbackAbsent: true,
    broadPatFallbackAbsent: true,
    observerWriterCredentialSeparationVerified: process.env.WRITER_CREDENTIAL_ENVIRONMENT === 'production-db-writer',
    proofRef: `postgres-writer-proof:${mainSha}:${ledgerDigest.slice(0, 16)}:${catalogFingerprint.slice(0, 16)}`,
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
      schemaVersion: 2,
      status: 'PRODUCTION_DB_PROJECT_BOUND_WRITER_CREDENTIAL_NOT_EVIDENCED',
      mainSha,
      projectRef: PRODUCTION_DB_POLICY.productionProjectRef,
      reason: error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[REDACTED_CONNECTION_STRING]') : 'UNKNOWN',
      databaseMutationAuthorized: false,
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith('production-db-writer-credential-proof.mjs')) main();

export { STATUS as PRODUCTION_DB_PROJECT_BOUND_WRITER_CREDENTIAL_VERIFIED };
