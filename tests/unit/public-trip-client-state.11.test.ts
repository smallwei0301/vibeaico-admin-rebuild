import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { initialLoadState, shouldFetchOnMount } from '@/lib/public-trip-client-state';

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
    expect(client).toContain('allListedSoldOut(plan)');
  });
});
