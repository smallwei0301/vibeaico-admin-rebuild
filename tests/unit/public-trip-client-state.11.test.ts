import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { publicTripDetailsPage as t } from '@/i18n/zh-TW/pages/public-trip-details';
import {
  createRequestSequencer, shouldApplyResult,
  bookingCtaState, hasBookableListedDeparture, initialLoadState, outcomeFromHttp, shouldFetchOnMount, stateAfterFetch,
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
    for (const state of ['fixed', 'fixed-unavailable', 'request', 'request-unavailable']) {
      expect(client).toMatch(new RegExp("\\{bookingCtaState\\(plan\\) === '" + state + "' \\? \\("));
    }
    expect(client).not.toMatch(/plan\.salesMode === 'REQUEST'/);
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

  it('bookingCtaState：FIXED 既有案例不回歸', () => {
    const ok = [{ seatsLeft: 4 }];
    expect(bookingCtaState({ salesMode: 'FIXED_DEPARTURE', minParty: 2, departures: ok })).toBe('fixed');
    expect(bookingCtaState({ salesMode: 'FIXED_DEPARTURE', minParty: 2, departures: [] })).toBe('fixed-unavailable');
    expect(bookingCtaState({
      salesMode: 'FIXED_DEPARTURE', minParty: 2, departures: [{ seatsLeft: 0, soldOut: true }],
    })).toBe('fixed-unavailable');
    expect(bookingCtaState({
      salesMode: 'FIXED_DEPARTURE', minParty: 5, departures: [{ seatsLeft: 4 }, { seatsLeft: 1 }],
    })).toBe('fixed-unavailable');
  });

  it('bookingCtaState：REQUEST 空陣列／全客滿／全不足 → request-unavailable；有可選團次 → request', () => {
    expect(bookingCtaState({ salesMode: 'REQUEST', minParty: 2, departures: [] })).toBe('request-unavailable');
    expect(bookingCtaState({
      salesMode: 'REQUEST', minParty: 2, departures: [{ seatsLeft: 0, soldOut: true }, { seatsLeft: 0, soldOut: true }],
    })).toBe('request-unavailable');
    expect(bookingCtaState({
      salesMode: 'REQUEST', minParty: 5, departures: [{ seatsLeft: 4 }],
    })).toBe('request-unavailable');
    expect(bookingCtaState({ salesMode: 'REQUEST', minParty: 2, departures: [{ seatsLeft: 0, soldOut: true }, { seatsLeft: 2 }] }))
      .toBe('request');
  });

  it('bookingCtaState：未載入團次（departuresNotLoaded）→ dates-not-loaded，不提供入口；INSTANT 仍為 none', () => {
    const plan = { minParty: 1, departures: [], departuresNotLoaded: true };
    expect(bookingCtaState({ salesMode: 'FIXED_DEPARTURE', ...plan })).toBe('dates-not-loaded');
    expect(bookingCtaState({ salesMode: 'REQUEST', ...plan })).toBe('dates-not-loaded');
    expect(bookingCtaState({ salesMode: 'INSTANT', ...plan })).toBe('none');
    expect(client).toContain("bookingCtaState(plan) === 'dates-not-loaded'");
    expect(client).toContain('t.departures.notLoaded');
    expect(t.departures.notLoaded).toContain('聯絡店家');
  });

  it('文案與 noBookable 對齊：noRequestable 說明列出的日期都無法申請', () => {
    expect(t.departures.noRequestable).toMatch(/列出的日期都無法申請/);
    expect(t.departures.noRequestable).toContain('請聯絡店家');
  });

  it('bookingCtaState：INSTANT 與其他模式維持 none（只顯示說明、沒有入口）', () => {
    expect(bookingCtaState({ salesMode: 'INSTANT', minParty: 2, departures: [{ seatsLeft: 9 }] })).toBe('none');
    expect(bookingCtaState({ salesMode: 'INSTANT', minParty: 2, departures: [] })).toBe('none');
  });

  it('outcomeFromHttp：404 → not-found；其他非 2xx、無效 payload → error；有效 → ready', () => {
    expect(outcomeFromHttp(404, false, undefined)).toEqual({ kind: 'not-found' });
    expect(outcomeFromHttp(500, false, undefined)).toEqual({ kind: 'error' });
    expect(outcomeFromHttp(429, false, undefined)).toEqual({ kind: 'error' });
    // C7：HTTP 200 但 success:false（即使帶 data）也要判為 error。
    expect(outcomeFromHttp(200, true, { success: false })).toEqual({ kind: 'error' });
    expect(outcomeFromHttp(200, true, { success: false, data })).toEqual({ kind: 'error' });
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

  it('MINOR4：noBookable 文案與「僅列出部分日期」並列時不矛盾，且說明列出的日期都無法預約', () => {
    expect(t.departures.noBookable).toMatch(/列出的日期都無法預約/);
    expect(t.departures.noBookable).not.toContain('目前沒有可預約日期');
    expect(t.departures.truncated).toContain('部分日期');
  });

  it('shouldApplyResult：只有 id 相同才套用', () => {
    expect(shouldApplyResult(2, 2)).toBe(true);
    expect(shouldApplyResult(1, 2)).toBe(false);
  });

  describe('請求序號器（連續 visibilitychange）', () => {
    const ready = { status: 'ready', data } as const;
    // 模擬 client 的套用邏輯。
    const make = () => {
      const seq = createRequestSequencer();
      let state: ReturnType<typeof stateAfterFetch> = ready;
      const apply = (id: number, outcome: Parameters<typeof stateAfterFetch>[0]) => {
        if (seq.isLatest(id)) state = stateAfterFetch(outcome, true, state);
      };
      return { seq, apply, get: () => state };
    };

    it('舊請求較晚完成：舊結果不得套用', () => {
      const { seq, apply, get } = make();
      const a = seq.begin();
      const b = seq.begin();
      apply(b.id, { kind: 'not-found' });
      apply(a.id, { kind: 'ready', data });
      expect(get()).toEqual({ status: 'not-found' });
    });

    it('新的回 404 之後，舊的回 200 也不得覆蓋', () => {
      const { seq, apply, get } = make();
      const old = seq.begin();
      const latest = seq.begin();
      apply(latest.id, { kind: 'not-found' });
      expect(get()).toEqual({ status: 'not-found' });
      apply(old.id, { kind: 'ready', data });
      expect(get()).toEqual({ status: 'not-found' });
    });

    it('發新請求會 abort 前一個；unmount（abortAll）後沒有結果可套用', () => {
      const { seq, apply, get } = make();
      const a = seq.begin();
      expect(a.signal.aborted).toBe(false);
      const b = seq.begin();
      expect(a.signal.aborted).toBe(true);
      expect(b.signal.aborted).toBe(false);
      seq.abortAll();
      expect(b.signal.aborted).toBe(true);
      apply(b.id, { kind: 'not-found' });
      expect(get()).toBe(ready);
    });

    it('client 以序號器接線：begin／isLatest／abortAll 與 abort signal', () => {
      expect(client).toContain('const sequencer = createRequestSequencer();');
      expect(client).toMatch(/const \{ id, signal \} = sequencer\.begin\(\);/);
      expect(client).toMatch(/if \(sequencer\.isLatest\(id\)\) setState\(/);
      expect(client).toMatch(/fetch\(path, \{ cache: 'no-store', signal \}\)/);
      expect(client).toMatch(/sequencer\.abortAll\(\);/);
      expect(client).not.toMatch(/let active = true/);
    });
  });
});
