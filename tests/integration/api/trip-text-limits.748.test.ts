/**
 * #748／#785：行程文字欄位上限的 HTTP 驗收。
 *
 * 不只看狀態碼：超量寫入被擋（400 REQ_001）之後，重新 GET／直查資料列，
 * 五個欄位必須與送出前完全相同；歷史超量資料不會擋住其他欄位的儲存；
 * 剛好在上限的內容逐字存住。
 *
 * 需要共用 TEST reset/seed lane，CI 以 TEST_VALIDATION holder 序列化。
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { SHOP_A } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };

interface TripView {
  id: string;
  description: string;
  safetyNotice: string;
  inclusions: string[];
  exclusions: string[];
  notices: string[];
  title: string;
}

type TextFields = Pick<TripView, 'description' | 'safetyNotice' | 'inclusions' | 'exclusions' | 'notices'>;

async function json<T>(response: Response): Promise<Envelope<T>> {
  return (await response.json()) as Envelope<T>;
}

let ownerA: AuthedApi;
let admin: SupabaseClient;
const createdTripIds: string[] = [];

async function getTrip(id: string): Promise<TripView> {
  const response = await ownerA.get(`/api/trips/${id}`);
  expect(response.status).toBe(200);
  const body = await json<{ trip: TripView }>(response);
  expect(body.data?.trip, 'GET /api/trips/:id 沒有回 trip').toBeTruthy();
  return body.data!.trip;
}

const textFieldsOf = (t: TripView): TextFields => ({
  description: t.description, safetyNotice: t.safetyNotice,
  inclusions: t.inclusions, exclusions: t.exclusions, notices: t.notices,
});

async function createTrip(extra: Record<string, unknown> = {}): Promise<{ id: string; title: string }> {
  const title = `limits-${randomUUID()}`;
  const response = await ownerA.post('/api/trips', { title, ...extra });
  expect(response.status).toBe(200);
  const id = (await json<{ id: string }>(response)).data!.id;
  createdTripIds.push(id);
  return { id, title };
}

const lines = (n: number, prefix = '項目') => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
});

afterAll(async () => {
  for (const id of createdTripIds) await admin.from('trips').delete().eq('id', id).eq('tenant_id', SHOP_A.id);
});

describe('超量 PUT 被擋，資料列不變（#748／#785）', () => {
  const OVERSIZED: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
    ['description 5001 code points', { description: 'a'.repeat(5001) }],
    ['exclusions 21 個可見項', { exclusions: lines(21) }],
    ['notices 單項 301 字', { notices: ['n'.repeat(301)] }],
    ['#785 exclusions 單項 3001 原始字（全空白）', { exclusions: [' '.repeat(3001)] }],
    ['#785 notices 201 個原始項（全空字串）', { notices: Array(201).fill('') }],
    ['#785 includes 整體 20001 原始字', { includes: '\n'.repeat(20001) }],
  ];

  it.each(OVERSIZED)('%s → 400 REQ_001，之後 GET 五個欄位與送出前相同', async (_label, body) => {
    const seed = {
      description: '原本的介紹', notes: '原本的提醒', includes: '含早餐\n含接送',
      exclusions: ['小費'], notices: ['請準時'],
    };
    const { id } = await createTrip(seed);
    const before = textFieldsOf(await getTrip(id));

    const res = await ownerA.put(`/api/trips/${id}`, body);
    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe('REQ_001');

    expect(textFieldsOf(await getTrip(id)), '被擋的 PUT 不得改動資料列').toEqual(before);
  });
});

describe('超量 POST 被擋，沒有建立行程', () => {
  const OVERSIZED_CREATE: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
    ['description 5001', { description: 'a'.repeat(5001) }],
    ['exclusions 21 項', { exclusions: lines(21) }],
    ['#785 exclusions 單項 3001 原始字', { exclusions: [' '.repeat(3001)] }],
  ];

  it.each(OVERSIZED_CREATE)('%s → 400 REQ_001，且資料庫沒有該 title 的行程', async (_label, body) => {
    const title = `limits-reject-${randomUUID()}`;
    const res = await ownerA.post('/api/trips', { title, ...body });
    expect(res.status).toBe(400);
    const env = await json<{ id?: string }>(res);
    expect(env.code).toBe('REQ_001');
    expect(env.data?.id).toBeUndefined();

    const { data, error } = await admin.from('trips').select('id').eq('tenant_id', SHOP_A.id).eq('title', title);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });
});

describe('歷史超量資料不擋其他欄位的儲存', () => {
  it('description 已是 6000 字（直接寫 DB）→ PUT 只改 title → 200，description 原樣保留', async () => {
    const { id } = await createTrip({ description: '初始' });
    const legacy = 'd'.repeat(6000);
    const { error } = await admin.from('trips').update({ description: legacy }).eq('id', id).eq('tenant_id', SHOP_A.id);
    expect(error).toBeNull();

    const newTitle = `limits-legacy-${randomUUID()}`;
    const res = await ownerA.put(`/api/trips/${id}`, { title: newTitle });
    expect(res.status).toBe(200);

    const trip = await getTrip(id);
    expect(trip.title).toBe(newTitle);
    expect(trip.description, '歷史超量的 description 不得被截斷或清掉').toBe(legacy);
  });
});

describe('#785 歷史資料：原始項數超過 200 的清單不擋其他欄位', () => {
  it.each(['exclusions', 'notices'] as const)('%s 已是 300 個空白項（直接寫 DB）→ PUT 只改 title → 200，清單原樣保留', async (field) => {
    const { id } = await createTrip();
    const legacy = Array(300).fill(' ');
    const { error } = await admin.from('trips').update({ [field]: legacy }).eq('id', id).eq('tenant_id', SHOP_A.id);
    expect(error).toBeNull();

    const newTitle = `limits-legacy-raw-${randomUUID()}`;
    const res = await ownerA.put(`/api/trips/${id}`, { title: newTitle });
    expect(res.status).toBe(200);
    expect((await getTrip(id)).title).toBe(newTitle);

    const { data, error: readError } = await admin.from('trips').select(field).eq('id', id).eq('tenant_id', SHOP_A.id).single();
    expect(readError).toBeNull();
    const stored = (data as Record<string, unknown>)[field] as string[];
    expect(stored, `${field} 不得被截斷或正規化`).toHaveLength(300);
    expect(stored).toEqual(legacy);
  });
});

describe('合法邊界逐字存住', () => {
  it('description 剛好 5000、三個清單各 20 項每項 300 字 → 200 且讀回逐字相同', async () => {
    const { id } = await createTrip();
    const item = (prefix: string, i: number) => `${prefix}${i}`.padEnd(300, '字');
    const description = '介'.repeat(5000);
    const inclusions = Array.from({ length: 20 }, (_, i) => item('含', i));
    const exclusions = Array.from({ length: 20 }, (_, i) => item('不含', i));
    const notices = Array.from({ length: 20 }, (_, i) => item('注', i));

    const res = await ownerA.put(`/api/trips/${id}`, {
      description, includes: inclusions.join('\n'), exclusions, notices,
    });
    expect(res.status).toBe(200);

    const trip = await getTrip(id);
    expect(trip.description).toBe(description);
    expect(trip.inclusions).toEqual(inclusions);
    expect(trip.exclusions).toEqual(exclusions);
    expect(trip.notices).toEqual(notices);
  });
});
