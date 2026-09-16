import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Issue #447 controlled writer route truth', () => {
  it('legacy runner hard-stops Production and points to controlled writer', () => {
    const text = readFileSync(resolve(process.cwd(), 'scripts/db/run-migrations.mjs'), 'utf8');
    expect(text).toContain('PRODUCTION_CONTROLLED_WRITER_REQUIRED');
    expect(text).toContain('controlled Production DB writer');
  });
});
