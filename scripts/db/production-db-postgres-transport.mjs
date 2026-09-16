import postgres from 'postgres';

import { PRODUCTION_DB_POLICY } from '../agents/production-db-release-preflight.mjs';

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
  if (url.pathname !== '/postgres' || !url.username || !url.password) {
    fail('WRITER_URL_DATABASE_OR_CREDENTIAL_INVALID', 'writer credential must name the postgres database and a login role');
  }
  if (url.username === 'postgres') fail('SUPERUSER_WRITER_FORBIDDEN', 'writer credential must use the dedicated migration role, never postgres');
  const sslmode = url.searchParams.get('sslmode');
  if (!['require', 'verify-full'].includes(sslmode ?? '')) fail('WRITER_URL_TLS_REQUIRED', 'writer URL must require TLS');
  return { connectionString: value, host: expectedHost, database: 'postgres', role: decodeURIComponent(url.username) };
}

function assertSessionIdentity(rows, expected) {
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row || row.database_name !== expected.database || row.database_user !== expected.role) {
    fail('WRITER_DATABASE_IDENTITY_MISMATCH', 'connected database or role does not match the project-bound writer credential');
  }
}

/** A narrow internal transport; callers never receive a general SQL runner. */
export function createProjectBoundProductionDbTransport({ connectionString, sqlFactory = postgres } = /** @type {any} */ ({})) {
  const expected = parseProjectBoundProductionDbWriterUrl(connectionString);

  async function withSession(work) {
    const sql = sqlFactory(expected.connectionString, {
      ssl: 'require',
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
    async executeAtomic(sqlText) {
      if (!String(sqlText ?? '').trim()) fail('EMPTY_CONTROLLED_APPLY_SQL', 'controlled apply SQL is required');
      return withSession(async (sql) => {
        await sql.unsafe(sqlText);
        return { status: 'APPLY_REQUEST_CONFIRMED', databaseMutationAuthorized: false };
      });
    },
  });
}
