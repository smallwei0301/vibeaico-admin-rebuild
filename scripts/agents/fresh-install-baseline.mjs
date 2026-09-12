#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const BASELINE_MANIFEST =
  'supabase/local-migrations/fresh-install-compatibility-baseline/manifest.json';
export const HISTORICAL_MANIFEST =
  'supabase/local-migrations/historical-integration-baseline/manifest.json';
const CANONICAL_ROOT = 'supabase/migrations';
const MIGRATION_FILENAME = /^\d{4}_[a-z0-9_]+\.sql$/;
const GIT_OBJECT_ID = /^[0-9a-f]{40}$/;
const SHA256_DIGEST = /^[0-9a-f]{64}$/;
const CLASSIFICATION = 'COMPATIBILITY_ONLY';
const TRANSFORM = 'WRAP_IN_TRANSACTION';
const PROFILE = 'FRESH_INSTALL_COMPATIBILITY_BASELINE';
const REPOSITORY = 'smallwei0301/vibeaico-admin-rebuild';
const CAP_FILES = new Set([
  '0030_trip_plan_global_limit.sql',
  '0031_trip_plan_limit_lock_repair.sql',
  '0032_trip_plan_statement_guard.sql',
]);

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const gitBlobSha = (bytes) => crypto.createHash('sha1')
  .update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
const reject = (message) => { throw new Error(`FRESH_INSTALL_BASELINE_BLOCKED: ${message}`); };

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) reject(`${label} must be an object`);
  const actual = Object.keys(value).sort().join(',');
  const wanted = [...expected].sort().join(',');
  if (actual !== wanted) reject(`${label} has unknown or missing fields`);
}

function readJson(root, relative) {
  const file = path.join(root, ...relative.split('/'));
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    reject(`cannot read ${relative}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function plainFile(root, relative) {
  const parts = relative.split('/');
  let current = root;
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) reject(`symlink input: ${relative}`);
    if (index < parts.length - 1 && !stat.isDirectory()) reject(`non-directory input: ${relative}`);
    if (index === parts.length - 1 && !stat.isFile()) reject(`non-file input: ${relative}`);
  }
  return fs.readFileSync(current);
}

function validateCanonical(canonical) {
  if (!Array.isArray(canonical) || canonical.length === 0) reject('canonical migrations missing');
  const names = new Set();
  const prefixes = new Set();
  for (const file of canonical) {
    exactKeys(file, ['name', 'content'], 'canonical entry');
    if (!MIGRATION_FILENAME.test(file.name) || names.has(file.name) || prefixes.has(file.name.slice(0, 4))) {
      reject(`invalid or colliding canonical identity: ${file.name}`);
    }
    if (!Buffer.isBuffer(file.content) || file.content.length === 0) reject(`empty canonical SQL: ${file.name}`);
    names.add(file.name);
    prefixes.add(file.name.slice(0, 4));
  }
  const sourceDigest = sha256(JSON.stringify([...canonical]
    .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    .map((file) => ({ name: file.name, sha256: sha256(file.content) }))));
  return { names, prefixes, sourceDigest };
}

function validateManifest(manifest, historical, canonicalNames, canonicalPrefixes) {
  exactKeys(manifest, ['version', 'profile', 'mode', 'source', 'entries', 'contracts'], 'baseline manifest');
  exactKeys(manifest.source,
    ['repository', 'mainHead', 'canonicalSourceDigest', 'historicalManifest', 'historicalHead'],
    'baseline source');
  if (manifest.version !== 1 || manifest.profile !== PROFILE || manifest.mode !== 'LOCAL_ONLY_TRANSITIONAL') {
    reject('unsupported baseline manifest');
  }
  if (manifest.source.repository !== REPOSITORY || !GIT_OBJECT_ID.test(manifest.source.mainHead) ||
      !SHA256_DIGEST.test(manifest.source.canonicalSourceDigest) ||
      !GIT_OBJECT_ID.test(manifest.source.historicalHead) || manifest.source.historicalManifest !== HISTORICAL_MANIFEST) {
    reject('baseline source identity is invalid');
  }
  exactKeys(historical, ['version', 'mode', 'source', 'reason', 'files'], 'historical manifest');
  if (historical.version !== 1 || historical.mode !== 'LOCAL_ONLY_TRANSITIONAL' ||
      historical.source?.repository !== REPOSITORY || historical.source?.head !== manifest.source.historicalHead) {
    reject('historical manifest identity does not match the baseline');
  }
  if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) reject('baseline entries missing');
  const historicalByName = new Map(historical.files.map((entry) => [entry.name, entry]));
  const names = new Set();
  const prefixes = new Set();
  for (const entry of manifest.entries) {
    exactKeys(entry, ['name', 'blobSha', 'classification', 'reason', 'localTransform'], 'baseline entry');
    if (!MIGRATION_FILENAME.test(entry.name) || !GIT_OBJECT_ID.test(entry.blobSha) || entry.classification !== CLASSIFICATION ||
        typeof entry.reason !== 'string' || entry.reason.trim() === '' || names.has(entry.name) ||
        prefixes.has(entry.name.slice(0, 4)) || canonicalNames.has(entry.name) ||
        canonicalPrefixes.has(entry.name.slice(0, 4))) {
      reject(`invalid or colliding baseline entry: ${entry.name}`);
    }
    const historicalEntry = historicalByName.get(entry.name);
    if (!historicalEntry || historicalEntry.blobSha !== entry.blobSha || historicalEntry.retiredBy ||
        (historicalEntry.localTransform ?? null) !== (entry.localTransform ?? null)) {
      reject(`baseline entry is not the exact historical source: ${entry.name}`);
    }
    if (entry.localTransform !== undefined && entry.localTransform !== null && entry.localTransform !== TRANSFORM) {
      reject(`unsupported baseline transform: ${entry.name}`);
    }
    names.add(entry.name);
    prefixes.add(entry.name.slice(0, 4));
  }
  const contracts = manifest.contracts;
  exactKeys(contracts, ['tripPlanLimit'], 'baseline contracts');
  exactKeys(contracts.tripPlanLimit,
    ['maxPlansPerTenantTrip', 'triggerNames', 'function', 'shape', 'concurrencyLock'],
    'trip-plan contract');
  if (contracts.tripPlanLimit.maxPlansPerTenantTrip !== 100 ||
      contracts.tripPlanLimit.function !== 'public.enforce_trip_plan_limit()' ||
      contracts.tripPlanLimit.shape !== 'STATEMENT_LEVEL' ||
      contracts.tripPlanLimit.concurrencyLock !== 'parent trip row FOR NO KEY UPDATE' ||
      JSON.stringify(contracts.tripPlanLimit.triggerNames) !==
        JSON.stringify(['trip_plan_limit_guard', 'trip_plan_limit_guard_update'])) {
    reject('trip-plan cap contract must remain the approved statement-level 100-plan guard');
  }
  if (manifest.entries.filter((entry) => CAP_FILES.has(entry.name)).length !== CAP_FILES.size) {
    reject('baseline must include exactly the three approved plan-cap sources');
  }
  return { names, prefixes };
}

function assertCapSource(entry, content) {
  if (!CAP_FILES.has(entry.name)) return;
  const source = content.toString('utf8');
  for (const fragment of [
    'lock table public.trip_plans in share row exclusive mode',
    'public.enforce_trip_plan_limit()',
    '> 100',
  ]) {
    if (!source.includes(fragment)) reject(`cap source ${entry.name} lost required fragment: ${fragment}`);
  }
  if (entry.name === '0032_trip_plan_statement_guard.sql') {
    for (const fragment of [
      'referencing new table as new_trip_plans',
      'for no key update',
      'trip_plan_limit_guard_update',
    ]) if (!source.includes(fragment)) reject(`statement cap source lost required fragment: ${fragment}`);
  }
}

export function planFreshInstallBaseline(canonical, baseline, historical, readHistorical) {
  const { names: canonicalNames, prefixes: canonicalPrefixes, sourceDigest } = validateCanonical(canonical);
  if (baseline.source.canonicalSourceDigest !== sourceDigest) {
    reject('canonical migration bytes changed; review the baseline manifest before replay');
  }
  validateManifest(baseline, historical, canonicalNames, canonicalPrefixes);
  const files = canonical.map((file) => ({
    name: file.name,
    content: file.content,
    origin: 'CANONICAL',
    sourcePath: `${CANONICAL_ROOT}/${file.name}`,
  }));
  for (const entry of baseline.entries) {
    const content = readHistorical(entry.name);
    if (!Buffer.isBuffer(content) || gitBlobSha(content) !== entry.blobSha) {
      reject(`historical blob mismatch: ${entry.name}`);
    }
    assertCapSource(entry, content);
    const staged = entry.localTransform === TRANSFORM
      ? Buffer.concat([Buffer.from('begin;\n'), content, Buffer.from('\ncommit;\n')])
      : content;
    files.push({
      name: entry.name,
      content: staged,
      origin: CLASSIFICATION,
      sourcePath: `${HISTORICAL_MANIFEST.slice(0, HISTORICAL_MANIFEST.lastIndexOf('/'))}/${entry.name}`,
      classification: entry.classification,
      localTransform: entry.localTransform ?? null,
    });
  }
  files.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const manifest = files.map(({ content, ...file }) => ({
    ...file,
    bytes: content.length,
    sha256: sha256(content),
  }));
  return {
    files,
    manifest,
    compatibilityEntries: [...baseline.entries].sort((a, b) => a.name.localeCompare(b.name)),
    digest: sha256(JSON.stringify(manifest)),
    profile: PROFILE,
    mainHead: baseline.source.mainHead,
    historicalHead: baseline.source.historicalHead,
  };
}

function gitStatus(root) {
  return execFileSync('git', ['status', '--porcelain', '--untracked-files=all'],
    { cwd: root, encoding: 'utf8' }).trim();
}

function gitSucceeded(root, args) {
  return spawnSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).status === 0;
}

export function createCandidate({ root, destination, expectedHead, projectId }) {
  root = fs.realpathSync(root);
  if (!GIT_OBJECT_ID.test(expectedHead ?? '') || !/^schema-proof-[a-z0-9-]{1,50}$/.test(projectId ?? '')) {
    reject('invalid execution identity');
  }
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  if (git('rev-parse', 'HEAD') !== expectedHead) reject('stale checkout');
  if (gitStatus(root)) reject('schema source checkout is dirty');

  const absoluteDestination = path.resolve(destination);
  const parent = fs.realpathSync(path.dirname(absoluteDestination));
  const resolvedDestination = path.join(parent, path.basename(absoluteDestination));
  const relative = path.relative(root, resolvedDestination);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..') || fs.existsSync(resolvedDestination)) {
    reject('destination must be new and outside the checkout');
  }

  const canonicalNames = fs.readdirSync(path.join(root, CANONICAL_ROOT));
  if (canonicalNames.some((name) => !MIGRATION_FILENAME.test(name))) reject('unaccounted canonical entry');
  const canonical = canonicalNames.map((name) => ({
    name,
    content: plainFile(root, `${CANONICAL_ROOT}/${name}`),
  }));
  const baseline = readJson(root, BASELINE_MANIFEST);
  const historical = readJson(root, HISTORICAL_MANIFEST);
  let resolvedMainHead;
  try {
    resolvedMainHead = git('rev-parse', '--verify', `${baseline.source.mainHead}^{commit}`);
  } catch {
    reject('pinned main source commit is unavailable');
  }
  if (resolvedMainHead !== baseline.source.mainHead ||
      !gitSucceeded(root, ['merge-base', '--is-ancestor', baseline.source.mainHead, expectedHead]) ||
      !gitSucceeded(root, ['diff', '--quiet', baseline.source.mainHead, expectedHead, '--', CANONICAL_ROOT])) {
    reject('pinned main source is not an unchanged canonical ancestor of the checkout');
  }
  const historicalSql = fs.readdirSync(path.join(root, path.dirname(HISTORICAL_MANIFEST)))
    .filter((name) => name.endsWith('.sql'));
  if (historicalSql.some((name) => !historical.files.some((entry) => entry.name === name))) {
    reject('untracked historical SQL');
  }
  const plan = planFreshInstallBaseline(canonical, baseline, historical,
    (name) => plainFile(root, `${path.dirname(HISTORICAL_MANIFEST)}/${name}`));

  let config = plainFile(root, 'supabase/config.toml').toString('utf8');
  if ((config.match(/^project_id = "[^"]+"$/gm) ?? []).length !== 1 ||
      !config.includes('[db.seed]\nenabled = false')) reject('unsupported local config or enabled seed');
  config = config.replace(/^project_id = "[^"]+"$/m, `project_id = "${projectId}"`);
  fs.mkdirSync(path.join(resolvedDestination, CANONICAL_ROOT), { recursive: true });
  fs.writeFileSync(path.join(resolvedDestination, 'supabase/config.toml'), config);
  for (const file of plan.files) fs.writeFileSync(path.join(resolvedDestination, CANONICAL_ROOT, file.name), file.content);
  fs.writeFileSync(path.join(resolvedDestination, 'candidate.json'), JSON.stringify({
    version: 1,
    observedHead: expectedHead,
    profile: PROFILE,
    canonicalApproved: false,
    candidateOverlayIncluded: false,
    remoteDatabaseUsed: false,
    sourceManifestSha256: plan.digest,
    historicalManifest: HISTORICAL_MANIFEST,
    historicalHead: plan.historicalHead,
    compatibilityEntries: plan.compatibilityEntries,
    files: plan.manifest,
    limitation: 'Disposable replay evidence only; it does not approve canonical adoption or authorize any remote apply.',
  }, null, 2) + '\n');
  return plan;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) reject('usage: fresh-install-baseline.mjs <new-local-directory>');
    const result = createCandidate({
      root: process.cwd(),
      destination: process.argv[2],
      expectedHead: process.env.EXPECTED_HEAD,
      projectId: process.env.LOCAL_PROJECT_ID,
    });
    console.log(JSON.stringify({ profile: result.profile, files: result.files.length,
      compatibilityFiles: result.compatibilityEntries.length, sourceManifestSha256: result.digest }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
