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
  const backslashEscapes = quote === "'"
    && /[eE]/.test(input[start - 1] ?? '')
    && !/[\p{L}\p{N}_$]/u.test(input[start - 2] ?? '');
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
  const previous = input[index - 1] ?? '';
  if (previous && /[\p{L}\p{N}_$]/u.test(previous)) return '';
  return input.slice(index).match(/^\$[\p{ID_Start}_][\p{ID_Continue}_]*\$|^\$\$/u)?.[0] ?? '';
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



export function stripSqlStringLiterals(sql, nestedDollarBody = false) {
  const input = stripSqlComments(sql);
  let output = '';
  let index = 0;
  while (index < input.length) {
    const char = input[index];
    if (char === "'" || char === '"') {
      const end = quotedTokenEnd(input, index, char);
      output += ' '.repeat(end - index);
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
  if (!/^\s*create\s+(?:or\s+replace\s+)?(?:function|procedure)\b/i.test(lexical)) return input;

  for (const as of lexical.matchAll(/\bas\b/gi)) {
    let bodyStart = as.index + as[0].length;
    while (/\s/.test(lexical[bodyStart] ?? '')) bodyStart += 1;
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

const SAFE_IMMEDIATE_SQL_FUNCTIONS = new Set([
  'array_agg', 'array_length', 'array_to_string', 'btrim', 'coalesce', 'count',
  'date_part', 'date_trunc', 'format', 'gen_random_uuid', 'json_agg',
  'json_build_object', 'jsonb_agg', 'jsonb_build_object', 'length', 'least',
  'lower', 'now', 'pg_get_constraintdef', 'pg_get_expr',
  'pg_get_function_def', 'pg_get_function_identity_arguments', 'pg_get_functiondef',
  'pg_options_to_table', 'regexp_replace', 'round', 'string_agg', 'to_regclass',
  'to_regtype', 'unnest', 'upper',
]);

const SQL_PARENTHESES_WORDS = new Set([
  'all', 'and', 'any', 'as', 'case', 'check', 'exists', 'filter', 'from', 'group',
  'having', 'in', 'limit', 'not', 'offset', 'on', 'or', 'over', 'partition',
  'returning', 'select', 'some', 'using', 'values', 'when', 'where', 'with',
]);

function hasUnverifiedRoutineInvocation(text) {
  const candidates = String(text).matchAll(
    /\b(?:[A-Za-z_][\w$]*\s*\.\s*)?([A-Za-z_][\w$]*)\s*\(/gi,
  );
  for (const match of candidates) {
    const name = String(match[1]).toLowerCase();
    const qualified = /\./.test(match[0]);
    if (!qualified && (SAFE_IMMEDIATE_SQL_FUNCTIONS.has(name) || SQL_PARENTHESES_WORDS.has(name))) continue;
    return true;
  }
  return false;
}

function rejectImmediateRoutineInvocations(statements) {
  const checkCommandText = (text) => {
    const lexical = stripSqlStringLiterals(text, true);
    const commandSegments = [
      ...lexical.matchAll(/\b(?:select|perform)\b[\s\S]*?(?=;|$)/gi),
    ];
    return commandSegments.some((segment) => hasUnverifiedRoutineInvocation(segment[0]));
  };

  for (const statement of statements) {
    const immediateText = stripStoredRoutineBodies(statement).trim();
    const lexicalText = stripSqlStringLiterals(immediateText);
    const topLevelCall = /^\s*call\b/i.test(lexicalText);
    const topLevelSelectCall = /^\s*select\b/i.test(lexicalText) && checkCommandText(lexicalText);
    if (topLevelCall || topLevelSelectCall || checkCommandText(lexicalText)) {
      fail('UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED', 'immediate routine invocation is not admitted by the fail-closed classifier');
    }

    if (/^\s*do\b/i.test(lexicalText)) {
      const body = immediateProceduralBody(immediateText);
      if (body !== null && checkCommandText(body)) {
        fail('UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED', 'routine invocation inside an immediate procedural block is not admitted');
      }
    }
  }
}

function immediateProceduralBody(statement) {
  const input = String(statement);
  const match = input.match(/^\s*do\b/i);
  if (!match) return null;

  let index = match[0].length;
  const skipWhitespace = () => {
    while (/\s/.test(input[index] ?? '')) index += 1;
  };
  skipWhitespace();

  const language = input.slice(index).match(/^language\b/i);
  if (language) {
    index += language[0].length;
    skipWhitespace();
    while (index < input.length && !/\s/.test(input[index])) index += 1;
    skipWhitespace();
  }

  const extended = /[eE]/.test(input[index] ?? '') && input[index + 1] === "'";
  const quoteIndex = extended ? index + 1 : index;
  if (input[quoteIndex] === "'") {
    const end = quotedTokenEnd(input, quoteIndex, "'");
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

function firstDynamicSqlTemplate(fragment) {
  const input = String(fragment).trim();
  let index = 0;
  const skipWhitespace = () => {
    while (/\s/.test(input[index] ?? '')) index += 1;
  };
  while (input[index] === '(') {
    index += 1;
    skipWhitespace();
  }

  const format = input.slice(index).match(/^format\s*\(/i);
  if (format) {
    const formatOpenIndex = index + format[0].lastIndexOf('(');
    index += format[0].length;
    skipWhitespace();

    const extended = /[eE]/.test(input[index] ?? '') && input[index + 1] === "'";
    const quoteIndex = extended ? index + 1 : index;
    if (input[quoteIndex] === "'") {
      const end = quotedTokenEnd(input, quoteIndex, "'");
      const formatEnd = matchingParenthesisEnd(input, formatOpenIndex);
      if (input.slice(formatEnd).trim()) {
        fail('UNSUPPORTED_DYNAMIC_SQL_NOT_ADMITTED', 'dynamic SQL format expression has unconsumed trailing syntax');
      }
      const rawTemplate = input.slice(quoteIndex + 1, end - 1);
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
      if (input.slice(formatEnd).trim()) {
        fail('UNSUPPORTED_DYNAMIC_SQL_NOT_ADMITTED', 'dynamic SQL format expression has unconsumed trailing syntax');
      }
      return input.slice(index + dollar.length, end);
    }
    return '';
  }

  const extended = /[eE]/.test(input[index] ?? '') && input[index + 1] === "'";
  const quoteIndex = extended ? index + 1 : index;
  if (input[quoteIndex] === "'") {
    const end = quotedTokenEnd(input, quoteIndex, "'");
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
    for (const match of lexicalStatement.matchAll(/\bexecute\b/gi)) {
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
  const formatCall = /^\s*\(*\s*format\s*\(/i.test(fragment);
  const templateStatements = splitSqlStatements(template);
  const boundedConstraintRepair = /^alter\s+table\b[\s\S]*\bdrop\s+constraint\b/i.test(lexicalTemplate)
    && formatPlaceholdersAreBounded(template)
    && templateStatements.length === 1;
  if (boundedConstraintRepair) return 'SCHEMA_REPAIR';
  if (/\bdrop\b|\btruncate\b|\balter\s+table\b[\s\S]*\bdrop\b/i.test(fragment)) {
    fail('DESTRUCTIVE_SQL_NOT_ADMITTED', 'dynamic SQL may execute an unbounded destructive command');
  }
  if (templateStatements.length !== 1) {
    fail('UNSUPPORTED_DYNAMIC_SQL_NOT_ADMITTED', 'dynamic SQL must contain exactly one statically bounded statement');
  }
  if (formatCall) {
    fail('UNSUPPORTED_DYNAMIC_SQL_NOT_ADMITTED', 'dynamic format SQL is not admitted unless it is a bounded constraint repair');
  }
  if (!/^(?:update\b|delete\s+from\b|insert\s+into\b|merge\s+into\b)/i.test(lexicalTemplate)) {
    fail('UNSUPPORTED_DYNAMIC_SQL_NOT_ADMITTED', 'dynamic SQL must be a statically bounded DML template');
  }
  return 'BACKFILL';
}

function assertDynamicExecutionSafe(body) {
  const lexicalBody = stripSqlStringLiterals(body, true);
  if (/\bexecute\b[\s\S]*\|\|/i.test(lexicalBody)) {
    fail('UNSUPPORTED_DYNAMIC_SQL_NOT_ADMITTED', 'concatenated dynamic SQL is not admitted');
  }
  return dynamicExecuteFragments(body).map(dynamicCommandKind);
}

function hasImmediateBackfillDml(text) {
  return splitSqlStatements(text).some((statement) => {
    const immediateText = stripStoredRoutineBodies(statement).trim();
    const lexicalText = stripSqlStringLiterals(immediateText);
    const procedural = /^do\b/i.test(lexicalText);
    const body = procedural ? immediateProceduralBody(immediateText) : null;
    if (procedural && body === null) {
      fail('UNSUPPORTED_SQL_LEXICAL_FORM', 'unrecognized DO body form is not admitted');
    }
    const executableBody = body === null ? '' : stripSqlStringLiterals(body, true);
    const directDml = /^(?:update\b|delete\s+from\b|insert\s+into\b|merge\s+into\b)/i.test(lexicalText);
    const explainedDml = /^explain\b[\s\S]*\b(?:update|delete\s+from|insert\s+into|merge\s+into)\b/i.test(lexicalText);
    const compoundDml = /^(?:with\b|do\b)[\s\S]*\b(?:update|delete\s+from|insert\s+into|merge\s+into)\b/i.test(lexicalText);
    const proceduralDml = body !== null && /\b(?:update|delete\s+from|insert\s+into|merge\s+into)\b/i.test(executableBody);
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
    if (/^\s*create\s+(?:or\s+replace\s+)?(?:function|procedure)\b/i.test(lexical)
      && /\bas\s+(?:[eE]|[uU]&)?\s*'/i.test(statement)) {
      fail('UNSUPPORTED_SQL_LEXICAL_FORM', 'single-quoted routine bodies are not admitted by the fail-closed classifier');
    }
  }
}

function rejectUnclassifiedDropStatements(text) {
  const fragments = splitSqlStatements(text)
    .map((fragment) => stripStoredRoutineBodies(stripSqlStringLiterals(fragment)))
    .filter((fragment) => /\bdrop\b/i.test(fragment));
  for (const fragment of fragments) {
    const drops = [...fragment.matchAll(/\bdrop\s+(?:if\s+exists\s+)?([A-Za-z_][\w$]*)/gi)];
    if (!drops.length) fail('UNCLASSIFIED_DROP_NOT_ADMITTED', 'DROP target could not be lexically identified');
    for (const match of drops) {
      const objectType = String(match[1]).toLowerCase();
      if (!new Set(['table', 'schema', 'policy', 'constraint', 'default', 'column']).has(objectType)) {
        fail('UNCLASSIFIED_DROP_NOT_ADMITTED', `unrecognized DROP form: ${objectType}`);
      }
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

export function inferMigrationRiskTier(sql) {
  const text = stripSqlComments(sql);

  // v1 絕不放行會直接刪掉資料容器或欄位的操作。constraint/default 的暫時移除
  // 則不是同一件事：例如 0109 在已知漂移環境中，會先拿掉舊 CHECK/default、
  // 把欄位型別修回 canonical enum，再於同一 transaction 重建正確約束。
  const statements = splitSqlStatements(text);
  rejectUnsupportedRoutineLiteralBodies(statements);
  rejectImmediateRoutineInvocations(statements);
  if (statements.some((statement) => /\btruncate\b|\bdrop\s+(?:table|schema)\b|\balter\s+table\b[\s\S]*\bdrop(?:\s+column)?\s+(?:if\s+exists\s+)?(?!constraint\b|default\b)/i.test(statement))) {
    fail('DESTRUCTIVE_SQL_NOT_ADMITTED', 'DROP TABLE/SCHEMA/COLUMN and TRUNCATE must use expand → migrate → contract outside v1');
  }
  rejectUnclassifiedDropStatements(text);

  const specialized = [];
  if (statements.some((statement) => /\balter\s+table\b[\s\S]*\bdrop\s+constraint\b|\balter\s+table\b[\s\S]*\balter\s+column\b[\s\S]*\bdrop\s+default\b|\balter\s+table\b[\s\S]*\balter\s+column\b[\s\S]*\btype\b/i.test(statement))) {
    specialized.push('SCHEMA_REPAIR');
  }
  if (statements.some((statement) => /\b(create|alter|drop)\s+policy\b|\b(?:enable|disable|force|no force)\s+row\s+level\s+security\b|\bgrant\b|\brevoke\b|\bsecurity\s+(definer|invoker)\b|\b(?:auth\.|tenant_role|is_tenant_member)\b|\breassign\s+owned\b|\balter\s+group\b[\s\S]*\b(?:add|drop)\s+user\b|\b(?:alter|create)\s+(?:role|user|group)\b|\b(?:alter|create)\s+(?:role|user)\b[\s\S]*\b(?:bypassrls|nobypassrls|superuser|nosuperuser|createrole|nocreaterole|createdb|nocreatedb|replication|noreplication|inherit|noinherit|login|nologin)\b|\b(?:alter\s+(?:table|schema|sequence|view|materialized\s+view|function|procedure|routine|type|domain|foreign\s+table)|create\s+(?:table|schema|sequence|view|materialized\s+view|function|procedure|type))\b[\s\S]*\bowner\s+to\b|\b(?:create|alter)\s+(?:or\s+replace\s+)?(?:view|materialized\s+view)\b[\s\S]*\bsecurity_(?:invoker|barrier)\b|\bcreate\s+schema\b[\s\S]*\bauthorization\b|\bset\s+(?:(?:local|session)\s+)?(?:"role"|role)(?![\p{L}\p{N}_$])|\breset\s+role\b|\bset\s+(?:(?:local|session)\s+)?authorization\b|\balter\s+default\s+privileges\b/i.test(statement))) {
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
