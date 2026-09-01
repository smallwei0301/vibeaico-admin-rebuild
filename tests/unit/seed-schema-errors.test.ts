import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isMissingColumnError, isMissingSchemaError } from '../../scripts/test/seed.mjs';

describe('seed schema error classification', () => {
  it('only tolerates a missing relation, not a missing column or function', () => {
    expect(isMissingSchemaError({ code: '42P01', message: 'relation "trip_plans" does not exist' })).toBe(true);
    expect(isMissingSchemaError({ code: 'PGRST205', message: 'Could not find the table public.trip_plans in the schema cache' })).toBe(true);
    expect(isMissingSchemaError({ code: 'PGRST202', message: "Could not find the 'price_per_person' column of 'trip_plans' in the schema cache" })).toBe(false);
    expect(isMissingSchemaError({ code: '42883', message: 'function public.seed_trip() does not exist' })).toBe(false);
  });

  it('recognizes only targeted historical missing-column drift for compatibility fallback', () => {
    expect(isMissingColumnError({ code: 'PGRST204', message: "Could not find the 'price_per_person' column of 'trip_plans' in the schema cache" })).toBe(true);
    expect(isMissingColumnError({ code: 'PGRST202', message: "Could not find the 'max_party' column of 'trip_plans' in the schema cache" })).toBe(true);
    expect(isMissingColumnError({ code: 'PGRST202', message: 'Could not find the function public.seed_trip() in the schema cache' })).toBe(false);
    expect(isMissingColumnError({ code: '42883', message: 'function public.seed_trip() does not exist' })).toBe(false);
  });

  it('uses the canonical trip plan price contract in the standard seed', () => {
    const source = readFileSync(resolve(process.cwd(), 'scripts/test/seed.mjs'), 'utf8');
    expect(source).toContain('price_per_person: 3000');
    expect(source).toContain('base_price: row.price_per_person');
    expect(source).toContain("slug: index === 0 ? 'standard-test-plan' : 'private-test-plan'");
    expect(source).toContain('safeUpsertTripPlans');
  });

  it('fails closed when required trip plan or departure seed data cannot be written', () => {
    const source = readFileSync(resolve(process.cwd(), 'scripts/test/seed.mjs'), 'utf8');
    expect(source).toMatch(/if \(!tripPlansSeeded\)\s*\{\s*throw new Error\(/);
    expect(source).toMatch(/const tripDeparturesSeeded = await safeUpsert\(/);
    expect(source).toMatch(/if \(!tripDeparturesSeeded\)\s*\{\s*throw new Error\(/);
  });
});
