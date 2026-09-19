import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/0125_issue_17_booking_addons_legacy_enum.sql', 'utf8');

describe('booking-addons canonical migration compatibility', () => {
  it('reconciles the historical enum before the canonical text migration', () => {
    expect(migration).toContain("v_type_name <> 'addon_performance_mode'");
    expect(migration).toContain("when 'PRIMARY' then 'INHERIT'");
    expect(migration).toContain('alter column performance_mode type text');
    expect(migration).toContain("alter column performance_mode set default 'INHERIT'");
  });
});
