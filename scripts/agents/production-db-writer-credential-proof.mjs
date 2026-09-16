#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import process from 'node:process';

import { PRODUCTION_DB_POLICY } from './production-db-release-preflight.mjs';
import {
  CANONICAL_PRODUCTION_DB_OWNER_ROLE,
  CANONICAL_PRODUCTION_DB_WRITER_ROLE,
  createProjectBoundProductionDbTransport,
  parseProjectBoundProductionDbWriterUrl,
} from '../db/production-db-postgres-transport.mjs';

const STATUS = 'PRODUCTION_DB_PROJECT_BOUND_WRITER_CREDENTIAL_VERIFIED';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function asBool(value) {
  return value === true || value === 't' || value === 'true';
}

async function build(mainSha, connectionString) {
  const parsed = parseProjectBoundProductionDbWriterUrl(connectionString);
  const transport = createProjectBoundProductionDbTransport({ connectionString });
  const [ledger, capabilities, catalogFingerprint] = await Promise.all([
    transport.captureLedger(),
    transport.captureCredentialCapabilities(),
    transport.captureCatalogFingerprint(),
  ]);

  const writerFlagsSafe = Boolean(
    asBool(capabilities.role_can_login) &&
    !asBool(capabilities.role_superuser) &&
    !asBool(capabilities.role_can_create_role) &&
    !asBool(capabilities.role_can_create_database) &&
    !asBool(capabilities.role_can_replicate) &&
    !asBool(capabilities.role_bypass_rls),
  );
  const ownerFlagsSafe = Boolean(
    !asBool(capabilities.owner_can_login) &&
    !asBool(capabilities.owner_superuser) &&
    !asBool(capabilities.owner_can_create_role) &&
    !asBool(capabilities.owner_can_create_database) &&
    !asBool(capabilities.owner_can_replicate) &&
    !asBool(capabilities.owner_bypass_rls),
  );
  const roleEscalationBoundaryVerified = Boolean(
    Number(capabilities.writer_membership_count) === 1 &&
    asBool(capabilities.owner_membership_exact) &&
    asBool(capabilities.writer_can_set_owner) &&
    asBool(capabilities.dangerous_set_role_absent),
  );
  const migrationOwnershipVerified = Boolean(
    asBool(capabilities.required_relation_ownership) &&
    asBool(capabilities.required_routine_ownership) &&
    asBool(capabilities.reserve_seats_execute) &&
    asBool(capabilities.release_seats_execute) &&
    asBool(capabilities.owner_public_default_acl_present),
  );
  const migrationPrivilegesVerified = Boolean(
    asBool(capabilities.public_schema_usage) &&
    asBool(capabilities.public_schema_create) &&
    asBool(capabilities.ledger_schema_usage) &&
    asBool(capabilities.ledger_select) &&
    asBool(capabilities.ledger_insert),
  );
  const identityVerified = Boolean(
    String(capabilities.database_name ?? '') === parsed.database &&
    String(capabilities.database_user ?? '') === CANONICAL_PRODUCTION_DB_WRITER_ROLE &&
    String(capabilities.session_user ?? '') === CANONICAL_PRODUCTION_DB_WRITER_ROLE,
  );

  const dedicatedRoleVerified = Boolean(
    identityVerified &&
    writerFlagsSafe &&
    ownerFlagsSafe &&
    roleEscalationBoundaryVerified &&
    migrationOwnershipVerified &&
    migrationPrivilegesVerified,
  );
  if (!dedicatedRoleVerified) throw new Error('DEDICATED_WRITER_ROLE_CAPABILITIES_NOT_VERIFIED');

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
    dedicatedRoleVerified,
    identityVerified,
    writerFlagsSafe,
    ownerFlagsSafe,
    roleEscalationBoundaryVerified,
    migrationOwnershipVerified,
    migrationPrivilegesVerified,
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
  }
}

if (process.argv[1]?.endsWith('production-db-writer-credential-proof.mjs')) main();

export { STATUS as PRODUCTION_DB_PROJECT_BOUND_WRITER_CREDENTIAL_VERIFIED };
