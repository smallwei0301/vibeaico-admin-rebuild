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

export type FixedBookingCtaState = 'show' | 'sold-out' | 'none';

/**
 * JSX 只依賴這個單一回傳值：
 * - show：FIXED_DEPARTURE 且不是全客滿 → 顯示報名入口。
 * - sold-out：FIXED_DEPARTURE 且全客滿 → 不顯示入口，顯示全客滿說明。
 * - none：其他販售方式 → 不顯示固定團次入口。
 */
export function fixedBookingCtaState(plan: {
  salesMode: string;
  departures: Array<{ soldOut?: true }>;
  departuresMayBeTruncated: boolean;
}): FixedBookingCtaState {
  if (plan.salesMode !== 'FIXED_DEPARTURE') return 'none';
  return allListedSoldOut(plan) ? 'sold-out' : 'show';
}

/** HTTP 回應 → 畫面結果：404 是找不到，其他非 2xx 或 payload 無效是錯誤。 */
export function outcomeFromHttp(status: number, ok: boolean, payload: unknown): PublicTripFetchOutcome {
  if (status === 404) return { kind: 'not-found' };
  if (!ok) return { kind: 'error' };
  const body = payload as { success?: boolean; data?: PublicTripDetails } | null | undefined;
  if (!body || !body.success || !body.data) return { kind: 'error' };
  return { kind: 'ready', data: body.data };
}
