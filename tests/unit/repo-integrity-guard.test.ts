import { describe, expect, it } from 'vitest';

import {
  evaluateRepositoryIntegrity,
  findMigrationIntegrityIssues,
  findStandaloneGitShas,
} from '../../scripts/ci/repo-integrity-guard.mjs';

const completeTree = [
  'package.json',
  'package-lock.json',
  'src/app/layout.tsx',
  'src/server/http.ts',
];

describe('repository integrity guard', () => {
  it('accepts a complete tree with a small intentional deletion', () => {
    expect(evaluateRepositoryIntegrity({
      trackedPaths: completeTree,
      baselineTrackedCount: 1_000,
      deletedPaths: ['docs/obsolete.md'],
      shaFindings: [],
    })).toEqual({ ok: true, errors: [] });
  });

  it('rejects a commit tree that lost a required project area', () => {
    const result = evaluateRepositoryIntegrity({
      trackedPaths: ['package.json', 'package-lock.json', 'src/server/http.ts'],
      baselineTrackedCount: 1_000,
      deletedPaths: [],
      shaFindings: [],
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('required path is missing: src/app/');
  });

  it('rejects an unexpectedly large deletion set', () => {
    const deletedPaths = Array.from({ length: 60 }, (_, index) => `src/removed-${index}.ts`);
    const result = evaluateRepositoryIntegrity({
      trackedPaths: completeTree,
      baselineTrackedCount: 1_000,
      deletedPaths,
      shaFindings: [],
    });

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('unexpected mass deletion: 60 files');
  });

  it('finds a bare commit SHA accidentally appended to source code', () => {
    expect(findStandaloneGitShas(
      'src/app/api/example/route.ts',
      'export const GET = () => Response.json({ ok: true });\n5970ca10bb471066c7bac9e3b7cb4e1bf61e82be\n',
    )).toEqual([
      'src/app/api/example/route.ts:2: standalone 40-character Git SHA',
    ]);
  });

  it('does not flag a SHA embedded in a normal string', () => {
    expect(findStandaloneGitShas(
      'src/example.ts',
      "const expectedHead = '5970ca10bb471066c7bac9e3b7cb4e1bf61e82be';\n",
    )).toEqual([]);
  });
});

describe('migration identity guard', () => {
  const baseMigrations = [
    'supabase/migrations/0077_shop_design_branding.sql',
    'supabase/migrations/0078_staff_schedule_mode.sql',
  ];

  it('accepts a new migration whose prefix advances beyond the base maximum', () => {
    expect(findMigrationIntegrityIssues({
      trackedPaths: [...baseMigrations, 'supabase/migrations/0079_reconcile_drift.sql'],
      baselineTrackedPaths: baseMigrations,
      modifiedPaths: [],
    })).toEqual([]);
  });

  it('rejects a newly introduced stale prefix even when that prefix is absent from main', () => {
    expect(findMigrationIntegrityIssues({
      trackedPaths: [...baseMigrations, 'supabase/migrations/0018_branch_only.sql'],
      baselineTrackedPaths: baseMigrations,
      modifiedPaths: [],
    })).toContain(
      'new migration prefix must be greater than base max 0078: supabase/migrations/0018_branch_only.sql',
    );
  });

  it('rejects duplicate migration prefixes on the candidate head', () => {
    const result = findMigrationIntegrityIssues({
      trackedPaths: [
        ...baseMigrations,
        'supabase/migrations/0079_first.sql',
        'supabase/migrations/0079_second.sql',
      ],
      baselineTrackedPaths: baseMigrations,
      modifiedPaths: [],
    });

    expect(result).toContain(
      'duplicate migration prefix on head: 0079 -> supabase/migrations/0079_first.sql, supabase/migrations/0079_second.sql',
    );
  });

  it('rejects editing a migration that already exists on the base revision', () => {
    expect(findMigrationIntegrityIssues({
      trackedPaths: baseMigrations,
      baselineTrackedPaths: baseMigrations,
      modifiedPaths: ['supabase/migrations/0078_staff_schedule_mode.sql'],
    })).toContain(
      'existing migration modified in place: supabase/migrations/0078_staff_schedule_mode.sql',
    );
  });

  it('rejects deleting or renaming an existing migration', () => {
    expect(findMigrationIntegrityIssues({
      trackedPaths: [
        'supabase/migrations/0077_shop_design_branding.sql',
        'supabase/migrations/0079_staff_schedule_mode.sql',
      ],
      baselineTrackedPaths: baseMigrations,
      modifiedPaths: [],
    })).toContain(
      'existing migration removed or renamed: supabase/migrations/0078_staff_schedule_mode.sql',
    );
  });

  it('rejects files in the migration directory that do not use the canonical NNNN_name.sql shape', () => {
    expect(findMigrationIntegrityIssues({
      trackedPaths: [...baseMigrations, 'supabase/migrations/manual-hotfix.sql'],
      baselineTrackedPaths: baseMigrations,
      modifiedPaths: [],
    })).toContain(
      'invalid migration filename: supabase/migrations/manual-hotfix.sql (expected NNNN_name.sql)',
    );
  });
});
