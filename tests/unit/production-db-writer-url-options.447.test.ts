import { describe, expect, it } from 'vitest';

import { parseProjectBoundProductionDbWriterUrl } from '../../scripts/db/production-db-postgres-transport.mjs';

const BASE = 'postgresql://production_migration_writer:secret@db.egehnijjpgijmccagxac.supabase.co:5432/postgres';

describe('Production DB writer URL startup parameter boundary #447', () => {
  it('accepts the one canonical connection query parameter', () => {
    expect(parseProjectBoundProductionDbWriterUrl(`${BASE}?sslmode=verify-full`)).toMatchObject({
      projectRef: 'egehnijjpgijmccagxac',
      role: 'production_migration_writer',
      transportMode: 'DIRECT',
    });
  });

  it.each([
    [`${BASE}?sslmode=verify-full&search_path=attacker`, 'search_path'],
    [`${BASE}?sslmode=verify-full&options=-csearch_path%3Dattacker`, 'options'],
    [`${BASE}?sslmode=verify-full&sslmode=disable`, 'duplicate sslmode'],
    [`${BASE}?sslmode=verify-full#ignored-fragment`, 'URL fragment'],
  ])('rejects %s startup override before connecting (%s)', (url) => {
    expect(() => parseProjectBoundProductionDbWriterUrl(url))
      .toThrow(/WRITER_URL_QUERY_PARAMETER_FORBIDDEN/);
  });
});
