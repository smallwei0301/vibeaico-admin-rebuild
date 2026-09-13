/**
 * /api/reports/booking-sources 整合測試（Issue #7）。
 * 端點行為見 src/app/api/reports/booking-sources/route.ts 檔頭註解：本月（預設，
 * 台北時區固定 +08:00）內以 start_at 篩選的預約，按 bookings.source 計數，
 * 固定回傳 LINE/PUBLIC_PAGE/MANUAL/RECURRING 四個 key（缺的補 0）。
 *
 * 手算期望值（依 scripts/test/seed.mjs 的 SHOP_A 種子，見 12 §1.3，同
 * reports.a5.test.ts 的頭部說明）：4 筆 bookings 全部 source='MANUAL'，
 * start_at 都在 seed 執行當下 ±6 小時內 —— 落在本月是必然的（±6 小時不可能
 * 跨月），因此不需要像 dashboard/staff-performance 那樣另外現算時窗神諭：
 *   → MANUAL=4，LINE=PUBLIC_PAGE=RECURRING=0。
 *
 * 清理紀律：本檔只讀，不寫入任何資料，不需要清理（前提同 reports.a5.test.ts：
 * 其他測試檔已依各自清理紀律，未在 SHOP_A 留下多餘的 bookings 列）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { SHOP_A, SHOP_B } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';
import type { MonthSourcePoint } from '@/services/reports';

const BASE = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };

async function readJson<T = unknown>(res: Response): Promise<Envelope<T>> {
  return (await res.json()) as Envelope<T>;
}

let ownerA: AuthedApi;
let seedBookings: { source: string }[];

beforeAll(async () => {
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);

  // service role 直查本租戶全部預約 source（正常情況＝種子 4 筆全部 MANUAL；
  // 其他測試檔的自建預約都已依清理紀律硬刪，同 reports.a5.test.ts 的前提）。
  const admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const { data, error } = await admin.from('bookings').select('source').eq('tenant_id', SHOP_A.id);
  if (error) throw error;
  seedBookings = (data ?? []) as { source: string }[];
  expect(seedBookings.length).toBe(4); // 前提檢查：清理紀律沒被破壞
});

describe('GET /api/reports/booking-sources（Issue #7，預設本月）', () => {
  it('以 seed 手算：MANUAL=4，其餘來源=0，四個 key 都回傳', async () => {
    const expectedCounts: Record<string, number> = { LINE: 0, PUBLIC_PAGE: 0, MANUAL: 0, RECURRING: 0 };
    for (const b of seedBookings) expectedCounts[b.source] = (expectedCounts[b.source] ?? 0) + 1;

    const res = await ownerA.get('/api/reports/booking-sources');
    expect(res.status).toBe(200);
    const body = await readJson<MonthSourcePoint[]>(res);
    expect(body.success).toBe(true);
    const data = body.data!;

    expect(data).toHaveLength(4);
    const bySource = Object.fromEntries(data.map((s) => [s.source, s.count]));
    expect(bySource.MANUAL).toBe(expectedCounts.MANUAL);
    expect(bySource.LINE).toBe(expectedCounts.LINE);
    expect(bySource.PUBLIC_PAGE).toBe(expectedCounts.PUBLIC_PAGE);
    expect(bySource.RECURRING).toBe(expectedCounts.RECURRING);
    expect(bySource.MANUAL).toBe(4);
  });

  it('未登入 → 401 AUTH_001', async () => {
    const res = await fetch(`${BASE}/api/reports/booking-sources`);
    expect(res.status).toBe(401);
    expect((await readJson(res)).code).toBe('AUTH_001');
  });

  it('跨租戶隔離：B 店帳號只看得到自己（0 筆）的來源分布，不含 A 店資料（SHOP_B 目前只有最小種子，沒有 bookings）', async () => {
    const ownerB = await loginAs(SHOP_B.owner.email, SHOP_B.owner.password);
    const res = await ownerB.get('/api/reports/booking-sources');
    expect(res.status).toBe(200);
    const body = await readJson<MonthSourcePoint[]>(res);
    expect(body.success).toBe(true);
    const total = body.data!.reduce((s, x) => s + x.count, 0);
    expect(total).toBe(0);
  });
});
