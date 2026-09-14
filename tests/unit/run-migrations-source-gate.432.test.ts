import { describe, expect, it, vi } from 'vitest';

import { sha256 } from '../../scripts/agents/schema-truth-guardrails.mjs';
import { EXPECTED_PROJECT_REFS } from '../../scripts/agents/schema-truth-evidence.mjs';
import {
  assertExactMigrationSet,
  resolveTargetEnvironment,
  runMigrationWorkflow,
} from '../../scripts/db/run-migrations.mjs';

const MAIN = 'a'.repeat(40);

function quietLog() {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function admitted(targetEnvironment: string, sql: string) {
  return {
    schemaVersion: 1,
    status: 'SOURCE_ADMITTED',
    targetEnvironment,
    currentMainSha: MAIN,
    mainRef: 'origin/main',
    migrationPath: 'supabase/migrations/example.sql',
    migrationSha256: sha256(Buffer.from(sql)),
    databaseMutationAuthorized: false,
  };
}

describe('Issue #432 migration runner source gate', () => {
  it('accepts only the canonical TEST and Production project refs', () => {
    expect(resolveTargetEnvironment(EXPECTED_PROJECT_REFS.TEST)).toBe('TEST');
    expect(resolveTargetEnvironment(EXPECTED_PROJECT_REFS.PRODUCTION)).toBe('PRODUCTION');
    expect(() => resolveTargetEnvironment('unknown-project')).toThrow(/UNKNOWN_PROJECT_REF/);
  });

  it('rejects branch-only or missing migration filenames before execution', () => {
    expect(() => assertExactMigrationSet(
      ['0001_base.sql', '0002_branch_only.sql'],
      ['0001_base.sql'],
    )).toThrow(/MIGRATION_SET_MISMATCH/);

    expect(() => assertExactMigrationSet(
      ['0001_base.sql'],
      ['0001_base.sql', '0002_main_only.sql'],
    )).toThrow(/MIGRATION_SET_MISMATCH/);
  });

  it('does not send any database request when the migration set differs from origin/main', async () => {
    const fetchImpl = vi.fn();
    await expect(runMigrationWorkflow({
      projectRef: EXPECTED_PROJECT_REFS.TEST,
      token: 'fake-test-token',
      repoRoot: '/repo',
      migrationsDir: '/repo/supabase/migrations',
      refreshMain: () => MAIN,
      listLocalFiles: () => ['0001_base.sql', '0002_branch_only.sql'],
      listCanonicalFiles: () => ['0001_base.sql'],
      fetchImpl,
      log: quietLog(),
    })).rejects.toThrow(/MIGRATION_SET_MISMATCH/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not send any database request when same filename bytes change after admission', async () => {
    const fetchImpl = vi.fn();
    const mainSql = "select 'main-bytes';\n";
    const localSql = "select 'different-worktree-bytes';\n";

    await expect(runMigrationWorkflow({
      projectRef: EXPECTED_PROJECT_REFS.TEST,
      token: 'fake-test-token',
      repoRoot: '/repo',
      migrationsDir: '/repo/supabase/migrations',
      refreshMain: () => MAIN,
      listLocalFiles: () => ['0001_base.sql'],
      listCanonicalFiles: () => ['0001_base.sql'],
      admit: ({ targetEnvironment }: { targetEnvironment: string }) => admitted(targetEnvironment, mainSql),
      readMigration: () => localSql,
      fetchImpl,
      log: quietLog(),
    })).rejects.toThrow(/MIGRATION_BYTES_CHANGED_AFTER_ADMISSION/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('preflights every migration before the first database request', async () => {
    const fetchImpl = vi.fn();
    const sqlByFile: Record<string, string> = {
      'supabase/migrations/0001_base.sql': "select 'one';\n",
      'supabase/migrations/0002_next.sql': "select 'two';\n",
    };
    let admissionCount = 0;

    await expect(runMigrationWorkflow({
      projectRef: EXPECTED_PROJECT_REFS.TEST,
      token: 'fake-test-token',
      repoRoot: '/repo',
      migrationsDir: '/repo/supabase/migrations',
      refreshMain: () => MAIN,
      listLocalFiles: () => ['0001_base.sql', '0002_next.sql'],
      listCanonicalFiles: () => ['0001_base.sql', '0002_next.sql'],
      admit: ({ migrationPath, targetEnvironment }: { migrationPath: string; targetEnvironment: string }) => {
        admissionCount += 1;
        if (admissionCount === 2) throw new Error('MIGRATION_NOT_IN_CURRENT_MAIN');
        return admitted(targetEnvironment, sqlByFile[migrationPath]);
      },
      readMigration: (_repoRoot: string, migrationPath: string) => sqlByFile[migrationPath],
      fetchImpl,
      log: quietLog(),
    })).rejects.toThrow(/MIGRATION_NOT_IN_CURRENT_MAIN/);

    expect(admissionCount).toBe(2);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('executes only after the complete plan is admitted and pinned to one main SHA', async () => {
    const sqlByFile: Record<string, string> = {
      'supabase/migrations/0001_base.sql': "select 'one';\n",
      'supabase/migrations/0002_next.sql': "select 'two';\n",
    };
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => '',
    }));

    const result = await runMigrationWorkflow({
      projectRef: EXPECTED_PROJECT_REFS.TEST,
      token: 'fake-test-token',
      repoRoot: '/repo',
      migrationsDir: '/repo/supabase/migrations',
      refreshMain: () => MAIN,
      listLocalFiles: () => ['0001_base.sql', '0002_next.sql'],
      listCanonicalFiles: () => ['0001_base.sql', '0002_next.sql'],
      admit: ({ migrationPath, targetEnvironment }: { migrationPath: string; targetEnvironment: string }) => admitted(targetEnvironment, sqlByFile[migrationPath]),
      readMigration: (_repoRoot: string, migrationPath: string) => sqlByFile[migrationPath],
      fetchImpl,
      log: quietLog(),
    });

    expect(result.plan.currentMainSha).toBe(MAIN);
    expect(result.plan.databaseMutationAuthorized).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
