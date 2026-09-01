#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_MANIFESTS = Object.freeze([
  'supabase/local-migrations/historical-integration-baseline/manifest.json',
  'supabase/local-migrations/issue-41-candidate-baseline/manifest.json',
]);
const DEFAULT_TARGET = 'supabase/migrations';
const SOURCE_SQL_NAME = /^[0-9a-z]+_[a-z0-9_]+\.sql$/;
const MIGRATION_NAME = /^\d{4}_[a-z0-9_]+\.sql$/;
const LOCAL_TRANSFORMS = new Set(['WRAP_IN_TRANSACTION']);

export function gitBlobSha(content) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return createHash('sha1')
    .update(Buffer.from(`blob ${buffer.length}\0`))
    .update(buffer)
    .digest('hex');
}

export function readOverlayManifest(manifestPath) {
  const parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (parsed.version !== 1) throw new Error(`unsupported local migration manifest version: ${parsed.version}`);
  if (parsed.mode !== 'LOCAL_ONLY_TRANSITIONAL') {
    throw new Error(`local migration manifest mode must be LOCAL_ONLY_TRANSITIONAL, got ${parsed.mode}`);
  }
  if (!parsed.source?.repository || !parsed.source?.branch || !parsed.source?.head) {
    throw new Error('local migration manifest must identify repository, branch, and exact head');
  }
  if (!Array.isArray(parsed.files) || parsed.files.length === 0) {
    throw new Error('local migration manifest must contain at least one file');
  }
  return parsed;
}

export function stageLocalMigrationOverlay({
  rootDir = process.cwd(),
  manifestRelativePath = null,
  manifestRelativePaths = null,
  targetRelativePath = DEFAULT_TARGET,
  allow = process.env.ALLOW_LOCAL_MIGRATION_OVERLAY === 'true',
  testProfile = process.env.TEST_PROFILE ?? '',
} = {}) {
  if (!allow) throw new Error('ALLOW_LOCAL_MIGRATION_OVERLAY=true is required');
  if (String(testProfile).toUpperCase() !== 'LOCAL_ISOLATED') {
    throw new Error('local migration overlay is allowed only for TEST_PROFILE=LOCAL_ISOLATED');
  }

  const selectedManifests = manifestRelativePath
    ? [manifestRelativePath]
    : Array.isArray(manifestRelativePaths) && manifestRelativePaths.length
      ? manifestRelativePaths
      : [...DEFAULT_MANIFESTS];
  const targetRoot = resolve(rootDir, targetRelativePath);
  const seenTargets = new Set();
  const staged = [];
  const sources = [];

  for (const relativeManifest of selectedManifests) {
    const manifestPath = resolve(rootDir, relativeManifest);
    const sourceRoot = dirname(manifestPath);
    const manifest = readOverlayManifest(manifestPath);
    const manifestTargets = new Set();

    const sourceNames = manifest.files.map((entry) => entry.sourceName ?? entry.name);
    const unexpectedSql = readdirSync(sourceRoot)
      .filter((name) => name.endsWith('.sql'))
      .filter((name) => !sourceNames.includes(name));
    if (unexpectedSql.length) {
      throw new Error(`untracked local migration files in ${relativeManifest}: ${unexpectedSql.join(', ')}`);
    }

    for (const entry of manifest.files) {
      const sourceName = entry.sourceName ?? entry.name;
      const targetName = entry.targetName ?? entry.name;
      if (!SOURCE_SQL_NAME.test(sourceName)) throw new Error(`invalid source SQL filename: ${sourceName}`);
      if (!MIGRATION_NAME.test(targetName)) throw new Error(`invalid staged migration filename: ${targetName}`);
      if (manifestTargets.has(targetName)) {
        throw new Error(`duplicate staged migration in manifest ${relativeManifest}: ${targetName}`);
      }
      if (seenTargets.has(targetName)) {
        throw new Error(`duplicate staged migration across manifests: ${targetName}`);
      }
      manifestTargets.add(targetName);
      seenTargets.add(targetName);

      const source = join(sourceRoot, sourceName);
      const target = join(targetRoot, targetName);
      if (!existsSync(source)) throw new Error(`manifest source is missing: ${sourceName}`);
      if (existsSync(target)) {
        throw new Error(`refusing to overwrite canonical migration path: ${targetName}`);
      }

      const content = readFileSync(source);
      const actualBlobSha = gitBlobSha(content);
      if (actualBlobSha !== entry.blobSha) {
        throw new Error(
          `blob integrity mismatch for ${sourceName}: expected ${entry.blobSha}, got ${actualBlobSha}`,
        );
      }

      const transform = entry.localTransform ?? null;
      if (transform && !LOCAL_TRANSFORMS.has(transform)) {
        throw new Error(`unsupported local migration transform for ${sourceName}: ${transform}`);
      }

      const stagedContent = transform === 'WRAP_IN_TRANSACTION'
        ? Buffer.concat([Buffer.from('begin;\n'), content, Buffer.from('\ncommit;\n')])
        : content;
      writeFileSync(target, stagedContent);
      staged.push({
        sourceName,
        targetName,
        blobSha: actualBlobSha,
        transform,
        source: manifest.source,
      });
    }

    sources.push({
      manifest: relativeManifest,
      ...manifest.source,
      status: manifest.source.status ?? 'SOURCE_IDENTIFIED',
      count: manifest.files.length,
    });
  }

  const result = {
    mode: 'LOCAL_ONLY_TRANSITIONAL',
    sources,
    count: staged.length,
    first: staged.at(0)?.targetName ?? null,
    last: staged.at(-1)?.targetName ?? null,
    transformed: staged
      .filter((entry) => entry.transform)
      .map((entry) => `${entry.targetName}:${entry.transform}`),
    renamed: staged
      .filter((entry) => entry.sourceName !== entry.targetName)
      .map((entry) => `${entry.sourceName}->${entry.targetName}`),
    staged,
  };

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    const sourceLines = result.sources.map((source) =>
      `- source: ${source.branch}@${source.head} (${source.status}, ${source.count} files)`,
    );
    appendFileSync(summaryPath, [
      '## Local migration overlays',
      '',
      ...sourceLines,
      `- staged count: ${result.count}`,
      `- range: ${result.first} → ${result.last}`,
      `- local transforms: ${result.transformed.join(', ') || 'none'}`,
      `- local renames: ${result.renamed.join(', ') || 'none'}`,
      '- scope: disposable local Supabase runner only; never a remote migration ledger',
      '',
    ].join('\n'), 'utf8');
  }

  return result;
}

function cli() {
  const result = stageLocalMigrationOverlay();
  console.log(
    `[local-migration-overlay] staged ${result.count} files (${result.first}..${result.last})`,
  );
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entry) cli();
