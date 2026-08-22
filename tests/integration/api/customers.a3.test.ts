/**
 * 顧客 API 整合測試 — 12 分冊 §4「Phase 3（核心 API）」矩陣：
 *   「customers：atRisk/minSpent 篩選走 view；刪除有進行中預約 409（軟刪
 *    active=false）」
 * 端點行為規格見 docs/integration/04-API-CONTRACTS.md §A-3、02 分冊 §0007
 * （`customers_view` 的 `booking_count`/`total_spent`/`at_risk` 定義）。
 *
 * ⚠️ TDD 紅燈說明：撰寫本檔當下 `PUT/DELETE /api/customers/:id` 尚未實作
 * （`src/app/api/customers/[id]/` 目錄是空的），全部紅燈——誠實的「先寫測試」
 * 狀態，不得為轉綠放寬斷言（12 §2.4）。`GET/POST /api/customers` 已有實作。
 *
 * 清理紀律：atRisk 案例需要一位「60 天前有 COMPLETED 預約」的顧客，seed 的
 * customerA1/A2/A3 都不符合這個條件，因此自建一個舊 booking + 專屬顧客，
 * 斷言完立刻刪除（inline，不留到 afterAll），避免污染 catalog.a4／reports.a5
 * 對顧客數量／花費的任何假設。DELETE 軟刪測試自建的顧客在驗證
 * `active=false` 之後，用 service role 直接硬刪除該列（不是走 API），確保
 * reports.a5 的 `totalCustomers=3` 手算值不被本檔多出來的顧客污染。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { SHOP_A, SHOP_B } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';
import type { Customer, Paged } from '@/lib/types';

const BASE = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';
const DAY_MS = 24 * 60 * 60 * 1000;

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };

async function readJson<T = unknown>(res: Response): Promise<Envelope<T>> {
  return (await res.json()) as Envelope<T>;
}

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

let admin: SupabaseClient;
let ownerA: AuthedApi;

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
});

async function hardDeleteCustomer(id: string): Promise<void> {
  const { error } = await admin.from('customers').delete().eq('id', id);
  expect(error).toBeNull();
}

describe('GET /api/customers 篩選走 customers_view（04 §A-3，02 §0007）', () => {
  it('atRisk=true：seed 3 位顧客 lastVisit 皆非 60 天前 → 0 筆', async () => {
    const res = await ownerA.get('/api/customers?atRisk=true&size=100');
    expect(res.status).toBe(200);
    const body = await readJson<Paged<Customer>>(res);
    expect(body.success).toBe(true);
    // 只斷言「不含 seed 3 位顧客」＋目前應為 0（下一個案例會自建一筆並驗證變成 1）。
    expect(body.data!.totalElements).toBe(0);
  });

  it('atRisk=true：自建一位 95 天前有 COMPLETED 預約的顧客 → 該顧客單獨出現，totalElements=1', async () => {
    const customerId = randomUUID();
    const { error: cErr } = await admin
      .from('customers')
      .insert({ id: customerId, tenant_id: SHOP_A.id, name: 'atRisk 測試顧客', phone: '0977000099', active: true });
    expect(cErr).toBeNull();

    const bookingId = randomUUID();
    const startAt = new Date(Date.now() - 95 * DAY_MS);
    const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);
    const { error: bErr } = await admin.from('bookings').insert({
      id: bookingId,
      tenant_id: SHOP_A.id,
      booking_no: `ATRISK${uniqueSuffix()}`,
      customer_id: customerId,
      service_id: SHOP_A.serviceA1,
      staff_id: null,
      start_at: startAt.toISOString(),
      end_at: endAt.toISOString(),
      duration_minutes: 60,
      price: 1200,
      final_price: 1200,
      status: 'COMPLETED',
      payment_status: 'PAID_OFFLINE',
      source: 'MANUAL',
    });
    expect(bErr).toBeNull();

    try {
      const res = await ownerA.get('/api/customers?atRisk=true&size=100');
      expect(res.status).toBe(200);
      const body = await readJson<Paged<Customer>>(res);
      expect(body.success).toBe(true);
      expect(body.data!.totalElements).toBe(1);
      expect(body.data!.content[0].id).toBe(customerId);
      expect(body.data!.content[0].atRisk).toBe(true);
    } finally {
      await admin.from('bookings').delete().eq('id', bookingId);
      await hardDeleteCustomer(customerId);
    }
  });

  it('minSpent=500：customerA1 有一筆 COMPLETED final_price=800（seed）→ 只含 A1，totalElements=1', async () => {
    const res = await ownerA.get('/api/customers?minSpent=500&size=100');
    expect(res.status).toBe(200);
    const body = await readJson<Paged<Customer>>(res);
    expect(body.success).toBe(true);
    expect(body.data!.totalElements).toBe(1);
    expect(body.data!.content[0].id).toBe(SHOP_A.customerA1);
    expect(body.data!.content[0].totalSpent).toBe(800);
  });

  it('minVisits=1：customerA1 booking_count(COMPLETED)=1（seed）→ 只含 A1，totalElements=1', async () => {
    const res = await ownerA.get('/api/customers?minVisits=1&size=100');
    expect(res.status).toBe(200);
    const body = await readJson<Paged<Customer>>(res);
    expect(body.success).toBe(true);
    expect(body.data!.totalElements).toBe(1);
    expect(body.data!.content[0].id).toBe(SHOP_A.customerA1);
    expect(body.data!.content[0].bookingCount).toBe(1);
  });

  it('未登入 → 401 AUTH_001', async () => {
    const res = await fetch(`${BASE}/api/customers`);
    expect(res.status).toBe(401);
    expect((await readJson(res)).code).toBe('AUTH_001');
  });
});

describe('POST /api/customers（04 §A-3）', () => {
  it('建立 → 回 id → GET 查得到；gender 空字串存 null、回傳 ""（mapper 規則）', async () => {
    const uniqueName = `建立測試顧客-${uniqueSuffix()}`;
    const postRes = await ownerA.post('/api/customers', {
      name: uniqueName,
      phone: '0933000001',
      gender: '',
      note: '整合測試自建',
    });
    expect(postRes.status).toBe(200);
    const postBody = await readJson<{ id: string }>(postRes);
    expect(postBody.success).toBe(true);
    const newId = postBody.data!.id;

    try {
      const getRes = await ownerA.get(`/api/customers?keyword=${encodeURIComponent(uniqueName)}&size=10`);
      expect(getRes.status).toBe(200);
      const getBody = await readJson<Paged<Customer>>(getRes);
      expect(getBody.data!.totalElements).toBe(1);
      const found = getBody.data!.content[0];
      expect(found.id).toBe(newId);
      expect(found.name).toBe(uniqueName);
      expect(found.phone).toBe('0933000001');
      expect(found.gender).toBe('');
      expect(found.note).toBe('整合測試自建');
    } finally {
      await hardDeleteCustomer(newId);
    }
  });
});

describe('PUT /api/customers/:id（04 §A-3）', () => {
  it('只更新有出現的欄位（PUT {note} 不動 name/phone）', async () => {
    const uniqueName = `部分更新測試顧客-${uniqueSuffix()}`;
    const postRes = await ownerA.post('/api/customers', { name: uniqueName, phone: '0933000002' });
    const newId = (await readJson<{ id: string }>(postRes)).data!.id;

    try {
      const putRes = await ownerA.put(`/api/customers/${newId}`, { note: '只改備註' });
      expect(putRes.status).toBe(200);
      expect((await readJson(putRes)).success).toBe(true);

      const getRes = await ownerA.get(`/api/customers?keyword=${encodeURIComponent(uniqueName)}&size=10`);
      const found = (await readJson<Paged<Customer>>(getRes)).data!.content[0];
      expect(found.name).toBe(uniqueName);
      expect(found.phone).toBe('0933000002');
      expect(found.note).toBe('只改備註');
    } finally {
      await hardDeleteCustomer(newId);
    }
  });

  it('跨租戶：owner-b PUT SHOP_A 的 customerA1 → 404 REQ_002（且不真的被改到）', async () => {
    const ownerB = await loginAs(SHOP_B.owner.email, SHOP_B.owner.password);
    const res = await ownerB.put(`/api/customers/${SHOP_A.customerA1}`, { note: '不該成功的跨租戶改動' });
    expect(res.status).toBe(404);
    const body = await readJson(res);
    expect(body.success).toBe(false);
    expect(body.code).toBe('REQ_002');

    const { data, error } = await admin.from('customers').select('note').eq('id', SHOP_A.customerA1).single();
    expect(error).toBeNull();
    expect((data as any).note).not.toBe('不該成功的跨租戶改動');
  });
});

describe('DELETE /api/customers/:id（04 §A-3：有進行中預約 409、軟刪 active=false）', () => {
  it('customerA1（seed 有 PENDING/CONFIRMED）DELETE → 409', async () => {
    const res = await ownerA.delete(`/api/customers/${SHOP_A.customerA1}`);
    expect(res.status).toBe(409);
    const body = await readJson(res);
    expect(body.success).toBe(false);
    // 04 分冊沒有為「有進行中預約」另訂專屬錯誤碼；錯誤碼總表裡 409 對應的
    // 唯一代碼是 REQ_003（狀態衝突），與 confirm 重複呼叫等其他狀態機衝突
    // 用同一個碼一致，故以此為準。
    expect(body.code).toBe('REQ_003');

    const { data, error } = await admin.from('customers').select('active').eq('id', SHOP_A.customerA1).single();
    expect(error).toBeNull();
    expect((data as any).active).toBe(true); // 沒有真的被刪
  });

  it('無進行中預約的自建顧客 DELETE → 200 → service role 直查 active=false（列仍在）', async () => {
    const uniqueName = `軟刪測試顧客-${uniqueSuffix()}`;
    const postRes = await ownerA.post('/api/customers', { name: uniqueName, phone: '0933000003' });
    const newId = (await readJson<{ id: string }>(postRes)).data!.id;

    try {
      const delRes = await ownerA.delete(`/api/customers/${newId}`);
      expect(delRes.status).toBe(200);
      expect((await readJson(delRes)).success).toBe(true);

      const { data, error } = await admin.from('customers').select('active').eq('id', newId).single();
      expect(error).toBeNull();
      expect((data as any).active).toBe(false);
    } finally {
      await hardDeleteCustomer(newId); // 硬刪清乾淨，避免污染 reports.a5 的 totalCustomers=3
    }
  });

  it('跨租戶：owner-b DELETE SHOP_A 的 customerA1 → 404 REQ_002（且不真的被改到）', async () => {
    const ownerB = await loginAs(SHOP_B.owner.email, SHOP_B.owner.password);
    const res = await ownerB.delete(`/api/customers/${SHOP_A.customerA1}`);
    expect(res.status).toBe(404);
    const body = await readJson(res);
    expect(body.success).toBe(false);
    expect(body.code).toBe('REQ_002');

    const { data, error } = await admin.from('customers').select('active').eq('id', SHOP_A.customerA1).single();
    expect(error).toBeNull();
    expect((data as any).active).toBe(true);
  });

  it('未登入 → 401 AUTH_001', async () => {
    const res = await fetch(`${BASE}/api/customers/${SHOP_A.customerA1}`, { method: 'DELETE' });
    expect(res.status).toBe(401);
    expect((await readJson(res)).code).toBe('AUTH_001');
  });
});
