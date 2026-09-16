import { PRODUCTION_DB_POLICY } from '../agents/production-db-release-preflight.mjs';

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

const STATE_CTE = `
with state(item) as (
  select format('schema|%s|owner=%s|acl=%s',
    n.nspname,
    pg_get_userbyid(n.nspowner),
    coalesce(array_to_string(n.nspacl, ','), ''))
  from pg_namespace n
  where n.nspname in ('public', 'supabase_migrations')

  union all

  select format('rel|%s.%s|kind=%s|owner=%s|rls=%s|force=%s|acl=%s',
    n.nspname,
    c.relname,
    c.relkind,
    pg_get_userbyid(c.relowner),
    c.relrowsecurity,
    c.relforcerowsecurity,
    coalesce(array_to_string(c.relacl, ','), ''))
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'supabase_migrations')
    and c.relkind in ('r', 'p', 'v', 'm', 'S')

  union all

  select format('column|%s.%s.%s|type=%s|notnull=%s|default=%s',
    n.nspname,
    c.relname,
    a.attname,
    format_type(a.atttypid, a.atttypmod),
    a.attnotnull,
    coalesce(pg_get_expr(d.adbin, d.adrelid), ''))
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where n.nspname in ('public', 'supabase_migrations')
    and c.relkind in ('r', 'p', 'v', 'm')
    and a.attnum > 0
    and not a.attisdropped

  union all

  select format('constraint|%s.%s|%s|%s',
    n.nspname,
    c.relname,
    con.conname,
    pg_get_constraintdef(con.oid, true))
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'

  union all

  select format('index|%s.%s|%s',
    n.nspname,
    c.relname,
    pg_get_indexdef(i.indexrelid))
  from pg_index i
  join pg_class c on c.oid = i.indrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'

  union all

  select format('policy|%s.%s|%s|cmd=%s|perm=%s|roles=%s|using=%s|check=%s',
    n.nspname,
    c.relname,
    p.polname,
    p.polcmd,
    p.polpermissive,
    array_to_string(p.polroles, ','),
    coalesce(pg_get_expr(p.polqual, p.polrelid), ''),
    coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''))
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'

  union all

  select format('routine|%s.%s(%s)|owner=%s|definer=%s|acl=%s|body_md5=%s',
    n.nspname,
    p.proname,
    pg_get_function_identity_arguments(p.oid),
    pg_get_userbyid(p.proowner),
    p.prosecdef,
    coalesce(array_to_string(p.proacl, ','), ''),
    md5(pg_get_functiondef(p.oid)))
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind in ('f', 'p')

  union all

  select format('trigger|%s.%s|%s',
    n.nspname,
    c.relname,
    pg_get_triggerdef(t.oid, true))
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and not t.tgisinternal
)
`;

export const PRODUCTION_DB_CATALOG_FINGERPRINT_SQL = `${STATE_CTE}
select encode(
  extensions.digest(
    convert_to(coalesce(string_agg(item, E'\\n' order by item), ''), 'UTF8'),
    'sha256'
  ),
  'hex'
) as catalog_fingerprint
from state
`;

export function normalizeProductionDbCatalogFingerprint(rows) {
  const fingerprint = String(Array.isArray(rows) ? rows[0]?.catalog_fingerprint ?? '' : '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(fingerprint)) {
    fail('PRODUCTION_DB_CATALOG_FINGERPRINT_INVALID', 'schema/ACL/RLS catalog fingerprint is missing or invalid');
  }
  return fingerprint;
}

export function buildProductionDbCatalogFingerprintRecheckSql(expectedFingerprint) {
  const expected = String(expectedFingerprint ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expected)) {
    fail('PRODUCTION_DB_CATALOG_FINGERPRINT_INVALID', 'expected schema/ACL/RLS fingerprint must be SHA-256');
  }
  return `do $catalogcheck$
declare
  actual text;
begin
  ${STATE_CTE}
  select encode(
    extensions.digest(
      convert_to(coalesce(string_agg(item, E'\\n' order by item), ''), 'UTF8'),
      'sha256'
    ),
    'hex'
  ) into actual
  from state;
  if actual is distinct from '${expected}' then
    raise exception 'PRODUCTION_DB_CATALOG_CHANGED_AFTER_LOCK: expected %, actual %', '${expected}', coalesce(actual, '<missing>');
  end if;
end
$catalogcheck$;`;
}

export function assertCanonicalProductionProject(projectRef) {
  if (String(projectRef ?? '') !== PRODUCTION_DB_POLICY.productionProjectRef) {
    fail('PRODUCTION_DB_PROJECT_IDENTITY_MISMATCH', 'catalog evidence belongs to another project');
  }
  return true;
}
