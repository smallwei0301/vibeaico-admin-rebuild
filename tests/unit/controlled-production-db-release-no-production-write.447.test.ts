import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Issue #447 source-only safety', () => {
  it('unit tests use injected fetch implementations and never embed a Production token', () => {
    const paths = [
      'tests/unit/controlled-production-db-release.447.test.ts',
      'tests/unit/controlled-production-db-release-admission.447.test.ts',
    ];
    for (const path of paths) {
      const text = readFileSync(resolve(process.cwd(), path), 'utf8');
      expect(text).not.toMatch(/sbp_[A-Za-z0-9]/);
      expect(text).not.toMatch(/PRODUCTION_DB_WRITER_TOKEN\s*=/);
    }
  });
});
