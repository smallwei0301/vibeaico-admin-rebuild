/**
 * GUIDE action inbox API — #43-A 待確認預約 + #43-B 今日／明日出發團次 + #43-C 待收款預約。
 * #43-B 透過 TEST service role 建立短命測試資料，測畢清理並驗證
 * 不跨租戶；不新增 schema、狀態機或其他外部副作用。
 *
 * 這支一般 Product integration 不得把 #41 的 TEST-only overlay 當成 main 前提。
 * `readTourSeedFields()` 只在觀察到完整 #41 相容欄位時補上合法 snapshot；
 * canonical core 則送空物件，讓同一套讀取斷言真的能在 main schema 上執行。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A, SHOP_B, TRIP_A } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';
import type { GuideActionInboxItem } from '@/lib/types';
import { getGuideActionInboxDateWindow } from '@/lib/guide-action-inbox';
import { readTourSeedFields } from '../../../scripts/test/tour-seed-profile.mjs';

const BASE = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };

async function readJson<T = unknown>(res: Response): Promise<Envelope<T>> {
  return (await res.json()) as Envelope<T>;
}

/**
 * #41 相容 schema 要求 formation_deadline_at > now() 且 <= 出發時刻。
 * 因此不能把「今日 23:58」永久寫死：CI 若在台北 23:58 後執行，任何今日團次都
 * 已沒有合法的未來截止時間。能建立今日團次時，固定挑現在至少 3 分鐘後的分鐘；
 * 已進入一天最後兩分鐘時只驗明日團次，TODAY 分類仍由既有 unit contract 鎖住。
 */
function futureTaipeiStartTime(now = new Date()): string | null {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value);
  const target = hour * 60 + minute + 3;
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || target >= 24 * 60) return null;
  return `${String(Math.floor(target / 60)).padStart(2, '0')}:${String(target % 60).padStart(2, '0')}`;
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

describe('GET /api/guide/action-inbox（#43-A / #43-B / #43-C）', () => {
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
      href: `/tenant/bookings?status=PENDING&bookingId=${SHOP_A.bookingPending}`,
    });
    expect(['IMMEDIATE', 'TODAY', 'UPCOMING']).toContain(pending?.priority);
    expect(pending?.customerName).toBe('顧客 A1（測試）');
    expect(pending?.serviceName).toBe('基礎剪髮（測試）');

    const payment = body.data?.find((item) => item.id === SHOP_A.bookingConfirmed);
    if (!payment || payment.kind !== 'BOOKING_PAYMENT') {
      throw new Error('已確認未付款預約 action inbox item 缺少或種類錯誤');
    }
    expect(payment).toMatchObject({
      id: SHOP_A.bookingConfirmed,
      kind: 'BOOKING_PAYMENT',
      bookingNo: 'BSEED0002',
      amount: 800,
      href: `/tenant/bookings?status=CONFIRMED&paymentStatus=UNPAID&bookingId=${SHOP_A.bookingConfirmed}`,
    });
    expect(['IMMEDIATE', 'TODAY', 'UPCOMING']).toContain(payment.priority);
  });

  it('未登入回 401 AUTH_001', async () => {
    const res = await fetch(`${BASE}/api/guide/action-inbox`);
    expect(res.status).toBe(401);
    expect((await readJson(res)).code).toBe('AUTH_001');
  });

  it('bookingId deep link 可從分頁列表精確取回同租戶預約', async () => {
    const res = await ownerA.get(
      `/api/bookings?bookingId=${SHOP_A.bookingPending}&status=PENDING&size=1&page=0`,
    );
    expect(res.status).toBe(200);
    const body = await readJson<{ totalElements: number; content: Array<{ id: string; status: string }> }>(res);
    expect(body.success).toBe(true);
    expect(body.data?.totalElements).toBe(1);
    expect(body.data?.content).toHaveLength(1);
    expect(body.data?.content[0]).toMatchObject({ id: SHOP_A.bookingPending, status: 'PENDING' });

    const ownerB = await loginAs(SHOP_B.owner.email, SHOP_B.owner.password);
    const crossTenant = await ownerB.get(`/api/bookings?bookingId=${SHOP_A.bookingPending}`);
    expect(crossTenant.status).toBe(200);
    const crossTenantBody = await readJson<{ totalElements: number; content: unknown[] }>(crossTenant);
    expect(crossTenantBody.success).toBe(true);
    expect(crossTenantBody.data?.totalElements).toBe(0);
    expect(crossTenantBody.data?.content).toEqual([]);
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

  it('回傳今日仍可建立的團次與明日團次，並給正確 deep link', async () => {
    const now = new Date();
    const { today, tomorrow } = getGuideActionInboxDateWindow(now, 'Asia/Taipei');
    const createDeparture = async (departsOn: string, startTime: string) => {
      const deadline = new Date(Date.now() + 60_000).toISOString();
      const tourFields = await readTourSeedFields(admin, deadline, 'OBSERVE');
      const { data, error } = await admin.from('trip_departures').insert({
        tenant_id: SHOP_A.id,
        trip_id: TRIP_A.id,
        plan_id: TRIP_A.planA1,
        departs_on: departsOn,
        start_time: startTime,
        capacity: 10,
        status: 'OPEN',
        ...tourFields.departure,
      }).select('id').single();
      expect(error).toBeNull();
      expect(data?.id).toBeTruthy();
      temporaryDepartureIds.push(data!.id);
      return data!.id;
    };

    const todayStart = futureTaipeiStartTime(now);
    const todayId = todayStart ? await createDeparture(today, todayStart) : null;
    const tomorrowId = await createDeparture(tomorrow, '08:02');
    const res = await ownerA.get('/api/guide/action-inbox');
    expect(res.status).toBe(200);
    const body = await readJson<GuideActionInboxItem[]>(res);
    const tomorrowItem = body.data?.find((item) => item.id === tomorrowId);

    if (todayId && todayStart) {
      const todayItem = body.data?.find((item) => item.id === todayId);
      expect(todayItem).toMatchObject({
        kind: 'DEPARTURE',
        tripId: TRIP_A.id,
        tripName: 'A 店測試行程',
        planName: '標準團（測試）',
        departureDate: today,
        startTime: todayStart,
        departureDay: 'TODAY',
        priority: 'TODAY',
        href: `/tenant/trips/${TRIP_A.id}`,
      });
    }
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
