// #298: fixture compatibility is not permission to import future Product migrations.
// Probe only the three named #41 seed fields. Never swallow arbitrary missing columns,
// table/auth/network failures, or a partly installed candidate schema.
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
  if (!['OBSERVE', 'CANONICAL_CORE', 'ISSUE_41_COMPATIBILITY'].includes(expected)) {
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
  const profile = present.every(Boolean) ? 'ISSUE_41_COMPATIBILITY' : 'CANONICAL_CORE';
  if (expected !== 'OBSERVE' && expected !== profile) {
    throw new Error(`TOUR_SEED_SCHEMA_MISMATCH: expected ${expected}, observed ${profile}`);
  }
  return {
    profile,
    plan: profile === 'CANONICAL_CORE' ? {} : { min_to_depart: 1 },
    departure: profile === 'CANONICAL_CORE' ? {} : {
      min_to_depart_snapshot: 1, formation_deadline_at: deadline,
    },
  };
}
