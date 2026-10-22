import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  mergeUnprocessedBookings, tenantDateString, tenantDayRange, unprocessedUpperBound,
} from '../../src/lib/bookings-query-range';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

describe('#908 首頁待辦連結與查詢範圍', () => {
  it('流失預警連結參數與顧客頁讀取的參數一致', () => {
    const dash = read('src/app/tenant/dashboard/page.tsx');
    const cust = read('src/app/tenant/customers/page.tsx');
    expect(dash).toContain('/tenant/customers?atRisk=true');
    expect(dash).not.toContain('filter=atRisk');
    expect(cust).toContain("params.get('atRisk') === 'true'");
  });

  it('tenantDayRange 以 Asia/Taipei 日界線計算（瀏覽器時區無關）', () => {
    const now = new Date('2026-10-13T16:30:00Z'); // 台北 10/14 00:30
    expect(tenantDateString(now)).toBe('2026-10-14');
    expect(tenantDayRange(now)).toEqual({
      from: '2026-10-13T16:00:00.000Z',
      to: '2026-10-14T15:59:59.999Z',
    });
    const early = new Date('2026-10-13T15:59:59Z'); // 台北 10/13 23:59:59
    expect(tenantDayRange(early).from).toBe('2026-10-12T16:00:00.000Z');
  });

  it('tenantDayRange 對有夏令時的時區也正確', () => {
    const { from, to } = tenantDayRange(new Date('2026-07-01T12:00:00Z'), 'America/New_York');
    expect(from).toBe('2026-07-01T04:00:00.000Z');
    expect(to).toBe('2026-07-02T03:59:59.999Z');
  });

  it('首頁今日預約帶 from/to、size 100，前端以同一時區比對日期', () => {
    const dash = read('src/app/tenant/dashboard/page.tsx');
    expect(dash).toContain('size: 100, ...tenantDayRange(new Date(), tz)');
    expect(dash).toContain('tenantDateString(new Date(b.startAt), tz) === today');
  });

  it('UNPROCESSED 以 statuses=PENDING,CONFIRMED 單次 server-side 查詢（#934）；合併工具仍依 startAt 由新到舊', () => {
    const src = read('src/app/tenant/bookings/page.tsx');
    expect(src).toContain("['PENDING', 'CONFIRMED'] as BookingStatus[]");
    expect(src).not.toContain('pendingRes.totalElements + confirmedRes.totalElements');
    const merged = mergeUnprocessedBookings(
      [{ id: 'a', startAt: '2026-10-01T00:00:00Z' }, { id: 'c', startAt: '2026-10-03T00:00:00Z' }],
      [{ id: 'b', startAt: '2026-10-02T00:00:00Z' }, { id: 'a', startAt: '2026-10-01T00:00:00Z' }],
    );
    expect(merged.map((b) => b.id)).toEqual(['c', 'b', 'a']);
  });

  it('顧客頁載入有過期請求保護', () => {
    const cust = read('src/app/tenant/customers/page.tsx');
    expect(cust).toContain('++loadSeq.current');
    expect(cust).toContain('if (isStale()) return;');
  });

  it('UNPROCESSED 且未設 endDate 時帶 to；其餘維持原行為', () => {
    const now = new Date('2026-10-13T08:00:00.000Z');
    expect(unprocessedUpperBound('UNPROCESSED', '', now)).toBe(now.toISOString());
    expect(unprocessedUpperBound('UNPROCESSED', undefined, now)).toBe(now.toISOString());
    expect(unprocessedUpperBound('UNPROCESSED', '2026-10-20', now)).toBeUndefined();
    expect(unprocessedUpperBound('PENDING', '', now)).toBeUndefined();
    expect(read('src/app/tenant/bookings/page.tsx')).toContain('startBefore: status === \'UNPROCESSED\'');
  });
});
