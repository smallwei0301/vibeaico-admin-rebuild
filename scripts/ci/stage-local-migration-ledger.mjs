#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_MANIFEST = 'supabase/local-migrations/historical-integration-baseline/manifest.json';
const DEFAULT_TARGET = 'supabase/migrations';
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
  if (!Array.isArray(parsed.files) || parsed.files.length === 0) {
    throw new Error('local migration manifest must contain at least one file');
  }
  return parsed;
}

export function stageLocalMigrationOverlay({
  rootDir = process.cwd(),
  manifestRelativePath = DEFAULT_MANIFEST,
  targetRelativePath = DEFAULT_TARGET,
  allow = process.env.ALLOW_LOCAL_MIGRATION_OVERLAY === 'true',
  testProfile = process.env.TEST_PROFILE ?? '',
} = {}) {
  if (!allow) throw new Error('ALLOW_LOCAL_MIGRATION_OVERLAY=true is required');
  if (String(testProfile).toUpperCase() !== 'LOCAL_ISOLATED') {
    throw new Error('local migration overlay is allowed only for TEST_PROFILE=LOCAL_ISOLATED');
  }

  const manifestPath = resolve(rootDir, manifestRelativePath);
  const sourceRoot = dirname(manifestPath);
  const targetRoot = resolve(rootDir, targetRelativePath);
  const manifest = readOverlayManifest(manifestPath);
  const seen = new Set();
  const staged = [];

  const unexpectedSql = readdirSync(sourceRoot)
    .filter((name) => name.endsWith('.sql'))
    .filter((name) => !manifest.files.some((entry) => entry.name === name));
  if (unexpectedSql.length) {
    throw new Error(`untracked local migration files: ${unexpectedSql.join(', ')}`);
  }

  for (const entry of manifest.files) {
    if (!MIGRATION_NAME.test(entry.name)) throw new Error(`invalid migration filename: ${entry.name}`);
    if (seen.has(entry.name)) throw new Error(`duplicate migration in manifest: ${entry.name}`);
    seen.add(entry.name);

    const source = join(sourceRoot, entry.name);
    const target = join(targetRoot, entry.name);
    if (!existsSync(source)) throw new Error(`manifest source is missing: ${entry.name}`);
    if (existsSync(target)) {
      throw new Error(`refusing to overwrite canonical migration path: ${entry.name}`);
    }

    const content = readFileSync(source);
    const actualBlobSha = gitBlobSha(content);
    if (actualBlobSha !== entry.blobSha) {
      throw new Error(
        `blob integrity mismatch for ${entry.name}: expected ${entry.blobSha}, got ${actualBlobSha}`,
      );
    }

    const transform = entry.localTransform ?? null;
    if (transform && !LOCAL_TRANSFORMS.has(transform)) {
      throw new Error(`unsupported local migration transform for ${entry.name}: ${transform}`);
    }

    const stagedContent = transform === 'WRAP_IN_TRANSACTION'
      ? Buffer.concat([Buffer.from('begin;\n'), content, Buffer.from('\ncommit;\n')])
      : content;
    writeFileSync(target, stagedContent);
    staged.push({ name: entry.name, blobSha: actualBlobSha, transform });
  }

  const result = {
    mode: manifest.mode,
    source: manifest.source,
    count: staged.length,
    first: staged.at(0)?.name ?? null,
    last: staged.at(-1)?.name ?? null,
    transformed: staged.filter((entry) => entry.transform).map((entry) => `${entry.name}:${entry.transform}`),
    staged,
  };

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    appendFileSync(summaryPath, [
      '## Local migration overlay',
      '',
      `- mode: ${result.mode}`,
      `- source branch: ${result.source.branch}`,
      `- source head: ${result.source.head}`,
      `- staged count: ${result.count}`,
      `- range: ${result.first} → ${result.last}`,
      `- local transforms: ${result.transformed.join(', ') || 'none'}`,
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
