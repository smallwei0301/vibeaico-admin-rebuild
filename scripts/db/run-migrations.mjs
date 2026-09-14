#!/usr/bin/env node
// scripts/db/run-migrations.mjs
//
// 依序把 current origin/main 的 supabase/migrations/NNNN_*.sql 套用到指定 Supabase 專案。
// 在任何 SQL HTTP request 之前，先完成整份 migration plan 的 canonical source admission。
//
// 安全原則：
//   1. 只接受本 repo 已知的 canonical TEST / Production project ref。
//   2. 先 read-only fetch origin/main，失敗就停止。
//   3. worktree migration 檔名集合必須與 current origin/main 完全相同。
//   4. 每一檔 exact bytes 都必須通過 schema-truth-guardrails.mjs。
//   5. 整份 plan 全部通過後才開始第一個 database POST。
//
// 注意：source admission 只是必要條件，不是 Production 授權。
// Production DDL / migration 仍需要 Owner 對該次操作另外具名授權。
//
// 用法：
//   SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/db/run-migrations.mjs <project_ref>
//
// token 必須是 Supabase Personal Access Token。專案 anon / service_role / sb_secret
// 不能用於 Management API。

import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import process from 'node:process';

import { admitCanonicalMigrationSource, sha256 } from '../agents/schema-truth-guardrails.mjs';
import { EXPECTED_PROJECT_REFS } from '../agents/schema-truth-evidence.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const MIGRATIONS_DIR = resolve(REPO_ROOT, 'supabase', 'migrations');
const MIGRATION_PREFIX = 'supabase/migrations/';
const API = 'https://api.supabase.com';

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

export function resolveTargetEnvironment(projectRef) {
  const value = String(projectRef ?? '').trim();
  if (value === EXPECTED_PROJECT_REFS.TEST) return 'TEST';
  if (value === EXPECTED_PROJECT_REFS.PRODUCTION) return 'PRODUCTION';
  fail('UNKNOWN_PROJECT_REF', 'project ref is not the canonical TEST or PRODUCTION project');
}

function runGit(repoRoot, args, runner = spawnSync) {
  const result = runner('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    fail('GIT_COMMAND_FAILED', `git ${args.join(' ')} failed: ${String(result.stderr ?? '').trim() || 'unknown error'}`);
  }
  return String(result.stdout ?? '');
}

export function refreshCanonicalMain(repoRoot = REPO_ROOT, runner = spawnSync) {
  runGit(repoRoot, ['fetch', '--quiet', 'origin', 'main'], runner);
  const sha = runGit(repoRoot, ['rev-parse', 'origin/main'], runner).trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sha)) fail('INVALID_MAIN_SHA', 'origin/main did not resolve to a commit SHA');
  return sha;
}

export function listLocalMigrationFiles(migrationsDir = MIGRATIONS_DIR) {
  return readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort();
}

export function listCanonicalMigrationFiles(repoRoot = REPO_ROOT, runner = spawnSync) {
  const output = runGit(
    repoRoot,
    ['ls-tree', '-r', '--name-only', 'origin/main', '--', 'supabase/migrations'],
    runner,
  );
  return output
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter((value) => value.endsWith('.sql'))
    .map((value) => {
      if (!value.startsWith(MIGRATION_PREFIX)) fail('INVALID_CANONICAL_MIGRATION_PATH', value);
      return value.slice(MIGRATION_PREFIX.length);
    })
    .sort();
}

export function assertExactMigrationSet(localFiles, canonicalFiles) {
  if (!Array.isArray(localFiles) || !Array.isArray(canonicalFiles)) fail('INVALID_MIGRATION_SET', 'migration lists must be arrays');
  const local = [...new Set(localFiles.map(String))].sort();
  const canonical = [...new Set(canonicalFiles.map(String))].sort();
  if (local.join('\n') !== canonical.join('\n')) {
    const localSet = new Set(local);
    const canonicalSet = new Set(canonical);
    const branchOnly = local.filter((name) => !canonicalSet.has(name));
    const missingFromWorktree = canonical.filter((name) => !localSet.has(name));
    fail(
      'MIGRATION_SET_MISMATCH',
      `worktree must exactly match origin/main migrations; branchOnly=[${branchOnly.join(', ')}], missingFromWorktree=[${missingFromWorktree.join(', ')}]`,
    );
  }
  return canonical;
}

function defaultReadMigration(repoRoot, relativePath) {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

export function buildAdmittedMigrationPlan({
  repoRoot = REPO_ROOT,
  files,
  targetEnvironment,
  admit = admitCanonicalMigrationSource,
  readMigration = defaultReadMigration,
}) {
  if (!Array.isArray(files) || files.length === 0) fail('NO_MIGRATIONS', 'no canonical migrations were found');
  const plan = [];
  let pinnedMainSha = null;

  for (const filename of files) {
    const migrationPath = `${MIGRATION_PREFIX}${filename}`;
    const admission = admit({
      repoRoot,
      migrationPath,
      targetEnvironment,
    });
    if (admission?.status !== 'SOURCE_ADMITTED' || admission?.databaseMutationAuthorized !== false) {
      fail('INVALID_SOURCE_ADMISSION', `${migrationPath} did not return a safe SOURCE_ADMITTED proof`);
    }
    if (admission.targetEnvironment !== targetEnvironment) {
      fail('TARGET_ENVIRONMENT_MISMATCH', `${migrationPath} admission target changed unexpectedly`);
    }
    if (pinnedMainSha === null) pinnedMainSha = admission.currentMainSha;
    else if (admission.currentMainSha !== pinnedMainSha) {
      fail('CANONICAL_MAIN_MOVED_DURING_PREFLIGHT', 'origin/main changed while building the migration plan');
    }

    const sql = String(readMigration(repoRoot, migrationPath));
    const readDigest = sha256(Buffer.from(sql));
    if (readDigest !== admission.migrationSha256) {
      fail('MIGRATION_BYTES_CHANGED_AFTER_ADMISSION', `${migrationPath} changed after source admission`);
    }

    plan.push({
      filename,
      migrationPath,
      sql,
      currentMainSha: admission.currentMainSha,
      migrationSha256: admission.migrationSha256,
    });
  }

  return {
    targetEnvironment,
    currentMainSha: pinnedMainSha,
    migrations: plan,
    databaseMutationAuthorized: false,
  };
}

export async function executeMigrationPlan({
  plan,
  projectRef,
  token,
  fetchImpl = fetch,
  log = console,
}) {
  const results = [];
  for (const entry of plan.migrations) {
    const res = await fetchImpl(`${API}/v1/projects/${projectRef}/database/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: entry.sql }),
    });
    const text = await res.text();
    if (!res.ok) {
      log.error(`[migrate] ✗ ${entry.filename} 失敗（HTTP ${res.status}）：${text}`);
      fail('MIGRATION_EXECUTION_FAILED', `${entry.filename} failed with HTTP ${res.status}`);
    }
    log.log(`[migrate] ✓ ${entry.filename}`);
    results.push({ filename: entry.filename, status: 'APPLIED' });
  }
  return results;
}

export async function runMigrationWorkflow({
  projectRef,
  token,
  repoRoot = REPO_ROOT,
  migrationsDir = MIGRATIONS_DIR,
  refreshMain = refreshCanonicalMain,
  listLocalFiles = listLocalMigrationFiles,
  listCanonicalFiles = listCanonicalMigrationFiles,
  admit = admitCanonicalMigrationSource,
  readMigration = defaultReadMigration,
  fetchImpl = fetch,
  log = console,
}) {
  if (!token) fail('MISSING_ACCESS_TOKEN', 'SUPABASE_ACCESS_TOKEN is required');
  const targetEnvironment = resolveTargetEnvironment(projectRef);

  const fetchedMainSha = refreshMain(repoRoot);
  const localFiles = listLocalFiles(migrationsDir);
  const canonicalFiles = listCanonicalFiles(repoRoot);
  const files = assertExactMigrationSet(localFiles, canonicalFiles);

  // Critical ordering: build the whole admitted in-memory plan before the first DB request.
  const plan = buildAdmittedMigrationPlan({
    repoRoot,
    files,
    targetEnvironment,
    admit,
    readMigration,
  });
  if (plan.currentMainSha !== fetchedMainSha) {
    fail('CANONICAL_MAIN_CHANGED_AFTER_FETCH', 'origin/main changed after the preflight fetch');
  }

  log.log(`[migrate] source preflight 通過：${targetEnvironment} / main ${plan.currentMainSha} / ${plan.migrations.length} migrations`);
  if (targetEnvironment === 'PRODUCTION') {
    log.warn('[migrate] 注意：source preflight 通過不等於 Production 授權；仍需本次具名 Owner authorization。');
  }

  const results = await executeMigrationPlan({ plan, projectRef, token, fetchImpl, log });
  return { plan, results };
}

async function main() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const projectRef = process.argv[2];
  if (!projectRef) {
    console.error('[migrate] 用法：SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/db/run-migrations.mjs <project_ref>');
    process.exitCode = 1;
    return;
  }

  try {
    const { plan } = await runMigrationWorkflow({ projectRef, token });
    console.log(`[migrate] 全部 migration 套用完成。source main=${plan.currentMainSha}`);
  } catch (error) {
    console.error('[migrate] 中止：', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main();
}
