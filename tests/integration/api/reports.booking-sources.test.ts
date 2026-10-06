/**
 * /api/reports/booking-sources 整合測試（Issue #7）。
 * 端點行為見 src/app/api/reports/booking-sources/route.ts 檔頭註解：本月（預設，
 * 台北時區固定 +08:00）內以 start_at 篩選的預約，按 bookings.source 計數，
 * 固定回傳 LINE/PUBLIC_PAGE/MANUAL/RECURRING 四個 key（缺的補 0）。
 *
 * 期望值（依 scripts/test/seed.mjs 的 SHOP_A 種子，見 reports.a5.test.ts
 * 的頭部說明）：4 筆 bookings 全部 source='MANUAL'，start_at 分別是 seed
 * 當下 +1h/+3h/-2h/+5h。預設區間是 Asia/Taipei 固定 +08:00 的本月；月末時
 * +5h 可以跨到下個月，故按獨立半開區間神諭從 4 筆種子中現算期望值，不能把全部
 * tenant rows 都當成本月資料。
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

/*
 * 獨立時窗神諭：預設本月＝Asia/Taipei 固定 +08:00 的 [from, to)。
 * 刻意不 import src/server/tz.ts，避免受測實作與期望值共用同一錯誤。
 */
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

function taipeiMonthWindow(now = new Date()) {
  const taipei = new Date(now.getTime() + TAIPEI_OFFSET_MS);
  const year = taipei.getUTCFullYear();
  const month = taipei.getUTCMonth();
  return {
    from: Date.UTC(year, month, 1) - TAIPEI_OFFSET_MS,
    to: Date.UTC(year, month + 1, 1) - TAIPEI_OFFSET_MS,
  };
}

function isInMonthWindow(startAt: string, month: ReturnType<typeof taipeiMonthWindow>) {
  const startAtMs = new Date(startAt).getTime();
  return startAtMs >= month.from && startAtMs < month.to;
}

function isInTaipeiMonth(startAt: string, now = new Date()) {
  return isInMonthWindow(startAt, taipeiMonthWindow(now));
}

async function requestInStableTaipeiMonth(
  request: () => Promise<Response>,
  now: () => Date = () => new Date(),
) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const month = taipeiMonthWindow(now());
    const response = await request();
    const afterRequest = taipeiMonthWindow(now());
    if (month.from === afterRequest.from && month.to === afterRequest.to) {
      return { month, response };
    }
  }

  throw new Error('台北本月在 API 請求期間切換兩次，無法安全比較精確來源計數');
}

async function readJson<T = unknown>(res: Response): Promise<Envelope<T>> {
  return (await res.json()) as Envelope<T>;
}

interface SeedBookingRow { start_at: string; source: string }

let ownerA: AuthedApi;
let seedBookings: SeedBookingRow[];

describe('booking-sources 的台北本月測試神諭', () => {
  it('月末與月初以半開區間切換，+5h 跨月排除且月初邊界納入', () => {
    const beforeBoundary = taipeiMonthWindow(new Date('2026-09-30T15:59:59.999Z'));
    expect(beforeBoundary).toEqual({
      from: Date.parse('2026-08-31T16:00:00.000Z'),
      to: Date.parse('2026-09-30T16:00:00.000Z'),
    });

    const atBoundary = taipeiMonthWindow(new Date('2026-09-30T16:00:00.000Z'));
    expect(atBoundary).toEqual({
      from: Date.parse('2026-09-30T16:00:00.000Z'),
      to: Date.parse('2026-10-31T16:00:00.000Z'),
    });

    const seedStartedAt = new Date('2026-09-30T12:22:50.879Z');
    const cancelledAt = new Date(seedStartedAt.getTime() + 5 * 60 * 60 * 1000).toISOString();
    expect(isInTaipeiMonth(cancelledAt, seedStartedAt)).toBe(false);
    expect(isInTaipeiMonth(cancelledAt, new Date('2026-10-01T00:00:00.000Z'))).toBe(true);
    expect(isInTaipeiMonth('2026-09-30T16:00:00.000Z', new Date('2026-10-01T00:00:00.000Z'))).toBe(true);
  });

  it('請求跨月時只重試一次，並以同一次穩定窗口計算', async () => {
    const times = [
      '2026-09-30T15:59:59.999Z', '2026-09-30T16:00:00.000Z',
      '2026-09-30T16:00:00.000Z', '2026-09-30T16:00:00.001Z',
    ].map((iso) => new Date(iso));
    const response = new Response();
    let clockRead = 0;
    let requestCount = 0;

    const result = await requestInStableTaipeiMonth(
      async () => {
        requestCount += 1;
        return response;
      },
      () => times[clockRead++],
    );

    expect(requestCount).toBe(2);
    expect(result.response).toBe(response);
    expect(result.month).toEqual(taipeiMonthWindow(new Date('2026-09-30T16:00:00.000Z')));
  });

  it('連續兩次跨月時明確失敗，不以不穩定窗口弱化斷言', async () => {
    const times = [
      '2026-09-30T15:59:59.999Z', '2026-09-30T16:00:00.000Z',
      '2026-10-31T15:59:59.999Z', '2026-10-31T16:00:00.000Z',
    ].map((iso) => new Date(iso));
    let clockRead = 0;
    let requestCount = 0;

    await expect(requestInStableTaipeiMonth(
      async () => {
        requestCount += 1;
        return new Response();
      },
      () => times[clockRead++],
    )).rejects.toThrow('台北本月在 API 請求期間切換兩次');
    expect(requestCount).toBe(2);
  });
});

describe('GET /api/reports/booking-sources（Issue #7，預設本月）', () => {
  beforeAll(async () => {
    ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);

    // service role 直查本租戶 4 筆種子的時窗與 source。其他測試檔的自建預約
    // 都已依清理紀律硬刪，同 reports.a5.test.ts 的前提。
    const admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const { data, error } = await admin.from('bookings').select('start_at, source').eq('tenant_id', SHOP_A.id);
    if (error) throw error;
    seedBookings = (data ?? []) as SeedBookingRow[];
    expect(seedBookings.length).toBe(4); // 前提檢查：清理紀律沒被破壞
  });

  it('以 seed 與台北本月時窗現算來源數，四個 key 都回傳', async () => {
    const expectedCounts: Record<string, number> = { LINE: 0, PUBLIC_PAGE: 0, MANUAL: 0, RECURRING: 0 };
    const { month, response: res } = await requestInStableTaipeiMonth(
      () => ownerA.get('/api/reports/booking-sources'),
    );
    for (const booking of seedBookings) {
      if (isInMonthWindow(booking.start_at, month)) {
        expectedCounts[booking.source] = (expectedCounts[booking.source] ?? 0) + 1;
      }
    }

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
