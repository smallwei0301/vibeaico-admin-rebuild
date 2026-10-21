// Issue #1088 — 帶 activeOnly／departsOn 時停用「已取消」狀態，deep link 互斥時忽略 status。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isCancelledStatusBlocked, parseTourOrdersDeepLink } from '@/services/tours';
import { tourOrdersPage as t } from '@/i18n/zh-TW/pages/tour-orders';

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), 'utf8');

describe('#1088 isCancelledStatusBlocked（選項停用條件）', () => {
  it('帶 activeOnly 或 departsOn 才停用；都沒有則維持可選', () => {
    expect(isCancelledStatusBlocked({ activeOnly: true, departsOn: '' })).toBe(true);
    expect(isCancelledStatusBlocked({ activeOnly: false, departsOn: '2026-10-21' })).toBe(true);
    expect(isCancelledStatusBlocked({ activeOnly: true, departsOn: '2026-10-21' })).toBe(true);
  });
  it('清除篩選後恢復可選', () => {
    expect(isCancelledStatusBlocked({ activeOnly: false, departsOn: '' })).toBe(false);
    expect(isCancelledStatusBlocked({})).toBe(false);
  });
});

describe('#1088 deep link 互斥解析', () => {
  it('status=CANCELLED 搭配 activeOnly → 忽略 status、保留 activeOnly', () => {
    expect(parseTourOrdersDeepLink('?status=CANCELLED&activeOnly=1')).toMatchObject({ status: '', activeOnly: true });
  });
  it('status=CANCELLED 搭配 departsOn → 忽略 status、保留 departsOn', () => {
    expect(parseTourOrdersDeepLink('?status=CANCELLED&departsOn=2026-10-21')).toMatchObject({ status: '', departsOn: '2026-10-21' });
  });
  it('departsOn 格式不合法時視為未帶，status=CANCELLED 照舊保留', () => {
    expect(parseTourOrdersDeepLink('?status=CANCELLED&departsOn=bad')).toMatchObject({ status: 'CANCELLED', departsOn: '' });
  });
  it('不帶這兩個篩選時行為不變；其他 status 不受影響', () => {
    expect(parseTourOrdersDeepLink('?status=CANCELLED')).toMatchObject({ status: 'CANCELLED' });
    expect(parseTourOrdersDeepLink('?status=PENDING&activeOnly=1')).toMatchObject({ status: 'PENDING', activeOnly: true });
    expect(parseTourOrdersDeepLink('?status=PENDING&departsOn=2026-10-21')).toMatchObject({ status: 'PENDING', departsOn: '2026-10-21' });
  });
});

describe('#1088 頁面接線與 i18n', () => {
  const page = read('src/app/tenant/tour-orders/page.tsx');
  it('「已取消」選項依 cancelledBlocked 停用並顯示 i18n 提示', () => {
    expect(page).toContain("disabled={k === 'CANCELLED' && cancelledBlocked}");
    expect(page).toContain('t.filters.cancelledDisabledHint');
    expect(page).toContain('isCancelledStatusBlocked({ activeOnly, departsOn: departsOnFilter })');
  });
  it('提示文案存在於 i18n，頁面不寫死中文', () => {
    expect(t.filters.cancelledDisabledHint).toBe('已排除已取消訂單，請先清除篩選');
  });
});
