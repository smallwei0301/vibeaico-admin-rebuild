/**
 * 服務 / 員工 / 班表 API 整合測試 — 12 分冊 §4「Phase 5」矩陣「其餘 B 組端點：
 * 照 §3 骨架，含各狀態機 409」。端點規格見 docs/integration/04-API-CONTRACTS.md §B-2：
 *   - POST /api/services、PUT/DELETE /:id：CRUD；DELETE 有未來預約 → 改 active=false
 *   - POST /api/services/reorder：{ids:[]} 依序寫 sort_order=index
 *   - POST /api/staff、PUT /:id：body 含 serviceIds[] → 先寫 staff 再全刪重插
 *     staff_services
 *   - GET/POST /api/shift-templates、GET/POST /api/shifts（批次 upsert）
 *   - 跨租戶：§0 規約 7 —— id 查無或不屬於本租戶都回 404 REQ_002
 *
 * 清理紀律：全部用自建資料（服務/員工/顧客/班別/班表），try/finally 或
 * afterAll 內以 service role 刪除；reorder 只 reorder 自建服務，不動 seed 的
 * serviceA1/A2 的 sort_order。班表用 +400 天的遠期日期，避免影響
 * available-slots 類測試（「該日有班表資料 → 沒排班的員工視為不上班」）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { SHOP_A, SHOP_B } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';
import type { Service } from '@/lib/types';

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

async function staffServiceIds(staffId: string): Promise<string[]> {
  const { data, error } = await admin
    .from('staff_services')
    .select('service_id')
    .eq('staff_id', staffId);
  expect(error).toBeNull();
  return (data as any[]).map((r) => r.service_id).sort();
}

describe('POST /api/services → GET /api/services（04 §B-2 CRUD）', () => {
  it('新增後列表看得到，欄位正確', async () => {
    const name = `B2 測試服務-${uniqueSuffix()}`;
    const res = await ownerA.post('/api/services', {
      name,
      durationMinutes: 45,
      price: 600,
    });
    expect(res.status).toBe(200);
    const body = await readJson<{ id: string }>(res);
    expect(body.success).toBe(true);
    expect(typeof body.data?.id).toBe('string');
    const serviceId = body.data!.id;
    try {
      const list = await ownerA.get('/api/services');
      expect(list.status).toBe(200);
      const listBody = await readJson<Service[]>(list);
      const created = listBody.data!.find((s) => s.id === serviceId);
      expect(created).toBeDefined();
      expect(created!.name).toBe(name);
      expect(created!.durationMinutes).toBe(45);
      expect(created!.price).toBe(600);
      expect(created!.active).toBe(true);
    } finally {
      await admin.from('services').delete().eq('id', serviceId);
    }
  });
});

describe('DELETE /api/services/:id 有未來預約 → 軟刪 active=false（04 §B-2）', () => {
  it('服務仍存在但 active=false，且回應 200', async () => {
    const serviceId = randomUUID();
    const customerId = randomUUID();
    const bookingId = randomUUID();
    const start = new Date(Date.now() + 330 * DAY_MS);
    try {
      await admin.from('services').insert({
        id: serviceId, tenant_id: SHOP_A.id, name: `B2 待刪服務-${uniqueSuffix()}`,
        duration_minutes: 60, price: 500,
      });
      await admin.from('customers').insert({
        id: customerId, tenant_id: SHOP_A.id, name: 'B2 刪服務測試顧客', phone: '',
      });
      const { error: bErr } = await admin.from('bookings').insert({
        id: bookingId, tenant_id: SHOP_A.id, booking_no: `TESTB2${uniqueSuffix()}`,
        customer_id: customerId, service_id: serviceId, staff_id: null,
        start_at: start.toISOString(),
        end_at: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
        duration_minutes: 60, price: 500, final_price: 500,
        status: 'PENDING', payment_status: 'UNPAID', source: 'MANUAL',
      });
      expect(bErr).toBeNull();

      const res = await ownerA.delete(`/api/services/${serviceId}`);
      expect(res.status).toBe(200);
      expect((await readJson(res)).success).toBe(true);

      const { data, error } = await admin
        .from('services').select('active').eq('id', serviceId).single();
      expect(error).toBeNull();
      expect((data as any).active).toBe(false); // 軟刪，列仍在
    } finally {
      await admin.from('bookings').delete().eq('id', bookingId);
      await admin.from('services').delete().eq('id', serviceId);
      await admin.from('customers').delete().eq('id', customerId);
    }
  });
});

describe('POST /api/staff 帶 serviceIds → staff_services；PUT serviceIds=[] → 清空（04 §B-2）', () => {
  it('新增員工掛 2 服務 → staff_services 正確', async () => {
    const res = await ownerA.post('/api/staff', {
      name: `B2 測試員工-${uniqueSuffix()}`,
      serviceIds: [SHOP_A.serviceA1, SHOP_A.serviceA2],
    });
    expect(res.status).toBe(200);
    const body = await readJson<{ id: string }>(res);
    expect(body.success).toBe(true);
    const staffId = body.data!.id;
    try {
      expect(await staffServiceIds(staffId)).toEqual(
        [SHOP_A.serviceA1, SHOP_A.serviceA2].sort(),
      );
    } finally {
      await admin.from('staff').delete().eq('id', staffId); // staff_services cascade
    }
  });

  it('PUT serviceIds=[] → staff_services 全清空', async () => {
    const create = await ownerA.post('/api/staff', {
      name: `B2 清空服務員工-${uniqueSuffix()}`,
      serviceIds: [SHOP_A.serviceA1],
    });
    expect(create.status).toBe(200);
    const staffId = (await readJson<{ id: string }>(create)).data!.id;
    try {
      expect(await staffServiceIds(staffId)).toEqual([SHOP_A.serviceA1]);

      const res = await ownerA.put(`/api/staff/${staffId}`, { serviceIds: [] });
      expect(res.status).toBe(200);
      expect((await readJson(res)).success).toBe(true);
      expect(await staffServiceIds(staffId)).toEqual([]);
    } finally {
      await admin.from('staff').delete().eq('id', staffId);
    }
  });
});

describe('POST /api/services/reorder（04 §B-2：ids 依序寫 sort_order=index）', () => {
  it('reorder 後 sort_order 依 ids 順序 0、1（提交完整租戶集合）', async () => {
    const svcX = randomUUID();
    const svcY = randomUUID();
    try {
      await admin.from('services').insert([
        { id: svcX, tenant_id: SHOP_A.id, name: `B2 排序X-${uniqueSuffix()}`, duration_minutes: 30, price: 100, sort_order: 50 },
        { id: svcY, tenant_id: SHOP_A.id, name: `B2 排序Y-${uniqueSuffix()}`, duration_minutes: 30, price: 100, sort_order: 51 },
      ]);

      // The atomic reorder RPC intentionally rejects partial permutations. Keep
      // the seed rows in the submitted collection while asserting the two
      // self-owned rows still receive the requested leading positions.
      const { data: tenantServices, error: tenantServicesError } = await admin
        .from('services').select('id').eq('tenant_id', SHOP_A.id);
      expect(tenantServicesError).toBeNull();
      const ownIds = new Set<string>([svcX, svcY]);
      const ids = [svcY, svcX, ...(tenantServices ?? [])
        .map((row: any) => row.id).filter((id: string) => !ownIds.has(id))];
      const res = await ownerA.post('/api/services/reorder', { ids });
      expect(res.status).toBe(200);
      expect((await readJson(res)).success).toBe(true);

      const { data, error } = await admin
        .from('services').select('id, sort_order').in('id', [svcX, svcY]);
      expect(error).toBeNull();
      const byId = new Map((data as any[]).map((r) => [r.id, r.sort_order]));
      expect(byId.get(svcY)).toBe(0);
      expect(byId.get(svcX)).toBe(1);
    } finally {
      await admin.from('services').delete().in('id', [svcX, svcY]);
    }
  });
});

describe('跨租戶：SHOP_B 的 service id 用 SHOP_A 身分打 → 404 REQ_002（04 §0 規約 7）', () => {
  it('PUT 與 DELETE 都回 404，且 B 店資料未被改動', async () => {
    const serviceBId = randomUUID();
    const originalName = `B 店服務-${uniqueSuffix()}`;
    try {
      await admin.from('services').insert({
        id: serviceBId, tenant_id: SHOP_B.id, name: originalName, duration_minutes: 30, price: 300,
      });

      const put = await ownerA.put(`/api/services/${serviceBId}`, { name: '越權改名' });
      expect(put.status).toBe(404);
      const putBody = await readJson(put);
      expect(putBody.success).toBe(false);
      expect(putBody.code).toBe('REQ_002');

      const del = await ownerA.delete(`/api/services/${serviceBId}`);
      expect(del.status).toBe(404);
      expect((await readJson(del)).code).toBe('REQ_002');

      const { data } = await admin
        .from('services').select('name, active').eq('id', serviceBId).single();
      expect((data as any).name).toBe(originalName);
      expect((data as any).active).toBe(true);
    } finally {
      await admin.from('services').delete().eq('id', serviceBId);
    }
  });
});

describe('班別模板 + 班表批次 upsert（04 §B-2）', () => {
  it('POST /api/shift-templates → GET 看得到；POST /api/shifts 批次寫入後 GET ?from&to 查得到，同鍵重送覆蓋 end_time', async () => {
    // 遠期日期（+400 天）：避免留班表資料影響 available-slots 演算法的其他測試
    const workDate = new Date(Date.now() + 400 * DAY_MS).toISOString().slice(0, 10);
    const templateName = `B2 早班-${uniqueSuffix()}`;

    const createTpl = await ownerA.post('/api/shift-templates', {
      name: templateName,
      startTime: '09:00',
      endTime: '13:00',
    });
    expect(createTpl.status).toBe(200);
    const tplBody = await readJson<{ id: string }>(createTpl);
    expect(tplBody.success).toBe(true);
    const templateId = tplBody.data!.id;

    try {
      const listTpl = await ownerA.get('/api/shift-templates');
      expect(listTpl.status).toBe(200);
      const tpl = (await readJson<Array<{ id: string; name: string; startTime: string; endTime: string }>>(listTpl))
        .data!.find((x) => x.id === templateId);
      expect(tpl).toBeDefined();
      expect(tpl!.name).toBe(templateName);
      expect(tpl!.startTime).toBe('09:00');
      expect(tpl!.endTime).toBe('13:00');

      // 批次 upsert：staffA1 該日 09:00–13:00
      const post1 = await ownerA.post('/api/shifts', [
        { staffId: SHOP_A.staffA1, workDate, startTime: '09:00', endTime: '13:00', templateId },
      ]);
      expect(post1.status).toBe(200);
      expect((await readJson(post1)).success).toBe(true);

      type ShiftRow = { staffId: string; workDate: string; startTime: string; endTime: string; templateId: string | null };
      const get1 = await ownerA.get(`/api/shifts?from=${workDate}&to=${workDate}`);
      expect(get1.status).toBe(200);
      const rows1 = (await readJson<ShiftRow[]>(get1)).data!;
      const mine1 = rows1.filter((r) => r.staffId === SHOP_A.staffA1 && r.workDate === workDate);
      expect(mine1).toHaveLength(1);
      expect(mine1[0].startTime).toBe('09:00');
      expect(mine1[0].endTime).toBe('13:00');
      expect(mine1[0].templateId).toBe(templateId);

      // 同鍵（staff+日期+起始）重送不同 endTime → 覆蓋，不重複
      const post2 = await ownerA.post('/api/shifts', [
        { staffId: SHOP_A.staffA1, workDate, startTime: '09:00', endTime: '14:00' },
      ]);
      expect(post2.status).toBe(200);
      const get2 = await ownerA.get(`/api/shifts?from=${workDate}&to=${workDate}`);
      const mine2 = (await readJson<ShiftRow[]>(get2)).data!
        .filter((r) => r.staffId === SHOP_A.staffA1 && r.workDate === workDate);
      expect(mine2).toHaveLength(1);
      expect(mine2[0].endTime).toBe('14:00');
    } finally {
      await admin.from('shifts').delete().eq('tenant_id', SHOP_A.id).eq('work_date', workDate);
      await admin.from('shift_templates').delete().eq('id', templateId);
    }
  });
});
