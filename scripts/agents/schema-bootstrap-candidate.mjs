#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const HISTORICAL_ROOT = 'supabase/local-migrations/historical-integration-baseline';
const NAME = /^\d{4}_[a-z0-9_]+\.sql$/;
const SHA = /^[0-9a-f]{40}$/;
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const blob = (bytes) => crypto.createHash('sha1')
  .update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
const reject = (message) => { throw new Error(`SCHEMA_BOOTSTRAP_BLOCKED: ${message}`); };

// Pure planning: no SQL execution and no promotion of a historical candidate to canonical authority.
export function planBootstrap(canonical, historical, readHistorical) {
  if (!Array.isArray(canonical) || canonical.length === 0) reject('canonical migrations missing');
  const targets = new Set();
  const prefixes = new Set();
  const reserve = (name) => {
    if (!NAME.test(name) || targets.has(name) || prefixes.has(name.slice(0, 4))) {
      reject('invalid or colliding migration identity');
    }
    targets.add(name);
    prefixes.add(name.slice(0, 4));
  };
  const files = canonical.map(({ name, content }) => {
    reserve(name);
    if (!Buffer.isBuffer(content) || !content.length) reject('canonical SQL must be nonempty bytes');
    return { name, content, origin: 'CANONICAL', sourcePath: `supabase/migrations/${name}` };
  });
  if (historical?.version !== 1 || historical.mode !== 'LOCAL_ONLY_TRANSITIONAL' ||
      historical.source?.repository !== 'smallwei0301/vibeaico-admin-rebuild' ||
      !SHA.test(historical.source?.head ?? '') || !Array.isArray(historical.files) ||
      historical.files.length === 0) reject('invalid historical manifest');
  const retired = [];
  const seen = new Set();
  for (const entry of historical.files) {
    if (!NAME.test(entry.name ?? '') || !SHA.test(entry.blobSha ?? '') || seen.has(entry.name)) {
      reject('invalid or duplicate historical identity');
    }
    seen.add(entry.name);
    // This profile must not grow into the candidate-overlay selector used by ordinary local TEST.
    if (Object.keys(entry).some((key) => !['name', 'blobSha', 'retiredBy', 'localTransform'].includes(key))) {
      reject('unknown historical manifest field');
    }
    const content = readHistorical(entry.name);
    if (!Buffer.isBuffer(content) || blob(content) !== entry.blobSha) reject('historical blob mismatch');
    if (entry.retiredBy) {
      if (!NAME.test(entry.retiredBy) || !targets.has(entry.retiredBy) || entry.localTransform) {
        reject('retirement requires an existing canonical replacement');
      }
      retired.push({ name: entry.name, replacement: entry.retiredBy });
      continue;
    }
    reserve(entry.name);
    if (entry.localTransform && entry.localTransform !== 'WRAP_IN_TRANSACTION') reject('unsupported transform');
    files.push({
      name: entry.name,
      content: entry.localTransform === 'WRAP_IN_TRANSACTION'
        ? Buffer.concat([Buffer.from('begin;\n'), content, Buffer.from('\ncommit;\n')]) : content,
      origin: 'HISTORICAL_COMPATIBILITY_CANDIDATE',
      sourcePath: `${HISTORICAL_ROOT}/${entry.name}`,
    });
  }
  files.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const manifest = files.map(({ content, ...entry }) => ({ ...entry, bytes: content.length, sha256: hash(content) }));
  return { files, manifest, retired, digest: hash(JSON.stringify(manifest)) };
}

function plainFile(root, relative) {
  const parts = relative.split('/');
  let candidate = root;
  for (let index = 0; index < parts.length; index++) {
    candidate = path.join(candidate, parts[index]);
    const stat = fs.lstatSync(candidate);
    if (stat.isSymbolicLink() || (index < parts.length - 1 && !stat.isDirectory())) reject('symlink/non-directory input');
    if (index === parts.length - 1 && !stat.isFile()) reject('input is not a regular file');
  }
  return fs.readFileSync(candidate);
}

export function createCandidate({ root, destination, expectedHead, projectId }) {
  root = fs.realpathSync(root);
  if (!SHA.test(expectedHead ?? '') || !/^schema-proof-[a-z0-9-]{1,50}$/.test(projectId ?? '')) reject('invalid execution identity');
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  if (git('rev-parse', 'HEAD') !== expectedHead) reject('stale checkout');
  if (git('status', '--porcelain', '--untracked-files=all', '--', 'supabase/config.toml', 'supabase/migrations', HISTORICAL_ROOT)) {
    reject('schema source checkout is dirty');
  }
  const parent = fs.realpathSync(path.dirname(path.resolve(destination)));
  destination = path.join(parent, path.basename(destination));
  const relative = path.relative(root, destination);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)) || fs.existsSync(destination)) {
    reject('destination must be new and outside the checkout');
  }
  const names = fs.readdirSync(path.join(root, 'supabase/migrations'));
  if (names.some((name) => !NAME.test(name))) reject('unaccounted canonical entry');
  const historical = JSON.parse(plainFile(root, `${HISTORICAL_ROOT}/manifest.json`));
  const historicalSql = fs.readdirSync(path.join(root, HISTORICAL_ROOT)).filter((name) => name.endsWith('.sql'));
  if (historicalSql.some((name) => !historical.files.some((entry) => entry.name === name))) reject('untracked historical SQL');
  const plan = planBootstrap(names.map((name) => ({ name, content: plainFile(root, `supabase/migrations/${name}`) })),
    historical, (name) => plainFile(root, `${HISTORICAL_ROOT}/${name}`));
  let config = plainFile(root, 'supabase/config.toml').toString('utf8');
  if ((config.match(/^project_id = "[^"]+"$/gm) ?? []).length !== 1 || !config.includes('[db.seed]\nenabled = false')) {
    reject('unsupported local config or enabled seed');
  }
  config = config.replace(/^project_id = "[^"]+"$/m, `project_id = "${projectId}"`);
  fs.mkdirSync(path.join(destination, 'supabase/migrations'), { recursive: true });
  fs.writeFileSync(path.join(destination, 'supabase/config.toml'), config);
  for (const file of plan.files) fs.writeFileSync(path.join(destination, 'supabase/migrations', file.name), file.content);
  const evidence = {
    version: 1, observedHead: expectedHead,
    profile: 'HISTORICAL_COMPATIBILITY_CANDIDATE', canonicalApproved: false,
    candidateOverlayIncluded: false, remoteDatabaseUsed: false,
    sourceManifestSha256: plan.digest, files: plan.manifest, retired: plan.retired,
    limitation: 'Replay success does not approve this bootstrap, prove environment parity, or authorize any remote apply.',
  };
  fs.writeFileSync(path.join(destination, 'candidate.json'), JSON.stringify(evidence, null, 2) + '\n');
  return evidence;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    if (process.argv.length !== 3) reject('usage: schema-bootstrap-candidate.mjs <new-local-directory>');
    const evidence = createCandidate({ root: process.cwd(), destination: process.argv[2],
      expectedHead: process.env.EXPECTED_HEAD, projectId: process.env.LOCAL_PROJECT_ID });
    console.log(JSON.stringify({ profile: evidence.profile, files: evidence.files.length,
      canonicalApproved: false, sourceManifestSha256: evidence.sourceManifestSha256 }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
