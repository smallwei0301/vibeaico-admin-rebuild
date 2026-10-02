import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  fixedBookingCtaState, hasBookableListedDeparture, initialLoadState, outcomeFromHttp, shouldFetchOnMount, stateAfterFetch,
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
    expect(client).toMatch(/\{fixedBookingCtaState\(plan\) === 'show' \? \(/);
    expect(client).toMatch(/\{fixedBookingCtaState\(plan\) === 'unavailable' \? \(/);
    expect(client).toContain('outcomeFromHttp(response.status, response.ok, payload)');
    expect(client).not.toMatch(/salesMode === 'FIXED_DEPARTURE'/);
    expect(client).toContain('plan.soldOutOmitted');
    expect(client).toContain('{trip.plansMayBeTruncated ? (');
  });

  it('hasBookableListedDeparture：至少一筆未客滿且 seatsLeft >= minParty 才為 true（>= 邊界）', () => {
    const d = (seatsLeft: number, soldOut?: true) => ({ seatsLeft, ...(soldOut ? { soldOut } : {}) });
    expect(hasBookableListedDeparture({ minParty: 2, departures: [] })).toBe(false);
    expect(hasBookableListedDeparture({ minParty: 2, departures: [d(0, true), d(0, true)] })).toBe(false);
    expect(hasBookableListedDeparture({ minParty: 3, departures: [d(1), d(2)] })).toBe(false);
    expect(hasBookableListedDeparture({ minParty: 3, departures: [d(1), d(3)] })).toBe(true);
    expect(hasBookableListedDeparture({ minParty: 3, departures: [d(3)] })).toBe(true);
    // soldOut 旗標優先（即使 seatsLeft 異常大也不可訂）。
    expect(hasBookableListedDeparture({ minParty: 1, departures: [d(5, true)] })).toBe(false);
    // minParty 缺值或不合法 → 比照預約頁預設 1。
    expect(hasBookableListedDeparture({ departures: [d(1)] })).toBe(true);
    expect(hasBookableListedDeparture({ minParty: 0, departures: [d(1)] })).toBe(true);
    expect(hasBookableListedDeparture({ minParty: Number.NaN, departures: [d(0, true)] })).toBe(false);
  });

  it('fixedBookingCtaState：FIXED＋有可訂 → show；空陣列／全客滿／全不足 minParty → unavailable；其他販售方式 → none', () => {
    const ok = [{ seatsLeft: 4 }];
    expect(fixedBookingCtaState({ salesMode: 'FIXED_DEPARTURE', minParty: 2, departures: ok })).toBe('show');
    expect(fixedBookingCtaState({ salesMode: 'FIXED_DEPARTURE', minParty: 2, departures: [] })).toBe('unavailable');
    expect(fixedBookingCtaState({
      salesMode: 'FIXED_DEPARTURE', minParty: 2, departures: [{ seatsLeft: 0, soldOut: true }],
    })).toBe('unavailable');
    expect(fixedBookingCtaState({
      salesMode: 'FIXED_DEPARTURE', minParty: 5, departures: [{ seatsLeft: 4 }, { seatsLeft: 1 }],
    })).toBe('unavailable');
    expect(fixedBookingCtaState({ salesMode: 'REQUEST', minParty: 2, departures: ok })).toBe('none');
    expect(fixedBookingCtaState({ salesMode: 'INSTANT', minParty: 2, departures: [] })).toBe('none');
  });

  it('outcomeFromHttp：404 → not-found；其他非 2xx、無效 payload → error；有效 → ready', () => {
    expect(outcomeFromHttp(404, false, undefined)).toEqual({ kind: 'not-found' });
    expect(outcomeFromHttp(500, false, undefined)).toEqual({ kind: 'error' });
    expect(outcomeFromHttp(429, false, undefined)).toEqual({ kind: 'error' });
    expect(outcomeFromHttp(200, true, { success: false })).toEqual({ kind: 'error' });
    expect(outcomeFromHttp(200, true, null)).toEqual({ kind: 'error' });
    expect(outcomeFromHttp(200, true, { success: true, data })).toEqual({ kind: 'ready', data });
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
