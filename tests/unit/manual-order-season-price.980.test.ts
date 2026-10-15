import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { previewManualOrderPrice, toSeasonRows } from '@/lib/manual-order-price';
import { mapTripPlan } from '@/server/mappers';
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

describe('#980 訂金預覽與 create_tour_order（0132）一致', () => {
  const dep = (over: Record<string, unknown>) =>
    previewManualOrderPrice({ ...base, seasons: [], departsOn: '2026-09-01', ...over });
  it('DEPOSIT_FIXED PER_PERSON：不乘人數', () => {
    expect(dep({ depositMode: 'DEPOSIT_FIXED', depositValue: 500 }).deposit).toBe(500);
  });
  it('DEPOSIT_FIXED PER_GROUP：不乘人數', () => {
    expect(dep({ priceType: 'PER_GROUP', partySize: 5, depositMode: 'DEPOSIT_FIXED', depositValue: 500 }).deposit).toBe(500);
  });
  it('DEPOSIT_FIXED 高於總額：以總額為上限', () => {
    expect(dep({ depositMode: 'DEPOSIT_FIXED', depositValue: 99999 }).deposit).toBe(3000);
    expect(dep({ priceType: 'PER_GROUP', depositMode: 'DEPOSIT_FIXED', depositValue: 5000 }).deposit).toBe(1000);
  });
  it('DEPOSIT_PERCENT：四捨五入到整數', () => {
    expect(dep({ basePrice: 1001, partySize: 1, depositMode: 'DEPOSIT_PERCENT', depositValue: 30 }).deposit).toBe(300);
    expect(dep({ basePrice: 1005, partySize: 1, depositMode: 'DEPOSIT_PERCENT', depositValue: 50 }).deposit).toBe(503);
    expect(dep({ basePrice: 999, partySize: 1, depositMode: 'DEPOSIT_PERCENT', depositValue: 30 }).deposit).toBe(300);
  });
  it('DEPOSIT_PERCENT 依季節價總額計算', () => {
    const r = previewManualOrderPrice({
      ...base, seasons: [season({})], departsOn: '2026-07-15', depositMode: 'DEPOSIT_PERCENT', depositValue: 30,
    });
    expect(r.deposit).toBe(1800);
  });
  it('NONE／FULL／未知：訂金 0', () => {
    expect(dep({ depositMode: 'NONE', depositValue: 500 }).deposit).toBe(0);
    expect(dep({ depositMode: 'FULL', depositValue: 500 }).deposit).toBe(0);
    expect(dep({}).deposit).toBe(0);
  });
});

describe('#980 季節排序 tie-break 與 override 為 null', () => {
  it('同跨度、sort_order 相同：依 id 小的優先（與 SQL s.id asc 一致）', () => {
    const rows = [
      { id: 'b', sort_order: 0, name: 'b', start_month: 7, start_day: 1, end_month: 8, end_day: 31, price_override: 3000, active: true },
      { id: 'a', sort_order: 0, name: 'a', start_month: 7, start_day: 1, end_month: 8, end_day: 31, price_override: 2000, active: true },
    ];
    const plan = mapTripPlan({ id: 'p', price_type: 'PER_PERSON', price_per_person: 1000, trip_plan_seasons: rows });
    expect(plan.seasons.map((x) => x.id)).toEqual(['a', 'b']);
    const r = previewManualOrderPrice({ ...base, seasons: plan.seasons, departsOn: '2026-07-15' });
    expect(r.unitPrice).toBe(2000);
  });
  it('id 比較用小寫；sort_order 較小者優先並帶出 sortOrder', () => {
    const mk = (id: string, so: number) => ({ id, sort_order: so, start_month: 1, start_day: 1, end_month: 12, end_day: 31, price_override: 1, active: true });
    const plan = mapTripPlan({ id: 'p', trip_plan_seasons: [mk('B0', 1), mk('a0', 1), mk('zz', 0)] });
    expect(plan.seasons.map((x) => x.id)).toEqual(['zz', 'a0', 'B0']);
    expect(plan.seasons.map((x) => x.sortOrder)).toEqual([0, 1, 1]);
  });
  it('toSeasonRows 優先用真實 sortOrder，沒有才用索引', () => {
    const rows = toSeasonRows([season({ id: 'x', sortOrder: 7 }), season({ id: 'y' })]);
    expect(rows.map((x) => x.sortOrder)).toEqual([7, 1]);
  });
  it('命中季節但 priceOverride 為 null：用基本價', () => {
    const r = previewManualOrderPrice({ ...base, seasons: [season({ priceOverride: null })], departsOn: '2026-07-15' });
    expect(r.unitPrice).toBe(1000);
    expect(r.total).toBe(3000);
  });
  it('未選團次但有季節：訂金同為估算（seasonalPending）', () => {
    const r = previewManualOrderPrice({ ...base, seasons: [season({})], departsOn: undefined, depositMode: 'DEPOSIT_FIXED', depositValue: 500 });
    expect(r.seasonalPending).toBe(true);
    expect(r.deposit).toBe(500);
  });
});

describe('#980 頁面原始碼斷言', () => {
  const page = readFileSync(resolve(__dirname, '../../src/app/tenant/tour-orders/page.tsx'), 'utf8');
  const helper = readFileSync(resolve(__dirname, '../../src/lib/manual-order-price.ts'), 'utf8');
  it('頁面透過 helper 使用 resolveSeasonUnitPrice，且不再用 basePrice 直接算總額', () => {
    expect(page).toContain('previewManualOrderPrice');
    expect(helper).toContain('resolveSeasonUnitPrice');
    expect(page).not.toContain('depositOf(');
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
