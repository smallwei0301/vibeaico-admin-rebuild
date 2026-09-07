import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  compareMigrationIdentitySnapshot,
  normalizeMigrationIdentitySnapshot,
} from '../../scripts/agents/migration-identity-compare.mjs';

const MAIN = 'a'.repeat(40);
const TEST_REF = 'nmwhwngojosmagjuvxol';
const script = resolve(process.cwd(), 'scripts/agents/migration-identity-compare.mjs');

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    environment: 'TEST',
    projectRef: TEST_REF,
    observedAt: '2026-09-07T12:00:00Z',
    observedMainSha: MAIN,
    evidenceRef: 'supabase:test/migration-ledger',
    ledgerState: 'PRESENT',
    identities: ['0001_initial_schema', '0002_add_customers'],
    ...overrides,
  };
}

const manifest = {
  count: 2,
  manifestDigest: 'f'.repeat(64),
  files: [
    { path: 'supabase/migrations/0001_initial_schema.sql', bytes: 1, sha256: '1'.repeat(64) },
    { path: 'supabase/migrations/0003_add_bookings.sql', bytes: 1, sha256: '2'.repeat(64) },
  ],
};

describe('migration identity comparer', () => {
  it('emits stable statuses for exact, ledger-only, main-only, and prefix-name drift', () => {
    const result = compareMigrationIdentitySnapshot({
      snapshot: snapshot(),
      migrationManifest: manifest,
      currentMainSha: MAIN,
    });

    expect(result).toEqual({
      environment: 'TEST',
      projectRef: TEST_REF,
      observedAt: '2026-09-07T12:00:00Z',
      observedMainSha: MAIN,
      evidenceRef: 'supabase:test/migration-ledger',
      ledgerState: 'PRESENT',
      comparisonState: 'COMPARED',
      entries: [
        {
          prefix: '0001',
          ledgerIdentity: '0001_initial_schema',
          mainIdentity: '0001_initial_schema',
          status: 'ON_MAIN_EXACT',
        },
        {
          prefix: '0002',
          ledgerIdentity: '0002_add_customers',
          mainIdentity: null,
          status: 'LEDGER_ONLY_IDENTITY',
        },
        {
          prefix: '0003',
          ledgerIdentity: null,
          mainIdentity: '0003_add_bookings',
          status: 'MAIN_ONLY_FILE',
        },
      ],
    });

    const collision = compareMigrationIdentitySnapshot({
      snapshot: snapshot({ identities: ['0001_initial_draft'] }),
      migrationManifest: manifest,
      currentMainSha: MAIN,
    });
    expect(collision.entries).toEqual([
      {
        prefix: '0001',
        ledgerIdentity: '0001_initial_draft',
        mainIdentity: '0001_initial_schema',
        status: 'PREFIX_COLLISION_NAME_MISMATCH',
      },
      {
        prefix: '0003',
        ledgerIdentity: null,
        mainIdentity: '0003_add_bookings',
        status: 'MAIN_ONLY_FILE',
      },
    ]);
  });

  it('rejects unsanitized, stale, cross-project, malformed, and duplicate evidence', () => {
    expect(() => normalizeMigrationIdentitySnapshot(snapshot({ unexpected: 'raw rows are forbidden' }), 'TEST', MAIN))
      .toThrow(/UNKNOWN_OR_MISSING_FIELD/);
    expect(() => normalizeMigrationIdentitySnapshot(snapshot({ observedMainSha: 'b'.repeat(40) }), 'TEST', MAIN))
      .toThrow(/STALE_MAIN_SHA/);
    expect(() => normalizeMigrationIdentitySnapshot(snapshot({ projectRef: 'egehnijjpgijmccagxac' }), 'TEST', MAIN))
      .toThrow(/PROJECT_REF_MISMATCH/);
    expect(() => normalizeMigrationIdentitySnapshot(snapshot({ identities: ['0001_initial_schema.sql'] }), 'TEST', MAIN))
      .toThrow(/INVALID_MIGRATION_IDENTITY/);
    expect(() => normalizeMigrationIdentitySnapshot(snapshot({ identities: ['0001_initial_schema', '0001_initial_schema'] }), 'TEST', MAIN))
      .toThrow(/DUPLICATE_IDENTITY/);
  });

  it('retains multiple ledger names under one prefix as explicit collision entries', () => {
    const result = compareMigrationIdentitySnapshot({
      snapshot: snapshot({ identities: ['0084_catalog_bridge', '0084_catalog_branch_draft'] }),
      migrationManifest: {
        ...manifest,
        files: [{ path: 'supabase/migrations/0084_catalog_bridge.sql', bytes: 1, sha256: '8'.repeat(64) }],
      },
      currentMainSha: MAIN,
    });

    expect(result.entries).toEqual([
      {
        prefix: '0084',
        ledgerIdentity: '0084_catalog_branch_draft',
        mainIdentity: '0084_catalog_bridge',
        status: 'PREFIX_COLLISION_NAME_MISMATCH',
      },
      {
        prefix: '0084',
        ledgerIdentity: '0084_catalog_bridge',
        mainIdentity: '0084_catalog_bridge',
        status: 'ON_MAIN_EXACT',
      },
    ]);
  });

  it.each([
    ['ABSENT', 'LEDGER_ABSENT'],
    ['UNAVAILABLE', 'LEDGER_UNAVAILABLE'],
  ])('preserves %s as incomplete evidence instead of reporting a match', (ledgerState, comparisonState) => {
    const result = compareMigrationIdentitySnapshot({
      snapshot: snapshot({ ledgerState, identities: [] }),
      migrationManifest: manifest,
      currentMainSha: MAIN,
    });

    expect(result.comparisonState).toBe(comparisonState);
    expect(result.entries.every((entry) => entry.status !== 'ON_MAIN_EXACT')).toBe(true);
    expect(result.entries).toEqual([]);
  });

  it('rejects non-canonical repository migration paths before comparison', () => {
    expect(() => compareMigrationIdentitySnapshot({
      snapshot: snapshot(),
      migrationManifest: {
        ...manifest,
        files: [{ path: 'supabase/migrations/nested/0001_initial_schema.sql', bytes: 1, sha256: '1'.repeat(64) }],
      },
      currentMainSha: MAIN,
    })).toThrow(/INVALID_MAIN_MIGRATION_IDENTITY/);
  });

  it('writes a deterministic JSON report atomically and preserves earlier output on invalid input', () => {
    const directory = mkdtempSync(join(tmpdir(), 'migration-identity-cli-'));
    const repoRoot = join(directory, 'repo');
    const snapshotPath = join(directory, 'ledger.json');
    const outputPath = join(directory, 'comparison.json');
    try {
      mkdirSync(join(repoRoot, 'supabase', 'migrations'), { recursive: true });
      writeFileSync(join(repoRoot, 'supabase', 'migrations', '0001_initial_schema.sql'), 'select 1;\n');
      execFileSync('git', ['init', '--initial-branch=main'], { cwd: repoRoot });
      execFileSync('git', ['config', 'user.email', 'governance@example.test'], { cwd: repoRoot });
      execFileSync('git', ['config', 'user.name', 'Governance test'], { cwd: repoRoot });
      execFileSync('git', ['add', '.'], { cwd: repoRoot });
      execFileSync('git', ['commit', '-m', 'fixture'], { cwd: repoRoot });
      const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
      writeFileSync(snapshotPath, JSON.stringify(snapshot({
        observedMainSha: head,
        identities: ['0001_initial_schema'],
      })));
      execFileSync(process.execPath, [script, 'compare',
        '--ledger-snapshot', snapshotPath,
        '--repo-root', repoRoot,
        '--current-main-sha', head,
        '--json-out', outputPath,
      ]);
      expect(JSON.parse(readFileSync(outputPath, 'utf8'))).toMatchObject({
        comparisonState: 'COMPARED',
        entries: [{ status: 'ON_MAIN_EXACT' }],
      });

      writeFileSync(outputPath, '{"preserve":true}\n');
      writeFileSync(snapshotPath, JSON.stringify(snapshot({ observedMainSha: MAIN })));
      expect(() => execFileSync(process.execPath, [script, 'compare',
        '--ledger-snapshot', snapshotPath,
        '--repo-root', repoRoot,
        '--current-main-sha', MAIN,
        '--json-out', outputPath,
      ], { stdio: 'pipe' })).toThrow(/STALE_REPOSITORY_HEAD/);
      expect(readFileSync(outputPath, 'utf8')).toBe('{"preserve":true}\n');

      writeFileSync(join(repoRoot, 'supabase', 'migrations', '0001_initial_schema.sql'), 'select 2;\n');
      expect(() => execFileSync(process.execPath, [script, 'compare',
        '--ledger-snapshot', snapshotPath,
        '--repo-root', repoRoot,
        '--current-main-sha', head,
        '--json-out', outputPath,
      ], { stdio: 'pipe' })).toThrow(/DIRTY_REPOSITORY/);
      expect(readFileSync(outputPath, 'utf8')).toBe('{"preserve":true}\n');

      writeFileSync(snapshotPath, JSON.stringify(snapshot({ unexpected: 'forbidden' })));
      expect(() => execFileSync(process.execPath, [script, 'compare',
        '--ledger-snapshot', snapshotPath,
        '--repo-root', repoRoot,
        '--current-main-sha', head,
        '--json-out', outputPath,
      ], { stdio: 'pipe' })).toThrow();
      expect(readFileSync(outputPath, 'utf8')).toBe('{"preserve":true}\n');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
