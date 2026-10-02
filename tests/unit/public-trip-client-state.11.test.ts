import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  allListedSoldOut, initialLoadState, shouldFetchOnMount, showFixedBookingCta, stateAfterFetch,
} from '@/lib/public-trip-client-state';

const data = { shop: {}, trip: {} } as never;
const client = readFileSync(resolve(process.cwd(), 'src/components/public/PublicTripDetailsClient.tsx'), 'utf8');
const page = readFileSync(resolve(process.cwd(), 'src/app/s/[shopCode]/trips/[slug]/page.tsx'), 'utf8');

describe('#11 client 有 initialData 時不重取', () => {
  it('有 initialData：初始即 ready，掛載不 fetch；按重試才 fetch', () => {
    expect(initialLoadState(data)).toEqual({ status: 'ready', data });
    expect(shouldFetchOnMount(data, 0)).toBe(false);
    expect(shouldFetchOnMount(data, 1)).toBe(true);
  });

  it('沒有 initialData：loading 並立即 fetch', () => {
    expect(initialLoadState(undefined)).toEqual({ status: 'loading' });
    expect(shouldFetchOnMount(undefined, 0)).toBe(true);
  });

  it('client 以 helper 決定是否 fetch，並於 visibilitychange 以 no-store 靜默更新；page 傳 initialData', () => {
    expect(client).toContain('shouldFetchOnMount(initialData, attempt)');
    expect(client).toContain('useState<LoadState>(() => initialLoadState(initialData))');
    expect(client).toContain("addEventListener('visibilitychange'");
    expect(client).toContain("cache: 'no-store'");
    expect(page).toContain('initialData={props.initialData}');
  });

  it('客滿團次顯示客滿文案且全客滿時不提供報名連結', () => {
    expect(client).toContain('t.departures.soldOut');
    expect(client).toContain('showFixedBookingCta(plan)');
    expect(client).toContain('plan.soldOutOmitted');
  });

  it('CTA 判斷只看可售列是否可能被截斷，不看 soldOutOmitted', () => {
    const soldOut = Array.from({ length: 6 }, () => ({ soldOut: true as const }));
    // 7 筆以上客滿、0 筆可售（其中一筆被略過）：CTA 隱藏。
    expect(allListedSoldOut({ departures: soldOut, departuresMayBeTruncated: false, ...{ soldOutOmitted: true } })).toBe(true);
    // 可售列可能被截斷：CTA 顯示。
    expect(allListedSoldOut({ departures: soldOut, departuresMayBeTruncated: true })).toBe(false);
    // 有可售列：CTA 顯示；沒有團次：不屬於全客滿。
    expect(allListedSoldOut({ departures: [...soldOut, {} as never], departuresMayBeTruncated: false })).toBe(false);
    expect(allListedSoldOut({ departures: [], departuresMayBeTruncated: false })).toBe(false);
  });

  it('allListedSoldOut：0 可售＋7 筆以上客滿（顯示 6 筆）隱藏；有可售／可售被截斷顯示；空陣列視為未全客滿', () => {
    const so = (n: number) => Array.from({ length: n }, () => ({ soldOut: true as const }));
    expect(allListedSoldOut({ departures: so(6), departuresMayBeTruncated: false })).toBe(true);
    expect(allListedSoldOut({ departures: [...so(5), {}], departuresMayBeTruncated: false })).toBe(false);
    expect(allListedSoldOut({ departures: [{}, ...so(5)], departuresMayBeTruncated: false })).toBe(false);
    expect(allListedSoldOut({ departures: so(6), departuresMayBeTruncated: true })).toBe(false);
    // 空陣列：沒有可判斷的客滿資訊，維持顯示報名入口（預約頁自己會顯示無可選日期）。
    expect(allListedSoldOut({ departures: [], departuresMayBeTruncated: false })).toBe(false);
  });

  it('showFixedBookingCta：FIXED 且非全客滿才顯示；其他販售方式不顯示', () => {
    const base = { departures: [{}], departuresMayBeTruncated: false };
    expect(showFixedBookingCta({ salesMode: 'FIXED_DEPARTURE', ...base })).toBe(true);
    expect(showFixedBookingCta({
      salesMode: 'FIXED_DEPARTURE', departures: [{ soldOut: true }], departuresMayBeTruncated: false,
    })).toBe(false);
    expect(showFixedBookingCta({ salesMode: 'REQUEST', ...base })).toBe(false);
    expect(showFixedBookingCta({ salesMode: 'INSTANT', ...base })).toBe(false);
  });

  it('stateAfterFetch：背景錯誤不覆蓋畫面；背景 404 切到找不到；前景錯誤顯示錯誤', () => {
    const ready = { status: 'ready', data } as const;
    expect(stateAfterFetch({ kind: 'error' }, true, ready)).toBe(ready);
    expect(stateAfterFetch({ kind: 'not-found' }, true, ready)).toEqual({ status: 'not-found' });
    expect(stateAfterFetch({ kind: 'not-found' }, false, ready)).toEqual({ status: 'not-found' });
    expect(stateAfterFetch({ kind: 'error' }, false, ready)).toEqual({ status: 'error' });
    expect(stateAfterFetch({ kind: 'ready', data }, true, { status: 'error' })).toEqual({ status: 'ready', data });
  });

  it('client 不論是否重試都保留 visibilitychange 監聽，且以 stateAfterFetch 套用結果', () => {
    expect(client).toContain('stateAfterFetch(outcome, background, current)');
    expect(client.indexOf("addEventListener('visibilitychange'"))
      .toBeGreaterThan(client.indexOf('shouldFetchOnMount(initialData, attempt)'));
    // fetch 之後不得 return（否則重試後 visibilitychange 監聽不會註冊）。
    expect(client).toContain('if (shouldFetchOnMount(initialData, attempt)) load(false);\n')
  });
});
