import postgres from 'postgres';

import { PRODUCTION_DB_POLICY } from '../agents/production-db-release-preflight.mjs';

export const CANONICAL_PRODUCTION_DB_WRITER_ROLE = 'production_migration_writer';

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

/**
 * Parse only the direct, project-bound Production database endpoint. This is a
 * deliberate allow-list: a TEST/pooler/arbitrary host cannot reach a mutation.
 */
export function parseProjectBoundProductionDbWriterUrl(connectionString) {
  const value = String(connectionString ?? '').trim();
  if (!value) fail('MISSING_PRODUCTION_DB_WRITER_URL', 'PRODUCTION_DB_WRITER_URL is required');
  let url;
  try {
    url = new URL(value);
  } catch {
    fail('MALFORMED_PRODUCTION_DB_WRITER_URL', 'writer credential is not a PostgreSQL connection string');
  }
  const expectedHost = `db.${PRODUCTION_DB_POLICY.productionProjectRef}.supabase.co`;
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== expectedHost || (url.port && url.port !== '5432')) {
    fail('WRITER_URL_PROJECT_MISMATCH', 'writer credential is not bound to the canonical direct Production project endpoint');
  }
  const role = decodeURIComponent(url.username);
  if (url.pathname !== '/postgres' || !role || !url.password) {
    fail('WRITER_URL_DATABASE_OR_CREDENTIAL_INVALID', 'writer credential must name the postgres database and a login role');
  }
  if (role === 'postgres') fail('SUPERUSER_WRITER_FORBIDDEN', 'writer credential must use the dedicated migration role, never postgres');
  if (role !== CANONICAL_PRODUCTION_DB_WRITER_ROLE) fail('WRITER_ROLE_MISMATCH', 'writer credential must use the canonical dedicated migration role');
  const sslmode = url.searchParams.get('sslmode');
  if (sslmode !== 'verify-full') fail('WRITER_URL_TLS_VERIFICATION_REQUIRED', 'writer URL must use sslmode=verify-full');
  return { connectionString: value, host: expectedHost, database: 'postgres', role };
}

function assertSessionIdentity(rows, expected) {
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row || row.database_name !== expected.database || row.database_user !== expected.role) {
    fail('WRITER_DATABASE_IDENTITY_MISMATCH', 'connected database or role does not match the project-bound writer credential');
  }
}

function assertPlanBoundExecution(command) {
  const sqlText = String(command?.sql ?? '');
  if (!/^[0-9a-f]{40}$/.test(String(command?.mainSha ?? '')) ||
      !/^[0-9a-f]{64}$/.test(String(command?.planDigest ?? '')) ||
      !/^[0-9a-f]{64}$/.test(String(command?.preparedAttemptDigest ?? '')) ||
      !String(command?.releaseId ?? '').trim()) {
    fail('PLAN_BOUND_EXECUTION_REQUIRED', 'Production SQL requires the admitted release, plan, and durable prepared-attempt identities');
  }
  if (!/^begin;\s*\n\s*set local lock_timeout/m.test(sqlText) ||
      !sqlText.includes('pg_try_advisory_xact_lock') ||
      !sqlText.includes('supabase_migrations.schema_migrations') ||
      !/\n\s*commit;\s*$/.test(sqlText)) {
    fail('CONTROLLED_TRANSACTION_SHAPE_REQUIRED', 'Production SQL must be the canonical locked ledger-controlled transaction');
  }
  return sqlText;
}

/** A narrow internal transport; callers never receive a general SQL runner. */
export function createProjectBoundProductionDbTransport({ connectionString, sqlFactory = postgres } = /** @type {any} */ ({})) {
  const expected = parseProjectBoundProductionDbWriterUrl(connectionString);

  async function withSession(work) {
    const sql = sqlFactory(expected.connectionString, {
      // Do not override sslmode=verify-full from the URL. postgres.js options
      // override query parameters; passing ssl:'require' would disable hostname
      // and certificate verification and weaken wrong-project fail-closed.
      ssl: 'verify-full',
      prepare: false,
      max: 1,
      connect_timeout: 10,
      idle_timeout: 5,
      max_lifetime: 60,
    });
    try {
      const identity = await sql.unsafe('select current_database() as database_name, current_user as database_user');
      assertSessionIdentity(identity, expected);
      return await work(sql);
    } finally {
      await sql.end({ timeout: 5 }).catch(() => undefined);
    }
  }

  return Object.freeze({
    kind: 'PROJECT_BOUND_POSTGRES',
    projectRef: PRODUCTION_DB_POLICY.productionProjectRef,
    async captureLedger() {
      return withSession((sql) => sql.unsafe('select version, name from supabase_migrations.schema_migrations order by version'));
    },
    async captureCredentialCapabilities() {
      return withSession((sql) => sql.unsafe(`
        select
          r.rolname as role_name,
          r.rolsuper as role_superuser,
          r.rolcreaterole as role_can_create_role,
          r.rolcreatedb as role_can_create_database,
          r.rolreplication as role_can_replicate,
          r.rolbypassrls as role_bypass_rls,
          r.rolcanlogin as role_can_login,
          has_schema_privilege(current_user, 'public', 'USAGE') as public_schema_usage,
          has_schema_privilege(current_user, 'public', 'CREATE') as public_schema_create,
          has_schema_privilege(current_user, 'supabase_migrations', 'USAGE') as ledger_schema_usage,
          has_table_privilege(current_user, 'supabase_migrations.schema_migrations', 'SELECT') as ledger_select,
          has_table_privilege(current_user, 'supabase_migrations.schema_migrations', 'INSERT') as ledger_insert
        from pg_roles r
        where r.rolname = current_user
      `));
    },
    // This intentionally accepts no free-standing SQL string. Callers must
    // present the plan and durable-attempt identities already checked by the
    // controlled release core; direct free-standing SQL execution bypasses
    // are rejected before a database session opens.
    async executePlanBoundTransaction(command) {
      const sqlText = assertPlanBoundExecution(command);
      return withSession(async (sql) => {
        await sql.unsafe(sqlText);
        return { status: 'APPLY_REQUEST_CONFIRMED', databaseMutationAuthorized: false };
      });
    },
  });
}
