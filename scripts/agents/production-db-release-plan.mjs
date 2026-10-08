import { createHash } from 'node:crypto';

import { CANONICAL_MIGRATION_IDENTITY, isCanonicalMigrationIdentity } from './production-db-migration-identity.mjs';
import { PRODUCTION_DB_POLICY } from './production-db-release-preflight.mjs';

const SHA = /^[0-9a-f]{40}$/;
const RELEASE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{7,119}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const LEDGER_VERSION = /^\d{14}$/;
const RISK_ORDER = Object.freeze({ ADDITIVE: 1, SCHEMA_REPAIR: 2, AUTHZ: 3, BACKFILL: 4 });
const FULL_PENDING_SET = 'FULL_PENDING_SET';
const ISSUES_17_680 = 'ISSUES_17_680';
const ISSUE_37_0131_0134 = 'ISSUE_37_0131_0134';
const ISSUE_46_0135 = 'ISSUE_46_0135';
export const ISSUE_46_0110_0136_CLOSURE = 'ISSUE_46_0110_0136_CLOSURE';
export const ISSUE_755_0110_0137_CLOSURE = 'ISSUE_755_0110_0137_CLOSURE';

// Plan construction is not execution authority. Current #755 nine-file approval
// is TEST-only; this selector does not enforce a Production prohibition.
// A release plan may select only a reviewed, bounded closure. Keep
// dependencies as canonical migration identities so a pending migration cannot
// become selectable merely by sharing an issue number or filename prefix.
const ISSUE_46_CLOSURE_ROOTS = Object.freeze([
  '0110_issue_42_plan_duration_pricetype_yearround',
  '0111_issue_46_guide_request_accept',
  '0115_issue_21_external_calendars',
  '0128_issue_42_plan_seasonal_pricing',
  '0130_issue_46_refund_policy_snapshot',
  '0132_issue_42_seasonal_price_resolution',
  '0135_issue_46_guide_interval_availability',
  // #755: security-invoker fix for the create_tour_order body shipped by 0130/0132.
  '0136_issue_755_create_tour_order_invoker',
]);
const BOUNDED_RELEASE_SCOPE_ROOTS = Object.freeze({
  [ISSUE_46_0110_0136_CLOSURE]: ISSUE_46_CLOSURE_ROOTS,
  [ISSUE_755_0110_0137_CLOSURE]: Object.freeze([
    ...ISSUE_46_CLOSURE_ROOTS,
    '0137_issue_749_create_tour_order_quoted',
  ]),
  [ISSUE_46_0135]: Object.freeze(['0135_issue_46_guide_interval_availability']),
  [ISSUES_17_680]: Object.freeze([
    '0121_issue_17_booking_addons_hardening',
    '0133_issue_680_booking_addons_composite_fk_expand',
  ]),
  [ISSUE_37_0131_0134]: Object.freeze([
    '0134_issue_37_rpc_invoker_owner_compat',
  ]),
});
const BOUNDED_RELEASE_DEPENDENCIES = Object.freeze({
  '0137_issue_749_create_tour_order_quoted': Object.freeze([
    '0132_issue_42_seasonal_price_resolution',
    '0136_issue_755_create_tour_order_invoker',
  ]),
  // 0136 only ALTERs the signature created by 0132 (which needs 0128's tables);
  // it must never be selectable without them.
  '0136_issue_755_create_tour_order_invoker': Object.freeze([
    '0128_issue_42_plan_seasonal_pricing',
    '0132_issue_42_seasonal_price_resolution',
  ]),
  '0121_issue_17_booking_addons_hardening': Object.freeze(['0125_issue_17_booking_addons_legacy_enum']),
  '0133_issue_680_booking_addons_composite_fk_expand': Object.freeze(['0121_issue_17_booking_addons_hardening']),
  // 0131's tour/staff tables must already be applied. They are checked below;
  // no pending migration prerequisite is silently pulled into this release.
  '0131_issue_37_atomic_departure_staff': Object.freeze([]),
  '0134_issue_37_rpc_invoker_owner_compat': Object.freeze(['0131_issue_37_atomic_departure_staff']),
});
const ISSUE_46_CLOSURE_APPLIED_PREREQUISITES = Object.freeze([
  '0001_extensions_and_functions',
  '0002_enums',
  '0003_tenants_and_accounts',
  '0004_core_business_tables',
  '0005_line_marketing_other',
  '0066_issue_8_tour_domain_core',
  '0067_issue_8_tour_integrity',
  '0068_issue_8_tour_rest_dml_acl',
  '0074_block_times_recurrence_fields',
  '0087_issue_8b_tour_orders',
  '0088_issue_8b_tour_order_rpc_acl',
  '0089_trip_display_fields',
  '0092_trip_departure_staff',
  '0107_issue_41_formation_state_model',
]);
const BOUNDED_APPLIED_PREREQUISITES = Object.freeze({
  [ISSUE_46_0110_0136_CLOSURE]: ISSUE_46_CLOSURE_APPLIED_PREREQUISITES,
  [ISSUE_755_0110_0137_CLOSURE]: ISSUE_46_CLOSURE_APPLIED_PREREQUISITES,
  [ISSUE_46_0135]: Object.freeze([
    '0003_tenants_and_accounts',
    '0004_core_business_tables',
    '0005_line_marketing_other',
    '0066_issue_8_tour_domain_core',
    '0074_block_times_recurrence_fields',
    '0092_trip_departure_staff',
    '0110_issue_42_plan_duration_pricetype_yearround',
    '0115_issue_21_external_calendars',
  ]),
  [ISSUE_37_0131_0134]: Object.freeze([
    '0066_issue_8_tour_domain_core',
    '0092_trip_departure_staff',
  ]),
});

// A historical compatibility migration can have a newer identity while still
// being a prerequisite for an older pending migration. Keep the file identity
// monotonic for repo-integrity, but execute this bounded precondition first.
const PENDING_MIGRATION_PRECEDENCE = Object.freeze([
  Object.freeze({ before: '0124_issue_18_owner_notify_legacy_shape', after: '0116_issue_18_owner_notify' }),
  Object.freeze({ before: '0125_issue_17_booking_addons_legacy_enum', after: '0121_issue_17_booking_addons_hardening' }),
  // 0136 ALTERs the signature defined by 0132; apply it strictly afterwards.
  Object.freeze({ before: '0132_issue_42_seasonal_price_resolution', after: '0136_issue_755_create_tour_order_invoker' }),
]);

// This one bounded legacy-shape precondition contains a type rewrite and an
// RLS enablement, but it must travel with the existing AUTHZ release lane so
// the atomic G3 plan can reconcile the known TEST baseline drift before 0121.
// Keep this an exact filename allowlist; generic mixed-risk SQL remains
// fail-closed below.
const AUTHZ_COMPATIBILITY_PRECONDITIONS = new Set([
  '0125_issue_17_booking_addons_legacy_enum',
  // #589/0127 replaces a stale notified CHECK only after fail-closed shape and
  // value inspection; its ACL/RLS reconciliation remains an AUTHZ release.
  '0127_issue_589_authz_constraint_reconciliation',
]);

// PostgreSQL resolves these built-ins from pg_catalog before application
// schemas. Accept both normal spellings (`now()`) and explicit pg_catalog
// spellings, but only for this finite list; a custom routine still fails closed.
const catalogRoutineSpellings = (names) => new Set(names.flatMap((name) => [name, `pg_catalog.${name}`]));
const SAFE_DECLARATIVE_CATALOG_ROUTINES = catalogRoutineSpellings([
  'now',
  'gen_random_uuid',
]);
const SAFE_PROCEDURAL_CATALOG_ROUTINES = catalogRoutineSpellings([
  'count',
  'string_agg',
  'pg_get_constraintdef',
  'pg_get_expr',
  'array_agg',
  'unnest',
  'pg_get_function_identity_arguments',
  'pg_get_functiondef',
  // #589/0127 only reads ACL catalog rows before a bounded reconciliation.
  // Qualified spellings below prevent an untrusted user-schema lookalike.
]);
SAFE_PROCEDURAL_CATALOG_ROUTINES.add('pg_catalog.to_regclass');
SAFE_PROCEDURAL_CATALOG_ROUTINES.add('pg_catalog.to_regtype');
SAFE_PROCEDURAL_CATALOG_ROUTINES.add('pg_catalog.format');
SAFE_PROCEDURAL_CATALOG_ROUTINES.add('pg_catalog.aclexplode');
SAFE_PROCEDURAL_CATALOG_ROUTINES.add('pg_catalog.acldefault');
const SAFE_POLICY_PREDICATE_ROUTINES = new Set([
  'is_tenant_member',
  'tenant_role_at_least',
  'storage.foldername',
]);

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function releasePlanDigestOf(plan = {}) {
  const copy = { ...plan };
  delete copy.planDigest;
  return sha256(JSON.stringify(canonicalize(copy)));
}

export { CANONICAL_MIGRATION_IDENTITY, isCanonicalMigrationIdentity };

export function normalizedRepoFile(value) {
  const name = String(value ?? '').trim();
  if (!isCanonicalMigrationIdentity(name)) {
    fail('INVALID_REPO_MIGRATION_NAME', `invalid repoFile: ${name || '<empty>'}`);
  }
  return name;
}

function normalizePlannedAt(value) {
  const text = String(value ?? '').trim();
  if (!ISO_UTC.test(text) || Number.isNaN(Date.parse(text))) fail('INVALID_PLANNED_AT', 'plannedAt must be ISO UTC');
  return new Date(text).toISOString();
}

function ledgerVersionAt(plannedAt, offsetSeconds) {
  const date = new Date(Date.parse(plannedAt) + offsetSeconds * 1000);
  const year = date.getUTCFullYear();
  const pad = (value) => String(value).padStart(2, '0');
  return `${year}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}

export function pendingProductionMigrations(aliasMap = {}) {
  if (aliasMap?.schemaVersion !== 1 || !Array.isArray(aliasMap?.entries)) {
    fail('INVALID_ALIAS_MAP', 'ledger alias map schema is unavailable');
  }
  const pending = aliasMap.entries
    .filter((entry) => entry?.classification === 'NOT_APPLIED' && entry?.notAppliedReason === 'PENDING_APPLY')
    .map((entry) => normalizedRepoFile(entry.repoFile));
  if (new Set(pending).size !== pending.length) fail('DUPLICATE_PENDING_MIGRATION', 'pending repo migration names must be unique');
  return orderPendingProductionMigrations(pending);
}

export function selectedProductionMigrations(aliasMap = {}, migrationScope = FULL_PENDING_SET) {
  const pending = pendingProductionMigrations(aliasMap);
  const scope = String(migrationScope ?? '').trim() || FULL_PENDING_SET;
  if (scope === FULL_PENDING_SET) return { migrationScope: scope, migrations: pending };
  const roots = BOUNDED_RELEASE_SCOPE_ROOTS[scope];
  if (!roots) fail('UNSUPPORTED_MIGRATION_SCOPE', `migration scope is not admitted: ${scope}`);
  for (const repoFile of BOUNDED_APPLIED_PREREQUISITES[scope] ?? []) {
    const matches = aliasMap.entries.filter((entry) => entry?.repoFile === repoFile);
    if (matches.length !== 1 || matches[0].classification !== 'EXACT' ||
        !Array.isArray(matches[0].ledgerNames) || matches[0].ledgerNames.length === 0 ||
        ([ISSUE_46_0135, ISSUE_46_0110_0136_CLOSURE, ISSUE_755_0110_0137_CLOSURE].includes(scope) && (matches[0].ledgerNames.length !== 1 || matches[0].ledgerNames[0] !== repoFile))) {
      fail('MIGRATION_SCOPE_APPLIED_PREREQUISITE_MISSING', `${scope} requires an exact applied prerequisite: ${repoFile}`);
    }
  }

  if ([ISSUE_46_0110_0136_CLOSURE, ISSUE_755_0110_0137_CLOSURE].includes(scope)) {
    // This sole historical alias is reviewed, not a generic ALIAS escape.
    const legacy = aliasMap.entries.filter((entry) => entry?.repoFile === '0099_drop_legacy_create_tour_order_overload');
    if (legacy.length !== 1 || legacy[0].classification !== 'ALIAS'
      || !Array.isArray(legacy[0].ledgerNames) || legacy[0].ledgerNames.length !== 1
      || legacy[0].ledgerNames[0] !== 'drop_legacy_create_tour_order_overload') {
      fail('MIGRATION_SCOPE_APPLIED_PREREQUISITE_MISSING', `${scope} requires the exact reviewed 0099 alias`);
    }
    // Unique ten-argument routine identity/body/ACL remain fresh G2/postcheck
    // obligations; this source-only ledger check does not certify live shape.
  }

  const closure = new Set();
  const visit = (repoFile) => {
    if (closure.has(repoFile)) return;
    closure.add(repoFile);
    for (const dependency of BOUNDED_RELEASE_DEPENDENCIES[repoFile] ?? []) visit(dependency);
  };
  for (const root of roots) visit(root);
  const missing = [...closure].filter((repoFile) => !pending.includes(repoFile));
  if (missing.length) fail('MIGRATION_SCOPE_DEPENDENCY_NOT_PENDING', `${scope} requires pending migrations: ${missing.join(', ')}`);
  return { migrationScope: scope, migrations: orderPendingProductionMigrations([...closure]) };
}

export function orderPendingProductionMigrations(names = []) {
  const ordered = [...names].sort();
  for (const { before, after } of PENDING_MIGRATION_PRECEDENCE) {
    const beforeIndex = ordered.indexOf(before);
    const afterIndex = ordered.indexOf(after);
    if (beforeIndex >= 0 && afterIndex >= 0 && beforeIndex > afterIndex) {
      ordered.splice(beforeIndex, 1);
      ordered.splice(afterIndex, 0, before);
    }
  }
  return ordered;
}

// PostgreSQL scan.l：ident_cont = [A-Za-z\200-\377_0-9$]；任何非 ASCII 字元都算識別字字元。
export const PG_IDENT_START_CLASS = 'A-Za-z_\\u0080-\\u{10FFFF}';
export const PG_IDENT_CONT_CLASS = 'A-Za-z0-9_$\\u0080-\\u{10FFFF}';
export const PG_IDENT_CONT_RE = new RegExp(`[${PG_IDENT_CONT_CLASS}]`, 'u');

// PostgreSQL 詞法：空白只有 [ \t\n\r\f\v]；識別字字元含所有非 ASCII。JS 的 \b／\s／\w 與此不同
// （\s 含 NBSP、U+2028 等，\b 把 é 當分隔），拿來做風險分類會少報（#781）。
// pgRe 把 regex 內的 \b／\s／\w 改寫成 PG 語意，並強制 u flag；以 source+flags 快取。
const PG_WS = ' \\t\\n\\r\\f\\v';
// 邊界用的字元類別不含 `$`：`$$`／`$tag$` 是獨立 token，可緊貼關鍵字（`$$select 1$$security definer`）。
// 代價是 `drop$x` 之類會多報，屬 fail closed。
const PG_BOUNDARY_CLASS = PG_IDENT_CONT_CLASS.replace('$', '');
const PG_BOUNDARY = `(?:(?<=[${PG_BOUNDARY_CLASS}])(?![${PG_BOUNDARY_CLASS}])|(?<![${PG_BOUNDARY_CLASS}])(?=[${PG_BOUNDARY_CLASS}]))`;
const PG_RE_CACHE = new Map();
export function pgRe(re) {
  const flags = re.flags.includes('u') ? re.flags : `${re.flags}u`;
  const key = `${flags}/${re.source}`;
  const cached = PG_RE_CACHE.get(key);
  if (cached) return cached;
  const source = re.source.replaceAll('[\\s\\S]', '[^]');
  let out = '';
  let inClass = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '\\') {
      const next = source[i + 1];
      i += 1;
      if (next === 'b' && !inClass) out += PG_BOUNDARY;
      else if (next === 's') out += inClass ? PG_WS : `[${PG_WS}]`;
      else if (next === 'w') out += inClass ? PG_IDENT_CONT_CLASS.replace('$', '') : `[${PG_IDENT_CONT_CLASS.replace('$', '')}]`;
      else out += ch + next;
      continue;
    }
    if (ch === '[' && !inClass) inClass = true;
    else if (ch === ']' && inClass) inClass = false;
    out += ch;
  }
  const compiled = new RegExp(out, flags);
  PG_RE_CACHE.set(key, compiled);
  return compiled;
}

// dolq_start = [A-Za-z\200-\377_]；dolq_cont = [A-Za-z\200-\377_0-9]
const PG_DOLLAR_TAG_RE = /\$(?:[A-Za-z_\u0080-\u{10FFFF}][A-Za-z0-9_\u0080-\u{10FFFF}]*)?\$/uy;

// PostgreSQL scan.l quotecontinue：字串結尾引號之後若接「水平空白／-- 註解 + 至少一個換行 + (空白 | -- 註解換行)* + '」，
// 則是同一個字串字面量的續段，且沿用相同模式（E 字串的反斜線跳脫在續段仍有效）。注意 scan.l 只認 -- 行註解，不認 /* */。
// 水平空白取 PG17 的 [ \t\f\v]（PG16 沒有 \v；超集對兩個版本都安全，PG16 本來就不接受 \v 出現在字串外）。
// 回傳續段開頭引號「之後」的位置；不是續段回傳 -1。手寫掃描以避免正規表示式的巢狀量詞回溯。
function stringContinuationEnd(input, from) {
  const n = input.length;
  let j = from;
  while (j < n) {
    const c = input[j];
    if (c === ' ' || c === '\t' || c === '\f' || c === '\v') { j += 1; continue; }
    if (c === '-' && input[j + 1] === '-') {
      j += 2;
      while (j < n && input[j] !== '\n' && input[j] !== '\r') j += 1;
      continue;
    }
    break;
  }
  if (input[j] !== '\n' && input[j] !== '\r') return -1;
  j += 1;
  while (j < n) {
    const c = input[j];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v') { j += 1; continue; }
    if (c === '-' && input[j + 1] === '-') {
      j += 2;
      while (j < n && input[j] !== '\n' && input[j] !== '\r') j += 1;
      if (j >= n) return -1;
      j += 1;
      continue;
    }
    break;
  }
  return input[j] === "'" ? j + 1 : -1;
}

function quotedTokenEnd(input, start, quote, rejectContinuationCode = '') {
  const backslashEscapes = quote === "'"
    && /[eE]/.test(input[start - 1] ?? '')
    && !PG_IDENT_CONT_RE.test(input[start - 2] ?? '');
  let index = start + 1;
  while (index < input.length) {
    if (backslashEscapes && input[index] === '\\' && index + 1 < input.length) {
      index += 2;
      continue;
    }
    if (input[index] === quote) {
      if (input[index + 1] === quote) {
        index += 2;
        continue;
      }
      if (quote === "'") {
        const continued = stringContinuationEnd(input, index + 1);
        if (continued >= 0) {
          if (rejectContinuationCode) {
            fail(rejectContinuationCode, 'adjacent string literal continuation is not admitted in routine bodies or dynamic SQL templates');
          }
          index = continued;
          continue;
        }
      }
      return index + 1;
    }
    index += 1;
  }
  fail('UNSUPPORTED_SQL_LEXICAL_FORM', 'unterminated quoted SQL token');
}



function dollarQuoteAt(input, index) {
  const previous = input[index - 1] ?? '';
  if (previous && PG_IDENT_CONT_RE.test(previous)) return '';
  if (input[index] !== '$') return '';
  PG_DOLLAR_TAG_RE.lastIndex = index;
  return PG_DOLLAR_TAG_RE.exec(input)?.[0] ?? '';
}

function unicodeEscapedIdentifierMentionsScs(input) {
  for (const match of input.matchAll(/u&"((?:[^"]|"")*)"(?:[ \t\n\r\f\v]*uescape[ \t\n\r\f\v]*'([^'])')?/gi)) {
    const escape = match[2] ?? '\\';
    let decoded = '';
    const body = match[1].replaceAll('""', '"');
    for (let i = 0; i < body.length; i += 1) {
      if (body[i] !== escape) {
        decoded += body[i];
        continue;
      }
      if (body[i + 1] === escape) {
        decoded += escape;
        i += 1;
        continue;
      }
      const long = body[i + 1] === '+';
      const digits = body.slice(i + (long ? 2 : 1), i + (long ? 8 : 5));
      if (digits.length !== (long ? 6 : 4) || !/^[0-9a-f]+$/i.test(digits)) return true;
      const codePoint = Number.parseInt(digits, 16);
      if (codePoint > 0x10ffff) return true;
      decoded += String.fromCodePoint(codePoint);
      i += long ? 7 : 4;
    }
    if (/standard_conforming_strings/i.test(decoded)) return true;
  }
  return false;
}

export function stripSqlComments(sql) {
  const input = String(sql ?? '');
  // 任何提及 standard_conforming_strings 的文字一律 fail closed（含 = 'off'、= false、TO off、
  // 引號識別字、set_config(...)）：它會改變字串詞法，本分類器不逐一建模賦值形式（#781）。
  // U&"..." 識別字會在詞法階段解碼 \XXXX／\+XXXXXX 跳脫，可拼出 standard_conforming_strings。
  // 逐一解碼（含 UESCAPE 變體），解出該名稱、或無法解碼，一律 fail closed；其他 U&" 沿用既有路徑。
  // 預設跳脫字元的 U&"..." 由下方逐一解碼；自訂 UESCAPE 已於上方整體拒絕，故 SET <U& 識別字> 無法繞過。
  if (unicodeEscapedIdentifierMentionsScs(input)) {
    fail('UNSUPPORTED_SQL_LEXICAL_FORM', 'standard_conforming_strings via U&"..." is not admitted by the fail-closed classifier');
  }
  if (/standard_conforming_strings/i.test(input)) {
    fail('UNSUPPORTED_SQL_LEXICAL_FORM', 'standard_conforming_strings is not admitted by the fail-closed classifier');
  }
  let output = '';
  let index = 0;
  while (index < input.length) {
    const char = input[index];
    const next = input[index + 1];
    if (char === "'" || char === '"') {
      const end = quotedTokenEnd(input, index, char);
      output += input.slice(index, end);
      index = end;
      continue;
    }
    const dollar = dollarQuoteAt(input, index);
    if (dollar) {
      const end = input.indexOf(dollar, index + dollar.length);
      if (end < 0) {
        fail('UNSUPPORTED_SQL_LEXICAL_FORM', 'unterminated dollar-quoted SQL token');
      }
      const endIndex = end + dollar.length;
      output += input.slice(index, endIndex);
      index = endIndex;
      continue;
    }
    if (char === '-' && next === '-') {
      output += '  ';
      index += 2;
      while (index < input.length && input[index] !== '\n' && input[index] !== '\r') {
        output += ' ';
        index += 1;
      }
      continue;
    }
    if (char === '/' && next === '*') {
      output += '  ';
      index += 2;
      let depth = 1;
      while (index < input.length && depth > 0) {
        if (input[index] === '/' && input[index + 1] === '*') {
          output += '  ';
          index += 2;
          depth += 1;
          continue;
        }
        if (input[index] === '*' && input[index + 1] === '/') {
          output += '  ';
          index += 2;
          depth -= 1;
          continue;
        }
        output += input[index] === '\n' ? '\n' : ' ';
        index += 1;
      }
      if (depth !== 0) fail('UNSUPPORTED_SQL_LEXICAL_FORM', 'unterminated block SQL comment');
      continue;
    }
    output += char;
    index += 1;
  }
  return output;
}

export function splitSqlStatements(sql) {
  const input = stripSqlComments(sql);
  const statements = [];
  let start = 0;
  let index = 0;
  while (index < input.length) {
    const char = input[index];
    if (char === "'" || char === '"') {
      index = quotedTokenEnd(input, index, char);
      continue;
    }
    const dollar = dollarQuoteAt(input, index);
    if (dollar) {
      const end = input.indexOf(dollar, index + dollar.length);
      index = end < 0 ? input.length : end + dollar.length;
      continue;
    }
    if (char === ';') {
      const statement = input.slice(start, index).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
    index += 1;
  }
  const tail = input.slice(start).trim();
  if (tail) statements.push(tail);
  return statements;
}



export function stripSqlStringLiterals(sql, nestedDollarBody = false, preserveDoubleQuotedIdentifiers = false) {
  const input = stripSqlComments(sql);
  let output = '';
  let index = 0;
  while (index < input.length) {
    const char = input[index];
    if (char === "'" || char === '"') {
      const end = quotedTokenEnd(input, index, char);
      if (char === '"' && preserveDoubleQuotedIdentifiers) {
        output += input.slice(index, end);
      } else {
        output += ' '.repeat(end - index);
      }
      index = end;
      continue;
    }
    const dollar = dollarQuoteAt(input, index);
    if (dollar) {
      const end = input.indexOf(dollar, index + dollar.length);
      if (end < 0) fail('UNSUPPORTED_SQL_LEXICAL_FORM', 'unterminated dollar-quoted SQL token');
      const endIndex = end + dollar.length;
      if (nestedDollarBody) {
        output += ' '.repeat(endIndex - index);
      } else {
        output += ' '.repeat(dollar.length);
        output += stripSqlStringLiterals(input.slice(index + dollar.length, end), true);
        output += ' '.repeat(dollar.length);
      }
      index = endIndex;
      continue;
    }
    output += char;
    index += 1;
  }
  return output;
}
function stripStoredRoutineBodies(statement) {
  // Mask strings and dollar-quoted bodies while locating AS, then remove only a
  // lexically identified top-level CREATE FUNCTION/PROCEDURE body. In particular,
  // never run a raw regex over a DO body: notice text must not be able to erase
  // executable DML from the migration-time classifier.
  const input = String(statement);
  const lexical = stripSqlStringLiterals(input, true);
  if (!pgRe(/^\s*create\s+(?:or\s+replace\s+)?(?:function|procedure)\b/i).test(lexical)) return input;

  for (const as of lexical.matchAll(pgRe(/\bas\b/gi))) {
    let bodyStart = as.index + as[0].length;
    while (pgRe(/\s/).test(lexical[bodyStart] ?? '')) bodyStart += 1;
    const dollar = dollarQuoteAt(input, bodyStart);
    if (!dollar) continue;
    const end = input.indexOf(dollar, bodyStart + dollar.length);
    if (end < 0) fail('UNSUPPORTED_SQL_LEXICAL_FORM', 'unterminated stored routine body');
    return input.slice(0, bodyStart)
      + ' '.repeat(end + dollar.length - bodyStart)
      + input.slice(end + dollar.length);
  }
  return input;
}

function hasConflictActionContinuation(input, start) {
  if (pgRe(/^\s*do\s+(?:nothing|update)\b/i).test(input.slice(start))) return true;
  const predicate = pgRe(/^\s*where\b/i).exec(input.slice(start));
  if (!predicate) return false;
  // Locate DO outside predicate parentheses/quoted identifiers. This only
  // recognizes the CONFLICT clause; the caller still scans every nested call.
  let index = start + predicate[0].length;
  while (index < input.length) {
    const char = input[index];
    if (char === '(') {
      index = matchingParenthesisEnd(input, index);
      continue;
    }
    if (char === '"' || char === "'") {
      index = quotedTokenEnd(input, index, char);
      continue;
    }
    if (char === ')' || char === ';') return false;
    const word = /^[A-Za-z_\u0080-\u{10FFFF}][A-Za-z0-9_$\u0080-\u{10FFFF}]*/u.exec(input.slice(index));
    if (word) {
      if (word[0].toLowerCase() === 'do') {
        return pgRe(/^do\s+(?:nothing|update)\b/i).test(input.slice(index));
      }
      index += word[0].length;
    } else {
      index += 1;
    }
  }
  return false;
}

function isSqlParenthesisSyntax(name, before, input, openIndex) {
  // PostgreSQL gram.y: an unqualified func_name is a type_function_name
  // (IDENT, unreserved_keyword or type_func_name_keyword). Only non-callable
  // grammar terminals may be recognized by spelling alone. In particular,
  // JOIN, FILTER, OVER, IF, SET and index access-method names are NOT terminals
  // that can safely be exempted everywhere. Unknown/ambiguous forms fail closed.
  // All terminals below are RESERVED_KEYWORD, except VALUES (COL_NAME_KEYWORD);
  // neither category is an unqualified type_function_name. Quoted/qualified
  // versions never reach this helper. Nested candidates are still inspected.
  if (/^(?:all|and|any|as|case|check|coalesce|default|else|end|for|foreign|from|group|having|in|into|lateral|limit|not|offset|on|only|or|order|primary|returning|select|some|then|unique|using|values|when|where|with)$/.test(name)) return true;
  if (name === 'exists') {
    return pgRe(/^\s*(?:\(\s*)*(?:select|with|values)\b/i).test(input.slice(openIndex + 1));
  }
  // CONFLICT is callable. ON alone is insufficient (JOIN ... ON conflict()
  // would be a routine call); require the INSERT conflict-action continuation.
  if (name === 'conflict' && pgRe(/\bon\s*$/i).test(before)) {
    const close = matchingParenthesisEnd(input, openIndex);
    return hasConflictActionContinuation(input, close);
  }
  // KEY alone is callable (unlike CHECK/UNIQUE, it is not a reserved keyword),
  // but `PRIMARY KEY (` / `FOREIGN KEY (` is the fixed table-constraint column
  // list grammar — never a function call — so only that exact two-word
  // continuation is recognized, not bare KEY everywhere.
  if (name === 'key' && pgRe(/\b(?:primary|foreign)\s+$/i).test(before)) return true;
  return false;
}

function isDmlTargetColumnList(text, index) {
  return pgRe(/\binsert\s+into\s+(?:only\s+)?(?:(?:"(?:[^"]|"")*"|[A-Za-z_\u0080-\u{10FFFF}][A-Za-z0-9_$\u0080-\u{10FFFF}]*)\s*\.\s*)?$/iu).test(
    String(text).slice(0, index),
  );
}

function isReferencesColumnList(text, index) {
  // `references [schema.]table(col[, col...])` is DDL foreign-key syntax, not a
  // routine call — the parenthesized part is a column list, not an argument list.
  // The candidate match itself already covers the optional schema-qualified
  // table name (mirroring how `isDmlTargetColumnList` covers `insert into
  // schema.table(`), so this only needs to confirm the immediately preceding
  // token is the `references` keyword. Any routine call that merely follows a
  // REFERENCES clause later in the statement still falls through to full
  // routine-invocation scrutiny, because its own preceding text will not end in
  // `references\s+`.
  return pgRe(/\breferences\s+$/iu).test(String(text).slice(0, index));
}

function isAliasColumnList(text, index) {
  // `... AS alias(col1, col2, ...)` renames a derived table/VALUES list's
  // columns — the parenthesized part is a column-name list, not an argument
  // list, so it is not a routine call. Only the exact `AS <candidate-name>(`
  // spelling is recognized (the word immediately before the candidate identifier
  // must be the `AS` keyword); an implicit (AS-less) alias column list still
  // falls through to full routine-invocation scrutiny.
  return pgRe(/\bas\s+$/iu).test(String(text).slice(0, index));
}

function hasUnverifiedRoutineInvocation(text, allowedRoutineCalls = new Set()) {
  const input = String(text);
  const quotedCandidates = input.matchAll(
    pgRe(/(?<![A-Za-z0-9_$\u0080-\u{10FFFF}])(?:[A-Za-z_\u0080-\u{10FFFF}][A-Za-z0-9_$\u0080-\u{10FFFF}]*\s*\.\s*)?"(?:[^"]|"")*"\s*\(/giu),
  );
  for (const match of quotedCandidates) {
    if (isDmlTargetColumnList(input, match.index) || isReferencesColumnList(input, match.index)
      || isAliasColumnList(input, match.index)) continue;
    return true;
  }

  const candidates = input.matchAll(
    pgRe(/(?<![A-Za-z0-9_$\u0080-\u{10FFFF}])(?:(?:"(?:[^"]|"")*"|[A-Za-z_\u0080-\u{10FFFF}][A-Za-z0-9_$\u0080-\u{10FFFF}]*)\s*\.\s*)?([A-Za-z_\u0080-\u{10FFFF}][A-Za-z0-9_$\u0080-\u{10FFFF}]*)\s*\(/giu),
  );
  for (const match of candidates) {
    if (isDmlTargetColumnList(input, match.index) || isReferencesColumnList(input, match.index)
      || isAliasColumnList(input, match.index)) continue;
    const calledName = match[0].slice(0, match[0].lastIndexOf('(')).replace(pgRe(/\s+/g), '').toLowerCase();
    const name = String(match[1]).toLowerCase();
    const before = input.slice(0, match.index);
    if (allowedRoutineCalls.has(calledName)) continue;
    if (!calledName.includes('.') && isSqlParenthesisSyntax(
      name, before, input, match.index + match[0].length - 1,
    )) continue;
    return true;
  }
  return false;
}

function rejectUnsupportedPreparedStatements(statements) {
  const preparedExecute = pgRe(/\bexecute\s+(?!(?:pg_catalog\s*\.\s*)?format\b)(?:(?:[A-Za-z_\u0080-\u{10FFFF}][A-Za-z0-9_$\u0080-\u{10FFFF}]*\s*\.\s*)?[A-Za-z_\u0080-\u{10FFFF}][A-Za-z0-9_$\u0080-\u{10FFFF}]*|"(?:[^"]|"")*")(?:\s*\([^;]*\))?(?=\s*(?:;|$))/iu);
  for (const statement of statements) {
    const immediateText = stripStoredRoutineBodies(statement).trim();
    const procedural = pgRe(/^do\b/i).test(immediateText);
    const executableText = procedural ? immediateProceduralBody(immediateText) ?? immediateText : immediateText;
    const lexicalText = stripSqlStringLiterals(executableText);
    // SQL EXECUTE is not PL/pgSQL dynamic EXECUTE. Check the entire immediate
    // command, not an end-anchored prepared name: EXPLAIN options, quoted names
    // and CTAS WITH [NO] DATA must not hide it. Privilege declarations are inert.
    const privilegeDeclaration = pgRe(/^(?:grant|revoke|alter\s+default\s+privileges)\b/i).test(lexicalText);
    const immediateExecute = !procedural
      && !pgRe(/^create\s+(?:or\s+replace\s+)?(?:function|procedure|(?:constraint\s+)?trigger)\b/i).test(lexicalText)
      && !privilegeDeclaration && pgRe(/\bexecute\b/i).test(lexicalText);
    if (pgRe(/\bprepare\b/i).test(lexicalText) || immediateExecute || preparedExecute.test(lexicalText)) {
      fail('UNSUPPORTED_DYNAMIC_SQL_NOT_ADMITTED', 'SQL-level PREPARE/EXECUTE is not admitted by the v1 classifier');
    }
  }
}

function indexAccessMethodColumnListStart(text) {
  // Only this anchored CREATE INDEX prefix makes btree/hash syntax rather
  // than a routine call. Leave the column expressions and predicate intact.
  const identifier = '(?:"(?:[^"]|"")*"|[A-Za-z_\\u0080-\\u{10FFFF}][A-Za-z0-9_$\\u0080-\\u{10FFFF}]*)';
  const prefix = pgRe(new RegExp('^create\\s+(?:unique\\s+)?index\\s+(?:concurrently\\s+)?'
    + '(?:if\\s+not\\s+exists\\s+)?(?:' + identifier + '\\s+)?on\\s+(?:only\\s+)?'
    + identifier + '(?:\\s*\\.\\s*' + identifier + ')?\\s+using\\s+(?:btree|hash)\\s*(?=\\()', 'iu'));
  return prefix.exec(stripSqlStringLiterals(text, true, true))?.[0].length ?? -1;
}

function rejectImmediateRoutineInvocations(statements, repoFile = '') {
  const checkCommandText = (text, allowedRoutineCalls = new Set()) => hasUnverifiedRoutineInvocation(
    stripSqlStringLiterals(text, true, true),
    allowedRoutineCalls,
  );

  for (const statement of statements) {
    const immediateText = stripStoredRoutineBodies(statement).trim();
    const lexicalText = stripSqlStringLiterals(immediateText);
    const topLevelCall = pgRe(/^\s*call\b/i).test(lexicalText);
    const policyDeclaration = pgRe(/^\s*create\s+policy\b/i).test(lexicalText);

    // A policy predicate takes effect only as authorization logic, not while the
    // migration executes. It is still limited to the G3-tested helper contract.
    if (policyDeclaration && checkCommandText(immediateText, SAFE_POLICY_PREDICATE_ROUTINES)) {
      fail('UNSUPPORTED_POLICY_ROUTINE_NOT_ADMITTED', 'policy predicate routine is not in the G3-covered contract');
    }

    if (pgRe(/^(?:create|alter)\b/i).test(lexicalText)
      && !policyDeclaration
      && !pgRe(/^create\s+(?:or\s+replace\s+)?(?:function|procedure)\b/i).test(lexicalText)) {
      const indexColumnsStart = indexAccessMethodColumnListStart(immediateText);
      for (const expression of lexicalText.matchAll(pgRe(/\b(?:check|default|using|as|where|generated|partition)\b/gi))) {
        let expressionStart = expression.index + expression[0].length;
        if (/^using$/i.test(expression[0]) && expressionStart < indexColumnsStart) {
          expressionStart = indexColumnsStart;
        }
        if (checkCommandText(immediateText.slice(expressionStart), SAFE_DECLARATIVE_CATALOG_ROUTINES)) {
          fail('UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED', 'DDL expression routine invocation is not admitted');
        }
      }
      if (pgRe(/^create\s+(?:unique\s+)?index\b/i).test(lexicalText)) {
        const open = lexicalText.indexOf('(');
        if (open >= 0 && checkCommandText(immediateText.slice(open))) {
          fail('UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED', 'index expression routine invocation is not admitted');
        }
      }
    }

    const copyQuery = pgRe(/^\s*copy\s*\(/i).exec(lexicalText);
    if (copyQuery && checkCommandText(immediateText.slice(copyQuery[0].length))) {
      fail('UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED', 'routine invocation inside a COPY query is not admitted');
    }
    // Only USING (an ALTER COLUMN TYPE rewrite expression, evaluated against
    // every existing row) is held to the zero-allowance immediate-execution bar
    // here. A bare column DEFAULT is not re-scanned with an empty allowlist —
    // the DDL expression scan above already vets it against
    // SAFE_DECLARATIVE_CATALOG_ROUTINES (the Owner-approved pg_catalog-prefixed
    // builtin allowlist), so re-including `default` here would silently
    // re-reject the very pg_catalog.now()/pg_catalog.gen_random_uuid() calls
    // that scan just admitted, with zero allowance instead of that allowlist.
    const topLevelExecutable = pgRe(/^\s*(?:\(\s*)*(?:with|select|insert|update|delete|merge|values|explain)\b/i).test(lexicalText)
      || pgRe(/^\s*create\s+(?:(?:(?:global|local)\s+)?(?:temporary|temp)\s+|unlogged\s+)?table\b[\s\S]*\bas\b/i).test(lexicalText)
      || pgRe(/^\s*create\s+materialized\s+view\b[\s\S]*\bas\b/i).test(lexicalText)
      || pgRe(/^\s*alter\s+table\b[\s\S]*\busing\b/i).test(lexicalText);
    if ((topLevelCall || topLevelExecutable && checkCommandText(immediateText))) {
      fail('UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED', 'immediate routine invocation is not admitted by the fail-closed classifier');
    }

    if (pgRe(/^\s*do\b/i).test(lexicalText)) {
      if (pgRe(/\bexecute\s*\(/i).test(lexicalText)) {
        fail('UNSUPPORTED_DYNAMIC_SQL_NOT_ADMITTED', 'parenthesized dynamic EXECUTE is not admitted');
      }
      const body = immediateProceduralBody(immediateText);
      const allowedProceduralCalls = String(repoFile) === '0127_issue_589_authz_constraint_reconciliation'
        ? new Set([...SAFE_PROCEDURAL_CATALOG_ROUTINES, 'public.is_tenant_member'])
        : SAFE_PROCEDURAL_CATALOG_ROUTINES;
      if (body !== null && checkCommandText(body, allowedProceduralCalls)) {
        fail('UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED', 'routine invocation inside an immediate procedural block is not admitted');
      }
    }
  }
}

function isBounded0127ProceduralReconciliation(statements, repoFile) {
  if (String(repoFile) !== '0127_issue_589_authz_constraint_reconciliation' || statements.length !== 1) return false;
  const body = immediateProceduralBody(stripStoredRoutineBodies(statements[0]).trim());
  if (body === null) return false;
  const fragments = splitSqlStatements(body).map((fragment) => stripSqlStringLiterals(fragment).trim()).filter(Boolean);
  const exact = new Set([
    'drop policy if exists p_booking_addons_i on public.booking_addons',
    'drop policy if exists p_booking_addons_u on public.booking_addons',
    'drop policy if exists p_booking_addons_d on public.booking_addons',
    'drop policy if exists p_booking_addons_s on public.booking_addons',
    'drop policy if exists p_owner_notify_recipients_s on public.owner_notify_recipients',
    'drop policy if exists p_owner_notify_recipients_i on public.owner_notify_recipients',
    'drop policy if exists p_owner_notify_recipients_u on public.owner_notify_recipients',
    'drop policy if exists p_owner_notify_recipients_d on public.owner_notify_recipients',
    'drop policy if exists p_owner_notify_recipients_all on public.owner_notify_recipients',
    'alter table public.booking_addons drop constraint if exists booking_addons_notified_check',
  ]);
  const drops = fragments.filter((fragment) => pgRe(/\bdrop\b/i).test(fragment)).map((fragment) => fragment.toLowerCase());
  return drops.length === exact.size && new Set(drops).size === exact.size
    && drops.every((fragment) => exact.has(fragment));
}

function rejectImmediateConfigurationMutations(statements) {
  for (const statement of statements) {
    const immediateText = stripStoredRoutineBodies(statement).trim();
    const lexicalText = stripSqlStringLiterals(immediateText);
    if (!pgRe(/^\s*do\b/i).test(lexicalText)) continue;
    const body = immediateProceduralBody(immediateText);
    const bodyLexical = body === null ? '' : stripSqlStringLiterals(body, true, true);
    if (pgRe(/\b(?:commit|rollback|start\s+transaction|begin\s+transaction)\b/i).test(bodyLexical)) {
      fail('UNSUPPORTED_AUTHZ_SQL_NOT_ADMITTED', 'transaction control inside an immediate procedural block is not admitted');
    }
    if (matchesChain(bodyLexical, [pgRe(/\bexception\s+when\b/gi), pgRe(/\bthen\b/gi)])) {
      fail('UNSUPPORTED_AUTHZ_SQL_NOT_ADMITTED', 'exception handlers inside an immediate procedural block are not admitted');
    }
    if (pgRe(/(?:^\s*(?:set|reset)\b|\bbegin\s+(?:set|reset)\b|(?:^|;|\b(?:then|else|loop|exception)\b)\s*(?:set|reset)\b)/i).test(bodyLexical)) {
      fail('UNSUPPORTED_AUTHZ_SQL_NOT_ADMITTED', 'SET/RESET inside an immediate procedural block is not admitted by the fail-closed classifier');
    }
  }
}

function immediateProceduralBody(statement) {
  const input = String(statement);
  const match = input.match(pgRe(/^\s*do\b/i));
  if (!match) return null;

  let index = match[0].length;
  const skipWhitespace = () => {
    while (pgRe(/\s/).test(input[index] ?? '')) index += 1;
  };
  skipWhitespace();

  const language = input.slice(index).match(pgRe(/^language\b/i));
  if (language) {
    index += language[0].length;
    skipWhitespace();
    while (index < input.length && !pgRe(/\s/).test(input[index])) index += 1;
    skipWhitespace();
  }

  const extended = /[eE]/.test(input[index] ?? '') && input[index + 1] === "'";
  const quoteIndex = extended ? index + 1 : index;
  if (input[quoteIndex] === "'") {
    const end = quotedTokenEnd(input, quoteIndex, "'", 'UNSUPPORTED_SQL_LEXICAL_FORM');
    if (input.slice(end).trim()) {
      fail('UNSUPPORTED_SQL_LEXICAL_FORM', 'procedural body has unconsumed trailing syntax');
    }
    const rawBody = input.slice(quoteIndex + 1, end - 1);
    if (extended && /\\/.test(rawBody)) {
      fail('UNSUPPORTED_SQL_LEXICAL_FORM', 'backslash-escaped E-string procedural bodies are not admitted');
    }
    return rawBody.replace(/''/g, "'");
  }

  const dollar = dollarQuoteAt(input, index);
  if (!dollar) return null;
  const end = input.indexOf(dollar, index + dollar.length);
  if (end < 0) fail('UNSUPPORTED_SQL_LEXICAL_FORM', 'unterminated dollar-quoted procedural body');
  const tokenEnd = end + dollar.length;
  if (input.slice(tokenEnd).trim()) {
    fail('UNSUPPORTED_SQL_LEXICAL_FORM', 'procedural body has unconsumed trailing syntax');
  }
  return input.slice(index + dollar.length, end);
}

function matchingParenthesisEnd(input, openIndex) {
  let depth = 0;
  let index = openIndex;
  while (index < input.length) {
    const char = input[index];
    if (char === "'" || char === '"') {
      index = quotedTokenEnd(input, index, char);
      continue;
    }
    const dollar = dollarQuoteAt(input, index);
    if (dollar) {
      const end = input.indexOf(dollar, index + dollar.length);
      if (end < 0) fail('UNSUPPORTED_SQL_LEXICAL_FORM', 'unterminated dollar-quoted dynamic SQL expression');
      index = end + dollar.length;
      continue;
    }
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
    index += 1;
  }
  fail('UNSUPPORTED_DYNAMIC_SQL_NOT_ADMITTED', 'dynamic SQL expression has unbalanced parentheses');
}

function splitTopLevelFormatArguments(input) {
  const values = [];
  let start = 0;
  let index = 0;
  let depth = 0;
  while (index < input.length) {
    const char = input[index];
    if (char === "'" || char === '"') {
      index = quotedTokenEnd(input, index, char);
      continue;
    }
    const dollar = dollarQuoteAt(input, index);
    if (dollar) {
      const end = input.indexOf(dollar, index + dollar.length);
      if (end < 0) fail('UNSUPPORTED_SQL_LEXICAL_FORM', 'unterminated dollar-quoted format argument');
      index = end + dollar.length;
      continue;
    }
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      if (depth === 0) fail('UNSUPPORTED_DYNAMIC_SQL_NOT_ADMITTED', 'format arguments have unbalanced parentheses');
      depth -= 1;
    } else if (char === ',' && depth === 0) {
      values.push(input.slice(start, index).trim());
      start = index + 1;
    }
    index += 1;
  }
  if (depth !== 0) fail('UNSUPPORTED_DYNAMIC_SQL_NOT_ADMITTED', 'format arguments have unbalanced parentheses');
  values.push(input.slice(start).trim());
  return values;
}

function isSimpleFormatArgument(value) {
  const input = String(value).trim();
  if (!input) return false;
  if (/^(?:null|true|false)$/i.test(input)) return true;
  if (/^\$[0-9]+$/.test(input)) return true;
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(input)) return true;

  const extended = /[eE]/.test(input[0] ?? '') && input[1] === "'";
  const quoteIndex = extended ? 1 : 0;
  if (input[quoteIndex] === "'") {
    const end = quotedTokenEnd(input, quoteIndex, "'", 'UNSUPPORTED_DYNAMIC_SQL_NOT_ADMITTED');
    return input.slice(end).trim() === '';
  }

  const dollar = dollarQuoteAt(input, 0);
  if (dollar) {
    const end = input.indexOf(dollar, dollar.length);
    return end >= 0 && input.slice(end + dollar.length).trim() === '';
  }

  return pgRe(/^(?:"(?:[^"]|"")*"|[A-Za-z_][\w$]*)(?:\s*\.\s*(?:"(?:[^"]|"")*"|[A-Za-z_][\w$]*))*$/u).test(input);
}

function boundedFormatPlaceholderCount(template) {
  let count = 0;
  for (let index = 0; index < String(template).length; index += 1) {
    if (template[index] !== '%') continue;
    if (template[index + 1] === '%') {
      index += 1;
      continue;
    }
    if (template[index + 1] === 'I') {
      count += 1;
      index += 1;
      continue;
    }
    return -1;
  }
  return count;
}

function assertFormatArgumentsBounded(input, firstArgEnd, formatEnd, template) {
  const placeholderCount = boundedFormatPlaceholderCount(template);
  if (placeholderCount < 0) {
    fail('UNSUPPORTED_DYNAMIC_SQL_NOT_ADMITTED', 'dynamic SQL format contains an unbounded placeholder');
  }
  let cursor = firstArgEnd;
  while (pgRe(/\s/).test(input[cursor] ?? '')) cursor += 1;
  if (input[cursor] === ')') {
    if (placeholderCount !== 0) {
      fail('UNSUPPORTED_DYNAMIC_SQL_NOT_ADMITTED', 'dynamic SQL format is missing an identifier argument');
    }
    return;
  }
  if (input[cursor] !== ',') {
    fail('UNSUPPORTED_DYNAMIC_SQL_NOT_ADMITTED', 'dynamic SQL format first argument has unconsumed syntax');
  }

  const args = splitTopLevelFormatArguments(input.slice(cursor + 1, formatEnd - 1));
  if (args.length !== placeholderCount || !args.every(isSimpleFormatArgument)) {
    fail('UNSUPPORTED_DYNAMIC_SQL_NOT_ADMITTED', 'dynamic SQL format arguments must be exactly bounded, side-effect-free identifiers or literals');
  }
}

function firstDynamicSqlTemplate(fragment) {
  const input = String(fragment).trim();
  let index = 0;
  const skipWhitespace = () => {
    while (pgRe(/\s/).test(input[index] ?? '')) index += 1;
  };
  while (input[index] === '(') {
    index += 1;
    skipWhitespace();
  }

  const format = input.slice(index).match(pgRe(/^pg_catalog\s*\.\s*format\s*\(/i));
  if (format) {
    const formatOpenIndex = index + format[0].lastIndexOf('(');
    index += format[0].length;
    skipWhitespace();

    const extended = /[eE]/.test(input[index] ?? '') && input[index + 1] === "'";
    const quoteIndex = extended ? index + 1 : index;
    if (input[quoteIndex] === "'") {
      const end = quotedTokenEnd(input, quoteIndex, "'", 'UNSUPPORTED_DYNAMIC_SQL_NOT_ADMITTED');
      const formatEnd = matchingParenthesisEnd(input, formatOpenIndex);
      const rawTemplate = input.slice(quoteIndex + 1, end - 1);
      assertFormatArgumentsBounded(input, end, formatEnd, rawTemplate);
      if (input.slice(formatEnd).trim()) {
        fail('UNSUPPORTED_DYNAMIC_SQL_NOT_ADMITTED', 'dynamic SQL format expression has unconsumed trailing syntax');
      }
      if (extended && /\\/.test(rawTemplate)) {
        fail('UNSUPPORTED_SQL_LEXICAL_FORM', 'backslash-escaped E-string dynamic SQL templates are not admitted');
      }
      return rawTemplate.replace(/''/g, "'");
    }

    const dollar = dollarQuoteAt(input, index);
    if (dollar) {
      const end = input.indexOf(dollar, index + dollar.length);
      if (end < 0) fail('UNSUPPORTED_SQL_LEXICAL_FORM', 'unterminated dynamic SQL template');
      const formatEnd = matchingParenthesisEnd(input, formatOpenIndex);
      const rawTemplate = input.slice(index + dollar.length, end);
      assertFormatArgumentsBounded(input, end + dollar.length, formatEnd, rawTemplate);
      if (input.slice(formatEnd).trim()) {
        fail('UNSUPPORTED_DYNAMIC_SQL_NOT_ADMITTED', 'dynamic SQL format expression has unconsumed trailing syntax');
      }
      return rawTemplate;
    }
    return '';
  }

  const extended = /[eE]/.test(input[index] ?? '') && input[index + 1] === "'";
  const quoteIndex = extended ? index + 1 : index;
  if (input[quoteIndex] === "'") {
    const end = quotedTokenEnd(input, quoteIndex, "'", 'UNSUPPORTED_DYNAMIC_SQL_NOT_ADMITTED');
    if (input.slice(end).trim()) {
      fail('UNSUPPORTED_DYNAMIC_SQL_NOT_ADMITTED', 'dynamic SQL expression has unconsumed trailing syntax');
    }
    const rawTemplate = input.slice(quoteIndex + 1, end - 1);
    if (extended && /\\/.test(rawTemplate)) {
      fail('UNSUPPORTED_SQL_LEXICAL_FORM', 'backslash-escaped E-string dynamic SQL templates are not admitted');
    }
    return rawTemplate.replace(/''/g, "'");
  }

  const dollar = dollarQuoteAt(input, index);
  if (!dollar) return '';
  const end = input.indexOf(dollar, index + dollar.length);
  if (end < 0) fail('UNSUPPORTED_SQL_LEXICAL_FORM', 'unterminated dynamic SQL template');
  const tokenEnd = end + dollar.length;
  if (input.slice(tokenEnd).trim()) {
    fail('UNSUPPORTED_DYNAMIC_SQL_NOT_ADMITTED', 'dynamic SQL expression has unconsumed trailing syntax');
  }
  return input.slice(index + dollar.length, end);
}

function dynamicExecuteFragments(body) {
  if (body == null) return [];
  const fragments = [];
  for (const statement of splitSqlStatements(body)) {
    const lexicalStatement = stripSqlStringLiterals(statement, true);
    for (const match of lexicalStatement.matchAll(pgRe(/\bexecute\b/gi))) {
      fragments.push(statement.slice(match.index + match[0].length));
    }
  }
  return fragments;
}

function formatPlaceholdersAreBounded(template) {
  const residual = String(template).replaceAll('%I', '').replaceAll('%%', '');
  return !residual.includes('%');
}

function dynamicCommandKind(fragment) {
  const template = firstDynamicSqlTemplate(fragment);
  const lexicalTemplate = stripSqlStringLiterals(template, true).trim();
  const formatCall = pgRe(/^\s*\(*\s*(?:pg_catalog\s*\.\s*)?format\s*\(/i).test(fragment);
  const templateStatements = splitSqlStatements(template);
  if (matchesChain(lexicalTemplate, [pgRe(/\bdrop\b/gi), pgRe(/\bcascade\b/gi)])) {
    fail('CASCADE_NOT_ADMITTED', 'dynamic schema repair cannot prove the dependency scope of CASCADE');
  }
  // One DROP CONSTRAINT only; a comma must not smuggle ADD CHECK/default/USING
  // or another ALTER action past migration-time expression admission.
  const identifier = '(?:%I|"(?:[^"]|"")*"|[A-Za-z_\\u0080-\\u{10FFFF}][A-Za-z0-9_$\\u0080-\\u{10FFFF}]*)';
  const boundedDrop = pgRe(new RegExp('^alter\\s+table\\s+(?:only\\s+)?' + identifier
    + '(?:\\s*\\.\\s*' + identifier + ')?\\s+drop\\s+constraint\\s+(?:if\\s+exists\\s+)?'
    + identifier + '(?:\\s+restrict)?\\s*;?\\s*$', 'iu'));
  const boundedConstraintRepair = boundedDrop.test(template.trim())
    && formatPlaceholdersAreBounded(template)
    && templateStatements.length === 1;
  if (boundedConstraintRepair) return 'SCHEMA_REPAIR';
  if (pgRe(/\bdrop\b|\btruncate\b/i).test(fragment)) {
    fail('DESTRUCTIVE_SQL_NOT_ADMITTED', 'dynamic SQL may execute an unbounded destructive command');
  }
  if (templateStatements.length !== 1) {
    fail('UNSUPPORTED_DYNAMIC_SQL_NOT_ADMITTED', 'dynamic SQL must contain exactly one statically bounded statement');
  }
  if (formatCall) {
    fail('UNSUPPORTED_DYNAMIC_SQL_NOT_ADMITTED', 'dynamic format SQL is not admitted unless it is a bounded constraint repair');
  }
  if (!pgRe(/^(?:update\b|delete\s+from\b|insert\s+into\b|merge\s+into\b)/i).test(lexicalTemplate)) {
    fail('UNSUPPORTED_DYNAMIC_SQL_NOT_ADMITTED', 'dynamic SQL must be a statically bounded DML template');
  }
  return 'BACKFILL';
}

function assertDynamicExecutionSafe(body) {
  const lexicalBody = stripSqlStringLiterals(body, true);
  if (matchesChain(lexicalBody, [pgRe(/\bexecute\b/gi), /\|\|/g])) {
    fail('UNSUPPORTED_DYNAMIC_SQL_NOT_ADMITTED', 'concatenated dynamic SQL is not admitted');
  }
  return dynamicExecuteFragments(body).map(dynamicCommandKind);
}

function hasImmediateBackfillDml(text) {
  return splitSqlStatements(text).some((statement) => {
    const immediateText = stripStoredRoutineBodies(statement).trim();
    // Creating a stored routine does not execute its body. Keep this boundary
    // explicit before looking for DML inside arbitrary immediate wrappers.
    if (pgRe(/^create\s+(?:or\s+replace\s+)?(?:function|procedure)\b/i).test(immediateText)) return false;
    const lexicalText = stripSqlStringLiterals(immediateText);
    const procedural = pgRe(/^do\b/i).test(lexicalText);
    const body = procedural ? immediateProceduralBody(immediateText) : null;
    if (procedural && body === null) {
      fail('UNSUPPORTED_SQL_LEXICAL_FORM', 'unrecognized DO body form is not admitted');
    }
    const executableBody = body === null ? '' : stripSqlStringLiterals(body, true);
    const directDml = pgRe(/^(?:update\b|delete\s+from\b|insert\s+into\b|merge\s+into\b)/i).test(lexicalText);
    const explainedDml = pgRe(/^explain\b[\s\S]*\b(?:update|delete\s+from|insert\s+into|merge\s+into)\b/i).test(lexicalText);
    // WITH can be nested under CTAS, views, EXPLAIN, COPY or other wrappers.
    // Inspect every immediate WITH/DO, not just the first statement keyword;
    // routine declarations are excluded and quoted/commented text is masked.
    const compoundDml = !procedural && matchesChain(lexicalText, [pgRe(/\bwith\b/gi), pgRe(/\b(?:update|delete\s+from|insert\s+into|merge\s+into)\b/gi)]);
    // Do not mistake a complete GRANT/REVOKE statement (which can list INSERT
    // or UPDATE as a privilege) for executed DML. Keep the broad scan for all
    // remaining procedural statements so BEGIN/IF/THEN/ELSE/LOOP DML remains
    // fail-closed.
    const proceduralWithoutPrivileges = body === null ? '' : splitSqlStatements(executableBody)
      .filter((fragment) => !pgRe(/^\s*(?:grant|revoke)\b/i).test(fragment))
      .join(';');
    const proceduralDml = body !== null && pgRe(/\b(?:update|delete\s+from\b|insert\s+into\b|merge\s+into\b)/i).test(proceduralWithoutPrivileges);
    const dynamicKinds = body !== null ? assertDynamicExecutionSafe(body) : [];
    return directDml || explainedDml || compoundDml || proceduralDml || dynamicKinds.includes('BACKFILL');
  });
}
export function highestRiskTier(tiers = []) {
  let selected = 'ADDITIVE';
  for (const raw of tiers) {
    const tier = String(raw ?? '').toUpperCase();
    if (!(tier in RISK_ORDER)) fail('UNSUPPORTED_RISK_TIER', `unsupported risk tier: ${tier || '<empty>'}`);
    if (RISK_ORDER[tier] > RISK_ORDER[selected]) selected = tier;
  }
  return selected;
}

function rejectUnsupportedRoutineLiteralBodies(statements) {
  for (const statement of statements) {
    const lexical = stripSqlStringLiterals(statement);
    if (pgRe(/^\s*create\s+(?:or\s+replace\s+)?(?:function|procedure)\b/i).test(lexical)
      && pgRe(/\bas\s+(?:[eE]|[uU]&)?\s*'/i).test(statement)) {
      fail('UNSUPPORTED_SQL_LEXICAL_FORM', 'single-quoted routine bodies are not admitted by the fail-closed classifier');
    }
  }
}

function rejectUnclassifiedDropStatements(text) {
  const fragments = splitSqlStatements(text)
    .map((fragment) => {
      const immediate = stripStoredRoutineBodies(fragment).trim();
      // Single-quoted DO bodies execute too; do not mask their DROP/CASCADE.
      const executable = pgRe(/^do\b/i).test(immediate) ? immediateProceduralBody(immediate) ?? immediate : immediate;
      return stripSqlStringLiterals(executable);
    })
    .filter((fragment) => pgRe(/\bdrop\b/i).test(fragment));
  for (const fragment of fragments) {
    const drops = [...fragment.matchAll(pgRe(/\bdrop\s+(?:if\s+exists\s+)?([A-Za-z_\u0080-\u{10FFFF}][\w$]*)/giu))];
    if (!drops.length) fail('UNCLASSIFIED_DROP_NOT_ADMITTED', 'DROP target could not be lexically identified');
    for (const match of drops) {
      const objectType = String(match[1]).toLowerCase();
      if (!new Set(['table', 'schema', 'policy', 'constraint', 'default', 'column', 'trigger']).has(objectType)) {
        fail('UNCLASSIFIED_DROP_NOT_ADMITTED', `unrecognized DROP form: ${objectType}`);
      }
    }
    if (pgRe(/\bcascade\b/i).test(fragment)) {
      fail('CASCADE_NOT_ADMITTED', 'schema repair cannot prove the dependency scope of CASCADE');
    }
  }
}

function assertSingleRiskTier(tiers = []) {
  const highest = highestRiskTier(tiers);
  const unique = [...new Set(tiers.map((raw) => String(raw ?? '').toUpperCase()))];
  if (unique.length > 1) {
    fail('MIXED_RISK_RELEASE_NOT_ADMITTED', 'split release plan by risk class before v1 apply: ' + unique.join('+'));
  }
  return highest;
}

function hasAuthzConfigurationMutation(statement) {
  const input = String(statement);
  return pgRe(/^\s*set\s+(?:(?:local|session)\s+)?(?:[A-Za-z_\u0080-\u{10FFFF}][\w$]*|(?:[uU]&)?(?:"(?:[^"]|"")*"))\s*(?:=|\bto\b)/iu).test(input)
    || pgRe(/^\s*reset\s+(?:[A-Za-z_\u0080-\u{10FFFF}][\w$]*|(?:[uU]&)?(?:"(?:[^"]|"")*"))/iu).test(input);
}

function matchesChain(text, chain) {
  // pgRe 以 source+flags 快取並共用 regex 實例；g 實例的 lastIndex 是共享狀態，
  // 用完（含 exec 拋錯）必須歸零，否則同 source 的 matchAll／exec 會從殘留位置開始（漏報）。
  let from = 0;
  for (const re of chain) {
    let match;
    try {
      re.lastIndex = from;
      match = re.exec(text);
    } finally {
      re.lastIndex = 0;
    }
    if (!match) return false;
    from = match.index + match[0].length;
  }
  return true;
}
const SCHEMA_REPAIR_CHAINS = [
  [pgRe(/\balter\s+table\b/gi), pgRe(/\bdrop\s+constraint\b/gi)],
  [pgRe(/\balter\s+table\b/gi), pgRe(/\balter\s+column\b/gi), pgRe(/\bdrop\s+default\b/gi)],
  [pgRe(/\balter\s+table\b/gi), pgRe(/\balter\s+column\b/gi), pgRe(/\btype\b/gi)],
];
// AUTHZ 風險規則；每條是「依序出現」的 regex 鏈（原 `A[\s\S]*B`），以 matchesChain 線性比對，避免 400KB 病態輸入的二次方回溯（#781）。
const AUTHZ_RISK_CHAINS = [
  [pgRe(/\b(create|alter|drop)\s+policy\b/gi)],
  [pgRe(/\b(?:enable|disable|force|no force)\s+row\s+level\s+security\b/gi)],
  [pgRe(/\bgrant\b/gi)],
  [pgRe(/\brevoke\b/gi)],
  [pgRe(/\bsecurity\s+(definer|invoker)\b/gi)],
  [pgRe(/\b(?:auth\.|tenant_role|is_tenant_member)\b/gi)],
  [pgRe(/\breassign\s+owned\b/gi)],
  [pgRe(/\balter\s+group\b/gi), pgRe(/\b(?:add|drop)\s+user\b/gi)],
  [pgRe(/\b(?:alter|create)\s+(?:role|user|group)\b/gi)],
  [pgRe(/\b(?:alter|create)\s+(?:role|user)\b/gi), pgRe(/\b(?:bypassrls|nobypassrls|superuser|nosuperuser|createrole|nocreaterole|createdb|nocreatedb|replication|noreplication|inherit|noinherit|login|nologin)\b/gi)],
  [pgRe(/\b(?:alter\s+(?:table|schema|sequence|view|materialized\s+view|function|procedure|routine|type|domain|foreign\s+table)|create\s+(?:table|schema|sequence|view|materialized\s+view|function|procedure|type))\b/gi), pgRe(/\bowner\s+to\b/gi)],
  [pgRe(/\b(?:create|alter)\s+(?:or\s+replace\s+)?(?:view|materialized\s+view)\b/gi), pgRe(/\bsecurity_(?:invoker|barrier)\b/gi)],
  [pgRe(/\bcreate\s+schema\b/gi), pgRe(/\bauthorization\b/gi)],
  [pgRe(/\bset\s+(?:(?:local|session)\s+)?(?:"role"|role)(?![A-Za-z0-9_$\u0080-\u{10FFFF}])/giu)],
  [pgRe(/\breset\s+role\b/gi)],
  [pgRe(/\bset\s+(?:(?:local|session)\s+)?authorization\b/gi)],
  [pgRe(/\balter\s+default\s+privileges\b/gi)],
];

export function inferMigrationRiskTier(sql, repoFile = '') {
  // UESCAPE（只在分類入口檢查，stripSqlComments 的其他使用者不受影響）： 的跳脫字元可寫成 '!'、E'!'、$$!$$ 等任意字串形式，不逐一建模：出現即 fail closed。
  if (/(?<![A-Za-z0-9_\u0080-\u{10FFFF}])uescape(?![A-Za-z0-9_\u0080-\u{10FFFF}])/iu.test(String(sql ?? ''))) {
    fail('UNSUPPORTED_SQL_LEXICAL_FORM', 'UESCAPE is not admitted by the fail-closed classifier');
  }
  const text = stripSqlComments(sql);

  // v1 絕不放行會直接刪掉資料容器或欄位的操作。constraint/default 的暫時移除
  // 則不是同一件事：例如 0109 在已知漂移環境中，會先拿掉舊 CHECK/default、
  // 把欄位型別修回 canonical enum，再於同一 transaction 重建正確約束。
  const statements = splitSqlStatements(text);
  rejectUnsupportedRoutineLiteralBodies(statements);
  rejectUnsupportedPreparedStatements(statements);
  rejectImmediateRoutineInvocations(statements, repoFile);
  rejectImmediateConfigurationMutations(statements);
  // 不錨定語句開頭：DO／動態 EXECUTE body 內的同類語句同樣生效。
  // ALTER DATABASE/ROLE/USER/SYSTEM ... SET 會持久改變 session 設定（含字串詞法），v1 不放行（#781）。
  if (statements.some((statement) => matchesChain(statement, [pgRe(/\balter\s+(?:database|role|user|system)\b/gi), pgRe(/\bset\b/gi)]))) {
    fail('UNSUPPORTED_SQL_LEXICAL_FORM', 'ALTER DATABASE/ROLE/USER/SYSTEM ... SET is not admitted by the fail-closed classifier');
  }
  if (statements.some((statement) => pgRe(/\btruncate\b|\bdrop\s+(?:table|schema)\b/i).test(statement))) {
    fail('DESTRUCTIVE_SQL_NOT_ADMITTED', 'DROP TABLE/SCHEMA and TRUNCATE must use expand → migrate → contract outside v1');
  }
  if (statements.some((statement) => matchesChain(statement, [pgRe(/\balter\s+table\b/gi), pgRe(/\bdrop(?:\s+column)?\s+(?:if\s+exists\s+)?(?!constraint\b|default\b)/gi)]))
    && !isBounded0127ProceduralReconciliation(statements, repoFile)) {
    fail('DESTRUCTIVE_SQL_NOT_ADMITTED', 'DROP TABLE/SCHEMA/COLUMN and TRUNCATE must use expand → migrate → contract outside v1');
  }
  rejectUnclassifiedDropStatements(text);

  const specialized = [];
  if (statements.some((statement) => SCHEMA_REPAIR_CHAINS.some((chain) => matchesChain(statement, chain)))) {
    specialized.push('SCHEMA_REPAIR');
  }
  if (statements.some((statement) => AUTHZ_RISK_CHAINS.some((chain) => matchesChain(statement, chain)) || hasAuthzConfigurationMutation(statement))) {
    specialized.push('AUTHZ');
  }
  if (hasImmediateBackfillDml(text)) specialized.push('BACKFILL');

  // v1 不用「選最高級」來掩蓋另一類必要證據。若一支 migration 同時混進兩種
  // specialized risk，先拆成 bounded migrations，讓每一支都有完整對應測試與復原證據。
  if (specialized.length > 1) {
    if (AUTHZ_COMPATIBILITY_PRECONDITIONS.has(String(repoFile))
      && specialized.includes('SCHEMA_REPAIR') && specialized.includes('AUTHZ')
      && !specialized.includes('BACKFILL')) {
      return 'AUTHZ';
    }
    fail('MIXED_RISK_MIGRATION_NOT_ADMITTED', `split migration by risk class before v1 apply: ${specialized.join('+')}`);
  }
  return specialized[0] ?? 'ADDITIVE';
}

/**
 * Build a release plan exclusively from current-main canonical migration bytes and
 * the alias-map entries explicitly classified PENDING_APPLY. `readCanonicalSql`
 * must read `origin/main:<path>` (or an equivalent immutable main snapshot), never
 * a PR/worktree overlay.
 * This source core verifies consistency with the supplied reader, not its Git
 * provenance. #455 owns trusted-main admission; #450 alone is not automation-ready.
 */
export function buildProductionDbReleasePlan({
  releaseId,
  mainSha,
  plannedAt,
  aliasMap,
  migrationScope = FULL_PENDING_SET,
  readCanonicalSql,
} = /** @type {any} */ ({})) {
  const id = String(releaseId ?? '').trim();
  if (!RELEASE_ID.test(id)) fail('INVALID_RELEASE_ID', 'releaseId has an invalid shape');
  const sha = String(mainSha ?? '').trim().toLowerCase();
  if (!SHA.test(sha)) fail('INVALID_MAIN_SHA', 'mainSha must be an exact 40-character SHA');
  const normalizedPlannedAt = normalizePlannedAt(plannedAt);
  if (typeof readCanonicalSql !== 'function') fail('CANONICAL_READER_REQUIRED', 'readCanonicalSql is required');

  const selection = selectedProductionMigrations(aliasMap, migrationScope);
  const names = selection.migrations;
  if (!names.length) fail('NO_PENDING_PRODUCTION_MIGRATIONS', 'alias map has no PENDING_APPLY migrations');

  const migrations = names.map((repoFile, index) => {
    const path = `supabase/migrations/${repoFile}.sql`;
    const sql = String(readCanonicalSql(path));
    if (!sql.trim()) fail('EMPTY_CANONICAL_MIGRATION', `${path} is empty`);
    return {
      repoFile,
      path,
      sha256: sha256(Buffer.from(sql)),
      riskTier: inferMigrationRiskTier(sql, repoFile),
      ledgerVersion: ledgerVersionAt(normalizedPlannedAt, index),
    };
  });

  const plan = {
    schemaVersion: 1,
    releaseId: id,
    repository: PRODUCTION_DB_POLICY.repository,
    productionProjectRef: PRODUCTION_DB_POLICY.productionProjectRef,
    mainSha: sha,
    plannedAt: normalizedPlannedAt,
    migrationScope: selection.migrationScope,
    riskTier: assertSingleRiskTier(migrations.map((entry) => entry.riskTier)),
    migrations,
  };
  return { ...plan, planDigest: releasePlanDigestOf(plan) };
}

export function verifyProductionDbReleasePlan({ plan, aliasMap, readCanonicalSql } = {}) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) fail('PLAN_REQUIRED', 'release plan is required');
  if (plan.repository !== PRODUCTION_DB_POLICY.repository) fail('WRONG_REPOSITORY', 'release plan repository is not canonical');
  if (plan.productionProjectRef !== PRODUCTION_DB_POLICY.productionProjectRef) fail('WRONG_PROJECT', 'release plan project is not canonical Production');
  if (!SHA.test(String(plan.mainSha ?? ''))) fail('INVALID_MAIN_SHA', 'release plan has no exact main SHA');
  if (!RELEASE_ID.test(String(plan.releaseId ?? ''))) fail('INVALID_RELEASE_ID', 'release plan has invalid releaseId');
  normalizePlannedAt(plan.plannedAt);
  if (releasePlanDigestOf(plan) !== plan.planDigest) fail('PLAN_DIGEST_MISMATCH', 'release plan digest is stale or forged');

  const selection = selectedProductionMigrations(aliasMap, plan.migrationScope);
  const pending = selection.migrations;
  const names = (Array.isArray(plan.migrations) ? plan.migrations : []).map((entry) => normalizedRepoFile(entry?.repoFile));
  if (pending.join('\n') !== names.join('\n')) {
    fail('PENDING_SET_MISMATCH', `plan=[${names.join(', ')}], pending=[${pending.join(', ')}]`);
  }
  if (new Set(names).size !== names.length) fail('DUPLICATE_PLAN_MIGRATION', 'plan migrations must be unique');
  const versions = plan.migrations.map((entry) => String(entry?.ledgerVersion ?? ''));
  if (versions.some((version) => !LEDGER_VERSION.test(version)) || new Set(versions).size !== versions.length) {
    fail('INVALID_LEDGER_VERSION_PLAN', 'ledger versions must be unique 14-digit values fixed at plan time');
  }
  if (typeof readCanonicalSql !== 'function') fail('CANONICAL_READER_REQUIRED', 'readCanonicalSql is required');

  const tiers = [];
  for (const entry of plan.migrations) {
    const expectedPath = `supabase/migrations/${entry.repoFile}.sql`;
    if (entry.path !== expectedPath) fail('MIGRATION_PATH_MISMATCH', `${entry.repoFile} path is not canonical`);
    const sql = String(readCanonicalSql(expectedPath));
    if (sha256(Buffer.from(sql)) !== entry.sha256) fail('MIGRATION_BYTES_MISMATCH', `${expectedPath} differs from reviewed main bytes`);
    const inferred = inferMigrationRiskTier(sql, entry.repoFile);
    if (entry.riskTier !== inferred) fail('MIGRATION_RISK_MISMATCH', `${entry.repoFile} risk tier changed`);
    tiers.push(inferred);
  }
  if (plan.riskTier !== assertSingleRiskTier(tiers)) fail('RELEASE_RISK_MISMATCH', 'release risk tier does not match migration risk floor');
  return { status: 'PLAN_VERIFIED', planDigest: plan.planDigest, migrationCount: names.length, riskTier: plan.riskTier, databaseMutationAuthorized: false };
}
