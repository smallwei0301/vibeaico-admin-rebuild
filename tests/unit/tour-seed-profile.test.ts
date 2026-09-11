import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readTourSeedFields, readLegacyPlanPriceColumn, legacyPlanPriceFields } from '../../scripts/test/tour-seed-profile.mjs';

const deadline = '2026-09-12T00:00:00Z';
function client(present: boolean[], failure?: { code: string; message: string }, rest = false) {
  let index = 0;
  return { from(table: string) { return { select(column: string) { return { async limit(count: number) {
    assert.equal(count, 0, 'probe must never read application rows');
    const exists = present[index++];
    return { error: failure ?? (exists ? null : rest
      ? { code: 'PGRST204', message: `Could not find the '${column}' column of '${table}' in the schema cache` }
      : { code: '42703', message: `column ${table}.${column} does not exist` }) };
  } }; } }; } };
}

describe('named #41 fixture fields never become implicit main schema', () => {
  it('seeds the canonical core without future fields', async () => {
    assert.deepEqual(await readTourSeedFields(client([false, false, false]), deadline, 'CANONICAL_CORE'),
      { profile: 'CANONICAL_CORE', plan: {}, departure: {} });
  });
  it('preserves the existing candidate seed when all three fields actually exist', async () => {
    assert.deepEqual(await readTourSeedFields(client([true, true, true]), deadline), {
      profile: 'ISSUE_41_COMPATIBILITY', plan: { min_to_depart: 1 },
      departure: { min_to_depart_snapshot: 1, formation_deadline_at: deadline },
    });
  });
  it('recognizes only the exact named PostgREST missing-column response', async () => {
    assert.equal((await readTourSeedFields(client([false, false, false], undefined, true), deadline)).profile, 'CANONICAL_CORE');
  });
  for (const fields of [[true, false, false], [false, true, false], [false, false, true],
    [true, true, false], [true, false, true], [false, true, true]]) {
    it(`fails closed on partial installation ${fields.join('/')}`, async () => {
      await assert.rejects(readTourSeedFields(client(fields), deadline), /PARTIAL/);
    });
  }
  for (const error of [
    { code: '42501', message: 'permission denied' },
    { code: '42P01', message: 'relation "trip_plans" does not exist' },
    { code: 'PGRST205', message: "Could not find the table 'public.trip_plans' in the schema cache" },
    { code: '42703', message: 'column trip_plans.base_price does not exist' },
    { code: 'PGRST204', message: "Could not find the 'base_price' column of 'trip_plans' in the schema cache" },
    { code: '', message: 'fetch failed' },
  ]) {
    it(`does not launder ${error.code || 'network'}: ${error.message}`, async () => {
      await assert.rejects(readTourSeedFields(client([], error), deadline), (actual: unknown) => actual === error);
    });
  }
  it('rejects candidate contamination when the job explicitly expects canonical core', async () => {
    await assert.rejects(readTourSeedFields(client([true, true, true]), deadline, 'CANONICAL_CORE'), /MISMATCH/);
  });
  it('rejects a missing candidate instead of silently accepting core', async () => {
    await assert.rejects(readTourSeedFields(client([false, false, false]), deadline, 'ISSUE_41_COMPATIBILITY'), /MISMATCH/);
  });
  it('rejects an unknown declared profile', async () => {
    await assert.rejects(readTourSeedFields(client([]), deadline, 'CANONCIAL_CORE'), /INVALID/);
  });
  it('rejects an invalid candidate deadline', async () => {
    await assert.rejects(readTourSeedFields(client([]), 'not-a-date'), /INVALID/);
  });
});

describe('legacy required price is explicit fixture compatibility', () => {
  it('observes the named price column without reading rows', async () => {
    assert.equal(await readLegacyPlanPriceColumn(client([true])), true);
    assert.equal(await readLegacyPlanPriceColumn(client([false])), false);
  });
  it('does not hide a different missing price column', async () => {
    const error = { code: '42703', message: 'column trip_plans.base_price does not exist' };
    await assert.rejects(readLegacyPlanPriceColumn(client([], error)), (actual: unknown) => actual === error);
  });
  it('copies each actual fixture price, not a single shared default', () => {
    assert.deepEqual(legacyPlanPriceFields(3000, true), { price_per_person: 3000 });
    assert.deepEqual(legacyPlanPriceFields(5000, true), { price_per_person: 5000 });
    assert.deepEqual(legacyPlanPriceFields(0, true), { price_per_person: 0 });
  });
  it('does not write a legacy column once it has been removed', () => {
    assert.deepEqual(legacyPlanPriceFields(3000, false), {});
  });
  for (const price of [NaN, Infinity, -1, '3000', null]) {
    it(`rejects invalid source price ${String(price)}`, () => {
      assert.throws(() => legacyPlanPriceFields(price, true), /PRICE_INVALID/);
    });
  }
  it('requires an explicit boolean presence result', () => {
    assert.throws(() => legacyPlanPriceFields(3000, 'yes'), /PRICE_INVALID/);
  });
});
