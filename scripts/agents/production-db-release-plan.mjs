import { createHash } from 'node:crypto';

import { PRODUCTION_DB_POLICY } from './production-db-release-preflight.mjs';

const SHA = /^[0-9a-f]{40}$/;
const RELEASE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{7,119}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const LEDGER_VERSION = /^\d{14}$/;
const RISK_ORDER = Object.freeze({ ADDITIVE: 1, SCHEMA_REPAIR: 2, AUTHZ: 3, BACKFILL: 4 });

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

function normalizedRepoFile(value) {
  const name = String(value ?? '').trim();
  if (!/^[0-9A-Za-z][0-9A-Za-z._-]*$/.test(name) || name.endsWith('.sql')) {
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
  return pending.sort();
}

function quotedTokenEnd(input, start, quote) {
  const backslashEscapes = quote === "'" && /[eE]/.test(input[start - 1] ?? '');
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
      return index + 1;
    }
    index += 1;
  }
  fail('UNSUPPORTED_SQL_LEXICAL_FORM', 'unterminated quoted SQL token');
}



function dollarQuoteAt(input, index) {
  return input.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0] ?? '';
}

export function stripSqlComments(sql) {
  const input = String(sql ?? '');
  if (/\bstandard_conforming_strings\s*(?:=|to)\s*off\b/i.test(input)) {
    fail('UNSUPPORTED_SQL_LEXICAL_FORM', 'standard_conforming_strings=off is not admitted by the fail-closed classifier');
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
      while (index < input.length && input[index] !== '\n') {
        output += ' ';
        index += 1;
      }
      continue;
    }
    if (char === '/' && next === '*') {
      output += '  ';
      index += 2;
      while (index < input.length && !(input[index] === '*' && input[index + 1] === '/')) {
        output += input[index] === '\n' ? '\n' : ' ';
        index += 1;
      }
      if (index < input.length) {
        output += '  ';
        index += 2;
      }
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


function stripStoredRoutineBodies(text) {
  // UPDATE / DELETE inside a stored function is runtime behavior, not a migration-time
  // backfill. Keep DO $$ ... $$ blocks intact because those execute immediately while
  // applying the migration and therefore must still count as BACKFILL when they mutate rows.
  return String(text).replace(
    /\bcreate\s+(?:or\s+replace\s+)?(?:function|procedure)\b[\s\S]*?\bas\s+(\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$)[\s\S]*?\1/gi,
    ' ',
  );
}

function hasImmediateBackfillDml(text) {
  // `UPDATE` / `DELETE` 也會合法出現在 ACL 語句與 policy 定義中，例如
  // `GRANT UPDATE`、`REVOKE DELETE`、`FOR UPDATE`。只有 migration 套用當下真的
  // 執行的資料 DML 才算 BACKFILL；stored function/procedure 內的 DML 是日後 RPC
  // 執行時才發生，不能把整支 migration 誤判成 BACKFILL。
  const immediateText = stripStoredRoutineBodies(text);
  const update = /\bupdate\s+(?:only\s+)?(?:"(?:[^"]|"")*"|[A-Za-z_][\w$]*)(?:\.(?:"(?:[^"]|"")*"|[A-Za-z_][\w$]*))?(?:\s+(?:as\s+)?(?:"(?:[^"]|"")*"|[A-Za-z_][\w$]*))?\s+set\b/i.test(immediateText);
  const deletion = /\bdelete\s+from\s+(?:only\s+)?(?:"(?:[^"]|"")*"|[A-Za-z_][\w$]*)(?:\.(?:"(?:[^"]|"")*"|[A-Za-z_][\w$]*))?(?=\s|;|$)/i.test(immediateText);
  return update || deletion;
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

function rejectUnclassifiedDropStatements(text) {
  const fragments = splitSqlStatements(text).filter((fragment) => /\bdrop\b/i.test(fragment));
  for (const fragment of fragments) {
    const recognized =
      /\bdrop\s+(?:table|schema)\b/i.test(fragment) ||
      /\b(?:create|alter|drop)\s+policy\b/i.test(fragment) ||
      /\bdrop\s+(?:constraint|default)\b/i.test(fragment) ||
      /\balter\s+table\b[\s\S]{0,240}\bdrop(?:\s+column)?\s+(?:if\s+exists\s+)?(?!constraint\b|default\b)/i.test(fragment);
    if (!recognized) fail('UNCLASSIFIED_DROP_NOT_ADMITTED', 'unrecognized DROP form must be reviewed explicitly');
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

export function inferMigrationRiskTier(sql) {
  const text = stripSqlComments(sql);

  // v1 絕不放行會直接刪掉資料容器或欄位的操作。constraint/default 的暫時移除
  // 則不是同一件事：例如 0109 在已知漂移環境中，會先拿掉舊 CHECK/default、
  // 把欄位型別修回 canonical enum，再於同一 transaction 重建正確約束。
  const statements = splitSqlStatements(text);
  if (statements.some((statement) => /\btruncate\b|\bdrop\s+(?:table|schema)\b|\balter\s+table\b[\s\S]{0,240}\bdrop(?:\s+column)?\s+(?:if\s+exists\s+)?(?!constraint\b|default\b)/i.test(statement))) {
    fail('DESTRUCTIVE_SQL_NOT_ADMITTED', 'DROP TABLE/SCHEMA/COLUMN and TRUNCATE must use expand → migrate → contract outside v1');
  }
  rejectUnclassifiedDropStatements(text);

  const specialized = [];
  if (/\balter\s+table\b[\s\S]{0,240}\bdrop\s+constraint\b|\balter\s+table\b[\s\S]{0,240}\balter\s+column\b[\s\S]{0,160}\bdrop\s+default\b|\balter\s+table\b[\s\S]{0,240}\balter\s+column\b[\s\S]{0,160}\btype\b/i.test(text)) {
    specialized.push('SCHEMA_REPAIR');
  }
  if (/\b(create|alter|drop)\s+policy\b|\b(?:enable|disable|force|no force)\s+row\s+level\s+security\b|\bgrant\b|\brevoke\b|\bsecurity\s+(definer|invoker)\b|\b(auth\.|tenant_role|is_tenant_member)/i.test(text)) {
    specialized.push('AUTHZ');
  }
  if (hasImmediateBackfillDml(text)) specialized.push('BACKFILL');

  // v1 不用「選最高級」來掩蓋另一類必要證據。若一支 migration 同時混進兩種
  // specialized risk，先拆成 bounded migrations，讓每一支都有完整對應測試與復原證據。
  if (specialized.length > 1) {
    fail('MIXED_RISK_MIGRATION_NOT_ADMITTED', `split migration by risk class before v1 apply: ${specialized.join('+')}`);
  }
  return specialized[0] ?? 'ADDITIVE';
}

/**
 * Build a release plan exclusively from current-main canonical migration bytes and
 * the alias-map entries explicitly classified PENDING_APPLY. `readCanonicalSql`
 * must read `origin/main:<path>` (or an equivalent immutable main snapshot), never
 * a PR/worktree overlay.
 */
export function buildProductionDbReleasePlan({
  releaseId,
  mainSha,
  plannedAt,
  aliasMap,
  readCanonicalSql,
} = {}) {
  const id = String(releaseId ?? '').trim();
  if (!RELEASE_ID.test(id)) fail('INVALID_RELEASE_ID', 'releaseId has an invalid shape');
  const sha = String(mainSha ?? '').trim().toLowerCase();
  if (!SHA.test(sha)) fail('INVALID_MAIN_SHA', 'mainSha must be an exact 40-character SHA');
  const normalizedPlannedAt = normalizePlannedAt(plannedAt);
  if (typeof readCanonicalSql !== 'function') fail('CANONICAL_READER_REQUIRED', 'readCanonicalSql is required');

  const names = pendingProductionMigrations(aliasMap);
  if (!names.length) fail('NO_PENDING_PRODUCTION_MIGRATIONS', 'alias map has no PENDING_APPLY migrations');

  const migrations = names.map((repoFile, index) => {
    const path = `supabase/migrations/${repoFile}.sql`;
    const sql = String(readCanonicalSql(path));
    if (!sql.trim()) fail('EMPTY_CANONICAL_MIGRATION', `${path} is empty`);
    return {
      repoFile,
      path,
      sha256: sha256(Buffer.from(sql)),
      riskTier: inferMigrationRiskTier(sql),
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

  const pending = pendingProductionMigrations(aliasMap);
  const names = (Array.isArray(plan.migrations) ? plan.migrations : []).map((entry) => normalizedRepoFile(entry?.repoFile));
  if (pending.join('\n') !== [...names].sort().join('\n')) {
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
    const inferred = inferMigrationRiskTier(sql);
    if (entry.riskTier !== inferred) fail('MIGRATION_RISK_MISMATCH', `${entry.repoFile} risk tier changed`);
    tiers.push(inferred);
  }
  if (plan.riskTier !== assertSingleRiskTier(tiers)) fail('RELEASE_RISK_MISMATCH', 'release risk tier does not match migration risk floor');
  return { status: 'PLAN_VERIFIED', planDigest: plan.planDigest, migrationCount: names.length, riskTier: plan.riskTier, databaseMutationAuthorized: false };
}
