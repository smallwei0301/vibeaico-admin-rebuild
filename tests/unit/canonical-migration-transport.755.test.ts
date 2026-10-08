import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { canonicalMigrationTransport } from '../../scripts/db/canonical-migration-transport.mjs';

const repoFile = '0135_issue_46_guide_interval_availability';
const path = `supabase/migrations/${repoFile}.sql`;
const canonical = readFileSync(path, 'utf8');
const digest = (sql: string) => createHash('sha256').update(sql).digest('hex');
const canonicalHash = 'c798b1596d149d1f866553bf8736bea7214fc7bd0531ea750f2511a17d39a59d';
const transportHash = '961e480475c488b484086a058f68391ca0e512e6aafcc64e13c3246acabefb87';
const entry = { repoFile, path, sha256: canonicalHash };

describe('exact canonical 0135 atomic transport #755', () => {
  it('removes only the pinned outer commands while preserving every other byte', () => {
    const result = canonicalMigrationTransport({ entry, sql: canonical });
    const begin = canonical.indexOf('begin;');
    const commit = canonical.lastIndexOf('commit;');
    const expected = canonical.slice(0, begin) + canonical.slice(begin + 6, commit) + canonical.slice(commit + 7);
    expect(result).toEqual({ sql: expected, canonicalSha256: canonicalHash, transportSha256: transportHash });
    expect(digest(canonical)).toBe(canonicalHash);
    expect(result.sql).toContain('do $$\nbegin');
    expect(result.sql).toContain('end;\n$$;');
  });

  it.each(['\n', 'commit;', 'rollback;', 'set role postgres;', '-- altered'])('rejects changed canonical source even if a caller re-pins its plan: %s', (extra) => {
    const sql = canonical + extra;
    expect(() => canonicalMigrationTransport({ entry: { ...entry, sha256: digest(sql) }, sql })).toThrow(/CANONICAL_TRANSPORT_PIN_MISMATCH/);
  });

  it('rejects plan digest mismatch before transforming', () => {
    expect(() => canonicalMigrationTransport({ entry: { ...entry, sha256: '0'.repeat(64) }, sql: canonical })).toThrow(/MIGRATION_BYTES_MISMATCH/);
  });

  it.each([
    { ...entry, repoFile: '0135_wrong_identity' },
    { ...entry, path: 'supabase/migrations/other.sql' },
  ])('rejects partial matching identity/path', (changed) => {
    expect(() => canonicalMigrationTransport({ entry: changed, sql: canonical })).toThrow(/CANONICAL_TRANSPORT_IDENTITY_MISMATCH/);
  });

  it('does not transform or admit boundaries for any other identity', () => {
    const sql = 'begin;\ncreate table public.x(id int);\ncommit;';
    const result = canonicalMigrationTransport({ entry: { repoFile: '0901_other', path: 'supabase/migrations/0901_other.sql', sha256: digest(sql) }, sql });
    expect(result.sql).toBe(sql); // Each caller must still run its atomic-admission gate.
    expect(result.transportSha256).toBe(result.canonicalSha256);
  });
});
