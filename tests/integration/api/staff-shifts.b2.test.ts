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
let ownerB: AuthedApi;

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
  ownerB = await loginAs(SHOP_B.owner.email, SHOP_B.owner.password);
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

describe('POST /api/services/:id/duplicate（04 §B-2）', () => {
  it('複製服務會同時配置 public 與 LINE 排序且排在最後', async () => {
    const before = await admin
      .from('services')
      .select('sort_order, line_sort_order')
      .eq('tenant_id', SHOP_A.id);
    expect(before.error).toBeNull();
    const maxSort = Math.max(...(before.data ?? []).map((row: any) => row.sort_order), -1);
    const maxLineSort = Math.max(...(before.data ?? []).map((row: any) => row.line_sort_order), -1);

    const source = await admin
      .from('services')
      .select('name')
      .eq('id', SHOP_A.serviceA1)
      .single();
    expect(source.error).toBeNull();

    const res = await ownerA.post(`/api/services/${SHOP_A.serviceA1}/duplicate`);
    expect(res.status).toBe(200);
    const body = await readJson<{ id: string }>(res);
    expect(body.success).toBe(true);
    const duplicateId = body.data!.id;
    try {
      const duplicate = await admin
        .from('services')
        .select('name, sort_order, line_sort_order')
        .eq('id', duplicateId)
        .single();
      expect(duplicate.error).toBeNull();
      expect(duplicate.data!.name).toBe(`${source.data!.name}（複本）`);
      expect(duplicate.data!.sort_order).toBeGreaterThan(maxSort);
      expect(duplicate.data!.line_sort_order).toBeGreaterThan(maxLineSort);
    } finally {
      await admin.from('services').delete().eq('id', duplicateId);
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
      const { error: serviceError } = await admin.from('services').insert({
        id: serviceId, tenant_id: SHOP_A.id, name: `B2 待刪服務-${uniqueSuffix()}`,
        duration_minutes: 60, price: 500, sort_order: 60, line_sort_order: 60,
      });
      expect(serviceError).toBeNull();
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
  it('reorder 後指定服務 sort_order 依完整 ids 順序 2、3（unique index 下仍可交換）', async () => {
    const svcX = randomUUID();
    const svcY = randomUUID();
    try {
      const { error: serviceError } = await admin.from('services').insert([
        { id: svcX, tenant_id: SHOP_A.id, name: `B2 排序X-${uniqueSuffix()}`, duration_minutes: 30, price: 100, sort_order: 50, line_sort_order: 50 },
        { id: svcY, tenant_id: SHOP_A.id, name: `B2 排序Y-${uniqueSuffix()}`, duration_minutes: 30, price: 100, sort_order: 51, line_sort_order: 51 },
      ]);
      expect(serviceError).toBeNull();

      const res = await ownerA.post('/api/services/reorder', {
        ids: [SHOP_A.serviceA1, SHOP_A.serviceA2, svcY, svcX],
      });
      expect(res.status).toBe(200);
      expect((await readJson(res)).success).toBe(true);

      const { data, error } = await admin
        .from('services').select('id, sort_order').in('id', [svcX, svcY]);
      expect(error).toBeNull();
      const byId = new Map((data as any[]).map((r) => [r.id, r.sort_order]));
      expect(byId.get(svcY)).toBe(2);
      expect(byId.get(svcX)).toBe(3);
    } finally {
      await admin.from('services').delete().in('id', [svcX, svcY]);
    }
  });
});

describe('POST /api/services position allocation（#128）', () => {
  it('同租戶並行新增的兩套排序均唯一，另一租戶不受影響', async () => {
    const names = [`B2 並行服務 A-${uniqueSuffix()}`, `B2 並行服務 B-${uniqueSuffix()}`];
    const createdIds = new Set<string>();

    try {
      const beforeA = await admin
        .from('services').select('sort_order, line_sort_order').eq('tenant_id', SHOP_A.id);
      expect(beforeA.error).toBeNull();
      const maxA = Math.max(...(beforeA.data ?? []).map((row: any) => row.sort_order), -1);
      const maxLineA = Math.max(...(beforeA.data ?? []).map((row: any) => row.line_sort_order), -1);

      const responses = await Promise.all(names.map((name) => ownerA.post('/api/services', {
        name,
        durationMinutes: 30,
        price: 300,
      })));
      const bodies = await Promise.all(responses.map((response) => readJson<{ id: string }>(response)));
      for (const [index, response] of responses.entries()) {
        expect(response.status).toBe(200);
        expect(bodies[index].success).toBe(true);
        createdIds.add(bodies[index].data!.id);
      }

      const { data: rows, error } = await admin
        .from('services')
        .select('id, tenant_id, sort_order, line_sort_order')
        .in('id', [...createdIds]);
      expect(error).toBeNull();
      expect(rows).toHaveLength(2);
      expect(new Set((rows ?? []).map((row: any) => row.sort_order)).size).toBe(2);
      expect(new Set((rows ?? []).map((row: any) => row.line_sort_order)).size).toBe(2);
      for (const row of rows ?? []) {
        expect(row.sort_order).toBeGreaterThan(maxA);
        expect(row.line_sort_order).toBeGreaterThan(maxLineA);
      }

      const beforeAAfterCreates = await admin
        .from('services').select('id, sort_order, line_sort_order').eq('tenant_id', SHOP_A.id);
      expect(beforeAAfterCreates.error).toBeNull();

      const beforeB = await admin
        .from('services').select('sort_order, line_sort_order').eq('tenant_id', SHOP_B.id);
      expect(beforeB.error).toBeNull();
      const maxB = Math.max(...(beforeB.data ?? []).map((row: any) => row.sort_order), -1);
      const maxLineB = Math.max(...(beforeB.data ?? []).map((row: any) => row.line_sort_order), -1);

      const bResponse = await ownerB.post('/api/services', {
        name: `B2 另一租戶服務-${uniqueSuffix()}`,
        durationMinutes: 30,
        price: 300,
      });
      expect(bResponse.status).toBe(200);
      const bBody = await readJson<{ id: string }>(bResponse);
      expect(bBody.success).toBe(true);
      createdIds.add(bBody.data!.id);

      const bRow = await admin
        .from('services').select('sort_order, line_sort_order').eq('id', bBody.data!.id).single();
      expect(bRow.error).toBeNull();
      expect(bRow.data!.sort_order).toBeGreaterThan(maxB);
      expect(bRow.data!.line_sort_order).toBeGreaterThan(maxLineB);

      const afterB = await admin
        .from('services').select('id, sort_order, line_sort_order').eq('tenant_id', SHOP_A.id);
      expect(afterB.error).toBeNull();
      expect(afterB.data).toEqual(beforeAAfterCreates.data);
    } finally {
      if (createdIds.size > 0) await admin.from('services').delete().in('id', [...createdIds]);
    }
  });
});

describe('跨租戶：SHOP_B 的 service id 用 SHOP_A 身分打 → 404 REQ_002（04 §0 規約 7）', () => {
  it('PUT 與 DELETE 都回 404，且 B 店資料未被改動', async () => {
    const serviceBId = randomUUID();
    const originalName = `B 店服務-${uniqueSuffix()}`;
    try {
      const { error: serviceError } = await admin.from('services').insert({
        id: serviceBId, tenant_id: SHOP_B.id, name: originalName, duration_minutes: 30, price: 300,
        sort_order: 60, line_sort_order: 60,
      });
      expect(serviceError).toBeNull();

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
