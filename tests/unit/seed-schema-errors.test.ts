import { describe, expect, it } from 'vitest';
import { isMissingSchemaError } from '../../scripts/test/seed.mjs';

describe('seed schema error classification', () => {
  it('only tolerates a missing relation, not a missing column or function', () => {
    expect(isMissingSchemaError({ code: '42P01', message: 'relation "trip_plans" does not exist' })).toBe(true);
    expect(isMissingSchemaError({ code: 'PGRST205', message: 'Could not find the table public.trip_plans in the schema cache' })).toBe(true);
    expect(isMissingSchemaError({ code: 'PGRST202', message: "Could not find the 'price_per_person' column of 'trip_plans' in the schema cache" })).toBe(false);
    expect(isMissingSchemaError({ code: '42883', message: 'function public.seed_trip() does not exist' })).toBe(false);
  });
});
