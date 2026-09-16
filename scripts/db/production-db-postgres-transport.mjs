import postgres from 'postgres';

import { PRODUCTION_DB_POLICY } from '../agents/production-db-release-preflight.mjs';
import {
  normalizeProductionDbCatalogFingerprint,
  PRODUCTION_DB_CATALOG_FINGERPRINT_SQL,
} from './production-db-catalog-fingerprint.mjs';

const EXPECTED_DATABASE = 'postgres';
const DIRECT_HOST = `db.${PRODUCTION_DB_POLICY.productionProjectRef}.supabase.co`;
const SESSION_POOLER_HOST = /^aws-\d+-ap-southeast-1\.pooler\.supabase\.com$/i;

export const CANONICAL_PRODUCTION_DB_WRITER_ROLE = 'production_migration_writer';
export const CANONICAL_PRODUCTION_DB_OWNER_ROLE = 'production_migration_owner';

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

function decodeUsername(value) {
  try {
    return decodeURIComponent(String(value ?? ''));
  } catch {
    fail('MALFORMED_PRODUCTION_DB_WRITER_URL', 'writer username is not valid URL encoding');
  }
}

function assertTlsMode(parsed) {
  const sslmode = String(parsed.searchParams.get('sslmode') ?? '').trim().toLowerCase();
  if (sslmode !== 'verify-full') {
    fail('WRITER_URL_TLS_VERIFICATION_REQUIRED', 'Production DB writer URL must use sslmode=verify-full');
  }
}

export function parseProjectBoundProductionDbWriterUrl(connectionString) {
  const raw = String(connectionString ?? '').trim();
  if (!raw) fail('MISSING_PRODUCTION_DB_WRITER_URL', 'PRODUCTION_DB_WRITER_URL is required');

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    fail('MALFORMED_PRODUCTION_DB_WRITER_URL', 'PRODUCTION_DB_WRITER_URL is not a valid PostgreSQL URL');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    fail('MALFORMED_PRODUCTION_DB_WRITER_URL', 'writer URL must use postgres/postgresql protocol');
  }

  const username = decodeUsername(parsed.username);
  const host = String(parsed.hostname ?? '').toLowerCase();
  const port = String(parsed.port || '5432');
  const database = String(parsed.pathname || '').replace(/^\//, '') || EXPECTED_DATABASE;

  if (port !== '5432') fail('WRITER_URL_SESSION_MODE_REQUIRED', 'Production writer requires session/direct port 5432');
  if (database !== EXPECTED_DATABASE) fail('WRITER_DATABASE_MISMATCH', `expected database ${EXPECTED_DATABASE}`);
  assertTlsMode(parsed);

  let transportMode;
  if (host === DIRECT_HOST) {
    if (username !== CANONICAL_PRODUCTION_DB_WRITER_ROLE) {
      if (username.toLowerCase() === 'postgres') fail('ADMIN_WRITER_FORBIDDEN', 'postgres admin role is forbidden as the automated writer');
      fail('WRITER_ROLE_MISMATCH', `direct writer role must be ${CANONICAL_PRODUCTION_DB_WRITER_ROLE}`);
    }
    transportMode = 'DIRECT';
  } else if (SESSION_POOLER_HOST.test(host)) {
    const expectedPoolerUser = `${CANONICAL_PRODUCTION_DB_WRITER_ROLE}.${PRODUCTION_DB_POLICY.productionProjectRef}`;
    if (username !== expectedPoolerUser) {
      if (username.toLowerCase().startsWith('postgres.')) fail('ADMIN_WRITER_FORBIDDEN', 'postgres pooler role is forbidden as the automated writer');
      fail('WRITER_URL_PROJECT_MISMATCH', 'session pooler username must bind the canonical writer role to the Production project ref');
    }
    transportMode = 'SUPAVISOR_SESSION';
  } else {
    fail('WRITER_URL_PROJECT_MISMATCH', 'writer URL does not identify the canonical Production direct/session endpoint');
  }

  if (!parsed.password) fail('WRITER_PASSWORD_REQUIRED', 'Production writer URL must include a dedicated role password');

  return {
    projectRef: PRODUCTION_DB_POLICY.productionProjectRef,
    role: CANONICAL_PRODUCTION_DB_WRITER_ROLE,
    ownerRole: CANONICAL_PRODUCTION_DB_OWNER_ROLE,
    database,
    host,
    port,
    transportMode,
    connectionString: raw,
  };
}

function credentialCapabilitySql() {
  const writer = CANONICAL_PRODUCTION_DB_WRITER_ROLE;
  const owner = CANONICAL_PRODUCTION_DB_OWNER_ROLE;
  return `
with writer as (
  select * from pg_roles where rolname = '${writer}'
), owner_role as (
  select * from pg_roles where rolname = '${owner}'
), membership as (
  select m.*
  from pg_auth_members m
  join pg_roles parent on parent.oid = m.roleid
  join pg_roles member on member.oid = m.member
  where member.rolname = '${writer}'
), required_relations(name) as (
  values ('trip_plans'), ('trip_departures'), ('tour_orders')
), required_routines(name, args) as (
  values
    ('create_tour_order', 'p_tenant uuid, p_order_no text, p_departure uuid, p_party_size integer, p_customer uuid, p_contact jsonb, p_source tour_order_source, p_payment_method uuid, p_note text, p_hold_expires timestamp with time zone'),
    ('cancel_tour_order', 'p_tenant uuid, p_order uuid, p_reason text'),
    ('expire_tour_order', 'p_tenant uuid, p_order uuid, p_reason text')
)
select
  current_database() as database_name,
  current_user as database_user,
  session_user as session_user,
  w.rolcanlogin as role_can_login,
  w.rolsuper as role_superuser,
  w.rolcreaterole as role_can_create_role,
  w.rolcreatedb as role_can_create_database,
  w.rolreplication as role_can_replicate,
  w.rolbypassrls as role_bypass_rls,
  o.rolcanlogin as owner_can_login,
  o.rolsuper as owner_superuser,
  o.rolcreaterole as owner_can_create_role,
  o.rolcreatedb as owner_can_create_database,
  o.rolreplication as owner_can_replicate,
  o.rolbypassrls as owner_bypass_rls,
  (select count(*) from membership) as writer_membership_count,
  exists (
    select 1 from membership m
    join pg_roles parent on parent.oid = m.roleid
    where parent.rolname = '${owner}'
      and m.admin_option = false
      and m.inherit_option = false
      and m.set_option = true
  ) as owner_membership_exact,
  pg_has_role(current_user, '${owner}', 'SET') as writer_can_set_owner,
  not exists (
    select 1
    from pg_auth_members m
    join pg_roles parent on parent.oid = m.roleid
    join pg_roles member on member.oid = m.member
    where member.rolname in ('${writer}', '${owner}')
      and parent.rolname in ('postgres', 'supabase_admin', 'service_role')
      and m.set_option = true
  ) as dangerous_set_role_absent,
  has_schema_privilege('${owner}', 'public', 'USAGE') as public_schema_usage,
  has_schema_privilege('${owner}', 'public', 'CREATE') as public_schema_create,
  has_schema_privilege('${owner}', 'supabase_migrations', 'USAGE') as ledger_schema_usage,
  has_table_privilege('${owner}', 'supabase_migrations.schema_migrations', 'SELECT') as ledger_select,
  has_table_privilege('${owner}', 'supabase_migrations.schema_migrations', 'INSERT') as ledger_insert,
  (
    select count(*) = 3
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join required_relations r on r.name = c.relname
    where n.nspname = 'public'
      and pg_get_userbyid(c.relowner) = '${owner}'
  ) as required_relation_ownership,
  (
    select count(*) = 3
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join required_routines r
      on r.name = p.proname
     and r.args = pg_get_function_identity_arguments(p.oid)
    where n.nspname = 'public'
      and pg_get_userbyid(p.proowner) = '${owner}'
  ) as required_routine_ownership,
  has_function_privilege('${owner}', 'public.reserve_seats(uuid,integer)', 'EXECUTE') as reserve_seats_execute,
  has_function_privilege('${owner}', 'public.release_seats(uuid,integer)', 'EXECUTE') as release_seats_execute,
  (
    select count(*) = 3
    from pg_default_acl d
    join pg_namespace n on n.oid = d.defaclnamespace
    where d.defaclrole = o.oid
      and n.nspname = 'public'
      and d.defaclobjtype in ('r', 'S', 'f')
  ) as owner_public_default_acl_present
from writer w
cross join owner_role o
`;
}

export function createProjectBoundProductionDbTransport({ connectionString, sqlFactory = postgres } = /** @type {any} */ ({})) {
  const expected = parseProjectBoundProductionDbWriterUrl(connectionString);

  async function withSession(fn) {
    const sql = sqlFactory(expected.connectionString, {
      max: 1,
      connect_timeout: 10,
      idle_timeout: 5,
      max_lifetime: 60,
      ssl: 'verify-full',
      prepare: false,
    });
    try {
      const identityRows = await sql.unsafe('select current_database() as database_name, current_user as database_user, session_user as session_user');
      const identity = identityRows?.[0] ?? {};
      if (String(identity.database_name ?? '') !== expected.database || String(identity.database_user ?? '') !== expected.role || String(identity.session_user ?? '') !== expected.role) {
        fail('WRITER_DATABASE_IDENTITY_MISMATCH', 'live database/session role does not match the dedicated Production writer');
      }
      return await fn(sql);
    } finally {
      await sql.end({ timeout: 2 }).catch(() => undefined);
    }
  }

  return Object.freeze({
    kind: 'PROJECT_BOUND_POSTGRES',
    projectRef: expected.projectRef,
    role: expected.role,
    ownerRole: expected.ownerRole,
    transportMode: expected.transportMode,

    async captureLedger() {
      return withSession((sql) => sql.unsafe('select version, name from supabase_migrations.schema_migrations order by version'));
    },

    async captureCatalogFingerprint() {
      return withSession(async (sql) => normalizeProductionDbCatalogFingerprint(await sql.unsafe(PRODUCTION_DB_CATALOG_FINGERPRINT_SQL)));
    },

    async captureCredentialCapabilities() {
      return withSession(async (sql) => {
        const rows = await sql.unsafe(credentialCapabilitySql());
        const row = rows?.[0];
        if (!row) fail('WRITER_CAPABILITY_EVIDENCE_MISSING', 'writer capability introspection returned no row');
        return row;
      });
    },
  });
}
