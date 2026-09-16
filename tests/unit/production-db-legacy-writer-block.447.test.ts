import { describe, expect, it, vi } from 'vitest';

import { sha256 } from '../../scripts/agents/schema-truth-guardrails.mjs';
import { EXPECTED_PROJECT_REFS } from '../../scripts/agents/schema-truth-evidence.mjs';
import { executeMigrationPlan, runMigrationWorkflow } from '../../scripts/db/run-migrations.mjs';

describe('Issue #447 legacy Production writer bypass', () => {
  it('blocks direct executor calls targeting Production or unknown projects before network', async () => {
    for (const projectRef of [EXPECTED_PROJECT_REFS.PRODUCTION, ` ${EXPECTED_PROJECT_REFS.PRODUCTION} `, 'unknown-project']) {
      const fetchSpy = vi.fn(async () => new Response('', { status: 200 }));
      await expect(executeMigrationPlan({
        projectRef, token: 'test-only-placeholder',
        plan: { migrations: [{ filename: 'arbitrary.sql', sql: 'delete from public.orders;' }] },
        fetchImpl: fetchSpy as unknown as typeof fetch,
        log: { log: vi.fn(), error: vi.fn() } as unknown as Console,
      })).rejects.toThrow(/PRODUCTION_CONTROLLED_WRITER_REQUIRED|UNKNOWN_PROJECT_REF/);
      expect(fetchSpy).not.toHaveBeenCalled();
    }
  });

  it('preserves direct executor behavior for canonical TEST', async () => {
    const sql = 'select 1;';
    const fetchSpy = vi.fn(async () => new Response('', { status: 200 }));
    const result = await executeMigrationPlan({
      projectRef: EXPECTED_PROJECT_REFS.TEST, token: 'test-only-placeholder',
      plan: { migrations: [{ filename: 'test.sql', sql }] },
      fetchImpl: fetchSpy as unknown as typeof fetch,
      log: { log: vi.fn(), error: vi.fn() } as unknown as Console,
    });
    expect(result).toEqual([{ filename: 'test.sql', status: 'APPLIED' }]);
    expect(fetchSpy).toHaveBeenCalledWith(
      `https://api.supabase.com/v1/projects/${EXPECTED_PROJECT_REFS.TEST}/database/query`,
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ query: sql }) }),
    );
  });

  it('fails before git/source work or any network request when legacy runner targets Production', async () => {
    const refreshMain = vi.fn();
    const fetchImpl = vi.fn();
    await expect(runMigrationWorkflow({
      projectRef: EXPECTED_PROJECT_REFS.PRODUCTION,
      token: 'legacy-broad-token',
      refreshMain,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })).rejects.toThrow(/PRODUCTION_CONTROLLED_WRITER_REQUIRED/);
    expect(refreshMain).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not change the canonical TEST path', async () => {
    const sql = 'select 1;';
    const fetchImpl = vi.fn(async () => new Response('', { status: 200 }));
    const result = await runMigrationWorkflow({
      projectRef: EXPECTED_PROJECT_REFS.TEST,
      token: 'test-token',
      repoRoot: '/repo',
      migrationsDir: '/repo/supabase/migrations',
      refreshMain: () => 'a'.repeat(40),
      listLocalFiles: () => ['0001_base.sql'],
      listCanonicalFiles: () => ['0001_base.sql'],
      admit: ({ migrationPath, targetEnvironment }: any) => ({
        schemaVersion: 1,
        status: 'SOURCE_ADMITTED',
        targetEnvironment,
        currentMainSha: 'a'.repeat(40),
        mainRef: 'origin/main',
        migrationPath,
        migrationSha256: sha256(Buffer.from(sql)),
        databaseMutationAuthorized: false,
      }),
      readMigration: () => sql,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      log: console,
    } as any);
    expect(result.plan.targetEnvironment).toBe('TEST');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
