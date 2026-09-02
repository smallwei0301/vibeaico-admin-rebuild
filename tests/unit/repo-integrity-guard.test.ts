import { describe, expect, it } from 'vitest';

import {
  evaluateRepositoryIntegrity,
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
