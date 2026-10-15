import { describe, it, expect } from 'vitest';
import { minNonSeasonalPriceByTrip } from '@/server/trip-flex';

const plan = (id: string, trip_id: string, price: unknown, active = true) => ({ id, trip_id, price_per_person: price, active });

describe('#1012 minNonSeasonalPriceByTrip', () => {
  it('沒有季節方案：取 active 最低價', () => {
    const m = minNonSeasonalPriceByTrip([plan('a', 't1', 1500), plan('b', 't1', 1200)], new Set());
    expect(m.get('t1')).toBe(1200);
  });
  it('較便宜的季節方案被排除', () => {
    const m = minNonSeasonalPriceByTrip([plan('a', 't1', 1500), plan('b', 't1', 900)], new Set(['b']));
    expect(m.get('t1')).toBe(1500);
  });
  it('全部季節方案：沒有 entry（價格洽詢，不是 0）', () => {
    const m = minNonSeasonalPriceByTrip([plan('a', 't1', 0), plan('b', 't1', 900)], new Set(['a', 'b']));
    expect(m.has('t1')).toBe(false);
  });
  it('inactive 被忽略', () => {
    const m = minNonSeasonalPriceByTrip([plan('a', 't1', 100, false), plan('b', 't1', 800)], new Set());
    expect(m.get('t1')).toBe(800);
  });
  it('非有限數字被忽略', () => {
    const m = minNonSeasonalPriceByTrip([plan('a', 't1', 'abc'), plan('b', 't1', Infinity), plan('c', 't2', 700)], new Set());
    expect(m.has('t1')).toBe(false);
    expect(m.get('t2')).toBe(700);
  });
  it('0 元與 1200 並存：取 1200（與首頁 n > 0 一致）', () => {
    const m = minNonSeasonalPriceByTrip([plan('a', 't1', 0), plan('b', 't1', 1200)], new Set());
    expect(m.get('t1')).toBe(1200);
  });
  it('只有 0 元方案：沒有 entry（價格洽詢）', () => {
    const m = minNonSeasonalPriceByTrip([plan('a', 't1', 0)], new Set());
    expect(m.has('t1')).toBe(false);
  });
  it('負數被忽略', () => {
    const m = minNonSeasonalPriceByTrip([plan('a', 't1', -50), plan('b', 't1', 900)], new Set());
    expect(m.get('t1')).toBe(900);
  });
});
