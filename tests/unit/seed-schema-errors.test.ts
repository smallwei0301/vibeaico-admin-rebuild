import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isMissingSchemaError } from '../../scripts/test/seed.mjs';

describe('seed schema error classification', () => {
  it('only tolerates a missing relation, not a missing column or function', () => {
    expect(isMissingSchemaError({ code: '42P01', message: 'relation "trip_plans" does not exist' })).toBe(true);
    expect(isMissingSchemaError({ code: 'PGRST205', message: 'Could not find the table public.trip_plans in the schema cache' })).toBe(true);
    expect(isMissingSchemaError({ code: 'PGRST202', message: "Could not find the 'price_per_person' column of 'trip_plans' in the schema cache" })).toBe(false);
    expect(isMissingSchemaError({ code: '42883', message: 'function public.seed_trip() does not exist' })).toBe(false);
  });

  it('uses the current trip plan price contract in the standard seed', () => {
    const source = readFileSync(resolve(process.cwd(), 'scripts/test/seed.mjs'), 'utf8');
    expect(source).toContain('base_price: 3000');
    expect(source).not.toContain('price_per_person:');
    expect(source).toContain("slug: 'standard-test-plan'");
    expect(source).toContain("slug: 'private-test-plan'");
  });
});
