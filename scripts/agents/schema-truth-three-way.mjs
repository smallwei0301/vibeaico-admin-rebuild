const SHA = /^[0-9a-f]{40}$/;
const ISO_UTC = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?Z$/;
const SURFACES = Object.freeze(['columns', 'constraints', 'indexes', 'views', 'policies', 'routines', 'triggers']);
const PROFILES = new Set(['CANONICAL_ONLY', 'OVERLAY_AUGMENTED', 'NOT_RUN']);
const PROJECT_REFS = Object.freeze({
  TEST: 'nmwhwngojosmagjuvxol',
  PRODUCTION: 'egehnijjpgijmccagxac',
});
const PRESENCE = Object.freeze({
  '100': 'REPO_ONLY',
  '010': 'TEST_ONLY',
  '001': 'PRODUCTION_ONLY',
  '110': 'REPO_TEST',
  '101': 'REPO_PRODUCTION',
  '011': 'TEST_PRODUCTION',
  '111': 'ALL_THREE',
});
const KEY_PATTERNS = Object.freeze({
  columns: /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/,
  constraints: /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/,
  indexes: /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/,
  views: /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/,
  policies: /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/,
  routines: /^public\.[a-z_][a-z0-9_]*\(.*\)$/,
  triggers: /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/,
});
const ROUTINE_RESULT_TYPE = /^(?:void|trigger|event_trigger|record|boolean|bool|smallint|integer|bigint|real|double precision|text|varchar|character varying|bytea|date|time(?: with(?:out)? time zone)?|timestamp(?: with(?:out)? time zone)?|interval|json|jsonb|uuid|cstring|gbtreekey_var|gbtreekey16|gbtreekey2|gbtreekey32|gbtreekey4|gbtreekey8|internal|money|oid|(?:numeric|decimal)(?:\(\d{1,4}(?:,\d{1,4})?\))?|(?:public\.)?notification_deliveries)(?:\[\])?$/;
const ROUTINE_RESERVED_WORDS = new Set([
  'all', 'alter', 'and', 'as', 'begin', 'between', 'by', 'call', 'case', 'check', 'cluster', 'comment', 'commit',
  'constraint', 'copy', 'create', 'current_catalog', 'current_date', 'current_role', 'current_schema', 'current_time',
  'current_timestamp', 'current_user', 'declare', 'default', 'delete', 'discard', 'distinct', 'do', 'drop', 'else',
  'end', 'except', 'execute', 'exception', 'fetch', 'for', 'foreign', 'from', 'grant', 'group', 'having', 'if',
  'in', 'index', 'insert', 'intersect', 'into', 'is', 'join', 'language', 'listen', 'load', 'lock', 'loop', 'merge',
  'move', 'not', 'notify', 'null', 'offset', 'on', 'only', 'or', 'order', 'perform', 'prepare', 'procedure', 'raise',
  'reindex', 'release', 'reset', 'return', 'returning', 'revoke', 'rollback', 'savepoint', 'schema', 'security',
  'select', 'sequence', 'session_user', 'set', 'show', 'some', 'table', 'then', 'to', 'trailing', 'truncate', 'union',
  'unique', 'update', 'using', 'vacuum', 'view', 'when', 'where', 'while', 'with', 'without', 'copy', 'call', 'execute',
]);

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

function assertKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_FIXTURE', `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.join('\n') !== wanted.join('\n')) fail('UNKNOWN_OR_MISSING_FIELD', `${label} keys must be exactly: ${wanted.join(', ')}`);
}

function normalizeMainSha(value) {
  const sha = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!SHA.test(sha)) fail('INVALID_MAIN_SHA', 'currentMainSha must be a 40-character SHA');
  return sha;
}

function normalizeObservedMainSha(value, currentMainSha, label) {
  const sha = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!SHA.test(sha) || sha !== currentMainSha) fail('STALE_MAIN_SHA', `${label} must match ${currentMainSha}`);
  return sha;
}

function normalizeEvidenceRef(value, label) {
  if (typeof value !== 'string' || value !== value.trim() || !/^[a-z][a-z0-9+.-]*:[A-Za-z0-9._/#:-]{1,299}$/i.test(value) || value.includes('://')) {
    fail('INVALID_EVIDENCE_REF', `${label} must be a compact non-secret evidence reference`);
  }
  return value;
}

function normalizeManifest(value, kind) {
  if (value === null && kind === 'canonical') return null;
  assertKeys(value, ['identity'], `${kind}Manifest`);
  const prefix = kind === 'canonical' ? 'repo:canonical/' : 'repo:overlay/';
  if (typeof value.identity !== 'string' || value.identity !== value.identity.trim() || !value.identity.startsWith(prefix) || !/^[A-Za-z0-9._:/-]{1,300}$/.test(value.identity)) {
    fail('INVALID_MANIFEST', `${kind} manifest identity is invalid`);
  }
  return { identity: value.identity };
}

function normalizeDefinition(value, label) {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value, 'utf8') > 16 * 1024 || value.includes('\0')) {
    fail('INVALID_SURFACE_DEFINITION', `${label} must be a non-empty schema definition without NUL data`);
  }
  return value;
}

function normalizeRoutineMetadata(value, label) {
  assertKeys(value, ['schema', 'key', 'resultType', 'kind', 'securityDefiner', 'volatility'], label);
  if (value.schema !== 'public') fail('INVALID_PUBLIC_SCHEMA', `${label}.schema must be public`);
  const key = normalizeRoutineKey(value.key, `${label}.key`);
  if (typeof value.resultType !== 'string' || value.resultType.includes('\0')) fail('INVALID_RESULT_TYPE', `${label}.resultType is invalid`);
  const resultType = normalizeRoutineResultType(value.resultType, `${label}.resultType`);
  if (!['function', 'procedure'].includes(value.kind)) fail('INVALID_ROUTINE_METADATA', `${label}.kind is invalid`);
  if (typeof value.securityDefiner !== 'boolean') fail('INVALID_ROUTINE_METADATA', `${label}.securityDefiner must be boolean`);
  if (!['immutable', 'stable', 'volatile'].includes(value.volatility)) fail('INVALID_ROUTINE_METADATA', `${label}.volatility is invalid`);
  return { key, definition: `result=${resultType}|kind=${value.kind}|securityDefiner=${value.securityDefiner}|volatility=${value.volatility}` };
}

function normalizeRoutineKey(value, label) {
  if (typeof value !== 'string' || value !== value.trim() || !KEY_PATTERNS.routines.test(value) || /["';]|\b(?:select|drop|from|begin|return|insert|update|delete|alter|create)\b/i.test(value)) fail('INVALID_SURFACE_KEY', `${label} has an invalid canonical shape`);
  const match = /^public\.([a-z_][a-z0-9_]*)\((.*)\)$/.exec(value);
  if (!match) fail('INVALID_SURFACE_KEY', `${label} has an invalid canonical shape`);
  const argumentsText = match[2];
  if (!argumentsText) return value;
  if (argumentsText !== argumentsText.trim()) fail('INVALID_SURFACE_KEY', `${label} has invalid identity arguments`);
  let depth = 0;
  let start = 0;
  const argumentsList = [];
  for (let index = 0; index < argumentsText.length; index += 1) {
    const character = argumentsText[index];
    if (character === '(') depth += 1;
    else if (character === ')') depth -= 1;
    if (depth < 0) fail('INVALID_SURFACE_KEY', `${label} has unbalanced arguments`);
    if (character === ',' && depth === 0) {
      const rawArgument = argumentsText.slice(start, index);
      const argument = rawArgument.trim();
      if (rawArgument !== argument && rawArgument !== ` ${argument}`) fail('INVALID_SURFACE_KEY', `${label} has invalid identity argument spacing`);
      argumentsList.push(argument);
      start = index + 1;
    }
  }
  const rawFinalArgument = argumentsText.slice(start);
  const finalArgument = rawFinalArgument.trim();
  if (rawFinalArgument !== finalArgument && rawFinalArgument !== ` ${finalArgument}`) fail('INVALID_SURFACE_KEY', `${label} has invalid identity argument spacing`);
  argumentsList.push(finalArgument);
  const identifier = /^[a-z_][a-z0-9_]*$/;
  const typeIdentifier = /^[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?(?:\[\])?$/;
  const numericType = /^(?:numeric|decimal)\(\d{1,4}(?:,\d{1,4})?\)(?:\[\])?$/;
  const multiWordType = /^(?:double precision|character varying|bit varying|time with time zone|time without time zone|timestamp with time zone|timestamp without time zone)$/;
  const validType = (type) => {
    if (numericType.test(type) || multiWordType.test(type)) return true;
    if (!typeIdentifier.test(type)) return false;
    return type.replace(/\[\]$/, '').split('.').every((part) => !ROUTINE_RESERVED_WORDS.has(part.toLowerCase()));
  };
  const validArgument = (argument) => {
    if (!argument || argument !== argument.trim() || /["';]/.test(argument)) return false;
    if (validType(argument)) return true;
    const separator = argument.indexOf(' ');
    if (separator < 1) return false;
    const name = argument.slice(0, separator);
    const type = argument.slice(separator + 1);
    return identifier.test(name) && !ROUTINE_RESERVED_WORDS.has(name.toLowerCase()) && validType(type);
  };
  if (depth !== 0 || argumentsList.some((argument) => !validArgument(argument))) fail('INVALID_SURFACE_KEY', `${label} has invalid identity arguments`);
  return `public.${match[1]}(${argumentsList.join(', ')})`;
}

function normalizeRoutineResultType(value, label) {
  if (typeof value !== 'string' || value.includes('\0')) fail('INVALID_RESULT_TYPE', `${label} is invalid`);
  const text = value.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\(\s*/g, '(').replace(/\s*\)/g, ')').replace(/\s*,\s*/g, ',');
  const atom = (candidate) => {
    if (!ROUTINE_RESULT_TYPE.test(candidate)) fail('INVALID_RESULT_TYPE', `${label} is invalid`);
    return candidate;
  };
  if (text.startsWith('setof ')) return `setof ${atom(text.slice(6))}`;
  const table = /^table\((.*)\)$/.exec(text);
  if (!table) return atom(text);
  const fields = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index <= table[1].length; index += 1) {
    const character = table[1][index] ?? ',';
    if (character === '(') depth += 1;
    else if (character === ')') depth -= 1;
    if (depth < 0) fail('INVALID_RESULT_TYPE', `${label} is invalid`);
    if (character === ',' && depth === 0) {
      const field = table[1].slice(start, index);
      const match = /^([a-z_][a-z0-9_]*) (.+)$/.exec(field);
      if (!match) fail('INVALID_RESULT_TYPE', `${label} is invalid`);
      fields.push(`${match[1]} ${atom(match[2])}`);
      start = index + 1;
    }
  }
  if (depth !== 0 || !fields.length) fail('INVALID_RESULT_TYPE', `${label} is invalid`);
  return `table(${fields.join(',')})`;
}

function normalizeSurfaceEntry(surface, value, index) {
  if (surface === 'routines') return normalizeRoutineMetadata(value, `${surface}[${index}]`);
  if (surface === 'columns') {
    const keys = value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).sort().join('\n') : '';
    if (!['definition\nkey\nschema', 'definition\nkey\nordinalPosition\nschema'].includes(keys)) {
      fail('UNKNOWN_OR_MISSING_FIELD', `${surface}[${index}] keys must be key, definition, schema, and optional ordinalPosition`);
    }
  } else assertKeys(value, ['key', 'definition', 'schema'], `${surface}[${index}]`);
  if (value.schema !== 'public') fail('INVALID_PUBLIC_SCHEMA', `${surface}[${index}].schema must be public`);
  if (typeof value.key !== 'string' || value.key !== value.key.trim() || !KEY_PATTERNS[surface].test(value.key)) {
    fail('INVALID_SURFACE_KEY', `${surface}[${index}].key has an invalid canonical shape`);
  }
  if (surface === 'views' && !value.key.startsWith('public.')) {
    fail('INVALID_PUBLIC_SCHEMA', `${surface}[${index}].key must use the public schema`);
  }
  if (surface === 'columns' && Object.hasOwn(value, 'ordinalPosition') && (!Number.isInteger(value.ordinalPosition) || value.ordinalPosition < 1)) {
    fail('INVALID_ORDINAL_POSITION', `${surface}[${index}].ordinalPosition must be a positive integer`);
  }
  const label = `${surface}[${index}].definition`;
  return { key: value.key, definition: normalizeDefinition(value.definition, label) };
}

function normalizeSurfaces(value) {
  assertKeys(value, SURFACES, 'surfaces');
  const normalized = {};
  for (const surface of SURFACES) {
    if (!Array.isArray(value[surface])) fail('INVALID_SURFACE', `${surface} must be an array`);
    const entries = value[surface].map((item, index) => normalizeSurfaceEntry(surface, item, index));
    if (new Set(entries.map((entry) => entry.key)).size !== entries.length) fail('DUPLICATE_SURFACE_KEY', `${surface} contains a duplicate canonical key`);
    normalized[surface] = entries.sort((left, right) => left.key.localeCompare(right.key));
  }
  return normalized;
}

function emptySurfaces(surfaces) {
  return SURFACES.every((surface) => surfaces[surface].length === 0);
}

export function normalizeRepoBuiltFixture(value, currentMainSha) {
  const mainSha = normalizeMainSha(currentMainSha);
  assertKeys(value, ['observedMainSha', 'repoBuiltProfile', 'canonicalManifest', 'overlayManifests', 'surfaces'], 'repoFixture');
  const repoBuiltProfile = typeof value.repoBuiltProfile === 'string' ? value.repoBuiltProfile.trim().toUpperCase() : '';
  if (!PROFILES.has(repoBuiltProfile)) fail('INVALID_REPO_BUILT_PROFILE', 'repoBuiltProfile is invalid');
  const canonicalManifest = normalizeManifest(value.canonicalManifest, 'canonical');
  if (!Array.isArray(value.overlayManifests)) fail('INVALID_OVERLAY_MANIFESTS', 'overlayManifests must be an array');
  const overlayManifests = value.overlayManifests.map((item) => normalizeManifest(item, 'overlay'));
  if (new Set(overlayManifests.map((item) => item.identity)).size !== overlayManifests.length) fail('DUPLICATE_OVERLAY_MANIFEST', 'overlay manifests must be unique');
  overlayManifests.sort((left, right) => left.identity.localeCompare(right.identity));
  const surfaces = normalizeSurfaces(value.surfaces);
  if (
    (repoBuiltProfile === 'CANONICAL_ONLY' && (!canonicalManifest || overlayManifests.length !== 0)) ||
    (repoBuiltProfile === 'OVERLAY_AUGMENTED' && (!canonicalManifest || overlayManifests.length === 0)) ||
    (repoBuiltProfile === 'NOT_RUN' && (overlayManifests.length !== 0 || !emptySurfaces(surfaces)))
  ) fail('INVALID_REPO_BUILT_PROFILE', 'profile does not match canonical, overlay, and surface evidence');
  return {
    observedMainSha: normalizeObservedMainSha(value.observedMainSha, mainSha, 'repoFixture.observedMainSha'),
    repoBuiltProfile,
    canonicalManifest,
    overlayManifests,
    surfaces,
  };
}

export function normalizeEnvironmentSnapshot(value, expectedEnvironment, currentMainSha) {
  const mainSha = normalizeMainSha(currentMainSha);
  assertKeys(value, ['schemaVersion', 'environment', 'projectRef', 'observedAt', 'observedMainSha', 'evidenceRef', 'surfaces'], 'environmentSnapshot');
  if (value.schemaVersion !== 1) fail('INVALID_SNAPSHOT', 'schemaVersion must be 1');
  const environment = typeof value.environment === 'string' ? value.environment.trim().toUpperCase() : '';
  if (environment !== expectedEnvironment) fail('ENVIRONMENT_MISMATCH', `expected ${expectedEnvironment}, got ${environment || '<empty>'}`);
  const projectRef = typeof value.projectRef === 'string' ? value.projectRef.trim().toLowerCase() : '';
  if (projectRef !== PROJECT_REFS[environment]) fail('PROJECT_REF_MISMATCH', `expected ${environment} project ${PROJECT_REFS[environment]}`);
  const calendar = typeof value.observedAt === 'string' ? ISO_UTC.exec(value.observedAt) : null;
  if (!calendar) {
    fail('INVALID_OBSERVED_AT', 'observedAt must be an ISO UTC timestamp');
  }
  const [year, month, day, hour, minute, second] = calendar.slice(1, 7).map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day ||
    parsed.getUTCHours() !== hour || parsed.getUTCMinutes() !== minute || parsed.getUTCSeconds() !== second
  ) fail('INVALID_OBSERVED_AT', 'observedAt must be a valid UTC calendar timestamp');
  return {
    schemaVersion: 1,
    environment,
    projectRef,
    observedAt: value.observedAt,
    observedMainSha: normalizeObservedMainSha(value.observedMainSha, mainSha, `${environment}.observedMainSha`),
    evidenceRef: normalizeEvidenceRef(value.evidenceRef, `${environment}.evidenceRef`),
    surfaces: normalizeSurfaces(value.surfaces),
  };
}

function entriesByKey(entries) {
  return new Map(entries.map((entry) => [entry.key, entry]));
}

function compareSurface(repoEntries, testEntries, productionEntries, repoVerified) {
  const repo = entriesByKey(repoEntries);
  const test = entriesByKey(testEntries);
  const production = entriesByKey(productionEntries);
  const keys = [...new Set([...repo.keys(), ...test.keys(), ...production.keys()])].sort();
  return keys.map((key) => {
    const repoEntry = repo.get(key);
    const testEntry = test.get(key);
    const productionEntry = production.get(key);
    const repoPresent = repoVerified ? Boolean(repoEntry) : null;
    const testPresent = Boolean(testEntry);
    const productionPresent = Boolean(productionEntry);
    const observedDefinitions = [repoVerified ? repoEntry : null, testEntry, productionEntry]
      .filter(Boolean)
      .map((entry) => entry.definition);
    const definitions = new Set(observedDefinitions);
    return {
      key,
      repoPresent,
      testPresent,
      productionPresent,
      presence: repoVerified
        ? PRESENCE[`${Number(repoPresent)}${Number(testPresent)}${Number(productionPresent)}`]
        : 'REPO_UNVERIFIED',
      definitionStatus: observedDefinitions.length < 2
        ? 'DEFINITION_NOT_COMPARABLE'
        : definitions.size > 1 ? 'SAME_KEY_DEFINITION_MISMATCH' : 'DEFINITION_MATCH',
    };
  });
}

export function compareThreeWaySchemaTruth({ repoFixture, testSnapshot, productionSnapshot, currentMainSha }) {
  const mainSha = normalizeMainSha(currentMainSha);
  const repo = normalizeRepoBuiltFixture(repoFixture, mainSha);
  const test = normalizeEnvironmentSnapshot(testSnapshot, 'TEST', mainSha);
  const production = normalizeEnvironmentSnapshot(productionSnapshot, 'PRODUCTION', mainSha);
  const surfaces = {};
  const repoVerified = repo.repoBuiltProfile !== 'NOT_RUN';
  for (const surface of SURFACES) {
    surfaces[surface] = {
      entries: compareSurface(repo.surfaces[surface], test.surfaces[surface], production.surfaces[surface], repoVerified),
    };
  }
  return {
    observedMainSha: mainSha,
    repoBuilt: {
      profile: repo.repoBuiltProfile,
      canonicalManifest: repo.canonicalManifest,
      overlayManifests: repo.overlayManifests,
    },
    limitations: { columns: 'ORDINAL_NOT_COMPARED', routines: 'BODY_NOT_COMPARED' },
    surfaces,
  };
}
