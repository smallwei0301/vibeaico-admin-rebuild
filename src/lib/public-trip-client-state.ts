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
 * 已列出的團次中，是否至少有一筆「可訂」：未客滿，且剩餘名額 >= 方案最低人數。
 * 最低人數缺值或不合法時比照預約頁預設（`Number(min_party ?? 1)`）視為 1。
 *
 * 刻意最保守且單一：`departuresMayBeTruncated`（lookahead／截斷）一律不會開啟入口，只用來決定提示文案。
 * 理由：預約頁的 loadPublicBookingPlan 只查一次、上限 1000 列，看不到詳情頁 lookahead 讀到的那一列；
 * 詳情頁不應替預約頁讀不到的團次開啟入口，否則會導向空的預約清單。
 */
export function hasBookableListedDeparture(plan: {
  minParty?: number;
  departures: Array<{ seatsLeft: number; soldOut?: true }>;
}): boolean {
  const min = Number.isInteger(plan.minParty) && (plan.minParty as number) >= 1 ? (plan.minParty as number) : 1;
  return plan.departures.some((departure) => departure.soldOut !== true && departure.seatsLeft >= min);
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

export type FixedBookingCtaState = 'show' | 'unavailable' | 'none';

/**
 * JSX 只依賴這個單一回傳值：
 * - show：FIXED_DEPARTURE 且已列出的團次至少一筆可訂 → 顯示報名入口。
 * - unavailable：FIXED_DEPARTURE 但沒有可訂的已列出團次（含空陣列）→ 不顯示入口，顯示說明。
 * - none：其他販售方式 → 不顯示固定團次入口。
 */
export function fixedBookingCtaState(plan: {
  salesMode: string;
  minParty?: number;
  departures: Array<{ seatsLeft: number; soldOut?: true }>;
}): FixedBookingCtaState {
  if (plan.salesMode !== 'FIXED_DEPARTURE') return 'none';
  return hasBookableListedDeparture(plan) ? 'show' : 'unavailable';
}

/** HTTP 回應 → 畫面結果：404 是找不到，其他非 2xx 或 payload 無效是錯誤。 */
export function outcomeFromHttp(status: number, ok: boolean, payload: unknown): PublicTripFetchOutcome {
  if (status === 404) return { kind: 'not-found' };
  if (!ok) return { kind: 'error' };
  const body = payload as { success?: boolean; data?: PublicTripDetails } | null | undefined;
  if (!body || !body.success || !body.data) return { kind: 'error' };
  return { kind: 'ready', data: body.data };
}
