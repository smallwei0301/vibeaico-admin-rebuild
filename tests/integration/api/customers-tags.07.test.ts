/**
 * GET /api/customers/tags — issue #7 customers 標籤下拉的真實資料源。
 * 契約：04 分冊 §B-6、原站 DOM spec `docs/specs/customers.json`。
 *
 * 每個案例都以可辨識的 UUID 顧客資料作障壁，不依賴 seed 目前「剛好沒有標籤」；
 * afterAll 只刪本檔建立的 id，避免測試資料污染其它 API 的固定基線。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { SHOP_A, SHOP_B } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };
type TagsData = { tags: string[] };

async function readJson<T = unknown>(res: Response): Promise<Envelope<T>> {
  return (await res.json()) as Envelope<T>;
}

let admin: SupabaseClient;
let ownerA: AuthedApi;
let ownerB: AuthedApi;
const createdCustomerIds: string[] = [];
let advancedCustomerSnapshot: Record<string, unknown> | null = null;
let advancedCustomerSnapshotLoaded = false;
let advancedCustomerMutated = false;

async function createCustomer(tenantId: string, tags: string[], active = true): Promise<string> {
  const id = randomUUID();
  const { error } = await admin.from('customers').insert({
    id,
    tenant_id: tenantId,
    name: `tags.07 ${id.slice(0, 8)}`,
    phone: `09${id.replaceAll('-', '').slice(0, 8)}`,
    tags,
    active,
  });
  expect(error).toBeNull();
  createdCustomerIds.push(id);
  return id;
}

async function restoreAdvancedCustomerSnapshot(): Promise<void> {
  expect(advancedCustomerSnapshotLoaded).toBe(true);
  const query = admin.from('feature_subscriptions');
  const { error } = advancedCustomerSnapshot
    ? await query.upsert(advancedCustomerSnapshot, { onConflict: 'tenant_id,code' })
    : await query.delete().eq('tenant_id', SHOP_A.id).eq('code', 'ADVANCED_CUSTOMER');
  expect(error).toBeNull();
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: subscription, error: subscriptionError } = await admin
    .from('feature_subscriptions').select('*')
    .eq('tenant_id', SHOP_A.id).eq('code', 'ADVANCED_CUSTOMER').maybeSingle();
  expect(subscriptionError).toBeNull();
  advancedCustomerSnapshot = subscription as Record<string, unknown> | null;
  advancedCustomerSnapshotLoaded = true;
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
  ownerB = await loginAs(SHOP_B.owner.email, SHOP_B.owner.password);
});

afterAll(async () => {
  if (createdCustomerIds.length > 0) {
    const { error } = await admin.from('customers').delete().in('id', createdCustomerIds);
    const { count, error: countError } = await admin
      .from('customers').select('id', { count: 'exact', head: true }).in('id', createdCustomerIds);
    expect(error).toBeNull();
    expect(countError).toBeNull();
    expect(count ?? 0).toBe(0);
  }
  if (advancedCustomerMutated) await restoreAdvancedCustomerSnapshot();
});

describe('GET /api/customers/tags（04 §B-6）', () => {
  it('同一店重複標籤只回一份，且按 zh-Hant collator 排序', async () => {
    const prefix = `tags.07-sort-${randomUUID().slice(0, 8)}`;
    const sentinels = [`${prefix}-甲`, `${prefix}-乙`, `${prefix}-A`];
    await createCustomer(SHOP_A.id, [sentinels[0], sentinels[1], sentinels[1], sentinels[2]]);

    const res = await ownerA.get('/api/customers/tags');
    expect(res.status).toBe(200);
    const body = await readJson<TagsData>(res);
    expect(body.success).toBe(true);
    const returnedSentinels = body.data!.tags.filter((tag) => tag.startsWith(prefix));
    expect(returnedSentinels.length).toBeGreaterThan(0);
    expect(returnedSentinels).toEqual([...new Set(sentinels)].sort(new Intl.Collator('zh-Hant').compare));
    expect(new Set(returnedSentinels).size).toBe(returnedSentinels.length);
  });

  it('停用顧客上的標籤仍會列出', async () => {
    const inactiveTag = `停用顧客#tags07-${randomUUID().slice(0, 8)}`;
    await createCustomer(SHOP_A.id, [inactiveTag], false);

    const res = await ownerA.get('/api/customers/tags');
    expect(res.status).toBe(200);
    const body = await readJson<TagsData>(res);
    expect(body.data!.tags).toContain(inactiveTag);
  });

  it('租戶隔離：A/B 各自只能看到自己的標籤', async () => {
    const tagA = `A-only#tags07-${randomUUID().slice(0, 8)}`;
    const tagB = `B-only#tags07-${randomUUID().slice(0, 8)}`;
    await createCustomer(SHOP_A.id, [tagA]);
    await createCustomer(SHOP_B.id, [tagB]);

    const [resA, resB] = await Promise.all([
      ownerA.get('/api/customers/tags'),
      ownerB.get('/api/customers/tags'),
    ]);
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    const tagsA = (await readJson<TagsData>(resA)).data!.tags;
    const tagsB = (await readJson<TagsData>(resB)).data!.tags;
    expect(tagsA).toContain(tagA);
    expect(tagsA).not.toContain(tagB);
    expect(tagsB).toContain(tagB);
    expect(tagsB).not.toContain(tagA);
  });

  it('未訂閱 ADVANCED_CUSTOMER → 403 FEAT_001；還原後同端點回 200', async () => {
    advancedCustomerMutated = true;
    const { error } = await admin.from('feature_subscriptions').delete()
      .eq('tenant_id', SHOP_A.id).eq('code', 'ADVANCED_CUSTOMER');
    expect(error).toBeNull();
    try {
      const blocked = await ownerA.get('/api/customers/tags');
      expect(blocked.status).toBe(403);
      const body = await readJson(blocked);
      expect(body.success).toBe(false);
      expect(body.code).toBe('FEAT_001');
      expect(body.message).toBe('此功能尚未訂閱，請至功能商店開通');
    } finally {
      await restoreAdvancedCustomerSnapshot();
      advancedCustomerMutated = false;
    }

    const restored = await ownerA.get('/api/customers/tags');
    expect(restored.status).toBe(200);
    expect((await readJson<TagsData>(restored)).success).toBe(true);
  });
});
