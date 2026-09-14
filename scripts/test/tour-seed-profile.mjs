// #298: fixture compatibility is not permission to import future Product migrations.
// Probe only the three named #41 seed fields. Never swallow arbitrary missing columns,
// table/auth/network failures, or a partly installed candidate schema.
//
// #41（canonical `0107`，Owner 2026-09-14）改變了這個探針的意義，所以語意在此翻轉。
//
// 在 `0107` 之前，這三個欄位只可能來自 TEST 的歷史 #41 overlay，因此「存在」＝
// 「fixture 把未來的 Product migration 拉進來了」，要擋。`0107` 之後它們是
// **canonical 欄位**，任何走完整 canonical 鏈的安裝都應該有——此時「不存在」才是
// 異常，而且它正是 PB-026 那個失敗形狀：migration 套用「成功」了，但欄位其實沒建起來
// （historical overlay 先建過同名物件，`add column if not exists` 於是變成 no-op）。
//
// 因此 `CANONICAL_CORE` 現在代表「post-#41 的 canonical 形狀：三個欄位都在」，
// 而 `PRE_ISSUE_41` 代表尚未套用 `0107` 的安裝。把舊名稱留著繼續指涉 overlay 會是
// 誤導——名稱說 compatibility，實際上是 canonical，那種落差正是 PB-037 那類誤判的溫床。
//
// 這個探針因此沒有失去牙齒，只是換了要咬的東西：它從「擋住未來欄位」變成
// 「證明 canonical 欄位真的建起來了」。兩者都是可觀察、可失敗的斷言。
const FIELDS = [
  ['trip_plans', 'min_to_depart'],
  ['trip_departures', 'min_to_depart_snapshot'],
  ['trip_departures', 'formation_deadline_at'],
];

async function columnPresent(admin, table, column) {
  const { error } = await admin.from(table).select(column).limit(0);
  if (!error) return true;
  const message = String(error.message ?? '');
  const pgMissing = error.code === '42703'
    && message.replaceAll('"', '') === `column ${table}.${column} does not exist`;
  const restMissing = error.code === 'PGRST204'
    && message === `Could not find the '${column}' column of '${table}' in the schema cache`;
  if (pgMissing || restMissing) return false;
  throw error;
}

export async function readTourSeedFields(admin, deadline, expected = 'OBSERVE') {
  if (!['OBSERVE', 'CANONICAL_CORE', 'PRE_ISSUE_41'].includes(expected)) {
    throw new Error('TOUR_SEED_SCHEMA_INVALID: unknown expected profile');
  }
  if (typeof deadline !== 'string' || !Number.isFinite(Date.parse(deadline))) {
    throw new Error('TOUR_SEED_SCHEMA_INVALID: deadline must be a valid timestamp');
  }
  const present = [];
  for (const [table, column] of FIELDS) present.push(await columnPresent(admin, table, column));
  if (present.some(Boolean) && !present.every(Boolean)) {
    throw new Error('TOUR_SEED_SCHEMA_PARTIAL: #41 fields must be all present or all absent');
  }
  const profile = present.every(Boolean) ? 'CANONICAL_CORE' : 'PRE_ISSUE_41';
  if (expected !== 'OBSERVE' && expected !== profile) {
    throw new Error(`TOUR_SEED_SCHEMA_MISMATCH: expected ${expected}, observed ${profile}`);
  }
  return {
    profile,
    plan: profile === 'CANONICAL_CORE' ? { min_to_depart: 1 } : {},
    departure: profile === 'CANONICAL_CORE'
      ? { min_to_depart_snapshot: 1, formation_deadline_at: deadline }
      : {},
  };
}

// Historical compatibility schema still has this required column. A newer schema may
// remove it; fill it only when the exact column is observed, never via a #41 trigger.
export async function readLegacyPlanPriceColumn(admin) {
  return columnPresent(admin, 'trip_plans', 'price_per_person');
}

export function legacyPlanPriceFields(basePrice, hasLegacyColumn) {
  if (typeof basePrice !== 'number' || !Number.isFinite(basePrice) || basePrice < 0
      || typeof hasLegacyColumn !== 'boolean') {
    throw new Error('TOUR_SEED_PRICE_INVALID');
  }
  return hasLegacyColumn ? { price_per_person: basePrice } : {};
}
