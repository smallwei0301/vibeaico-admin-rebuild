import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  gitBlobSha,
  stageLocalMigrationOverlay,
} from '../../scripts/ci/stage-local-migration-ledger.mjs';

function fixture() {
  const root = join(tmpdir(), `vibeaico-local-ledger-${crypto.randomUUID()}`);
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

describe('local migration overlay', () => {
  it('verifies Git blob integrity and stages into the disposable migration directory', () => {
    const { root, target } = fixture();
    try {
      const result = stageLocalMigrationOverlay({
        rootDir: root,
        allow: true,
        testProfile: 'LOCAL_ISOLATED',
      });
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
      expect(() => stageLocalMigrationOverlay({
        rootDir: root,
        allow: true,
        testProfile: 'LOCAL_ISOLATED',
      })).toThrow('blob integrity mismatch');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('never overwrites a canonical migration with the same filename', () => {
    const { root, target } = fixture();
    try {
      writeFileSync(join(target, '0015_example.sql'), 'canonical\n');
      expect(() => stageLocalMigrationOverlay({
        rootDir: root,
        allow: true,
        testProfile: 'LOCAL_ISOLATED',
      })).toThrow('refusing to overwrite canonical migration path');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
