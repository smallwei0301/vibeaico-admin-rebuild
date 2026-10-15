import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { candidateIsBookable } from '@/lib/public-departure-candidates';
import { publicTripDetailsPage as t } from '@/i18n/zh-TW/pages/public-trip-details';
import { publicTourBookingPage as bookingT } from '@/i18n/zh-TW/pages/public-tour-booking';

const src = readFileSync('src/components/public/PublicTripDetailsClient.tsx', 'utf8');

describe('#995 方案詳情頁：名額少於最低成團人數的團次不標為可預約', () => {
  it('candidateIsBookable：剩餘名額 < minParty 為不可訂', () => {
    expect(candidateIsBookable(1, 2)).toBe(false);
    expect(candidateIsBookable(2, 2)).toBe(true);
  });
  it('元件使用 candidateIsBookable 並僅對可訂團次套用 badge-primary', () => {
    expect(src).toContain("import { candidateIsBookable } from '@/lib/public-departure-candidates'");
    expect(src).toContain('!candidateIsBookable(departure.seatsLeft, plan.minParty)');
    expect(src).toContain("bookable ? 'badge badge-primary' : 'badge text-secondary'");
    expect(src).toContain('t.departures.belowMinParty');
  });
  it('申請制（REQUEST）方案不套用名額不足狀態：RequestForm 不鎖團次、request API 不保留名額', () => {
    expect(src).toContain("const belowMinParty = plan.salesMode !== 'REQUEST' && !departure.soldOut");
    expect(src).toContain('const bookable = !departure.soldOut && !belowMinParty;');
    expect(src).toContain('{belowMinParty ? <span');
  });
  it('i18n：新增名額不足文案，且與預約表單「名額不足」用語一致', () => {
    expect(t.departures.belowMinParty).toContain('名額不足');
    expect(bookingT.form.departureInsufficientSuffix).toContain('名額不足');
  });
});
