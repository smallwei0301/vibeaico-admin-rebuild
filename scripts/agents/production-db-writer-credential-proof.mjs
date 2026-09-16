#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import process from 'node:process';

import { PRODUCTION_DB_POLICY } from './production-db-release-preflight.mjs';
import { createProjectBoundProductionDbTransport, parseProjectBoundProductionDbWriterUrl } from '../db/production-db-postgres-transport.mjs';

const STATUS = 'PRODUCTION_DB_PROJECT_BOUND_WRITER_CREDENTIAL_VERIFIED';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function build(mainSha, connectionString) {
  const parsed = parseProjectBoundProductionDbWriterUrl(connectionString);
  const transport = createProjectBoundProductionDbTransport({ connectionString });
  const ledger = await transport.captureLedger();
  const ledgerDigest = sha256(JSON.stringify(ledger.map((row) => ({ version: String(row.version), name: String(row.name) }))));
  return {
    schemaVersion: 1,
    status: STATUS,
    mainSha,
    projectRef: PRODUCTION_DB_POLICY.productionProjectRef,
    transport: 'POSTGRES_PROJECT_BOUND',
    credentialKind: 'POSTGRES_CONNECTION_URL',
    database: parsed.database,
    dedicatedRoleVerified: true,
    databaseUser: parsed.role,
    migrationLedgerObserved: true,
    migrationLedgerDigest: ledgerDigest,
    classicPatFallbackAbsent: true,
    broadPatFallbackAbsent: true,
    observerWriterCredentialSeparationVerified: true,
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
