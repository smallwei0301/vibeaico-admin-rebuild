/**
 * Issue #28 category metadata — API create/update/reload persistence and tenant isolation.
 * Uses existing TEST columns; no schema operation is performed by this test.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A, SHOP_B } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

const BASE = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';

type Envelope<T = unknown> = {
  success: boolean;
  data?: T;
  message?: string;
  code?: string;
};

async function readJson<T = unknown>(response: Response): Promise<Envelope<T>> {
  return (await response.json()) as Envelope<T>;
}

function suffix(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

let admin: SupabaseClient;
let ownerA: AuthedApi;
let ownerB: AuthedApi;
let serviceCategoryId = '';
let productCategoryId = '';

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  admin = createClient(
    process.env.TEST_SUPABASE_URL!,
    process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
  ownerB = await loginAs(SHOP_B.owner.email, SHOP_B.owner.password);
});

afterAll(async () => {
  if (serviceCategoryId) {
    await admin.from('service_categories').delete().eq('id', serviceCategoryId);
  }
  if (productCategoryId) {
    await admin.from('product_categories').delete().eq('id', productCategoryId);
  }
});

describe('category metadata persistence (#28)', () => {
  it('service category survives create, update, reload and rejects another tenant', async () => {
    const tag = suffix();
    const serviceName = '服務分類-' + tag;
    const serviceDescription = '初始說明-' + tag;
    const createResponse = await ownerA.post('/api/service-categories', {
      name: serviceName,
      description: serviceDescription,
      active: false,
    });
    expect(createResponse.status).toBe(200);
    const created = await readJson<{ id: string; sortOrder: number }>(createResponse);
    expect(created.success).toBe(true);
    expect(created.data?.id).toBeTruthy();
    serviceCategoryId = created.data!.id;

    const { data: row, error } = await admin
      .from('service_categories')
      .select('tenant_id, name, description, active, sort_order')
      .eq('id', serviceCategoryId)
      .single();
    expect(error).toBeNull();
    expect(row).toMatchObject({
      tenant_id: SHOP_A.id,
      name: serviceName,
      description: serviceDescription,
      active: false,
    });
    expect(typeof row?.sort_order).toBe('number');

    const reloadResponse = await ownerA.get('/api/service-categories');
    expect(reloadResponse.status).toBe(200);
    const reloaded = await readJson<Array<{
      id: string; name: string; description: string; active: boolean; sortOrder: number;
    }>>(reloadResponse);
    expect(reloaded.data?.find((item) => item.id === serviceCategoryId)).toMatchObject({
      description: serviceDescription,
      active: false,
    });

    const updateResponse = await ownerA.put('/api/service-categories/' + serviceCategoryId, {
      description: '',
      active: true,
    });
    expect(updateResponse.status).toBe(200);
    expect((await readJson(updateResponse)).success).toBe(true);

    const updatedReload = await ownerA.get('/api/service-categories');
    const updatedBody = await readJson<Array<{
      id: string; description: string; active: boolean;
    }>>(updatedReload);
    expect(updatedBody.data?.find((item) => item.id === serviceCategoryId)).toMatchObject({
      description: '',
      active: true,
    });

    const crossTenant = await ownerB.put('/api/service-categories/' + serviceCategoryId, {
      description: '不應寫入',
      active: false,
    });
    expect(crossTenant.status).toBe(404);

    const { data: unchanged, error: unchangedError } = await admin
      .from('service_categories')
      .select('tenant_id, description, active')
      .eq('id', serviceCategoryId)
      .single();
    expect(unchangedError).toBeNull();
    expect(unchanged).toMatchObject({
      tenant_id: SHOP_A.id,
      description: '',
      active: true,
    });
  });

  it('product category persists description, active and explicit sort order after reload', async () => {
    const tag = suffix();
    const productName = '商品分類-' + tag;
    const productDescription = '陳列說明-' + tag;
    const createResponse = await ownerA.post('/api/product-categories', {
      name: productName,
      description: productDescription,
      active: false,
      sortOrder: 7,
    });
    expect(createResponse.status).toBe(200);
    const created = await readJson<{ id: string; sortOrder: number }>(createResponse);
    expect(created.success).toBe(true);
    expect(created.data?.id).toBeTruthy();
    expect(created.data?.sortOrder).toBe(7);
    productCategoryId = created.data!.id;

    const { data: row, error } = await admin
      .from('product_categories')
      .select('tenant_id, name, description, active, sort_order')
      .eq('id', productCategoryId)
      .single();
    expect(error).toBeNull();
    expect(row).toMatchObject({
      tenant_id: SHOP_A.id,
      name: productName,
      description: productDescription,
      active: false,
      sort_order: 7,
    });

    const reloadResponse = await ownerA.get('/api/product-categories');
    expect(reloadResponse.status).toBe(200);
    const reloaded = await readJson<Array<{
      id: string; name: string; description: string; active: boolean; sortOrder: number;
    }>>(reloadResponse);
    expect(reloaded.data?.find((item) => item.id === productCategoryId)).toMatchObject({
      description: productDescription,
      active: false,
      sortOrder: 7,
    });

    const updateResponse = await ownerA.put('/api/product-categories/' + productCategoryId, {
      description: '',
      active: true,
      sortOrder: 8,
    });
    expect(updateResponse.status).toBe(200);
    expect((await readJson(updateResponse)).success).toBe(true);

    const updatedReload = await ownerA.get('/api/product-categories');
    const updatedBody = await readJson<Array<{
      id: string; description: string; active: boolean; sortOrder: number;
    }>>(updatedReload);
    expect(updatedBody.data?.find((item) => item.id === productCategoryId)).toMatchObject({
      description: '',
      active: true,
      sortOrder: 8,
    });

    const crossTenant = await ownerB.put('/api/product-categories/' + productCategoryId, {
      active: false,
    });
    expect(crossTenant.status).toBe(404);
  });
});
