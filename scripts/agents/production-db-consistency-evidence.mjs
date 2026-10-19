import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { normalizeProductionDbImpactManifest } from './production-db-impact-manifest.mjs';
import { ISSUE_23_0113, ISSUE_749_0137, ISSUE_46_0110_0136_CLOSURE, ISSUE_755_0110_0137_CLOSURE, SCOPED_RELEASE_CAPTURE_SCOPES, splitSqlStatements, stripSqlComments, stripSqlStringLiterals,
  verifyProductionDbReleasePlan } from './production-db-release-plan.mjs';
import { buildObserverSnapshotFromRaw, normalizeObserverSnapshot, RELEASE_CATALOG_QUERY_DIGEST,
  compareObserverSnapshots } from './schema-drift-watch.mjs';
import { sha256, stableStringify, EXPECTED_PROJECT_REFS } from './schema-truth-evidence.mjs';

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

function signature(item) {
  return createHash('sha256').update(JSON.stringify([
    item?.surface ?? '', item?.objectKey ?? '', item?.expectedFingerprint ?? '', item?.observedFingerprint ?? null,
  ])).digest('hex');
}

function impactManifestDigest(manifest) {
  const normalized = normalizeProductionDbImpactManifest(manifest);
  const entries = normalized.entries
    .map((entry) => ({
      repoFile: entry.repoFile,
      impacts: [...entry.impacts].sort((a, b) => `${a.surface}:${a.objectKey}`.localeCompare(`${b.surface}:${b.objectKey}`)),
    }))
    .sort((a, b) => a.repoFile.localeCompare(b.repoFile));
  return createHash('sha256').update(JSON.stringify({ schemaVersion: 1, entries })).digest('hex');
}

function plannedProductionDifferences({ report, plan, impactManifest }) {
  if (!plan || !Array.isArray(plan.migrations) || plan.migrations.length === 0) fail('CONSISTENCY_PLAN_REQUIRED', 'release plan migrations are required');
  const normalized = normalizeProductionDbImpactManifest(impactManifest);
  const byFile = new Map(normalized.entries.map((entry) => [entry.repoFile, entry]));
  const allowed = new Map();
  const plannedLedger = new Map();

  for (const migration of plan.migrations) {
    const repoFile = String(migration?.repoFile ?? '').trim();
    const entry = byFile.get(repoFile);
    if (!entry) fail('MISSING_IMPACT_MANIFEST_ENTRY', `${repoFile || '<unknown>'} has no impact manifest entry`);
    // The observer hashes canonical ledger identities with sorted keys. Ledger
    // omissions belong to the selected plan, not the schema impact surfaces.
    const version = repoFile.slice(0, 4);
    plannedLedger.set(`${version}/${repoFile}`, createHash('sha256')
      .update(JSON.stringify({ name: repoFile, version })).digest('hex'));
    for (const impact of entry.impacts) {
      const key = `${impact.surface}:${impact.objectKey}`;
      const owner = allowed.get(key);
      if (owner && owner !== repoFile) fail('AMBIGUOUS_IMPACT_OWNERSHIP', `${key} belongs to multiple migrations`);
      allowed.set(key, repoFile);
    }
  }

  const pending = (report.differences ?? []).filter(
    (item) => item.environment === 'PRODUCTION' && item.classification === 'EXPECTED_PENDING_PRODUCTION',
  );
  for (const item of pending) {
    if (item.surface === 'migrationLedger'
      && plannedLedger.has(item.objectKey)
      && item.expectedFingerprint === plannedLedger.get(item.objectKey)
      && item.observedFingerprint === null) continue;
    const key = `${item.surface}:${item.objectKey}`;
    if (!allowed.has(key)) fail('UNPLANNED_PRODUCTION_DIFF', `${key} is outside this release impact manifest`);
  }
  return pending;
}

export function buildProductionConsistencyEvidence({ report, plan, impactManifest, mainSha, planDigest, releaseCatalog = null, observedMainSha = mainSha, ...options }) {
  // observedMainSha (current main) differs from the plan main only when the trusted workflow binding
  // carries migrationsUnchangedSincePlan; assemble derives it, callers cannot loosen the default.
  if (!report || report.observedMainSha !== observedMainSha) fail('CONSISTENCY_MAIN_MISMATCH', 'drift report is not for the selected main SHA');
  if (!plan || plan.mainSha !== mainSha || plan.planDigest !== planDigest) fail('CONSISTENCY_PLAN_MISMATCH', 'release plan is not the selected main SHA / plan digest');
  if (report.plannedLedgerMapping && report.plannedLedgerMapping.planDigest !== planDigest) fail('CONSISTENCY_LEDGER_PLAN_MISMATCH', 'ledger mapping belongs to another release plan');
  if (report.safety?.authorizesDatabaseWrite !== false) fail('OBSERVER_SCOPE_ESCALATION', 'drift observer must stay read-only');
  if ([ISSUE_46_0110_0136_CLOSURE, ISSUE_755_0110_0137_CLOSURE, ISSUE_23_0113, ISSUE_749_0137].includes(plan.migrationScope)
    || (plan.migrations?.length === 8 && plan.migrations.some((item) => item.repoFile === '0136_issue_755_create_tour_order_invoker'))) {
    return buildOriginalEightConsistency({ report, plan, impactManifest, mainSha, observedMainSha, planDigest, releaseCatalog, ...options });
  }
  if (report.status === 'DRIFT_BLOCKED' || report.status === 'EVIDENCE_UNAVAILABLE') fail('DRIFT_BLOCKED', `drift report status is ${report.status}`);
  if ((report.exceptionSummary?.expired ?? 0) > 0 || (report.exceptionSummary?.unmatched ?? 0) > 0) fail('STALE_DRIFT_EXCEPTION', 'drift exceptions must be active and matched');

  const testStatus = report.environmentStatuses?.TEST;
  if (!['MATCH', 'INTENTIONAL_DIFFERENCE'].includes(testStatus)) fail('TEST_SCHEMA_NOT_READY', `TEST status is ${testStatus ?? 'UNKNOWN'}`);
  const productionStatus = report.environmentStatuses?.PRODUCTION;
  if (!['MATCH', 'EXPECTED_PENDING_PRODUCTION', 'INTENTIONAL_DIFFERENCE'].includes(productionStatus)) fail('PRODUCTION_SCHEMA_UNEXPLAINED', `Production status is ${productionStatus ?? 'UNKNOWN'}`);

  const planned = plannedProductionDifferences({ report, plan, impactManifest });
  const plannedSignatures = new Set(planned.map(signature));
  const pending = (report.differences ?? []).filter((item) => item.environment === 'PRODUCTION' && item.classification === 'EXPECTED_PENDING_PRODUCTION');
  const intentional = (report.differences ?? []).filter((item) => item.classification === 'INTENTIONAL_DIFFERENCE');
  if (intentional.some((item) => !item.exception?.issue || !item.exception?.expiresAt)) fail('UNBOUND_INTENTIONAL_DIFFERENCE', 'intentional difference lacks durable exception evidence');
  if (pending.some((item) => !plannedSignatures.has(signature(item)))) fail('UNPLANNED_PRODUCTION_DIFF', 'Production has a pending difference outside this release plan');

  const observed = [report.environments?.TEST?.observedAt, report.environments?.PRODUCTION?.observedAt]
    .map((value) => Date.parse(String(value ?? ''))).filter(Number.isFinite);
  if (observed.length !== 2) fail('MISSING_OBSERVED_AT', 'TEST and Production observedAt are required');

  return {
    status: 'CONSISTENCY_VERIFIED', mainSha, planDigest,
    impactManifestDigest: impactManifestDigest(impactManifest),
    observedAt: new Date(Math.min(...observed)).toISOString(),
    plannedProductionDifferenceCount: pending.length,
    intentionalDifferenceCount: intentional.length,
    unexplainedDifferences: 0,
    databaseMutationAuthorized: false,
  };
}

const OWNER = 'production_migration_owner';
const WRITER = 'production_migration_writer';
const APP_ROLES = ['anon', 'authenticated', 'service_role'];
const compareJson = (a, b) => stableStringify(a) === stableStringify(b);
const sqlWords = (value) => stripSqlStringLiterals(stripSqlComments(value), true).toLowerCase();
const compactSql = (value) => stripSqlComments(value).replace(/\s+/g, ' ').trim().toLowerCase();
const routineKey = (routine) => `${routine.name}(${routine.args})`;
const digestJson = (value) => sha256(stableStringify(value));

function sourceRoutines(sql, path) {
  const result = [];
  for (const statement of splitSqlStatements(sql)) {
    const clean = stripSqlComments(statement);
    const head = /^\s*create\s+(?:or\s+replace\s+)?function\s+((?:public\.)?[a-z_][a-z_0-9]*)\s*\(([\s\S]*?)\)\s*returns\b/i.exec(clean);
    if (!head) continue;
    const tag = /\bas\s+(\$(?:[a-z_][a-z_0-9]*)?\$)/i.exec(clean);
    if (!tag) fail('UNSUPPORTED_ROUTINE_SOURCE', `${path} is not a literal dollar-quoted routine`);
    const start = tag.index + tag[0].length;
    const end = clean.indexOf(tag[1], start);
    if (end < 0) fail('UNSUPPORTED_ROUTINE_SOURCE', `${path} has no closing body delimiter`);
    // Extract from original statement: comments in a stored body are part of
    // prosrc. Only leading SQL comments may be removed for identifying CREATE.
    const originalTag = new RegExp(`\\bas\\s+${tag[1].replace(/\$/g, '\\$')}`, 'i').exec(statement);
    const bodyStart = originalTag.index + originalTag[0].length;
    const bodyEnd = statement.indexOf(tag[1], bodyStart);
    const outside = `${clean.slice(0, tag.index)} ${clean.slice(end + tag[1].length)}`;
    const search = /\bset\s+search_path\s*(?:=|to)\s*([^;\n]+?)(?=\s+(?:as|language|security|stable|volatile|immutable)\b|[;\n]|\s*$)/i.exec(outside);
    const returns = /\breturns\s+([\s\S]*?)(?=\s+(?:language|security|stable|volatile|immutable|strict|leakproof|parallel|called|set)\b|\s*$)/i.exec(outside);
    const language = /\blanguage\s+([a-z_0-9]+)/i.exec(outside)?.[1].toLowerCase();
    if (!returns || !language) fail('UNSUPPORTED_ROUTINE_SOURCE', `${path} has no literal return/language contract`);
    const args = head[2].replace(/\s+default\s+[^,]+/gi, '').replace(/\bpublic\./gi, '').replace(/\btimestamptz\b/gi, 'timestamp with time zone')
      .replace(/\bint\b/gi, 'integer').replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();
    result.push({ name: head[1].includes('.') ? head[1] : `public.${head[1]}`, args,
      argumentDeclaration: head[2].replace(/\bpublic\./gi, '').replace(/\btimestamptz\b/gi, 'timestamp with time zone')
        .replace(/\bint\b/gi, 'integer').replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim(),
      body: statement.slice(bodyStart, bodyEnd), securityDefiner: /\bsecurity\s+definer\b/i.test(outside),
      returnType: compactSql(returns[1]).replace(/\bpublic\./g, ''), language,
      strict: /\bstrict\b|\breturns\s+null\s+on\s+null\s+input\b/i.test(outside),
      leakproof: /\bleakproof\b/i.test(outside.replace(/\bnot\s+leakproof\b/gi, '')),
      parallel: /\bparallel\s+(unsafe|restricted|safe)\b/i.exec(outside)?.[1].toLowerCase() ?? 'unsafe',
      unsupportedHeader: /\b(?:cost|rows|support|window|transform)\b/i.test(sqlWords(outside)),
      volatility: /\bimmutable\b/i.test(outside) ? 'i' : /\bstable\b/i.test(outside) ? 's' : 'v',
      config: search ? [`search_path=${search[1].replace(/["']/g, '').replace(/\s*,\s*/g, ', ').trim()}`] : null,
      source: { path, sha256: sha256(sql) } });
  }
  return result;
}

function captureFor(capture, environment, { mainSha, now, report }) {
  if (!capture || capture.schemaVersion !== 1 || capture.environment !== environment
    || capture.projectRef !== (environment === 'LOCAL_EXPECTED' ? 'local-fresh' : EXPECTED_PROJECT_REFS[environment])
    || capture.mainSha !== mainSha || capture.queryDigest !== RELEASE_CATALOG_QUERY_DIGEST
    || capture.readOnly !== true || capture.databaseMutationAuthorized !== false) {
    fail('RELEASE_CATALOG_BINDING_INVALID', `${environment} raw catalog/query/project/main binding is invalid`);
  }
  const { captureDigest, ...core } = capture;
  if (captureDigest !== digestJson(core)) fail('RELEASE_CATALOG_HASH_MISMATCH', `${environment} catalog bytes changed`);
  const observed = Date.parse(capture.observedAt), current = Date.parse(now);
  if (!Number.isFinite(observed) || !Number.isFinite(current) || observed > current || current - observed > 15 * 60_000) {
    fail('RELEASE_CATALOG_STALE', `${environment} capture must be no more than 15 minutes old and not future`);
  }
  const snapshot = buildObserverSnapshotFromRaw({ environment, projectRef: capture.projectRef, observedAt: capture.observedAt,
    observedMainSha: mainSha, evidenceRef: environment === 'LOCAL_EXPECTED' ? 'local:fresh-install' : `supabase:${environment.toLowerCase()}/schema-observer`, raw: capture.raw });
  normalizeObserverSnapshot(snapshot, mainSha);
  if (snapshot.captureDigest.value !== capture.snapshotCaptureDigest) fail('RELEASE_RAW_CAPTURE_MISMATCH', `${environment} raw values are not the normalized capture`);
  const summary = report.environments?.[environment === 'LOCAL_EXPECTED' ? 'expected' : environment];
  if (summary?.captureDigest?.value !== snapshot.captureDigest.value) fail('RELEASE_REPORT_CAPTURE_MISMATCH', `${environment} report belongs to another capture`);
  const catalog = capture.catalog;
  for (const field of ['routines', 'foreignKeys', 'enums', 'roles', 'memberships', 'tableOwners', 'defaults']) {
    if (!Array.isArray(catalog?.[field])) fail('RELEASE_CATALOG_SURFACE_MISSING', `${environment}.${field} was not captured`);
  }
  if (!/^[a-f0-9]{64}$/.test(catalog.catalogFingerprint ?? '')) fail('RELEASE_CATALOG_FINGERPRINT_MISSING', `${environment} G6 catalog fingerprint was not captured`);
  return { ...capture, snapshot };
}

function effectivePrivileges(item, catalog, role) {
  const roles = new Map(catalog.roles.map((entry) => [entry.name, entry]));
  const inherited = new Set(['public', role]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of catalog.memberships) {
      if (inherited.has(edge.member) && roles.get(edge.member)?.inherit && edge.inherit && !inherited.has(edge.parent)) {
        inherited.add(edge.parent); changed = true;
      }
    }
  }
  return [...new Set((item?.privileges ?? []).filter((entry) => inherited.has(entry.grantee))
    .map((entry) => `${entry.privilege}:${entry.grantable}`))].sort();
}

function checkDedicatedRoles(catalog) {
  const role = (name) => catalog.roles.filter((entry) => entry.name === name);
  for (const name of [OWNER, WRITER]) {
    const records = role(name);
    if (records.length !== 1 || records[0].superuser || records[0].bypassRls || records[0].inherit
      || records[0].createRole || records[0].createDb || records[0].login !== (name === WRITER)) {
      fail('RELEASE_OWNER_CAPABILITY_INVALID', `${name} is not the dedicated bounded role`);
    }
  }
  const writer = catalog.memberships.filter((edge) => edge.member === WRITER);
  if (writer.length !== 1 || writer[0].parent !== OWNER || writer[0].admin || writer[0].inherit || writer[0].set !== true
    || catalog.memberships.some((edge) => edge.member === OWNER
      || (edge.parent === OWNER && !['postgres', WRITER].includes(edge.member)))) {
    fail('RELEASE_OWNER_MEMBERSHIP_INVALID', 'writer/owner membership exposes an unexpected capability');
  }
  for (const name of APP_ROLES) {
    const record = role(name);
    if (record.length !== 1 || record[0].superuser || record[0].createRole || record[0].createDb
      || (name !== 'service_role' && record[0].bypassRls)) fail('RELEASE_APP_ROLE_INVALID', `${name} is privileged unexpectedly`);
    const reachable = new Set([name]);
    for (let count = 0; count <= catalog.roles.length; count++) {
      for (const edge of catalog.memberships) if (reachable.has(edge.member) && (edge.set || edge.inherit)) reachable.add(edge.parent);
    }
    if ([...reachable].some((parent) => [OWNER, WRITER].includes(parent) || (parent !== 'service_role' && role(parent)[0]?.bypassRls)
      || role(parent)[0]?.superuser)) fail('RELEASE_APP_OWNER_BYPASS', `${name} can reach a privileged role`);
  }
}

function policyContract(items) {
  const contract = {};
  for (const item of items) {
    const [permissive, command, roles, using, check] = item.value.split('|');
    if (permissive !== 'true') fail('UNSUPPORTED_RLS_COMPATIBILITY', 'restrictive RLS must match exactly');
    for (const operation of command === '*' ? ['r', 'a', 'w', 'd'] : [command]) {
      const key = `${operation}:${roles}`;
      if (contract[key]) fail('UNSUPPORTED_RLS_COMPATIBILITY', 'multiple permissive policies need exact source review');
      contract[key] = { using: ['a'].includes(operation) ? '' : compactSql(using),
        check: ['a', 'w'].includes(operation) ? compactSql(check || using) : '' };
    }
  }
  return contract;
}

function sourceCatalog({ plan, repoRoot, readCanonicalSql, appliedSourceFiles = [] }) {
  const sources = new Map();
  const applied = new Set(appliedSourceFiles);
  const selected = new Set(plan.migrations.map((entry) => entry.repoFile));
  const files = readdirSync(resolve(repoRoot, 'supabase/migrations')).filter((name) => /^\d{4}_.*\.sql$/.test(name));
  const read = (path) => {
    if (!sources.has(path)) sources.set(path, String(readCanonicalSql(path)));
    return sources.get(path);
  };
  const before = new Map(), after = new Map(), enums = new Map();
  for (const file of files.sort()) {
    const identity = file.slice(0, -4);
    if (file.slice(0, 4) >= '0110' && !selected.has(identity) && !applied.has(identity)) continue;
    const path = `supabase/migrations/${file}`;
    const enumSql = stripSqlComments(read(path)).replace(/\bexecute\s+'((?:''|[^'])*)'\s*;/gi,
      (_statement, literal) => `${literal.replace(/''/g, "'")};`);
    for (const match of enumSql.matchAll(/\bcreate\s+type\s+(?:public\.)?([a-z_0-9]+)\s+as\s+enum\s*\(([^)]+)\)/gi)) {
      if (!enums.has(match[1])) enums.set(match[1], [...match[2].matchAll(/'((?:''|[^'])*)'/g)].map((literal) => literal[1].replace(/''/g, "'")));
    }
    for (const match of enumSql.matchAll(/\balter\s+type\s+(?:public\.)?([a-z_0-9]+)\s+add\s+value\s+(?:if\s+not\s+exists\s+)?'([^']+)'(?:\s+(before|after)\s+'([^']+)')?/gi)) {
      const labels = enums.get(match[1]);
      if (!labels) continue;
      if (labels.includes(match[2])) continue;
      if (!match[3]) labels.push(match[2]);
      else {
        const index = labels.indexOf(match[4]);
        if (index < 0) fail('RELEASE_ENUM_SOURCE_UNSUPPORTED', `${path} references an unknown enum label`);
        labels.splice(index + (match[3].toLowerCase() === 'after' ? 1 : 0), 0, match[2]);
      }
    }
    for (const routine of sourceRoutines(read(path), path)) {
      if (!selected.has(identity)) before.set(routineKey(routine), routine);
      after.set(routineKey(routine), routine);
    }
    for (const statement of splitSqlStatements(read(path))) {
      const alter = /^\s*alter\s+function\s+((?:public\.)?[a-z_][a-z_0-9]*)\s*\([\s\S]*?\)\s+security\s+(invoker|definer)\s*;?\s*$/i.exec(stripSqlComments(statement));
      if (!alter) continue;
      const name = alter[1].includes('.') ? alter[1] : `public.${alter[1]}`;
      const matches = [...after].filter(([, routine]) => routine.name === name);
      if (matches.length !== 1) fail('AMBIGUOUS_ROUTINE_ALTER', `${path} needs exact routine signature binding`);
      const [key, routine] = matches[0];
      const altered = { ...routine, securityDefiner: alter[2].toLowerCase() === 'definer',
        alterSource: { path, sha256: sha256(read(path)) } };
      after.set(key, altered);
      // 已套用的 source 沒有計畫中的轉換：before 與 after 必須相同。
      if (applied.has(identity)) before.set(key, altered);
    }
  }
  // The Production before contract is the canonical0087 create/cancel and0100
  // expire body, not whichever later main definition happens to be current.
  for (const prefix of applied.size ? [] : ['0087_', '0100_']) {
    const matches = files.filter((name) => name.startsWith(prefix));
    if (matches.length !== 1) fail('BEFORE_SOURCE_REQUIRED', `${prefix} canonical source is ambiguous`);
    const path = `supabase/migrations/${matches[0]}`;
    for (const routine of sourceRoutines(read(path), path)) if (['public.create_tour_order', 'public.cancel_tour_order', 'public.expire_tour_order'].includes(routine.name)) before.set(routineKey(routine), routine);
  }
  return { before, after, enums, sources, read };
}

function deriveClosure({ source, captures, impactManifest, plan, createTourOrderFamily = true }) {
  const knownTables = new Set();
  for (const sql of source.sources.values()) for (const match of stripSqlComments(sql).matchAll(/\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?((?:public\.)?[a-z_][a-z_0-9]*)/gi)) {
    knownTables.add(match[1].includes('.') ? match[1] : `public.${match[1]}`);
  }
  const roots = new Set(), routines = new Set(), bodies = [];
  for (const migration of plan.migrations) {
    for (const routine of sourceRoutines(source.read(migration.path), migration.path)) routines.add(routineKey(routine));
  }
  // 0136 changes an existing routine, whose original dependency body is also
  // checked. Source maps have exact signatures, not caller supplied closures.
  for (const map of createTourOrderFamily ? [source.before, source.after] : []) for (const [key, routine] of map) {
    if (['public.create_tour_order', 'public.cancel_tour_order', 'public.expire_tour_order'].includes(routine.name)) routines.add(key);
  }
  const selected = new Set(plan.migrations.map((item) => item.repoFile));
  const plannedTriggers = new Set();
  for (const entry of normalizeProductionDbImpactManifest(impactManifest).entries) if (selected.has(entry.repoFile)) {
    for (const impact of entry.impacts) {
      if (impact.surface === 'triggers') plannedTriggers.add(impact.objectKey);
      const match = /^(?:table:)?(public\.[a-z_0-9]+)(?:\.|$)/i.exec(impact.objectKey);
      if (match && knownTables.has(match[1])) roots.add(match[1]);
    }
  }
  const policies = captures.LOCAL_EXPECTED.raw.metadata.items.filter((item) => item.surface === 'policies');
  let changed = true;
  while (changed) {
    changed = false;
    const texts = [];
    for (const key of routines) {
      for (const map of [source.before, source.after]) {
        const routine = map.get(key);
        if (routine) texts.push(routine.body);
      }
    }
    texts.push(...policies.filter((item) => roots.has(item.key.split('.').slice(0, 2).join('.'))).map((item) => item.value));
    texts.push(...captures.LOCAL_EXPECTED.raw.metadata.items.filter((item) => item.surface === 'triggers'
      && plannedTriggers.has(item.key)).map((item) => item.value));
    for (const text of texts) {
      const code = sqlWords(text);
      for (const match of code.matchAll(/\b(?:from|join|update|into|delete\s+from)\s+((?:public\.)?[a-z_][a-z_0-9]*)(?![a-z_0-9])/gi)) {
        const table = match[1].includes('.') ? match[1] : `public.${match[1]}`;
        if (match[1].startsWith('public.') && !knownTables.has(table)) fail('RELEASE_UNSOURCED_DEPENDENCY', `${table} has no canonical table source`);
        if (knownTables.has(table) && !roots.has(table)) { roots.add(table); changed = true; }
      }
      for (const [key, routine] of source.after) {
        const name = routine.name.split('.')[1];
        if (new RegExp(`(?:\\bpublic\\.|\\b)${name}\\s*\\(`, 'i').test(code) && !routines.has(key)) { routines.add(key); changed = true; }
      }
    }
    for (const capture of Object.values(captures)) for (const fk of capture.catalog.foreignKeys) {
      if (roots.has(fk.table) && !roots.has(fk.target)) { roots.add(fk.target); changed = true; }
    }
  }
  for (const key of routines) for (const map of [source.before, source.after]) if (map.has(key)) bodies.push(map.get(key).body);
  const code = bodies.map(sqlWords).join('\n');
  const operations = new Map();
  const write = (table) => {
    const name = table.includes('.') ? table : `public.${table}`;
    if (!operations.has(name)) operations.set(name, { insert: new Set(), update: new Set(), delete: false });
    return operations.get(name);
  };
  for (const match of code.matchAll(/\binsert\s+into\s+((?:public\.)?[a-z_][a-z_0-9]*)\s*\(([^)]+)\)/gi)) {
    for (const column of match[2].split(',').map((item) => item.trim())) write(match[1]).insert.add(column);
  }
  for (const match of code.matchAll(/\bupdate\s+((?:public\.)?[a-z_][a-z_0-9]*)(?:\s+[a-z_][a-z_0-9]*)?\s+set\s+([\s\S]*?)(?=\bwhere\b|\breturning\b|;)/gi)) {
    for (const column of match[2].matchAll(/(?:^|,)\s*([a-z_][a-z_0-9]*)\s*=/gi)) write(match[1]).update.add(column[1]);
  }
  for (const match of code.matchAll(/\bdelete\s+from\s+((?:public\.)?[a-z_][a-z_0-9]*)/gi)) write(match[1]).delete = true;
  for (const capture of Object.values(captures)) for (const fk of capture.catalog.foreignKeys) {
    if (operations.get(fk.target)?.delete && !roots.has(fk.table)) fail('RELEASE_DELETE_DEPENDENCY_UNEXPLAINED', `${fk.table} has an inbound FK to selected DELETE target ${fk.target}`);
  }
  return { tables: roots, routines, code, operations };
}

function assertRoutine(capture, contract, key) {
  const matches = capture.catalog.routines.filter((routine) => routineKey(routine) === key);
  if (matches.length !== 1) fail('RELEASE_ROUTINE_CAPTURE_REQUIRED', `${capture.environment}: ${key} is missing or ambiguous`);
  const routine = matches[0];
  const definition = sourceRoutines(routine.definition, 'observed-catalog').find((entry) => routineKey(entry) === key);
  if (definition?.unsupportedHeader || contract?.unsupportedHeader) fail('RELEASE_ROUTINE_HEADER_UNSUPPORTED', `${key} has an unbound header clause`);
  if (!definition || definition.body !== routine.body || definition.securityDefiner !== routine.securityDefiner
    || definition.volatility !== routine.volatility || !compareJson(definition.config, routine.config)) {
    fail('RELEASE_ROUTINE_CAPTURE_INCONSISTENT', `${key} prosrc/header differ from its fingerprinted pg_get_functiondef`);
  }
  if (routine.body.trim() !== contract.body.trim() || routine.securityDefiner !== contract.securityDefiner
    || routine.volatility !== contract.volatility || !compareJson(routine.config, contract.config)
    || definition.returnType !== contract.returnType || definition.language !== contract.language
    || definition.strict !== contract.strict || definition.leakproof !== contract.leakproof || definition.parallel !== contract.parallel
    || definition.argumentDeclaration !== contract.argumentDeclaration) {
    fail('RELEASE_ROUTINE_SOURCE_MISMATCH', `${capture.environment}: ${key} is not ${contract.source.path}`);
  }
  if (routine.owner !== 'postgres' && routine.owner !== OWNER) fail('RELEASE_ROUTINE_OWNER_INVALID', `${key} has an unexpected owner`);
  const metadata = capture.raw.metadata.items.filter((item) => item.surface === 'routines' && item.key === key);
  const md5 = createHash('md5').update(routine.definition).digest('hex');
  const value = `f|${routine.volatility}|${routine.securityDefiner}|${(routine.config ?? []).join(',')}|${md5}`;
  if (metadata.length !== 1 || metadata[0].value !== value) fail('RELEASE_ROUTINE_FINGERPRINT_MISMATCH', `${key} details are not the observed fingerprint`);
  const acl = capture.raw.acl.functions.filter((item) => `public.${item.name}(${item.identityArguments})` === key);
  if (acl.length !== 1 || acl[0].securityDefiner !== routine.securityDefiner || acl[0].owner !== routine.owner) fail('RELEASE_ROUTINE_ACL_MISMATCH', `${key} ACL/source capture differs`);
  return routine;
}
function routineHeader(routine) {
  const tag = /\bas\s+\$(?:[a-z_][a-z_0-9]*)?\$/i.exec(routine.definition);
  if (!tag) fail('RELEASE_ROUTINE_HEADER_UNSUPPORTED', 'observed routine has no literal body delimiter');
  // pg_get_functiondef is canonical PostgreSQL rendering. SECURITY DEFINER is
  // the one original8 header transition (0136), checked against source above.
  return routine.definition.slice(0, tag.index).replace(/\s+SECURITY DEFINER\b/g, '').trim();
}

function checkCatalogClosure(capture, expected, closure, allowed, source) {
  const items = capture.raw.metadata.items;
  const baseline = expected.raw.metadata.items;
  const target = (item) => item.key.split('.').slice(0, 2).join('.');
  const byIdentity = new Map(items.map((item) => [`${item.surface}:${item.key}`, item]));
  const expectedIdentity = new Map(baseline.map((item) => [`${item.surface}:${item.key}`, item]));
  const plannedMissing = (item) => capture.environment === 'PRODUCTION' && allowed.has(`${item.surface}:${item.key}`);
  const requireColumn = (table, column) => {
    const key = `columns:${table}.${column}`;
    const want = expectedIdentity.get(key), actual = byIdentity.get(key);
    if (!want || !actual || want.value !== actual.value) {
      if (want && !actual && plannedMissing(want)) return;
      fail('RELEASE_DEPENDENCY_COLUMN_MISMATCH', `${capture.environment}: ${table}.${column} changed`);
    }
  };
  for (const fk of capture.catalog.foreignKeys.filter((entry) => closure.tables.has(entry.table))) {
    const actual = byIdentity.get(`constraints:${fk.table}.${fk.name}`);
    if (fk.validated !== true || fk.deferrable !== false || actual?.value !== `f|${fk.definition}`
      || !Array.isArray(fk.columns) || !Array.isArray(fk.targetColumns) || fk.columns.length !== fk.targetColumns.length) {
      fail('RELEASE_FK_CAPTURE_MISMATCH', `${fk.table}.${fk.name} FK shape/validation differs`);
    }
    const same = baseline.some((item) => item.surface === 'constraints' && target(item) === fk.table && item.value === actual.value);
    if (!same) fail('RELEASE_FK_SOURCE_MISMATCH', `${fk.table}.${fk.name} is outside canonical dependency contracts`);
    for (const column of fk.columns) requireColumn(fk.table, column);
    if (fk.target === 'auth.users') {
      if (!compareJson(capture.catalog.authTarget, { type: 'uuid', notNull: true, primaryKey: true })
        || !compareJson(fk.targetColumns, ['id'])) fail('RELEASE_AUTH_FK_MISMATCH', 'Supabase auth target must remain the uuid primary key');
    } else for (const column of fk.targetColumns) requireColumn(fk.target, column);
  }
  for (const table of closure.tables) {
    if (table === 'auth.users') continue;
    const write = closure.operations.get(table);
    const expectedColumns = baseline.filter((item) => item.surface === 'columns' && target(item) === table);
    for (const column of expectedColumns) {
      const name = column.key.split('.')[2];
      if (write?.insert.size || new RegExp(`\\b${name}\\b`, 'i').test(closure.code) || write?.update.has(name)) requireColumn(table, name);
    }
    const actualColumns = items.filter((item) => item.surface === 'columns' && target(item) === table);
    if (!actualColumns.length && !expectedColumns.every(plannedMissing)) fail('RELEASE_DEPENDENCY_TABLE_MISSING', `${table} is missing`);
    for (const column of actualColumns) {
      if (expectedIdentity.has(`columns:${column.key}`)) continue;
      const name = column.key.split('.')[2];
      if (new RegExp(`\\b${name}\\b`, 'i').test(closure.code)) fail('RELEASE_EXTRA_REFERENCED_COLUMN', `${column.key} is not canonical`);
      // A read-only relation's unrelated columns cannot alter the selected
      // reads. INSERT omitted columns require concrete safe type/default proof.
      if (write?.insert.size && !safeOmittedTourColumn(column, items)) fail('RELEASE_INSERT_DEFAULT_UNEXPLAINED', `${column.key} default is not proven safe`);
    }
    for (const constraint of items.filter((item) => item.surface === 'constraints' && target(item) === table)) {
      const want = expectedIdentity.get(`constraints:${constraint.key}`);
      if (want?.value === constraint.value) continue;
      if (constraint.value.startsWith('f|')) continue; // checked with full target closure above
      if (!write || (!write.insert.size && !write.update.size)) continue;
      if (constraint.value === 'u|UNIQUE (tenant_id, id)' && items.some((item) => item.surface === 'constraints'
        && target(item) === table && item.value === 'p|PRIMARY KEY (id)')) continue;
      if (safeLegacyTourCheck(constraint, items, write)) continue;
      if (!write.insert.size && constraint.value.startsWith('c|CHECK (') && !/NOT VALID/i.test(constraint.value)) {
        const predicate = sqlWords(constraint.value);
        const references = actualColumns.filter((column) => new RegExp(`\\b${column.key.split('.')[2]}\\b`, 'i').test(predicate));
        const calls = [...predicate.matchAll(/([a-z_][a-z_0-9.]*)\s*\(/gi)].map((match) => match[1]);
        const scalar = new Set(['boolean', 'smallint', 'integer', 'bigint', 'numeric', 'text', 'uuid', 'date', 'timestamp with time zone']);
        if (references.length && references.every((column) => !write.update.has(column.key.split('.')[2])
          && (scalar.has(column.value.split('|')[0]) || source.enums.has(column.value.split('|')[0])))
          && calls.every((name) => ['check', 'any', 'and', 'or', 'not'].includes(name))) continue;
      }
      fail('RELEASE_WRITE_CONSTRAINT_UNEXPLAINED', `${capture.environment}: ${constraint.key} is not safe for selected writes`);
    }
    for (const want of baseline.filter((item) => ['constraints', 'triggers'].includes(item.surface) && target(item) === table)) {
      const actual = byIdentity.get(`${want.surface}:${want.key}`);
      if (actual?.value === want.value || (!actual && plannedMissing(want))) continue;
      const localFkColumns = want.value.startsWith('f|') ? /FOREIGN KEY \(([^)]+)\)/.exec(want.value)?.[1] : null;
      const code = sqlWords(localFkColumns ?? want.value);
      const referenced = actualColumns.some((column) => {
        const name = column.key.split('.')[2];
        return new RegExp(`\\b${name}\\b`, 'i').test(code)
          && (new RegExp(`\\b${name}\\b`, 'i').test(closure.code) || write?.insert.size || write?.update.has(name));
      });
      if (allowed.has(`${want.surface}:${want.key}`) || (want.surface === 'constraints' && referenced)) {
        fail('RELEASE_EXPECTED_CONTRACT_MISSING', `${capture.environment}: ${want.key} is missing or changed`);
      }
    }
    const indexShape = (value) => value.replace(/^(CREATE (?:UNIQUE )?INDEX) [^ ]+ ON /i, '$1 ON ');
    for (const index of items.filter((item) => item.surface === 'indexes' && target(item) === table)) {
      if (baseline.some((item) => item.surface === 'indexes' && target(item) === table && indexShape(item.value) === indexShape(index.value))) continue;
      if (!/CREATE UNIQUE INDEX /i.test(index.value)) {
        if (!write?.insert.size && !write?.update.size) continue;
        const ordinary = /^CREATE INDEX [^ ]+ ON [^ ]+ USING (?:btree|hash) \(([a-z_0-9, ]+)\)$/i.exec(index.value);
        if (ordinary && ordinary[1].split(',').every((name) => actualColumns.some((column) => column.key === `${table}.${name.trim()}`))) continue;
        fail('RELEASE_INDEX_EXPRESSION_UNEXPLAINED', `${index.key} could call code or reject a selected write`);
      }
      if ((!write?.insert.size && !write?.update.size) || /USING btree \(tenant_id, id\)$/.test(index.value)
        && items.some((item) => item.surface === 'constraints' && target(item) === table && item.value === 'p|PRIMARY KEY (id)')) continue;
      fail('RELEASE_UNIQUE_INDEX_UNEXPLAINED', `${index.key} can reject a selected write`);
    }
    for (const want of baseline.filter((item) => item.surface === 'indexes' && target(item) === table && allowed.has(`indexes:${item.key}`))) {
      const actual = byIdentity.get(`indexes:${want.key}`);
      if (actual?.value !== want.value && !(!actual && plannedMissing(want))) fail('RELEASE_PLANNED_INDEX_MISMATCH', `${want.key} is not the canonical planned index`);
    }
    const policies = (list) => list.filter((item) => item.surface === 'policies' && target(item) === table);
    const expectedPolicies = policies(baseline), actualPolicies = policies(items);
    const plannedTable = capture.environment === 'PRODUCTION' && actualColumns.length === 0 && expectedColumns.every(plannedMissing);
    if (plannedTable) continue;
    if (!compareJson(actualPolicies, expectedPolicies)
      && !compareJson(policyContract(actualPolicies), policyContract(expectedPolicies))) fail('RELEASE_RLS_PREDICATE_MISMATCH', `${table} effective RLS differs`);
    const actualAcl = capture.raw.acl.tables.find((item) => `public.${item.name}` === table);
    const expectedAcl = expected.raw.acl.tables.find((item) => `public.${item.name}` === table);
    if (!actualAcl || !expectedAcl || actualAcl.rowSecurity !== expectedAcl.rowSecurity
      || actualAcl.forceRowSecurity !== expectedAcl.forceRowSecurity) fail('RELEASE_TABLE_RLS_MISMATCH', `${table} RLS flags differ`);
    for (const role of APP_ROLES) if (!compareJson(effectivePrivileges(actualAcl, capture.catalog, role), effectivePrivileges(expectedAcl, expected.catalog, role))) {
      fail('RELEASE_APP_GRANT_MISMATCH', `${table} effective ${role} grants differ`);
    }
    const owner = capture.catalog.tableOwners.filter((entry) => entry.table === table);
    if (owner.length !== 1 || !['postgres', OWNER].includes(owner[0].owner)) fail('RELEASE_TABLE_OWNER_INVALID', `${table} owner is untrusted`);
    for (const trigger of items.filter((item) => item.surface === 'triggers' && target(item) === table)) {
      if (!write?.insert.size && !write?.update.size && !write?.delete) continue;
      if (expectedIdentity.get(`triggers:${trigger.key}`)?.value !== trigger.value) fail('RELEASE_WRITE_TRIGGER_MISMATCH', `${trigger.key} changes selected write effects`);
      const call = /execute function\s+((?:public\.)?[a-z_0-9]+)\(/i.exec(trigger.value);
      if (!call || call[1].replace(/^public\./, '') !== 'set_updated_at') fail('RELEASE_WRITE_TRIGGER_UNEXPLAINED', `${trigger.key} dependency was not source reviewed`);
      const key = 'public.set_updated_at()';
      assertRoutine(capture, source.after.get(key), key);
    }
    for (const entry of capture.catalog.defaults.filter((item) => item.table === table)) {
      const column = byIdentity.get(`columns:${table}.${entry.column}`);
      if (!column || column.value.split('|').slice(2).join('|') !== entry.expression || !Array.isArray(entry.functions)
        || !Array.isArray(entry.sequences) || entry.sequences.length) fail('RELEASE_DEFAULT_DEPENDENCY_MISMATCH', `${table}.${entry.column} default resolution changed`);
      for (const routine of entry.functions) if ((!['pg_catalog.now', 'pg_catalog.gen_random_uuid', 'pg_catalog.jsonb_build_object', 'pg_catalog.jsonb_build_array'].includes(routine.name)
        && !(['pg_catalog.numeric', 'pg_catalog.int8'].includes(routine.name) && routine.args === 'integer')) || routine.securityDefiner) {
        fail('RELEASE_DEFAULT_FUNCTION_UNEXPLAINED', `${table}.${entry.column} calls an unreviewed default function`);
      }
    }
    for (const column of actualColumns) if (column.value.split('|')[2]) {
      if (capture.catalog.defaults.filter((item) => item.table === table && item.column === column.key.split('.')[2]).length !== 1) fail('RELEASE_DEFAULT_CAPTURE_REQUIRED', `${column.key} default resolution missing`);
    }
  }
  for (const column of items.filter((item) => item.surface === 'columns' && closure.tables.has(target(item)))) {
    const type = column.value.split('|')[0];
    const enumContract = expected.catalog.enums.find((entry) => entry.name === type);
    if (enumContract && (!compareJson(enumContract.labels, source.enums.get(type))
      || !compareJson(capture.catalog.enums.find((entry) => entry.name === type), enumContract))) fail('RELEASE_ENUM_MISMATCH', `${type} labels differ from canonical source`);
  }
}

function constantJsonConstructor(expression) {
  const token = /\s*(jsonb_build_object|jsonb_build_array|'(?:''|[^'])*'|-?\d+(?:\.\d+)?|true|false|null|[(),])\s*/gy;
  const tokens = []; let position = 0;
  while (position < expression.length) {
    token.lastIndex = position;
    const match = token.exec(expression);
    if (!match) return false;
    tokens.push(match[1]); position = token.lastIndex;
  }
  let index = 0;
  const value = () => {
    const next = tokens[index++];
    if (next === 'jsonb_build_object' || next === 'jsonb_build_array') {
      if (tokens[index++] !== '(') throw new Error('constructor');
      const args = [];
      if (tokens[index] !== ')') { args.push(value()); while (tokens[index] === ',') { index++; args.push(value()); } }
      if (tokens[index++] !== ')') throw new Error('constructor');
      if (next === 'jsonb_build_array') return args;
      if (args.length % 2 || args.some((item, i) => i % 2 === 0 && typeof item !== 'string')) throw new Error('nonnull string keys');
      return Object.fromEntries(args.reduce((pairs, item, i) => i % 2 ? [...pairs, [args[i - 1], item]] : pairs, []));
    }
    if (next?.startsWith("'")) return next.slice(1, -1).replace(/''/g, "'");
    if (next === 'null') return null;
    if (next === 'true' || next === 'false') return next === 'true';
    if (/^-?\d+(?:\.\d+)?$/.test(next ?? '')) return Number(next);
    throw new Error('literal');
  };
  try { const result = value(); return index === tokens.length && result !== null && typeof result === 'object'; }
  catch { return false; }
}

function safeOmittedTourColumn(column) {
  if (!column.key.startsWith('public.tour_orders.')) return false;
  const values = {
    balance_collection_mode_snapshot: "text|true|'DEADLINE'::text", balance_due_hours_snapshot: 'integer|false|48',
    balance_due: 'numeric|true|0', balance_due_at: 'timestamp with time zone|false|',
  };
  const name = column.key.split('.')[2];
  if (values[name]) return column.value === values[name];
  // jsonb_build_object/array are pure, non-null pg_catalog constructors. Their
  // resolved OIDs are checked separately; no constraint may consume this extra
  // field. This is INSERT compatibility, not canonical parity of its contents.
  return name === 'cancellation_policy_snapshot' && column.value.startsWith('jsonb|true|')
    && constantJsonConstructor(column.value.slice('jsonb|true|'.length));
}

function safeLegacyTourCheck(constraint, items, write) {
  if (!constraint.key.startsWith('public.tour_orders.')) return false;
  const safe = new Set([
    "c|CHECK (balance_collection_mode_snapshot = ANY (ARRAY['DEADLINE'::text, 'ON_SITE'::text]))",
    "c|CHECK (balance_collection_mode_snapshot = 'DEADLINE'::text AND balance_due_hours_snapshot IS NOT NULL AND balance_due_hours_snapshot > 0 OR balance_collection_mode_snapshot = 'ON_SITE'::text AND balance_due_hours_snapshot IS NULL)",
    'c|CHECK (balance_due >= 0::numeric)',
    "c|CHECK (deposit_mode_snapshot = ANY (ARRAY['NONE'::text, 'DEPOSIT_FIXED'::text, 'DEPOSIT_PERCENT'::text, 'FULL'::text]))",
  ]);
  if (!safe.has(constraint.value)) return false;
  const names = ['balance_collection_mode_snapshot', 'balance_due_hours_snapshot', 'balance_due', 'deposit_mode_snapshot'];
  for (const name of names.filter((name) => constraint.value.includes(name))) {
    if (write.insert.has(name) || write.update.has(name)) return false;
    const column = items.find((item) => item.surface === 'columns' && item.key === `public.tour_orders.${name}`);
    if (!column || (name === 'deposit_mode_snapshot' ? column.value !== 'text|false|' : !safeOmittedTourColumn(column))) return false;
  }
  // Defaults are DEADLINE,48,0,NULL. PostgreSQL CHECK accepts UNKNOWN for
  // nullable deposit mode. UPDATE does not change any input to these checks.
  return true;
}

function buildOriginalEightConsistency({ report, plan, impactManifest, mainSha, observedMainSha = mainSha, planDigest, releaseCatalog,
  repoRoot = process.cwd(), readCanonicalSql = (path) => readFileSync(resolve(repoRoot, path), 'utf8'),
  now = new Date().toISOString(), readSourceAt, isAncestor }) {
  const scopeSpec = SCOPED_RELEASE_CAPTURE_SCOPES[plan.migrationScope];
  if (!scopeSpec || plan.migrations.length !== scopeSpec.migrationCount) fail('RELEASE_SCOPE_MISMATCH', 'only the admitted bounded release scopes are accepted');
  const aliasMap = JSON.parse(readFileSync(resolve(repoRoot, 'supabase/ledger-alias-map.json'), 'utf8'));
  verifyProductionDbReleasePlan({ plan, aliasMap, readCanonicalSql });
  const checkedManifest = JSON.parse(readFileSync(resolve(repoRoot, 'supabase/production-db-impact-manifest.json'), 'utf8'));
  if (!compareJson(impactManifest, checkedManifest)) fail('RELEASE_MANIFEST_SOURCE_MISMATCH', 'impact manifest is not trusted canonical source');
  if (!releaseCatalog?.binding || !compareJson(releaseCatalog.binding.plan, plan)) fail('RELEASE_G3_BINDING_REQUIRED', 'existing verified G3 ledger binding is required');
  const captures = Object.fromEntries(['LOCAL_EXPECTED', 'TEST', 'PRODUCTION'].map((environment) => [environment,
    captureFor(releaseCatalog[environment], environment, { mainSha: observedMainSha, now, report })]));
  const replay = compareObserverSnapshots({ expectedSnapshot: captures.LOCAL_EXPECTED.snapshot, testSnapshot: captures.TEST.snapshot,
    productionSnapshot: captures.PRODUCTION.snapshot, currentMainSha: observedMainSha, now, maxEvidenceAgeMinutes: 15,
    releaseLedgerBinding: releaseCatalog.binding, aliasMap, readCanonicalSql, readSourceAt, isAncestor });
  if (!compareJson(replay.differences, report.differences) || !compareJson(replay.plannedLedgerMapping, report.plannedLedgerMapping)
    || !compareJson(replay.testBaseline0098Mapping, report.testBaseline0098Mapping)) fail('RELEASE_REPORT_REPLAY_MISMATCH', 'raw observer differences or ledger mappings changed');
  if (replay.status === 'EVIDENCE_UNAVAILABLE' || (report.exceptionSummary?.expired ?? 0) || (report.exceptionSummary?.unmatched ?? 0)) fail('RELEASE_CAPTURE_UNAVAILABLE', 'raw captures/ledger/exception evidence is unavailable');
  checkDedicatedRoles(captures.PRODUCTION.catalog);
  const source = sourceCatalog({ plan, repoRoot, readCanonicalSql, appliedSourceFiles: scopeSpec.appliedSourceFiles });
  for (const migration of plan.migrations) for (const match of stripSqlComments(source.read(migration.path)).matchAll(/\balter\s+table\s+(?:only\s+)?(?:public\.)?([a-z_][a-z_0-9]*)/gi)) {
    const owner = captures.PRODUCTION.catalog.tableOwners.find((entry) => entry.table === `public.${match[1]}`);
    if (owner && owner.owner !== OWNER) fail('RELEASE_PLANNED_DDL_OWNER_MISMATCH', `${match[1]} cannot be altered by the dedicated owner`);
  }
  const closure = deriveClosure({ source, captures, impactManifest, plan, createTourOrderFamily: scopeSpec.createTourOrderFamily });
  if (!closure.tables.size || (scopeSpec.routinesRequired && !closure.routines.size)) fail('RELEASE_CLOSURE_EMPTY', 'canonical source does not resolve a dependency closure');
  const impacts = normalizeProductionDbImpactManifest(impactManifest).entries.filter((entry) => plan.migrations.some((migration) => migration.repoFile === entry.repoFile));
  const allowed = new Map(impacts.flatMap((entry) => entry.impacts.map((impact) => [`${impact.surface}:${impact.objectKey}`, entry.repoFile])));
  const surfaceItems = (capture, surface) => surface === 'acl' ? capture.snapshot.acl.items : capture.snapshot.surfaces[surface].items;
  for (const entry of impacts) for (const impact of entry.impacts) {
    const expected = surfaceItems(captures.LOCAL_EXPECTED, impact.surface).find((item) => item.key === impact.objectKey);
    if (!expected) fail('RELEASE_EXPECTED_IMPACT_MISSING', `${impact.surface}:${impact.objectKey} is absent from canonical replay`);
    if (['routines', 'acl'].includes(impact.surface)) continue; // body/security and effective grants are checked below
    const test = surfaceItems(captures.TEST, impact.surface).find((item) => item.key === impact.objectKey);
    if (test?.fingerprint !== expected.fingerprint) fail('RELEASE_TEST_IMPACT_MISMATCH', `${impact.objectKey} is not the selected after state`);
    const production = surfaceItems(captures.PRODUCTION, impact.surface).find((item) => item.key === impact.objectKey);
    if (production && production.fingerprint !== expected.fingerprint) fail('RELEASE_BEFORE_IMPACT_UNEXPLAINED', `${impact.objectKey} has a noncanonical before shape`);
  }
  const bindings = [];
  for (const key of closure.routines) {
    const after = source.after.get(key), before = source.before.get(key);
    if (!after) fail('RELEASE_ROUTINE_SOURCE_REQUIRED', `${key} has no canonical after definition`);
    const localRoutine = assertRoutine(captures.LOCAL_EXPECTED, after, key);
    const testRoutine = assertRoutine(captures.TEST, after, key);
    if (routineHeader(testRoutine) !== routineHeader(localRoutine)) fail('RELEASE_ROUTINE_HEADER_MISMATCH', `${key} full after header differs from canonical replay`);
    const actualBefore = captures.PRODUCTION.catalog.routines.find((entry) => routineKey(entry) === key);
    const planned = allowed.has(`routines:${key}`);
    if (actualBefore) {
      if (!before) fail('RELEASE_BEFORE_SOURCE_REQUIRED', `${key} unexpectedly exists before planned creation`);
      assertRoutine(captures.PRODUCTION, before, key);
      if (routineHeader(actualBefore) !== routineHeader(localRoutine)) fail('RELEASE_ROUTINE_HEADER_MISMATCH', `${key} full before header is outside the source-attributed original8 transition`);
      if (planned && actualBefore.owner !== OWNER) fail('RELEASE_PLANNED_ROUTINE_OWNER_MISMATCH', `${key} cannot be replaced by the dedicated owner`);
      if (!planned && (before.body.trim() !== after.body.trim() || before.securityDefiner !== after.securityDefiner
        || !compareJson(before.config, after.config))) fail('RELEASE_UNPLANNED_ROUTINE_TRANSITION', `${key} changes outside the planned impact`);
    } else if (!planned) fail('RELEASE_HELPER_MISSING', `${key} is required before release`);
    const aclFor = (capture) => capture.raw.acl.functions.find((item) => `public.${item.name}(${item.identityArguments})` === key);
    for (const capture of [captures.TEST, ...(actualBefore ? [captures.PRODUCTION] : [])]) for (const role of APP_ROLES) {
      if (!compareJson(effectivePrivileges(aclFor(capture), capture.catalog, role), effectivePrivileges(aclFor(captures.LOCAL_EXPECTED), captures.LOCAL_EXPECTED.catalog, role))) fail('RELEASE_ROUTINE_APP_GRANT_MISMATCH', `${key} ${role} grants differ`);
    }
    bindings.push({ objectKey: key, beforeSource: before?.source ?? null, afterSource: after.source,
      alterSource: after.alterSource ?? null,
      expectedFingerprint: captures.LOCAL_EXPECTED.snapshot.surfaces.routines.items.find((item) => item.key === key)?.fingerprint ?? null,
      observedFingerprint: captures.PRODUCTION.snapshot.surfaces.routines.items.find((item) => item.key === key)?.fingerprint ?? null });
  }
  // auth.uid is a Supabase-managed dependency. Compare its actual body and
  // security configuration against the canonical local platform replay; do not
  // pretend that an application migration owns the platform definition.
  if (/\bauth\.uid\s*\(/i.test(closure.code)) {
    const expected = captures.LOCAL_EXPECTED.catalog.routines.find((entry) => entry.name === 'auth.uid');
    if (!expected) fail('RELEASE_AUTH_UID_CAPTURE_REQUIRED', 'local platform auth.uid was not captured');
    for (const capture of [captures.TEST, captures.PRODUCTION]) {
      const actual = capture.catalog.routines.find((entry) => entry.name === 'auth.uid');
      if (!actual || actual.body !== expected.body || actual.securityDefiner !== expected.securityDefiner
        || !compareJson(actual.config, expected.config) || actual.args !== expected.args
        || routineHeader(actual) !== routineHeader(expected)) fail('RELEASE_AUTH_UID_MISMATCH', 'platform auth.uid dependency differs');
    }
  }
  for (const capture of [captures.TEST, captures.PRODUCTION]) checkCatalogClosure(capture, captures.LOCAL_EXPECTED, closure, allowed, source);
  const plannedDifferences = report.differences.filter((item) => item.environment === 'PRODUCTION'
    && (allowed.has(`${item.surface}:${item.objectKey}`) || (item.surface === 'migrationLedger' && plan.migrations.some((migration) => item.objectKey === `${migration.repoFile.slice(0, 4)}/${migration.repoFile}`))));
  return { status: 'CONSISTENCY_VERIFIED', mainSha, planDigest, impactManifestDigest: impactManifestDigest(impactManifest),
    observedAt: new Date(Math.min(...Object.values(captures).map((capture) => Date.parse(capture.observedAt)))).toISOString(),
    scope: plan.migrationScope, rawObserverStatus: report.status, rawObserverDifferenceCount: report.differenceCount,
    dependencyClosure: { tables: [...closure.tables].sort(), routines: [...closure.routines].sort() },
    sourceBindings: bindings, captureDigests: Object.fromEntries(Object.entries(captures).map(([label, capture]) => [label, capture.captureDigest])),
    productionCatalogFingerprint: captures.PRODUCTION.catalog.catalogFingerprint,
    productionCatalogFingerprintCoverage: 'EXISTING_G6_PUBLIC_LEDGER_AND_WRITER_CATALOG',
    supplementalObservedAt: captures.PRODUCTION.observedAt,
    supplementalCoverage: ['enum labels', 'platform auth.uid and auth.users target', 'application role memberships', 'resolved default function OIDs'],
    plannedProductionDifferences: plannedDifferences.map((item) => ({ surface: item.surface, objectKey: item.objectKey,
      expectedFingerprint: item.expectedFingerprint, observedFingerprint: item.observedFingerprint })),
    plannedProductionDifferenceCount: plannedDifferences.length, intentionalDifferenceCount: 0,
    unexplainedDifferences: 0, fullEnvironmentParityProven: false, databaseMutationAuthorized: false };
}
