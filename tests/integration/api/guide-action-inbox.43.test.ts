/**
 * GUIDE action inbox API — #43-A 待確認預約 + #43-B 今日／明日出發團次。
 * #43-B 透過既有團次 API 建立短命測試資料，測畢以 service role 清理並驗證
 * 不跨租戶；不新增 schema、狀態機或其他外部副作用。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A, SHOP_B, TRIP_A } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';
import type { GuideActionInboxItem } from '@/lib/types';
import { getGuideActionInboxDateWindow } from '@/lib/guide-action-inbox';

const BASE = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };

async function readJson<T = unknown>(res: Response): Promise<Envelope<T>> {
  return (await res.json()) as Envelope<T>;
}

let admin: SupabaseClient;
let ownerA: AuthedApi;
const temporaryDepartureIds: string[] = [];

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
});

afterAll(async () => {
  for (const id of temporaryDepartureIds) {
    const { error } = await admin.from('trip_departures').delete()
      .eq('tenant_id', SHOP_A.id).eq('id', id);
    if (error) throw error;
  }
});

describe('GET /api/guide/action-inbox（#43-A / #43-B）', () => {
  it('登入租戶回傳待確認預約的可操作欄位與優先級', async () => {
    const res = await ownerA.get('/api/guide/action-inbox');
    expect(res.status).toBe(200);
    const body = await readJson<GuideActionInboxItem[]>(res);
    expect(body.success).toBe(true);

    const pending = body.data?.find((item) => item.id === SHOP_A.bookingPending);
    if (!pending || pending.kind !== 'BOOKING_REQUEST') {
      throw new Error('待確認預約 action inbox item 缺少或種類錯誤');
    }
    expect(pending).toMatchObject({
      id: SHOP_A.bookingPending,
      kind: 'BOOKING_REQUEST',
      bookingNo: 'BSEED0001',
      href: '/tenant/bookings?status=PENDING',
    });
    expect(['IMMEDIATE', 'TODAY', 'UPCOMING']).toContain(pending?.priority);
    expect(pending?.customerName).toBe('顧客 A1（測試）');
    expect(pending?.serviceName).toBe('基礎剪髮（測試）');
  });

  it('未登入回 401 AUTH_001', async () => {
    const res = await fetch(`${BASE}/api/guide/action-inbox`);
    expect(res.status).toBe(401);
    expect((await readJson(res)).code).toBe('AUTH_001');
  });

  it('SHOP_B 不會看到 SHOP_A 的待確認預約', async () => {
    const ownerB = await loginAs(SHOP_B.owner.email, SHOP_B.owner.password);
    const res = await ownerB.get('/api/guide/action-inbox');
    expect(res.status).toBe(200);
    const body = await readJson<GuideActionInboxItem[]>(res);
    expect(body.success).toBe(true);
    expect(body.data ?? []).toEqual([]);
    expect(body.data?.some((item) => item.id === SHOP_A.bookingPending)).toBe(false);
  });

  it('回傳今天與明日團次的白話資料與正確 deep link', async () => {
    const { today, tomorrow } = getGuideActionInboxDateWindow(new Date(), 'Asia/Taipei');
    const createDeparture = async (departsOn: string, startTime: string) => {
      const res = await ownerA.post(`/api/trips/${TRIP_A.id}/departures`, {
        planId: TRIP_A.planA1,
        departsOn,
        startTime,
        capacity: 10,
      });
      expect(res.status).toBe(200);
      const body = await readJson<{ id: string }>(res);
      expect(body.success).toBe(true);
      temporaryDepartureIds.push(body.data!.id);
      return body.data!.id;
    };

    const todayId = await createDeparture(today, '23:58');
    const tomorrowId = await createDeparture(tomorrow, '08:02');
    const res = await ownerA.get('/api/guide/action-inbox');
    expect(res.status).toBe(200);
    const body = await readJson<GuideActionInboxItem[]>(res);
    const todayItem = body.data?.find((item) => item.id === todayId);
    const tomorrowItem = body.data?.find((item) => item.id === tomorrowId);

    expect(todayItem).toMatchObject({
      kind: 'DEPARTURE',
      tripId: TRIP_A.id,
      tripName: 'A 店測試行程',
      planName: '標準團（測試）',
      departureDate: today,
      startTime: '23:58',
      departureDay: 'TODAY',
      priority: 'TODAY',
      href: `/tenant/trips/${TRIP_A.id}`,
    });
    expect(tomorrowItem).toMatchObject({
      kind: 'DEPARTURE',
      departureDate: tomorrow,
      startTime: '08:02',
      departureDay: 'TOMORROW',
      priority: 'UPCOMING',
      href: `/tenant/trips/${TRIP_A.id}`,
    });

    const ownerB = await loginAs(SHOP_B.owner.email, SHOP_B.owner.password);
    const shopBResponse = await ownerB.get('/api/guide/action-inbox');
    expect(shopBResponse.status).toBe(200);
    const shopBBody = await readJson<GuideActionInboxItem[]>(shopBResponse);
    expect(shopBBody.data?.some((item) => temporaryDepartureIds.includes(item.id))).toBe(false);
  });
});
