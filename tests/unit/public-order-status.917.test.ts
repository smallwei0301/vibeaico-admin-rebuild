// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { cancelledCopyKind, formatInstantInTimeZone, formatPlainDateWithWeekday } from '@/lib/public-order-format';
import { common } from '@/i18n/zh-TW/common';

const page = readFileSync('src/app/s/[shopCode]/requests/[orderId]/page.tsx', 'utf8');

describe('#917 旅客訂單狀態頁格式化', () => {
  it('出發日期為純日期並附星期，不受時區影響', () => {
    expect(formatPlainDateWithWeekday('2026-11-02', common.weekdays)).toBe('2026/11/02（一）');
    expect(formatPlainDateWithWeekday('2026-11-01', common.weekdays)).toBe('2026/11/01（日）');
    expect(formatPlainDateWithWeekday('2026-02-30', common.weekdays)).toBeNull();
    expect(formatPlainDateWithWeekday('abc', common.weekdays)).toBeNull();
  });
  it('時間點依店家時區顯示', () => {
    expect(formatInstantInTimeZone('2026-10-13T16:30:00Z', 'Asia/Taipei')).toBe('2026/10/14 00:30');
    expect(formatInstantInTimeZone('2026-10-13T16:30:00Z')).toBe('2026/10/14 00:30');
    expect(formatInstantInTimeZone('2026-10-13T16:30:00Z', 'America/Los_Angeles')).toBe('2026/10/13 09:30');
    expect(formatInstantInTimeZone('2026-10-13T16:30:00Z', 'bad/zone')).toBe('2026/10/14 00:30');
    expect(formatInstantInTimeZone('nope')).toBeNull();
  });
  it('CANCELLED 依付款狀態分流', () => {
    expect(cancelledCopyKind('UNPAID')).toBe('UNPAID');
    expect(cancelledCopyKind(undefined)).toBe('UNPAID');
    for (const s of ['PAID', 'PARTIAL', 'REFUND_PENDING']) expect(cancelledCopyKind(s)).toBe('PAID');
    expect(cancelledCopyKind('REFUNDED')).toBe('REFUNDED');
  });
  it('頁面使用分流與格式化，不直接輸出 departsOn 原始值', () => {
    expect(page).toContain('cancelledCopyKind(order.paymentStatus)');
    expect(page).toContain('cancelledPaidDescription');
    expect(page).not.toMatch(/<dd>\{order\.departsOn\}/);
    expect(page).not.toContain('formatDateTime');
  });
});
