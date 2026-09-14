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

/*
 * canonical `0107`（#41，Owner 2026-09-14）之後，這三個欄位是 canonical 的一部分，
 * 探針的意義因此翻轉：`CANONICAL_CORE` ＝ 三個欄位都在；`PRE_ISSUE_41` ＝ 尚未套用
 * `0107`。後者出現在走完整 canonical 鏈的安裝上，就是 PB-026 那個失敗形狀
 * （migration 套用「成功」但欄位其實沒建起來）。探針的其餘保證一字未動：不讀資料列、
 * 不吞任何非指名的錯誤、半套一律 fail closed。
 */
describe('named #41 fields are canonical after 0107, and must actually exist', () => {
  it('seeds the post-#41 canonical shape with the #41 fields', async () => {
    assert.deepEqual(await readTourSeedFields(client([true, true, true]), deadline, 'CANONICAL_CORE'), {
      profile: 'CANONICAL_CORE', plan: { min_to_depart: 1 },
      departure: { min_to_depart_snapshot: 1, formation_deadline_at: deadline },
    });
  });
  it('reports a pre-0107 install without inventing the #41 fields', async () => {
    assert.deepEqual(await readTourSeedFields(client([false, false, false]), deadline), {
      profile: 'PRE_ISSUE_41', plan: {}, departure: {},
    });
  });
  it('recognizes only the exact named PostgREST missing-column response', async () => {
    assert.equal((await readTourSeedFields(client([false, false, false], undefined, true), deadline)).profile, 'PRE_ISSUE_41');
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
  /*
   * 這一條是翻轉後最重要的保護：`agent-schema-bootstrap` 與兩支 schema proof 都以
   * `TEST_TOUR_SEED_PROFILE=CANONICAL_CORE` 作為前置條件。若 `0107` 在該安裝上其實
   * 沒生效（PB-026 的 no-op），這裡會 MISMATCH 而不是讓後續測試對著不存在的欄位跑。
   */
  it('rejects a canonical install where 0107 did not actually take effect', async () => {
    await assert.rejects(readTourSeedFields(client([false, false, false]), deadline, 'CANONICAL_CORE'), /MISMATCH/);
  });
  it('rejects a post-0107 install when the job explicitly expects the pre-0107 shape', async () => {
    await assert.rejects(readTourSeedFields(client([true, true, true]), deadline, 'PRE_ISSUE_41'), /MISMATCH/);
  });
  it('no longer accepts the retired ISSUE_41_COMPATIBILITY profile name', async () => {
    await assert.rejects(readTourSeedFields(client([]), deadline, 'ISSUE_41_COMPATIBILITY'), /INVALID/);
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
