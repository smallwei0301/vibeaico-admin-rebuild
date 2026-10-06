import { candidateIsBookable } from '@/lib/public-departure-candidates';
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
  bookableDepartureAvailable?: boolean;
}): boolean {
  // #761：6 筆列出視窗之外、但仍在預約／申請頁前 12 個候選內的可訂團次（server 以同一套候選規則算出）。
  if (plan.bookableDepartureAvailable === true) return true;
  return plan.departures.some((departure) => departure.soldOut !== true && candidateIsBookable(departure.seatsLeft, plan.minParty));
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
  // 背景錯誤不覆蓋現有畫面；但若目前還在 loading（前景請求被中止），不可停在 loading，必須落到 error。
  return background && current.status !== 'loading' ? current : { status: 'error' };
}

/**
 * 切回分頁時是否發背景更新：只有已顯示資料（ready）才更新。loading（前景請求進行中，背景請求會 abort 它）、
 * error（有重試按鈕）、not-found（頁面已不存在，維持現狀、重新整理才會重查）都略過。
 */
export function shouldRefreshOnVisible(current: PublicTripLoadState): boolean {
  return current.status === 'ready';
}

export type BookingCtaState =
  | 'fixed' | 'fixed-unavailable'
  | 'request' | 'request-unavailable'
  | 'dates-not-loaded'
  | 'none';

/**
 * JSX 只依賴這個單一回傳值（依 salesMode）：
 * - FIXED_DEPARTURE、REQUEST：已列出的團次至少一筆可訂（見 hasBookableListedDeparture）才回 fixed／request，
 *   否則回 *-unavailable（含空陣列）。REQUEST 的目的頁（RequestForm）沒有可選團次就永遠送不出去，
 *   且其 canSubmit 需要 departureId，所以與 FIXED 同樣處理；條件（含 seatsLeft >= minParty）比目的頁更保守。
 * - INSTANT 與其他模式：none（沿用原狀：INSTANT 只顯示說明，沒有入口）。
 */
export function bookingCtaState(plan: {
  salesMode: string;
  minParty?: number;
  departuresNotLoaded?: boolean;
  bookableDepartureAvailable?: boolean;
  departures: Array<{ seatsLeft: number; soldOut?: true }>;
}): BookingCtaState {
  // 未載入團次的方案（超過方案數上限）：不提供入口，請旅客聯絡店家。
  if (plan.departuresNotLoaded && (plan.salesMode === 'FIXED_DEPARTURE' || plan.salesMode === 'REQUEST')) {
    return 'dates-not-loaded';
  }
  if (plan.salesMode === 'FIXED_DEPARTURE') {
    return hasBookableListedDeparture(plan) ? 'fixed' : 'fixed-unavailable';
  }
  if (plan.salesMode === 'REQUEST') {
    return hasBookableListedDeparture(plan) ? 'request' : 'request-unavailable';
  }
  return 'none';
}

/** HTTP 回應 → 畫面結果：404 是找不到，其他非 2xx 或 payload 無效是錯誤。 */
export function outcomeFromHttp(status: number, ok: boolean, payload: unknown): PublicTripFetchOutcome {
  if (status === 404) return { kind: 'not-found' };
  if (!ok) return { kind: 'error' };
  const body = payload as { success?: boolean; data?: PublicTripDetails } | null | undefined;
  if (!body || !body.success || !body.data) return { kind: 'error' };
  return { kind: 'ready', data: body.data };
}

/** 只有最新一次請求（id 相同）才可套用結果。 */
export function shouldApplyResult(requestId: number, latestId: number): boolean {
  return requestId === latestId;
}

/**
 * 請求序號器：每次 begin() 遞增 id 並 abort 前一個請求；只有最新一次（且尚未 abortAll）可套用結果，
 * 避免連續 visibilitychange 時較晚完成的舊請求覆蓋較新的結果（例如新請求已回 404／客滿）。
 */
export function createRequestSequencer() {
  let latest = 0;
  let closed = false;
  let controller: AbortController | null = null;
  return {
    begin(): { id: number; signal: AbortSignal } {
      controller?.abort();
      controller = new AbortController();
      latest += 1;
      return { id: latest, signal: controller.signal };
    },
    isLatest(id: number): boolean {
      return !closed && shouldApplyResult(id, latest);
    },
    abortAll(): void {
      closed = true;
      controller?.abort();
    },
  };
}
