import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('direct release transport CA trust #589', () => {
  it('pins the Supabase CA bundle for canonical TEST G3 and post-TEST schema reads', () => {
    const source = read('.github/workflows/ci.yml');

    expect(source).toContain('NODE_EXTRA_CA_CERTS: ${{ github.workspace }}/config/supabase-production-root-bundle.crt');
    expect(source.match(/test -s "\$NODE_EXTRA_CA_CERTS"/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source).not.toContain('rejectUnauthorized: false');
  });

  it('pins the same CA bundle for the standalone read-only schema observer', () => {
    const source = read('.github/workflows/agent-schema-drift-watch.yml');

    expect(source).toContain('NODE_EXTRA_CA_CERTS: ${{ github.workspace }}/config/supabase-production-root-bundle.crt');
    expect(source).toContain('test -s "$NODE_EXTRA_CA_CERTS"');
    expect(source).not.toContain('rejectUnauthorized: false');
  });
});
