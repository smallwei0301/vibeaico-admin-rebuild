import type { PublicTripDetails } from '@/server/public-shop';

/** Server 已載入並清理的公開資料（與公開 API 回應同一 allowlist 形狀）。 */
export type PublicTripInitialData = PublicTripDetails;

export type PublicTripLoadState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'error' }
  | { status: 'ready'; data: PublicTripDetails };

/** 有 initialData 就直接 ready，不顯示載入殼層。 */
export function initialLoadState(initialData?: PublicTripInitialData): PublicTripLoadState {
  return initialData ? { status: 'ready', data: initialData } : { status: 'loading' };
}

/** 掛載（及重試前）是否要立即 fetch：有 initialData 且尚未按重試時不需要。 */
export function shouldFetchOnMount(initialData: PublicTripInitialData | undefined, attempt: number): boolean {
  return !initialData || attempt > 0;
}
