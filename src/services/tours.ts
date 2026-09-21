import { adapt, request } from '@/lib/api';
import type {
  DepartureConflict, Trip, TripAddon, TripDeparture, TripPlan, TripPlanSeason,
  TourOrder, TourPaymentStatus, Paged,
} from '@/lib/types';
import {
  MOCK_TOUR_ORDERS, MOCK_TRIPS, MOCK_TRIP_ADDONS,
  MOCK_TRIP_DEPARTURES, MOCK_TRIP_PLANS,
} from '@/mock/tours';

/**
 * UI 型別仍比 canonical schema 寬（`category`、`durationDays` 等尚無欄位），
 * 那部分的相容性繼續留在 service 邊界，不為此加寬資料表。
 *
 * ⚠️ issue #259：`tagline` / `meetingPointMapUrl` / `exclusions` / `notices` /
 * `refundPolicyType` **原本刻意不在這裡**——`trips` 表沒有對應欄位，送過去也是白送。
 * 詳情頁因此在那五個欄位下方標了「儲存後不會保留」。`0089` 補上欄位之後，
 * 這裡必須跟著帶上它們，否則欄位建了、註記移除了，值還是存不進去——
 * 那會變成一個比原本更難察覺的假成功。
 */
function tripApiPayload(payload: Partial<Trip>) {
  return {
    title: payload.title,
    slug: payload.slug,
    summary: payload.summary,
    description: payload.description,
    coverImageUrl: payload.coverImageUrl,
    gallery: payload.galleryUrls,
    location: payload.region,
    meetingPoint: payload.meetingPoint,
    includes: payload.inclusions?.join('\n'),
    notes: payload.safetyNotice,
    tagline: payload.tagline,
    meetingPointMapUrl: payload.meetingPointMapUrl,
    exclusions: payload.exclusions,
    notices: payload.notices,
    refundPolicyType: payload.refundPolicyType,
  };
}

function planApiPayload(payload: Partial<TripPlan>) {
  return {
    name: payload.name,
    description: payload.description,
    pricePerPerson: payload.basePrice,
    childPrice: payload.childPrice,
    minParty: payload.minParticipants,
    maxParty: payload.maxParticipants,
    depositMode: payload.depositMode,
    depositValue: payload.depositValue,
    sortOrder: payload.sortOrder,
    active: payload.active,
    /**
     * issue #42：`toAdvancedPlanPayload()` 已經把這三個欄位放進要儲存的
     * Partial<TripPlan>，但這裡漏掉沒有一起序列化——Advanced Settings 存檔
     * 時使用者在畫面上改的時長／計價方式／全年販售因此永遠送不到
     * `PUT /api/trip-plans/:id`，`planUpdateSchema` 收到的 body 裡完全沒有
     * 這三個 key，等於一個看起來成功、值卻沒進資料庫的假成功。
     * 三個欄位在 payload 未帶到時本來就是 `undefined`，`JSON.stringify`
     * 會整個拿掉該 key，因此加回來不會影響 Quick Edit（永遠不帶這三個欄位）
     * 送出的 partial payload。
     */
    durationMinutes: payload.durationMinutes,
    priceType: payload.priceType,
    yearRound: payload.yearRound,
  };
}

function departureApiPayload(payload: Partial<TripDeparture>) {
  return {
    planId: payload.planId,
    departsOn: payload.departsOn,
    startTime: payload.startTime,
    capacity: payload.capacity,
    status: payload.status,
    note: payload.note,
    /**
     * issue #37：導遊指派。
     *
     * ⚠️ 這裡刻意讓 `undefined` 通過（`JSON.stringify` 會把它整個欄位拿掉），因為
     * 後端把「沒帶這個欄位」與「帶了 null」當成兩件不同的事：前者是「這次不動指派」，
     * 後者是「明確清空」。若在這裡補成 `?? null`，一次「只改名額」的儲存就會把既有的
     * 主導遊清掉，而店家不會收到任何提示。
     */
    primaryStaffId: payload.primaryStaffId,
    assistantStaffIds: payload.assistantStaffIds,
  };
}

/**
 * 導遊模組（TOUR_MODULE）資料入口。
 * 真實端點契約見 docs/integration/10-TOUR-DOMAIN.md §5；
 * 名額扣減一律由後端原子完成（reserve_seats），前端永遠即時讀 seatsBooked，不做快取。
 */

/* ------------------------------------------------------------------ 行程 */
export const listTrips = () =>
  adapt<Trip[]>(() => MOCK_TRIPS, () => request<Trip[]>('/api/trips'));

export const getTrip = (id: string) =>
  adapt<Trip | undefined>(
    () => MOCK_TRIPS.find((t) => t.id === id),
    async () => {
      const data = await request<Trip | { trip: Trip }>(`/api/trips/${id}`);
      return 'trip' in data ? data.trip : data;
    },
  );

export const createTrip = (payload: Partial<Trip>) =>
  adapt(() => undefined, () =>
    request<void>('/api/trips', {
      method: 'POST',
      body: JSON.stringify(tripApiPayload(payload)),
    }));

export const updateTrip = (id: string, payload: Partial<Trip>) =>
  adapt(() => undefined, () =>
    request<void>(`/api/trips/${id}`, {
      method: 'PUT',
      body: JSON.stringify(tripApiPayload(payload)),
    }));

export const deleteTrip = (id: string) =>
  adapt(() => undefined, () => request<void>(`/api/trips/${id}`, { method: 'DELETE' }));

/** 只影響 VibeAI 公開商店頁的可見性 */
export const publishTrip = (id: string, publish: boolean) =>
  adapt(() => undefined, () =>
    request<void>(`/api/trips/${id}/${publish ? 'publish' : 'unpublish'}`, { method: 'POST' }));

/** 送出 Midao 上架申請（需 Midao 管理者審核，見 11 分冊 §4.2） */
export const requestMidaoListing = (id: string) =>
  adapt(() => undefined, () =>
    request<void>(`/api/trips/${id}/request-midao-listing`, { method: 'POST' }));

/* ------------------------------------------------------------------ 方案 */
export const listTripPlans = (tripId: string) =>
  adapt<TripPlan[]>(
    () => MOCK_TRIP_PLANS.filter((p) => p.tripId === tripId),
    () => request<TripPlan[]>(`/api/trips/${tripId}/plans`),
  );

export const saveTripPlan = (tripId: string, payload: Partial<TripPlan>) =>
  adapt(() => undefined, () => (payload.id
    ? request<void>(`/api/trip-plans/${payload.id}`, {
      method: 'PUT', body: JSON.stringify(planApiPayload(payload)),
    })
    : request<void>(`/api/trips/${tripId}/plans`, {
      method: 'POST', body: JSON.stringify(planApiPayload(payload)),
    })));

export const deleteTripPlan = (planId: string) =>
  adapt(() => undefined, () => request<void>(`/api/trip-plans/${planId}`, { method: 'DELETE' }));

/**
 * issue #42：季節定價（`trip_plan_seasons`）。`TripPlan.seasons` 早就是
 * canonical 契約的一部分，但一直沒有可以真的存進去的路徑——`mapTripPlan()`
 * 過去對這個欄位寫死回傳 `[]`。存在自己的子表（比照 `trip_addons`），不是
 * `trip_plans` 上的一個 key，所以有自己的 create/update/delete 端點：
 * `POST /api/trip-plans/:planId/seasons`（新建）、
 * `PUT/DELETE /api/trip-plan-seasons/:id`（既有列）。
 *
 * mock 模式沒有獨立的季節資料表，跟 `saveTripAddon`／`saveTripPlan` 同一套
 * 慣例：呼叫端（頁面）在 `USE_MOCK` 分支自己把改動寫回 `planDraft.seasons`
 * 這個 in-memory 陣列，這裡只負責在有真後端時真的打 API。
 */
export const saveTripPlanSeason = (planId: string, payload: Partial<TripPlanSeason>) =>
  adapt<TripPlanSeason | undefined>(() => undefined, () => (payload.id
    ? request<TripPlanSeason>(`/api/trip-plan-seasons/${payload.id}`, {
      method: 'PUT', body: JSON.stringify(payload),
    })
    : request<TripPlanSeason>(`/api/trip-plans/${planId}/seasons`, {
      method: 'POST', body: JSON.stringify(payload),
    })));

export const deleteTripPlanSeason = (id: string) =>
  adapt(() => undefined, () => request<void>(`/api/trip-plan-seasons/${id}`, { method: 'DELETE' }));

/* ------------------------------------------------------------------ 團次 */
export const listTripDepartures = (tripId: string) =>
  adapt<TripDeparture[]>(
    () => MOCK_TRIP_DEPARTURES.filter((d) => d.tripId === tripId),
    () => request<TripDeparture[]>(`/api/trips/${tripId}/departures`),
  );

export const saveTripDeparture = (tripId: string, payload: Partial<TripDeparture>) =>
  adapt(() => undefined, () => (payload.id
    ? request<void>(`/api/trip-departures/${payload.id}`, {
      method: 'PUT', body: JSON.stringify(departureApiPayload(payload)),
    })
    : request<void>(`/api/trips/${tripId}/departures`, {
      method: 'POST', body: JSON.stringify(departureApiPayload(payload)),
    })));

/**
 * 批次開團：後端依 weekdays 展開日期區間。
 *
 * 回傳後端實際的 `{ created, skipped }`——`skipped` 是撞到「同方案同日同時」既有團次
 * 而略過的筆數。前端自己算日曆得到的筆數與這個數字**不一定相同**，拿前者報成功就是
 * 一則編出來的訊息（店家會以為開了 7 團，實際只開了 1 團）。
 */
export type BatchDepartureResult = {
  created: number;
  skipped: number;
  /** issue #37：因撞班而跳過的日期與原因。空陣列＝沒有任何日期因撞班被跳過。 */
  conflicts?: DepartureConflict[];
};

export const batchCreateDepartures = (
  tripId: string,
  payload: {
    planId: string; from: string; to: string; weekdays: number[]; startTime: string; capacity: number;
    primaryStaffId?: string | null; assistantStaffIds?: string[];
  },
) =>
  adapt<BatchDepartureResult>(
    () => ({ created: 0, skipped: 0, conflicts: [] }),
    () => request<BatchDepartureResult>(
      `/api/trips/${tripId}/departures/batch`, { method: 'POST', body: JSON.stringify(payload) },
    ),
  );

export const deleteTripDeparture = (id: string) =>
  adapt(() => undefined, () => request<void>(`/api/trip-departures/${id}`, { method: 'DELETE' }));

/* ------------------------------------------------------------------ 加購 */
export const listTripAddons = (tripId: string) =>
  adapt<TripAddon[]>(
    () => MOCK_TRIP_ADDONS.filter((a) => a.tripId === tripId),
    () => request<TripAddon[]>(`/api/trips/${tripId}/addons`),
  );

export const saveTripAddon = (tripId: string, payload: Partial<TripAddon>) =>
  adapt(() => undefined, () => (payload.id
    ? request<void>(`/api/trip-addons/${payload.id}`, { method: 'PUT', body: JSON.stringify(payload) })
    : request<void>(`/api/trips/${tripId}/addons`, { method: 'POST', body: JSON.stringify(payload) })));

export const deleteTripAddon = (id: string) =>
  adapt(() => undefined, () => request<void>(`/api/trip-addons/${id}`, { method: 'DELETE' }));

/* ------------------------------------------------------------- 旅遊訂單 */
export type TourOrderQuery = {
  page?: number; size?: number; status?: string; source?: string;
  paymentStatus?: string; keyword?: string;
  /**
   * GUIDE 收件匣 REFUND_PENDING 卡片的 deep link（#43 類別 5）以 orderId 精準撈一筆，
   * 比照 `BookingQuery.bookingId`（`src/services/bookings.ts`）——不是分頁篩選條件，
   * 只在目標列可能不在目前已載入頁面時使用。
   */
  orderId?: string;
};

export function listTourOrders(q: TourOrderQuery = {}): Promise<Paged<TourOrder>> {
  return adapt(
    () => {
      const page = q.page ?? 0, size = q.size ?? 20;
      let rows = MOCK_TOUR_ORDERS;
      if (q.orderId) rows = rows.filter((o) => o.id === q.orderId);
      if (q.status) rows = rows.filter((o) => o.status === q.status);
      if (q.source) rows = rows.filter((o) => o.source === q.source);
      if (q.paymentStatus) rows = rows.filter((o) => o.paymentStatus === q.paymentStatus);
      if (q.keyword) {
        const k = q.keyword.toLowerCase();
        rows = rows.filter((o) => [o.orderNo, o.customerName, o.customerPhone, o.tripTitle]
          .some((v) => v.toLowerCase().includes(k)));
      }
      return {
        content: rows.slice(page * size, (page + 1) * size),
        totalElements: rows.length,
        totalPages: Math.max(1, Math.ceil(rows.length / size)),
        number: page,
        size,
      };
    },
    () => request<Paged<TourOrder>>('/api/tour-orders', { query: q as Record<string, string> }),
  );
}

/** `TourPaymentStatus` 值域，供 deep link 驗證與 UI 下拉共用同一份清單。 */
export const TOUR_PAYMENT_STATUS_VALUES: TourPaymentStatus[] = [
  'UNPAID', 'PARTIAL', 'PAID', 'REFUND_PENDING', 'REFUNDED',
];

/**
 * `/tenant/tour-orders` 的 `?paymentStatus=`／`?orderId=` deep link 解析（#43 類別 5，
 * GUIDE 收件匣 REFUND_PENDING 卡片；`src/app/api/guide/action-inbox/route.ts` 產生
 * `?paymentStatus=REFUND_PENDING&orderId=<id>`）。比照 `/tenant/bookings` 既有的
 * `?status`／`?paymentStatus=UNPAID`／`?bookingId` query-string 慣例。
 *
 * 抽成純函式、獨立於頁面元件之外：本專案的 vitest 單元測試跑在 node 環境
 * （`vitest.config.mts`: `environment: 'node'`），未安裝 `@testing-library/react`，
 * 無法掛載 `'use client'` 頁面元件做真正的互動測試（`window.location` 也不存在）。
 * 把「解析＋值域驗證」這段抽出來，至少能對它做真正的行為測試——而不是再一次對
 * 頁面原始碼字串 grep（PB-027／PB-039 記錄過的假測試模式）。頁面 `useEffect` 呼叫
 * 這個函式後把回傳值指定給 `paymentFilter`／`requestedOrderId` 兩個 state，那一步
 * 是機械的 pass-through，這個測試邊界涵蓋不到它——PR 報告裡如實說明。
 */
export function parseTourOrdersDeepLink(search: string): {
  paymentStatus: TourPaymentStatus | ''; orderId: string;
} {
  const params = new URLSearchParams(search);
  const ps = params.get('paymentStatus');
  const paymentStatus = ps && (TOUR_PAYMENT_STATUS_VALUES as string[]).includes(ps)
    ? (ps as TourPaymentStatus)
    : '';
  const orderId = params.get('orderId') ?? '';
  return { paymentStatus, orderId };
}

export const confirmTourOrderPayment = (id: string) =>
  adapt(() => undefined, () =>
    request<void>(`/api/tour-orders/${id}/confirm-payment`, { method: 'POST' }));

export const completeTourOrder = (id: string) =>
  adapt(() => undefined, () => request<void>(`/api/tour-orders/${id}/complete`, { method: 'POST' }));

export const cancelTourOrder = (id: string, reason?: string) =>
  adapt(() => undefined, () =>
    request<void>(`/api/tour-orders/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }));

export const createManualTourOrder = (payload: {
  departureId: string; customerName: string; customerPhone: string;
  partySize: number; paymentMethodId: string; note?: string;
}) =>
  adapt(() => undefined, () =>
    request<void>('/api/tour-orders/manual', { method: 'POST', body: JSON.stringify(payload) }));

/**
 * #46（GUIDE 側）：導遊接受／拒絕 REQUEST 訂單。`holdHours` 對映
 * `docs/decisions/2026-09-14-guide-request-payment-hold.md` 的「接受單一
 * REQUEST 時可再針對該次交易覆寫保留時間」；不傳就用該方案的
 * `request_hold_hours` 預設，實際算出的截止時間一律由後端 rpc 單一來源決定。
 *
 * ⚠️ 這裡先只補齊 service 層。`/tenant/tour-orders` 頁的清單／詳情目前
 * 沒有攜帶 `salesMode`（`TourOrder` 型別沒有這個欄位——加它、以及在詳情 modal
 * 畫出「接受／拒絕」按鈕與覆寫保留時數的輸入框，是比「換一顆按鈕」更大的 UI
 * 工作），本輪誠實只交付後端端點；UI 接線留給下一輪，見 PR 說明。
 */
export const acceptTourOrder = (id: string, holdHours?: number) =>
  adapt(() => undefined, () =>
    request<void>(`/api/tour-orders/${id}/accept`, {
      method: 'POST', body: JSON.stringify({ holdHours }),
    }));

export const rejectTourOrder = (id: string, reason?: string) =>
  adapt(() => undefined, () =>
    request<void>(`/api/tour-orders/${id}/reject`, {
      method: 'POST', body: JSON.stringify({ reason }),
    }));
