import { describe, expect, it } from 'vitest';

import { admitCanonicalMigrationSource } from '../../scripts/agents/schema-truth-guardrails.mjs';

describe('Issue #427 canonical migration source admission', () => {
  it('pins admission to origin/main and rejects alternate refs before reading migration bytes', () => {
    expect(() => admitCanonicalMigrationSource({
      repoRoot: process.cwd(),
      migrationPath: 'supabase/migrations/0001_example.sql',
      targetEnvironment: 'TEST',
      mainRef: 'HEAD',
    })).toThrow(/INVALID_MAIN_REF/);
  });

  it('rejects non-canonical migration paths before invoking Git', () => {
    expect(() => admitCanonicalMigrationSource({
      repoRoot: process.cwd(),
      migrationPath: 'supabase/local-migrations/0001_example.sql',
      targetEnvironment: 'TEST',
    })).toThrow(/INVALID_MIGRATION_PATH/);
  });
});
