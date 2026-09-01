import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  gitBlobSha,
  stageLocalMigrationOverlay,
} from '../../scripts/ci/stage-local-migration-ledger.mjs';

const PRIMARY_MANIFEST =
  'supabase/local-migrations/historical-integration-baseline/manifest.json';

function fixture() {
  const root = join(tmpdir(), `vibeaico-local-ledger-${randomUUID()}`);
  const source = join(root, 'supabase/local-migrations/historical-integration-baseline');
  const target = join(root, 'supabase/migrations');
  mkdirSync(source, { recursive: true });
  mkdirSync(target, { recursive: true });
  const content = Buffer.from('select 1;\n');
  writeFileSync(join(source, '0015_example.sql'), content);
  writeFileSync(join(source, 'manifest.json'), JSON.stringify({
    version: 1,
    mode: 'LOCAL_ONLY_TRANSITIONAL',
    source: { repository: 'owner/repo', branch: 'old', head: 'abc' },
    files: [{ name: '0015_example.sql', blobSha: gitBlobSha(content) }],
  }));
  return { root, source, target };
}

function stageFixture(root: string, overrides: Record<string, unknown> = {}) {
  return stageLocalMigrationOverlay({
    rootDir: root,
    manifestRelativePath: PRIMARY_MANIFEST,
    allow: true,
    testProfile: 'LOCAL_ISOLATED',
    ...overrides,
  });
}

describe('local migration overlay', () => {
  it('verifies Git blob integrity and stages into the disposable migration directory', () => {
    const { root, target } = fixture();
    try {
      const result = stageFixture(root);
      expect(result).toMatchObject({ count: 1, first: '0015_example.sql', last: '0015_example.sql' });
      expect(readFileSync(join(target, '0015_example.sql'), 'utf8')).toBe('select 1;\n');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses to run without the explicit local-only switch', () => {
    const { root } = fixture();
    try {
      expect(() => stageLocalMigrationOverlay({
        rootDir: root,
        manifestRelativePath: PRIMARY_MANIFEST,
        allow: false,
        testProfile: 'LOCAL_ISOLATED',
      })).toThrow('ALLOW_LOCAL_MIGRATION_OVERLAY=true is required');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses canary or remote profiles', () => {
    const { root } = fixture();
    try {
      expect(() => stageLocalMigrationOverlay({
        rootDir: root,
        manifestRelativePath: PRIMARY_MANIFEST,
        allow: true,
        testProfile: 'LOCAL_ISOLATED_CANARY',
      })).toThrow('allowed only for TEST_PROFILE=LOCAL_ISOLATED');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed on blob mismatch', () => {
    const { root, source } = fixture();
    try {
      const manifestPath = join(source, 'manifest.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      manifest.files[0].blobSha = '0'.repeat(40);
      writeFileSync(manifestPath, JSON.stringify(manifest));
      expect(() => stageFixture(root)).toThrow('blob integrity mismatch');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('wraps a verified lock migration in one local-only transaction', () => {
    const { root, source, target } = fixture();
    try {
      const manifestPath = join(source, 'manifest.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      manifest.files[0].localTransform = 'WRAP_IN_TRANSACTION';
      writeFileSync(manifestPath, JSON.stringify(manifest));
      const result = stageFixture(root);
      expect(result.transformed).toEqual(['0015_example.sql:WRAP_IN_TRANSACTION']);
      expect(readFileSync(join(target, '0015_example.sql'), 'utf8')).toBe(
        'begin;\nselect 1;\n\ncommit;\n',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed on an unknown local transform', () => {
    const { root, source } = fixture();
    try {
      const manifestPath = join(source, 'manifest.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      manifest.files[0].localTransform = 'IGNORE_ERRORS';
      writeFileSync(manifestPath, JSON.stringify(manifest));
      expect(() => stageFixture(root)).toThrow('unsupported local migration transform');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('never overwrites a canonical migration with the same filename', () => {
    const { root, target } = fixture();
    try {
      writeFileSync(join(target, '0015_example.sql'), 'canonical\n');
      expect(() => stageFixture(root)).toThrow('refusing to overwrite canonical migration path');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('stages multiple source manifests and permits an integrity-checked local rename', () => {
    const { root, target } = fixture();
    const second = join(root, 'supabase/local-migrations/issue-candidate');
    mkdirSync(second, { recursive: true });
    const content = Buffer.from('select 2;\n');
    writeFileSync(join(second, '0015a_candidate.sql'), content);
    writeFileSync(join(second, 'manifest.json'), JSON.stringify({
      version: 1,
      mode: 'LOCAL_ONLY_TRANSITIONAL',
      source: {
        repository: 'owner/repo',
        branch: 'candidate',
        head: 'def',
        status: 'CANDIDATE_SOURCE_NOT_CANONICAL',
      },
      files: [{
        name: '0015a_candidate.sql',
        targetName: '0016_candidate_local.sql',
        blobSha: gitBlobSha(content),
      }],
    }));

    try {
      const result = stageLocalMigrationOverlay({
        rootDir: root,
        manifestRelativePaths: [
          PRIMARY_MANIFEST,
          'supabase/local-migrations/issue-candidate/manifest.json',
        ],
        allow: true,
        testProfile: 'LOCAL_ISOLATED',
      });
      expect(result.count).toBe(2);
      expect(result.renamed).toEqual(['0015a_candidate.sql->0016_candidate_local.sql']);
      expect(result.sources[1]).toMatchObject({
        branch: 'candidate',
        status: 'CANDIDATE_SOURCE_NOT_CANONICAL',
      });
      expect(readFileSync(join(target, '0016_candidate_local.sql'), 'utf8')).toBe('select 2;\n');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects duplicate staged filenames across manifests', () => {
    const { root } = fixture();
    const second = join(root, 'supabase/local-migrations/issue-candidate');
    mkdirSync(second, { recursive: true });
    const content = Buffer.from('select 2;\n');
    writeFileSync(join(second, '0016_candidate.sql'), content);
    writeFileSync(join(second, 'manifest.json'), JSON.stringify({
      version: 1,
      mode: 'LOCAL_ONLY_TRANSITIONAL',
      source: { repository: 'owner/repo', branch: 'candidate', head: 'def' },
      files: [{
        name: '0016_candidate.sql',
        targetName: '0015_example.sql',
        blobSha: gitBlobSha(content),
      }],
    }));

    try {
      expect(() => stageLocalMigrationOverlay({
        rootDir: root,
        manifestRelativePaths: [
          PRIMARY_MANIFEST,
          'supabase/local-migrations/issue-candidate/manifest.json',
        ],
        allow: true,
        testProfile: 'LOCAL_ISOLATED',
      })).toThrow('duplicate staged migration across manifests');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
