/** Atomic JSON import — issue #8, 10-TOUR-DOMAIN §5 and 12-TESTING-TDD §3. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A, SHOP_B, STAFF_A2 } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };
type ImportResult = { imported: number; results: Array<{ title: string; tripId: string; created: boolean; plansAdded: number }> };
const prefix = `itest-atomic-import-${Date.now()}`;
let admin: SupabaseClient;
let managerRpc: SupabaseClient;
let staffRpc: SupabaseClient;
let ownerA: AuthedApi;

const body = (suffix: string) => ({
  title: `原子匯入 ${suffix}`,
  slug: `${prefix}-${suffix}`,
  shortDescription: '整批要嘛全進、要嘛全不進',
  activityPlans: [{ name: '標準方案', slug: 'standard', basePrice: 1200 }],
});
const json = async <T>(res: Response) => (await res.json()) as Envelope<T>;

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_ANON_KEY).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  managerRpc = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: loginError } = await managerRpc.auth.signInWithPassword({
    email: SHOP_A.owner.email, password: SHOP_A.owner.password,
  });
  expect(loginError).toBeNull();
  staffRpc = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: staffLoginError } = await staffRpc.auth.signInWithPassword({
    email: STAFF_A2.email, password: STAFF_A2.password,
  });
  expect(staffLoginError).toBeNull();
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
});

afterAll(async () => {
  const { data: trips } = await admin.from('trips').select('id').eq('tenant_id', SHOP_A.id).like('slug', `${prefix}%`);
  const ids = (trips ?? []).map((trip) => trip.id);
  if (ids.length) {
    const { error } = await admin.from('trips').delete().in('id', ids);
    expect(error, `cleanup failed for ${ids.length} atomic-import trips`).toBeNull();
  }
  const { count, error } = await admin.from('trips').select('*', { count: 'exact', head: true })
    .eq('tenant_id', SHOP_A.id).like('slug', `${prefix}%`);
  expect(error).toBeNull();
  expect(count, 'atomic-import cleanup left residual trips').toBe(0);
});

describe('POST /api/trips/import', () => {
  it('imports a single object, raw array, and { trips }; re-import updates trip but adds no duplicate plans', async () => {
    const single = await ownerA.post('/api/trips/import', body('single'));
    expect(single.status, JSON.stringify(await json(single.clone()))).toBe(200);

    const array = await ownerA.post('/api/trips/import', [body('array-a'), body('array-b')]);
    expect(array.status).toBe(200);
    expect((await json<ImportResult>(array)).data!.imported).toBe(2);

    const wrapped = await ownerA.post('/api/trips/import', { trips: [body('wrapped')] });
    expect(wrapped.status).toBe(200);

    const again = await ownerA.post('/api/trips/import', { ...body('single'), title: '原子匯入 single 更新版' });
    const againBody = await json<ImportResult>(again);
    expect(again.status).toBe(200);
    expect(againBody.data!.results[0]).toMatchObject({ created: false, plansAdded: 0 });

    const { data: trip } = await admin.from('trips').select('id, title').eq('tenant_id', SHOP_A.id).eq('slug', `${prefix}-single`).single();
    expect(trip!.title).toBe('原子匯入 single 更新版');
    const { count } = await admin.from('trip_plans').select('*', { count: 'exact', head: true }).eq('trip_id', trip!.id);
    expect(count).toBe(1);
  });

  it('rejects an invalid later trip with no residual trip or plan rows', async () => {
    const badSlug = `${prefix}-must-not-exist`;
    const res = await ownerA.post('/api/trips/import', [body('valid-before-invalid'), {
      title: '壞資料', slug: badSlug, activityPlans: Array.from({ length: 101 }, (_, n) => ({ name: `太多-${n}` })),
    }]);
    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe('REQ_001');
    const { count: trips } = await admin.from('trips').select('*', { count: 'exact', head: true })
      .eq('tenant_id', SHOP_A.id).in('slug', [`${prefix}-valid-before-invalid`, badSlug]);
    expect(trips).toBe(0);
  });

  it('concurrent imports add the plan exactly once and report the actual insertion count', async () => {
    const payload = body('concurrent');
    const [a, b] = await Promise.all([
      ownerA.post('/api/trips/import', payload), ownerA.post('/api/trips/import', payload),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 200]);
    const outcomes = [await json<ImportResult>(a), await json<ImportResult>(b)]
      .map((response) => response.data!.results[0].plansAdded).sort();
    expect(outcomes).toEqual([0, 1]);
    const { data: trip } = await admin.from('trips').select('id').eq('tenant_id', SHOP_A.id)
      .eq('slug', `${prefix}-concurrent`).single();
    const { count } = await admin.from('trip_plans').select('*', { count: 'exact', head: true })
      .eq('trip_id', trip!.id).eq('slug', 'standard');
    expect(count).toBe(1);
  });

  it('concurrent existing [A, B] and [B, A] batches both finish, and each response keeps its input order', async () => {
    const a = body('deadlock-a');
    const b = body('deadlock-b');
    const seed = await ownerA.post('/api/trips/import', [a, b]);
    expect(seed.status, JSON.stringify(await json(seed.clone()))).toBe(200);

    const [forward, reverse] = await Promise.all([
      ownerA.post('/api/trips/import', [a, b]),
      ownerA.post('/api/trips/import', [b, a]),
    ]);
    const forwardBody = await json<ImportResult>(forward);
    const reverseBody = await json<ImportResult>(reverse);
    expect([forward.status, reverse.status]).toEqual([200, 200]);
    expect(forwardBody.data!.results.map((result) => result.title)).toEqual([a.title, b.title]);
    expect(reverseBody.data!.results.map((result) => result.title)).toEqual([b.title, a.title]);
    expect(forwardBody.data!.results.every((result) => !result.created && result.plansAdded === 0)).toBe(true);
    expect(reverseBody.data!.results.every((result) => !result.created && result.plansAdded === 0)).toBe(true);
  });

  it('accepts a final total of 100 plans, then rejects plan 101 without partial rows', async () => {
    const slug = `${prefix}-final-plan-limit`;
    const hundredPlans = Array.from({ length: 100 }, (_, n) => ({
      name: `方案 ${n + 1}`, slug: `plan-${n + 1}`, basePrice: 1200,
    }));
    const accepted = await ownerA.post('/api/trips/import', {
      ...body('final-plan-limit'), slug, activityPlans: hundredPlans,
    });
    expect(accepted.status, JSON.stringify(await json(accepted.clone()))).toBe(200);
    expect((await json<ImportResult>(accepted)).data!.results[0].plansAdded).toBe(100);

    const repeated = await ownerA.post('/api/trips/import', {
      ...body('final-plan-limit'), slug, activityPlans: hundredPlans,
    });
    expect(repeated.status, JSON.stringify(await json(repeated.clone()))).toBe(200);
    expect((await json<ImportResult>(repeated)).data!.results[0].plansAdded).toBe(0);

    const { data: trip } = await admin.from('trips').select('id, title')
      .eq('tenant_id', SHOP_A.id).eq('slug', slug).single();
    expect(trip!.title).toBe(`原子匯入 final-plan-limit`);
    const rejected = await ownerA.post('/api/trips/import', {
      ...body('final-plan-limit'), slug, title: '不應部分更新',
      activityPlans: [{ name: '第 101 個方案', slug: 'plan-101', basePrice: 1200 }],
    });
    expect(rejected.status).toBe(400);
    expect((await json(rejected)).code).toBe('REQ_001');

    const { count } = await admin.from('trip_plans').select('*', { count: 'exact', head: true })
      .eq('trip_id', trip!.id);
    expect(count).toBe(100);
    const { data: overflow } = await admin.from('trip_plans').select('id')
      .eq('trip_id', trip!.id).eq('slug', 'plan-101').maybeSingle();
    expect(overflow).toBeNull();
    const { data: unchangedTrip } = await admin.from('trips').select('title').eq('id', trip!.id).single();
    expect(unchangedTrip!.title).toBe(`原子匯入 final-plan-limit`);
  });

  it('rejects a STAFF user at the HTTP role gate and at the direct RPC role gate', async () => {
    const slug = `${prefix}-staff-forbidden`;
    const staffApi = await loginAs(STAFF_A2.email, STAFF_A2.password);
    const http = await staffApi.post('/api/trips/import', { ...body('staff-forbidden'), slug });
    expect(http.status).toBe(403);
    expect((await json(http)).code).toBe('AUTH_005');
    const { error } = await staffRpc.rpc('import_trips_atomic', {
      p_tenant_id: SHOP_A.id,
      p_trips: [{ title: 'STAFF 不可直連', slug, activityPlans: [] }],
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501');
    const { count } = await admin.from('trips').select('*', { count: 'exact', head: true })
      .eq('tenant_id', SHOP_A.id).eq('slug', slug);
    expect(count).toBe(0);
  });

  it('a direct manager RPC cannot import into another tenant', async () => {
    const slug = `${prefix}-manager-cross-tenant`;
    const { error } = await managerRpc.rpc('import_trips_atomic', {
      p_tenant_id: SHOP_B.id,
      p_trips: [{ title: '不可寫入 B 店', slug, activityPlans: [] }],
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501');
    const { count } = await admin.from('trips').select('*', { count: 'exact', head: true })
      .eq('tenant_id', SHOP_B.id).eq('slug', slug);
    expect(count).toBe(0);
  });

  it('the direct authenticated RPC rejects duplicate trip slugs before any row is written', async () => {
    const slug = `${prefix}-direct-duplicate`;
    const { error } = await managerRpc.rpc('import_trips_atomic', {
      p_tenant_id: SHOP_A.id,
      p_trips: [
        { title: '直接 RPC 重複 甲', slug, activityPlans: [] },
        { title: '直接 RPC 重複 乙', slug, activityPlans: [] },
      ],
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe('22023');
    const { count } = await admin.from('trips').select('*', { count: 'exact', head: true })
      .eq('tenant_id', SHOP_A.id).eq('slug', slug);
    expect(count, 'direct RPC duplicate check must leave no residual trip').toBe(0);
  });
});
