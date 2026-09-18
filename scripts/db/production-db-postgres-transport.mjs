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

function asBool(value) {
  return value === true || value === 't' || value === 'true';
}

function decodeUsername(value) {
  try {
    return decodeURIComponent(String(value ?? ''));
  } catch {
    fail('MALFORMED_PRODUCTION_DB_WRITER_URL', 'writer username is not valid URL encoding');
  }
}

function assertConnectionQuery(parsed) {
  const entries = [...parsed.searchParams.entries()];
  if (parsed.hash || entries.length !== 1 || entries[0][0] !== 'sslmode') {
    fail(
      'WRITER_URL_QUERY_PARAMETER_FORBIDDEN',
      'Production DB writer URL may contain exactly one connection query parameter: sslmode',
    );
  }
  if (String(entries[0][1]).trim().toLowerCase() !== 'verify-full') {
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
  assertConnectionQuery(parsed);

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
), memberships as (
  select member.rolname as member_name,
         parent.rolname as parent_name,
         m.admin_option,
         m.inherit_option,
         m.set_option
  from pg_auth_members m
  join pg_roles parent on parent.oid = m.roleid
  join pg_roles member on member.oid = m.member
  where member.rolname in ('${writer}', '${owner}')
), required_relations(name) as (
  values ('trip_plans'), ('trip_departures'), ('tour_orders')
), required_routines(name, args) as (
  values
    ('create_tour_order', 'p_tenant uuid, p_order_no text, p_departure uuid, p_party_size integer, p_customer uuid, p_contact jsonb, p_source tour_order_source, p_payment_method uuid, p_note text, p_hold_expires timestamp with time zone'),
    ('cancel_tour_order', 'p_tenant uuid, p_order uuid, p_reason text'),
    ('expire_tour_order', 'p_tenant uuid, p_order uuid, p_reason text')
), default_acl_entries as (
  select owner_acl.rolname as owner_name,
         d.defaclobjtype,
         coalesce(grantee.rolname, 'PUBLIC') as grantee_name,
         x.privilege_type,
         x.is_grantable
  from pg_default_acl d
  join pg_roles owner_acl on owner_acl.oid = d.defaclrole
  join pg_namespace n on n.oid = d.defaclnamespace
  cross join lateral aclexplode(d.defaclacl) x
  left join pg_roles grantee on grantee.oid = x.grantee
  where n.nspname = 'public'
    and owner_acl.rolname in ('postgres', '${owner}')
    and d.defaclobjtype in ('r', 'S', 'f')
), owner_default_acl as (
  select defaclobjtype, grantee_name, privilege_type, is_grantable
  from default_acl_entries where owner_name = '${owner}'
), postgres_default_acl as (
  select defaclobjtype, grantee_name, privilege_type, is_grantable
  from default_acl_entries where owner_name = 'postgres'
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
  w.rolinherit as role_inherit,
  o.rolcanlogin as owner_can_login,
  o.rolsuper as owner_superuser,
  o.rolcreaterole as owner_can_create_role,
  o.rolcreatedb as owner_can_create_database,
  o.rolreplication as owner_can_replicate,
  o.rolbypassrls as owner_bypass_rls,
  o.rolinherit as owner_inherit,
  (select count(*) from memberships where member_name = '${writer}') as writer_membership_count,
  (select count(*) from memberships where member_name = '${owner}') as owner_membership_count,
  exists (
    select 1 from memberships m
    where m.member_name = '${writer}'
      and m.parent_name = '${owner}'
      and m.admin_option = false
      and m.inherit_option = false
      and m.set_option = true
  ) as owner_membership_exact,
  pg_has_role(current_user, '${owner}', 'SET') as writer_can_set_owner,
  not exists (
    select 1 from memberships m
    where m.member_name in ('${writer}', '${owner}')
      and m.parent_name in ('postgres', 'supabase_admin', 'service_role')
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
  (select count(distinct defaclobjtype) = 3 from owner_default_acl) as owner_default_acl_types_present,
  not exists (
    (select * from owner_default_acl except select * from postgres_default_acl)
    union all
    (select * from postgres_default_acl except select * from owner_default_acl)
  ) as owner_public_default_acl_matches_postgres
from writer w
cross join owner_role o
`;
}

export function assertDedicatedProductionDbWriterCapabilities(capabilities = {}) {
  const identityVerified = Boolean(
    String(capabilities.database_name ?? '') === EXPECTED_DATABASE &&
    String(capabilities.database_user ?? '') === CANONICAL_PRODUCTION_DB_WRITER_ROLE &&
    String(capabilities.session_user ?? '') === CANONICAL_PRODUCTION_DB_WRITER_ROLE,
  );
  const writerFlagsSafe = Boolean(
    asBool(capabilities.role_can_login) &&
    !asBool(capabilities.role_superuser) &&
    !asBool(capabilities.role_can_create_role) &&
    !asBool(capabilities.role_can_create_database) &&
    !asBool(capabilities.role_can_replicate) &&
    !asBool(capabilities.role_bypass_rls) &&
    !asBool(capabilities.role_inherit),
  );
  const ownerFlagsSafe = Boolean(
    !asBool(capabilities.owner_can_login) &&
    !asBool(capabilities.owner_superuser) &&
    !asBool(capabilities.owner_can_create_role) &&
    !asBool(capabilities.owner_can_create_database) &&
    !asBool(capabilities.owner_can_replicate) &&
    !asBool(capabilities.owner_bypass_rls) &&
    !asBool(capabilities.owner_inherit),
  );
  const roleEscalationBoundaryVerified = Boolean(
    Number(capabilities.writer_membership_count) === 1 &&
    Number(capabilities.owner_membership_count) === 0 &&
    asBool(capabilities.owner_membership_exact) &&
    asBool(capabilities.writer_can_set_owner) &&
    asBool(capabilities.dangerous_set_role_absent),
  );
  const migrationOwnershipVerified = Boolean(
    asBool(capabilities.required_relation_ownership) &&
    asBool(capabilities.required_routine_ownership) &&
    asBool(capabilities.reserve_seats_execute) &&
    asBool(capabilities.release_seats_execute),
  );
  const migrationPrivilegesVerified = Boolean(
    asBool(capabilities.public_schema_usage) &&
    asBool(capabilities.public_schema_create) &&
    asBool(capabilities.ledger_schema_usage) &&
    asBool(capabilities.ledger_select) &&
    asBool(capabilities.ledger_insert),
  );
  const defaultAclMirrorVerified = Boolean(
    asBool(capabilities.owner_default_acl_types_present) &&
    asBool(capabilities.owner_public_default_acl_matches_postgres),
  );
  const dedicatedRoleVerified = Boolean(
    identityVerified &&
    writerFlagsSafe &&
    ownerFlagsSafe &&
    roleEscalationBoundaryVerified &&
    migrationOwnershipVerified &&
    migrationPrivilegesVerified &&
    defaultAclMirrorVerified,
  );
  if (!dedicatedRoleVerified) fail('DEDICATED_WRITER_ROLE_CAPABILITIES_NOT_VERIFIED', 'live writer/owner capabilities no longer match the dedicated Production writer contract');
  return {
    dedicatedRoleVerified,
    identityVerified,
    writerFlagsSafe,
    ownerFlagsSafe,
    roleEscalationBoundaryVerified,
    migrationOwnershipVerified,
    migrationPrivilegesVerified,
    defaultAclMirrorVerified,
  };
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
    let reserved;
    try {
      reserved = await sql.reserve();
      const identityRows = await reserved.unsafe('select current_database() as database_name, current_user as database_user, session_user as session_user');
      const identity = identityRows?.[0] ?? {};
      if (String(identity.database_name ?? '') !== expected.database || String(identity.database_user ?? '') !== expected.role || String(identity.session_user ?? '') !== expected.role) {
        fail('WRITER_DATABASE_IDENTITY_MISMATCH', 'live database/session role does not match the dedicated Production writer');
      }
      return await fn(reserved);
    } finally {
      if (reserved) await Promise.resolve(reserved.release()).catch(() => undefined);
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
      return withSession(async (sql) => {
        await sql.unsafe(`set role ${CANONICAL_PRODUCTION_DB_OWNER_ROLE}`);
        return sql.unsafe('select version, name from supabase_migrations.schema_migrations order by version');
      });
    },

    async captureCatalogFingerprint() {
      return withSession(async (sql) => {
        const capabilityRows = await sql.unsafe(credentialCapabilitySql());
        const capabilities = capabilityRows?.[0];
        if (!capabilities) fail('WRITER_CAPABILITY_EVIDENCE_MISSING', 'writer capability introspection returned no row');
        assertDedicatedProductionDbWriterCapabilities(capabilities);
        return normalizeProductionDbCatalogFingerprint(await sql.unsafe(PRODUCTION_DB_CATALOG_FINGERPRINT_SQL));
      });
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
