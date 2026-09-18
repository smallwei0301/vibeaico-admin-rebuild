import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('Production DB writer credential proof #447', () => {
  it('fails the job while preserving sanitized NOT_EVIDENCED evidence', () => {
    const dir = mkdtempSync(join(tmpdir(), 'writer-proof-'));
    const out = join(dir, 'proof.json');
    const result = spawnSync(
      process.execPath,
      ['scripts/agents/production-db-writer-credential-proof.mjs', 'a'.repeat(40), out],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PRODUCTION_DB_WRITER_URL: '',
          WRITER_CREDENTIAL_ENVIRONMENT: 'production-db-writer',
        },
        encoding: 'utf8',
      },
    );

    expect(result.status).not.toBe(0);
    const evidence = JSON.parse(readFileSync(out, 'utf8'));
    expect(evidence.status).toBe('PRODUCTION_DB_PROJECT_BOUND_WRITER_CREDENTIAL_NOT_EVIDENCED');
    expect(evidence.databaseMutationAuthorized).toBe(false);
    expect(evidence.reason).toBeTruthy();
    expect(JSON.stringify(evidence)).not.toContain('postgresql://');
  });
});
