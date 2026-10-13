/**
 * issue #933：預約日期篩選店家時區日界線、mark-paid-offline 狀態守門、
 * apply-coupon 同一預約不可重複核銷、詳情金額同步。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

type Row = Record<string, any>;
const state = vi.hoisted(() => ({ sb: null as any }));

vi.mock('@/server/tenant', () => ({
  requireTenant: async () => ({ tenantId: 't1', supabase: state.sb }),
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('@/server/features', () => ({ requireFeature: async () => undefined }));
vi.mock('@/server/email/notify', () => ({ notifyBookingEvent: vi.fn() }));
vi.mock('@/server/owner-notify', () => ({ notifyOwnerNewBooking: vi.fn() }));

import { GET as listRoute } from '../../src/app/api/bookings/route';
import { POST as markPaid } from '../../src/app/api/bookings/[id]/mark-paid-offline/route';
import { POST as applyCoupon } from '../../src/app/api/bookings/[id]/apply-coupon/route';
import { bookingFilterBound, zonedDayRange, tenantDayRange } from '../../src/lib/bookings-query-range';
import { canMarkPaidOffline, syncDetailFinalPrice } from '../../src/lib/booking-detail-sync';

function makeSb(opts: { booking?: Row | null; bookingUpdate?: { data: Row | null; error: any }; timezone?: string; settingsError?: boolean }) {
  const log: { table: string; op: string; patch?: Row; filters: [string, string, any][] }[] = [];
  const sb = {
    log,
    from(table: string) {
      const entry: any = { table, op: 'select', filters: [] };
      log.push(entry);
      const q: any = {
        select() { return q; },
        order() { return q; },
        range() { return q; },
        or() { return q; },
        update(patch: Row) { entry.op = 'update'; entry.patch = patch; return q; },
        eq(c: string, v: any) { entry.filters.push(['eq', c, v]); return q; },
        gte(c: string, v: any) { entry.filters.push(['gte', c, v]); return q; },
        lte(c: string, v: any) { entry.filters.push(['lte', c, v]); return q; },
        is(c: string, v: any) { entry.filters.push(['is', c, v]); return q; },
        not(c: string, op: string, v: any) { entry.filters.push(['not:' + op, c, v]); return q; },
        maybeSingle() { return Promise.resolve(resolve()); },
        then(res: any, rej: any) { return Promise.resolve(resolve()).then(res, rej); },
      };
      function resolve() {
        if (table === 'tenant_settings') {
          if (opts.settingsError) return { data: null, error: { message: 'boom', code: 'XX000' } };
          return { data: opts.timezone ? { basic: { timezone: opts.timezone } } : null, error: null };
        }
        if (table === 'bookings_view') return { data: [], count: 0, error: null };
        if (table === 'bookings') {
          if (entry.op === 'select') return { data: opts.booking ?? null, error: null };
          return opts.bookingUpdate ?? { data: { id: 'b1' }, error: null };
        }
        return { data: null, error: null };
      }
      return q;
    },
  };
  return sb;
}

const req = (body?: unknown) => new Request('http://x', { method: 'POST', body: JSON.stringify(body ?? {}) });
const ctx = { params: Promise.resolve({ id: 'b1' }) };
beforeEach(() => { vi.restoreAllMocks(); });

describe('#933 日界線轉換', () => {
  it('台北 from＝前一日 16:00Z（00:00+08:00），to 含當天 23:59:59.999', () => {
    expect(bookingFilterBound('2026-10-14', 'from', 'Asia/Taipei')).toBe('2026-10-13T16:00:00.000Z');
    expect(bookingFilterBound('2026-10-14', 'to', 'Asia/Taipei')).toBe('2026-10-14T15:59:59.999Z');
  });

  it('台北 00:00–08:00 的預約落在當天範圍內、不被歸到前一天', () => {
    const { from, to } = zonedDayRange('2026-10-14', 'Asia/Taipei');
    for (const t of ['2026-10-13T16:00:00.000Z', '2026-10-13T20:30:00.000Z', '2026-10-14T15:59:59.999Z']) {
      expect(Date.parse(t) >= Date.parse(from) && Date.parse(t) <= Date.parse(to)).toBe(true);
    }
    expect(Date.parse('2026-10-13T15:59:59.999Z')).toBeLessThan(Date.parse(from));
    expect(Date.parse('2026-10-14T16:00:00.000Z')).toBeGreaterThan(Date.parse(to));
  });

  it('結束日含當天（to 為當天最後一毫秒，不是 UTC 午夜）', () => {
    expect(bookingFilterBound('2026-10-14', 'to', 'Asia/Taipei')).not.toBe('2026-10-14');
    expect(Date.parse(bookingFilterBound('2026-10-14', 'to', 'Asia/Taipei')))
      .toBeGreaterThan(Date.parse('2026-10-14T12:00:00Z'));
  });

  it('非台北時區（Tokyo／New_York 夏令時）', () => {
    expect(bookingFilterBound('2026-10-14', 'from', 'Asia/Tokyo')).toBe('2026-10-13T15:00:00.000Z');
    expect(bookingFilterBound('2026-10-14', 'from', 'America/New_York')).toBe('2026-10-14T04:00:00.000Z');
    expect(bookingFilterBound('2026-10-14', 'to', 'America/New_York')).toBe('2026-10-15T03:59:59.999Z');
  });

  it('完整 ISO 時間原樣通過；無效時區回退台北', () => {
    expect(bookingFilterBound('2026-10-14T03:00:00.000Z', 'to', 'Asia/Taipei')).toBe('2026-10-14T03:00:00.000Z');
    expect(bookingFilterBound('2026-10-14', 'from', 'Not/AZone')).toBe('2026-10-13T16:00:00.000Z');
  });

  it('午夜 DST 跳時：Havana 2026-03-08 與 Santiago 2026-09-06 從當天第一個有效瞬間起、to 不跨日', () => {
    const localDate = (iso: string, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
    for (const [ymd, tz, next] of [['2026-03-08', 'America/Havana', '2026-03-09'], ['2026-09-06', 'America/Santiago', '2026-09-07']] as const) {
      const { from, to } = zonedDayRange(ymd, tz);
      expect(localDate(from, tz)).toBe(ymd);
      expect(localDate(new Date(Date.parse(from) - 1).toISOString(), tz)).not.toBe(ymd);
      expect(localDate(to, tz)).toBe(ymd);
      expect(localDate(new Date(Date.parse(to) + 1).toISOString(), tz)).toBe(next);
    }
    // 當地 00:00 不存在，第一個有效瞬間為 01:00（Havana UTC-5 → 05:00Z；Santiago UTC-3 → 04:00Z 為 01:00 之後）
    expect(zonedDayRange('2026-03-08', 'America/Havana').from).toBe('2026-03-08T05:00:00.000Z');
    expect(zonedDayRange('2026-03-08', 'America/New_York').from).toBe('2026-03-08T05:00:00.000Z');
    expect(zonedDayRange('2026-03-08', 'America/New_York').to).toBe('2026-03-09T03:59:59.999Z');
  });

  it('tenantDayRange 行為不變（首頁今日預約）', () => {
    const r = tenantDayRange(new Date('2026-10-14T01:00:00Z'), 'Asia/Taipei');
    expect(r).toEqual({ from: '2026-10-13T16:00:00.000Z', to: '2026-10-14T15:59:59.999Z' });
  });
});

describe('#933 GET /api/bookings 日期篩選', () => {
  const get = (qs: string) => listRoute(new Request('http://x/api/bookings?' + qs), { params: Promise.resolve({}) } as any);
  const view = () => state.sb.log.find((e: any) => e.table === 'bookings_view');

  it('YYYY-MM-DD 預設以台北日界線篩選', async () => {
    state.sb = makeSb({});
    const res = await get('from=2026-10-14&to=2026-10-14');
    expect(res.status).toBe(200);
    expect(view().filters).toContainEqual(['gte', 'start_at', '2026-10-13T16:00:00.000Z']);
    expect(view().filters).toContainEqual(['lte', 'start_at', '2026-10-14T15:59:59.999Z']);
  });

  it('店家設定非台北時區時依該時區', async () => {
    state.sb = makeSb({ timezone: 'Asia/Tokyo' });
    await get('from=2026-10-14');
    expect(view().filters).toContainEqual(['gte', 'start_at', '2026-10-13T15:00:00.000Z']);
  });

  it('完整 ISO（首頁／未處理上限）原樣傳遞', async () => {
    state.sb = makeSb({});
    await get('from=2026-10-13T16:00:00.000Z&to=2026-10-14T15:59:59.999Z');
    expect(view().filters).toContainEqual(['gte', 'start_at', '2026-10-13T16:00:00.000Z']);
    expect(view().filters).toContainEqual(['lte', 'start_at', '2026-10-14T15:59:59.999Z']);
  });

  it('tenant_settings 查詢錯誤：回 500，不靜默回退台北', async () => {
    state.sb = makeSb({ settingsError: true });
    const res = await get('from=2026-10-14');
    expect(res.status).toBe(500);
    expect(view().filters.some((f: any) => f[0] === 'gte' || f[0] === 'lte')).toBe(false);
  });

  it('設定缺值（無資料列）回退台北', async () => {
    state.sb = makeSb({});
    await get('to=2026-10-14');
    expect(view().filters).toContainEqual(['lte', 'start_at', '2026-10-14T15:59:59.999Z']);
  });

  it('未帶日期不查 tenant_settings', async () => {
    state.sb = makeSb({});
    await get('page=0');
    expect(state.sb.log.some((e: any) => e.table === 'tenant_settings')).toBe(false);
  });
});

describe('#933 mark-paid-offline 狀態守門', () => {
  for (const status of ['CANCELLED', 'NO_SHOW']) {
    it(`${status} 回 409 中文訊息且不更新`, async () => {
      state.sb = makeSb({ booking: { id: 'b1', status } });
      const res = await markPaid(req(), ctx);
      expect(res.status).toBe(409);
      expect((await res.json()).message).toContain('無法標記已收款');
      expect(state.sb.log.some((e: any) => e.op === 'update')).toBe(false);
    });
  }

  for (const status of ['PENDING', 'CONFIRMED', 'COMPLETED']) {
    it(`${status} 可標記，更新帶 not in 條件`, async () => {
      state.sb = makeSb({ booking: { id: 'b1', status } });
      const res = await markPaid(req(), ctx);
      expect(res.status).toBe(200);
      const upd = state.sb.log.find((e: any) => e.op === 'update');
      expect(upd.patch).toEqual({ payment_status: 'PAID_OFFLINE' });
      expect(upd.filters).toContainEqual(['not:in', 'status', '(CANCELLED,NO_SHOW)']);
    });
  }

  it('找不到仍是 404', async () => {
    state.sb = makeSb({ booking: null });
    expect((await markPaid(req(), ctx)).status).toBe(404);
  });

  it('更新時狀態已被改成取消（影響 0 筆）回 409', async () => {
    state.sb = makeSb({ booking: { id: 'b1', status: 'CONFIRMED' }, bookingUpdate: { data: null, error: null } });
    expect((await markPaid(req(), ctx)).status).toBe(409);
  });
});

describe('#933 apply-coupon 同一預約不可重複核銷', () => {
  it('custom_fields._coupon 已存在：409 且完全不碰 coupon_instances', async () => {
    state.sb = makeSb({
      booking: { id: 'b1', status: 'CONFIRMED', customer_id: 'c1', final_price: 900, custom_fields: { _coupon: { instanceId: 'ci0', code: 'A' } } },
    });
    const res = await applyCoupon(req({ code: 'B' }), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).message).toContain('已核銷過票券');
    expect(state.sb.log.some((e: any) => e.table === 'coupon_instances')).toBe(false);
    expect(state.sb.log.some((e: any) => e.op === 'update')).toBe(false);
  });
});

describe('#933 詳情金額同步', () => {
  it('同 id 更新 finalPrice，不同 id 或 null 原樣', () => {
    const prev = { id: 'b1', finalPrice: 1000, note: 'x' };
    expect(syncDetailFinalPrice(prev, 'b1', 800)).toEqual({ id: 'b1', finalPrice: 800, note: 'x' });
    expect(syncDetailFinalPrice(prev, 'b2', 800)).toBe(prev);
    expect(syncDetailFinalPrice(null, 'b1', 800)).toBeNull();
  });

  it('只有 PENDING／CONFIRMED／COMPLETED 顯示標記已收款', () => {
    expect(canMarkPaidOffline('CANCELLED')).toBe(false);
    expect(canMarkPaidOffline('NO_SHOW')).toBe(false);
    expect(canMarkPaidOffline('CONFIRMED')).toBe(true);
  });

  it('頁面三個金額操作成功後都同步 detailTarget，且按鈕受 canMarkPaidOffline 控制', () => {
    const src = readFileSync('src/app/tenant/bookings/page.tsx', 'utf8');
    expect(src.match(/syncDetailFinalPrice\(prev, id, /g)).toHaveLength(3);
    expect(src).toContain('canMarkPaidOffline(booking.status)');
    expect(src).not.toMatch(/startAt\.slice\(0, 10\) [<>]=? ?(startDate|endDate)/);
  });
});
