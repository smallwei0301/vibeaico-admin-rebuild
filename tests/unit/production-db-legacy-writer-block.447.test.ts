import { describe, expect, it, vi } from 'vitest';

import { EXPECTED_PROJECT_REFS } from '../../scripts/agents/schema-truth-evidence.mjs';
import { runMigrationWorkflow } from '../../scripts/db/run-migrations.mjs';

describe('Issue #447 legacy Production writer bypass', () => {
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
        migrationSha256: (await import('../../scripts/agents/schema-truth-guardrails.mjs')).sha256(Buffer.from(sql)),
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
