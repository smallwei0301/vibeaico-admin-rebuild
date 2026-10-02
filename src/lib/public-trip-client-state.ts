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

/**
 * 列出的團次全為客滿，且沒有「可能還有可售列未列出」時，不提供報名入口。
 * 只看 departuresMayBeTruncated；soldOutOmitted（略過客滿列）不影響判斷。
 */
export function allListedSoldOut(plan: {
  departures: Array<{ soldOut?: true }>;
  departuresMayBeTruncated: boolean;
}): boolean {
  return plan.departures.length > 0
    && plan.departures.every((departure) => departure.soldOut === true)
    && !plan.departuresMayBeTruncated;
}

export type PublicTripFetchOutcome =
  | { kind: 'not-found' }
  | { kind: 'error' }
  | { kind: 'ready'; data: PublicTripDetails };

/**
 * fetch 結果如何改變畫面狀態。
 * - ready：更新。
 * - not-found：前景與背景都切到「找不到／已下架」（隱藏所有 CTA）。
 * - error：前景才顯示錯誤；背景（visibilitychange 靜默更新）失敗不覆蓋現有畫面。
 */
export function stateAfterFetch(
  outcome: PublicTripFetchOutcome,
  background: boolean,
  current: PublicTripLoadState,
): PublicTripLoadState {
  if (outcome.kind === 'ready') return { status: 'ready', data: outcome.data };
  if (outcome.kind === 'not-found') return { status: 'not-found' };
  return background ? current : { status: 'error' };
}

/** 固定團次方案是否顯示報名入口：只有 FIXED_DEPARTURE 且不是「全部客滿」。 */
export function showFixedBookingCta(plan: {
  salesMode: string;
  departures: Array<{ soldOut?: true }>;
  departuresMayBeTruncated: boolean;
}): boolean {
  return plan.salesMode === 'FIXED_DEPARTURE' && !allListedSoldOut(plan);
}
