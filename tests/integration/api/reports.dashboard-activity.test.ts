/**
 * /api/reports/dashboard-activity 整合測試（Issue #7）。
 * 端點行為見 src/app/api/reports/dashboard-activity/route.ts 檔頭註解：合併
 * bookings.created_at（BOOKING_CREATED）、status 為 COMPLETED/CANCELLED 的
 * bookings.updated_at（BOOKING_COMPLETED/BOOKING_CANCELLED，誠實口徑：這是
 * 「最後更新時間」的近似值，不是真正的狀態轉換時間戳）、customers.created_at
 * （CUSTOMER_CREATED）、product_orders.created_at（ORDER_CREATED，SHOP_A 種子
 * 沒有 product_orders，這裡不斷言此類型），依 at 由新到舊排序取前 10 筆。
 *
 * 神諭（oracle）：不 import src/app/api/reports/dashboard-activity/route.ts，
 * 用 service role 直查種子資料，在測試裡獨立重算「合併＋排序」的結果 ——
 * 與受測程式共用排序/合併實作的話，實作錯了測試也跟著錯，驗不到東西
 * （同 reports.a5.test.ts 的做法）。
 *
 * 清理紀律：本檔只讀，不寫入任何資料，不需要清理（前提同 reports.a5.test.ts：
 * 其他測試檔已依各自清理紀律，未在 SHOP_A 留下多餘的 bookings/customers 列）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { SHOP_A, SHOP_B } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';
import type { RecentActivity } from '@/services/reports';

const BASE = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };

async function readJson<T = unknown>(res: Response): Promise<Envelope<T>> {
  return (await res.json()) as Envelope<T>;
}

interface SeedActivity { id: string; type: RecentActivity['type']; name: string; target: string; at: string }

let ownerA: AuthedApi;
let expected: SeedActivity[];

beforeAll(async () => {
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);

  const admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const [{ data: bookings, error: e1 }, { data: customers, error: e2 }] = await Promise.all([
    admin.from('bookings_view')
      .select('id, customer_name, service_name, status, created_at, updated_at')
      .eq('tenant_id', SHOP_A.id),
    admin.from('customers').select('id, name, created_at').eq('tenant_id', SHOP_A.id),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  expect(bookings?.length).toBe(4); // 前提檢查：清理紀律沒被破壞
  expect(customers?.length).toBe(3);

  // 獨立重算合併＋排序：與受測 route 不共用實作。
  const items: SeedActivity[] = [
    ...(bookings ?? []).map((b): SeedActivity => ({
      id: `bc_${b.id}`, type: 'BOOKING_CREATED', name: b.customer_name, target: b.service_name, at: b.created_at,
    })),
    ...(bookings ?? [])
      .filter((b) => b.status === 'COMPLETED' || b.status === 'CANCELLED')
      .map((b): SeedActivity => ({
        id: `bs_${b.id}`,
        type: b.status === 'COMPLETED' ? 'BOOKING_COMPLETED' : 'BOOKING_CANCELLED',
        name: b.customer_name, target: b.service_name, at: b.updated_at,
      })),
    ...(customers ?? []).map((c): SeedActivity => ({
      id: `cc_${c.id}`, type: 'CUSTOMER_CREATED', name: c.name, target: '', at: c.created_at,
    })),
  ];
  items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  expected = items.slice(0, 10);
});

describe('GET /api/reports/dashboard-activity（Issue #7）', () => {
  it('回傳依 at 新到舊排序的前 10 筆，內容與獨立神諭一致（種子只有 4 booking + 3 customer 事件 → 最多 8 筆）', async () => {
    const res = await ownerA.get('/api/reports/dashboard-activity');
    expect(res.status).toBe(200);
    const body = await readJson<RecentActivity[]>(res);
    expect(body.success).toBe(true);
    const data = body.data!;

    expect(data.length).toBe(expected.length);
    expect(data.length).toBeLessThanOrEqual(10);

    // 排序：每一筆的 at 都不早於下一筆（新到舊）。
    for (let i = 1; i < data.length; i += 1) {
      expect(Date.parse(data[i - 1]!.at)).toBeGreaterThanOrEqual(Date.parse(data[i]!.at));
    }

    // 逐筆比對 id/type/name/target/at（id 已含前綴，type 對齊神諭分類）。
    const byId = new Map(expected.map((e) => [e.id, e]));
    for (const item of data) {
      const exp = byId.get(item.id);
      expect(exp, `unexpected activity id ${item.id}`).toBeDefined();
      expect(item.type).toBe(exp!.type);
      expect(item.name).toBe(exp!.name);
      expect(item.target).toBe(exp!.target);
      expect(item.at).toBe(exp!.at);
    }

    // 種子的 bookingCompleted／bookingCancelled 一定要各出現一次 BOOKING_COMPLETED / BOOKING_CANCELLED。
    expect(data.some((a) => a.type === 'BOOKING_COMPLETED')).toBe(true);
    expect(data.some((a) => a.type === 'BOOKING_CANCELLED')).toBe(true);
    expect(data.filter((a) => a.type === 'BOOKING_CREATED').length).toBe(4);
    expect(data.filter((a) => a.type === 'CUSTOMER_CREATED').length).toBe(3);
  });

  it('未登入 → 401 AUTH_001', async () => {
    const res = await fetch(`${BASE}/api/reports/dashboard-activity`);
    expect(res.status).toBe(401);
    expect((await readJson(res)).code).toBe('AUTH_001');
  });

  it('跨租戶隔離：B 店帳號只看得到自己（1 筆 CUSTOMER_CREATED）的活動，不含 A 店資料', async () => {
    const ownerB = await loginAs(SHOP_B.owner.email, SHOP_B.owner.password);
    const res = await ownerB.get('/api/reports/dashboard-activity');
    expect(res.status).toBe(200);
    const body = await readJson<RecentActivity[]>(res);
    expect(body.success).toBe(true);
    const data = body.data!;
    expect(data.every((a) => a.type === 'CUSTOMER_CREATED')).toBe(true);
    expect(data.length).toBe(1);
  });
});
