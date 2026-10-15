import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { previewManualOrderPrice, toSeasonRows } from '@/lib/manual-order-price';
import type { TripPlanSeason } from '@/lib/types';

const season = (over: Partial<TripPlanSeason>): TripPlanSeason => ({
  id: 's1', name: 'x', startMonth: 7, startDay: 1, endMonth: 8, endDay: 31,
  priceOverride: 2000, active: true, ...over,
});
const base = { priceType: 'PER_PERSON', basePrice: 1000, partySize: 3 } as const;

describe('#980 手動建單金額預覽依團次出發日套用季節價', () => {
  it('季節命中：單價換成季節價', () => {
    const r = previewManualOrderPrice({ ...base, seasons: [season({})], departsOn: '2026-07-15' });
    expect(r.unitPrice).toBe(2000);
    expect(r.total).toBe(6000);
    expect(r.basis).toBe('DEPARTURE');
    expect(r.seasonalPending).toBe(false);
  });
  it('未命中：維持基本價', () => {
    const r = previewManualOrderPrice({ ...base, seasons: [season({})], departsOn: '2026-09-01' });
    expect(r.total).toBe(3000);
  });
  it('跨年季節（12/20–1/10）命中兩端', () => {
    const s = [season({ startMonth: 12, startDay: 20, endMonth: 1, endDay: 10, priceOverride: 1500 })];
    expect(previewManualOrderPrice({ ...base, seasons: s, departsOn: '2026-12-25' }).unitPrice).toBe(1500);
    expect(previewManualOrderPrice({ ...base, seasons: s, departsOn: '2027-01-05' }).unitPrice).toBe(1500);
    expect(previewManualOrderPrice({ ...base, seasons: s, departsOn: '2027-02-01' }).unitPrice).toBe(1000);
  });
  it('停用的季節不參與', () => {
    const s = [season({ active: false })];
    expect(toSeasonRows(s)).toHaveLength(0);
    expect(previewManualOrderPrice({ ...base, seasons: s, departsOn: '2026-07-15' }).total).toBe(3000);
  });
  it('PER_GROUP：總額為單價，不乘人數', () => {
    const r = previewManualOrderPrice({
      priceType: 'PER_GROUP', basePrice: 1000, partySize: 5, seasons: [season({})], departsOn: '2026-07-15',
    });
    expect(r.total).toBe(2000);
  });
  it('無團次：用基本價並標示為基本價；有季節時標示待定', () => {
    const withSeason = previewManualOrderPrice({ ...base, seasons: [season({})], departsOn: undefined });
    expect(withSeason.total).toBe(3000);
    expect(withSeason.basis).toBe('BASE');
    expect(withSeason.seasonalPending).toBe(true);
    const noSeason = previewManualOrderPrice({ ...base, seasons: [], departsOn: undefined });
    expect(noSeason.seasonalPending).toBe(false);
  });
});

describe('#980 頁面原始碼斷言', () => {
  const page = readFileSync(resolve(__dirname, '../../src/app/tenant/tour-orders/page.tsx'), 'utf8');
  const helper = readFileSync(resolve(__dirname, '../../src/lib/manual-order-price.ts'), 'utf8');
  it('頁面透過 helper 使用 resolveSeasonUnitPrice，且不再用 basePrice 直接算總額', () => {
    expect(page).toContain('previewManualOrderPrice');
    expect(helper).toContain('resolveSeasonUnitPrice');
    expect(page).not.toMatch(/draftPlan\.basePrice \* draft\.partySize/);
  });
  it('頁面無中文字面量（註解除外）', () => {
    const code = page
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((l) => l.replace(/(^|\s)\/\/.*$/, ''))
      .join('\n');
    expect(code).not.toMatch(/[一-鿿]/);
  });
});
