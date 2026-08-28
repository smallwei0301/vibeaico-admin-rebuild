import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/0037_issue_37_batch_error_classification.sql',
  'utf8',
);

describe('issue #37 batch RPC error classification', () => {
  it('keeps partial success limited to explicit availability and duplicate conflicts', () => {
    expect(migration).toMatch(
      /create or replace function public\.create_trip_departures_batch_with_staff/is,
    );
    expect(migration).toMatch(/sqlstate = 'P0001' and sqlerrm like 'AVAILABILITY_%'/);
    expect(migration).toMatch(
      /sqlstate = '23505' and sqlerrm = 'DEPARTURE_DUPLICATE'/,
    );
    expect(migration).not.toMatch(/sqlstate in \('P0001', '23505'\)/);
  });

  it('rethrows onboarding, missing-primary, and unknown configuration failures', () => {
    expect(migration).toMatch(/GUIDE_ONBOARDING_REQUIRED.*must abort/is);
    expect(migration).toMatch(/PRIMARY_STAFF_REQUIRED.*must abort/is);
    expect(migration).toMatch(/else\s+raise;/is);
  });
});
