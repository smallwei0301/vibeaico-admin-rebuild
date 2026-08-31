import { adapt, request } from '@/lib/api';
import type {
  Trip, TripAddon, TripDeparture, TripPlan, TourOrder, Paged,
} from '@/lib/types';
import {
  MOCK_TOUR_ORDERS, MOCK_TRIPS, MOCK_TRIP_ADDONS,
  MOCK_TRIP_DEPARTURES, MOCK_TRIP_PLANS,
} from '@/mock/tours';

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
    () => request<Trip>(`/api/trips/${id}`),
  );

export const createTrip = (payload: Partial<Trip>) =>
  adapt(() => undefined, () =>
    request<void>('/api/trips', { method: 'POST', body: JSON.stringify(payload) }));

export const updateTrip = (id: string, payload: Partial<Trip>) =>
  adapt(() => undefined, () =>
    request<void>(`/api/trips/${id}`, { method: 'PUT', body: JSON.stringify(payload) }));

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
    ? request<void>(`/api/trip-plans/${payload.id}`, { method: 'PUT', body: JSON.stringify(payload) })
    : request<void>(`/api/trips/${tripId}/plans`, { method: 'POST', body: JSON.stringify(payload) })));

export const deleteTripPlan = (planId: string) =>
  adapt(() => undefined, () => request<void>(`/api/trip-plans/${planId}`, { method: 'DELETE' }));

/* ------------------------------------------------------------------ 團次 */
export const listTripDepartures = (tripId: string) =>
  adapt<TripDeparture[]>(
    () => MOCK_TRIP_DEPARTURES.filter((d) => d.tripId === tripId),
    () => request<TripDeparture[]>(`/api/trips/${tripId}/departures`),
  );

export const saveTripDeparture = (tripId: string, payload: Partial<TripDeparture>) =>
  adapt(() => undefined, () => (payload.id
    ? request<void>(`/api/trip-departures/${payload.id}`, { method: 'PUT', body: JSON.stringify(payload) })
    : request<void>(`/api/trips/${tripId}/departures`, { method: 'POST', body: JSON.stringify(payload) })));

/** 批次開團：後端依 weekdays 展開日期區間 */
export const batchCreateDepartures = (
  tripId: string,
  payload: { planId: string; from: string; to: string; weekdays: number[]; startTime: string; capacity: number },
) =>
  adapt(() => undefined, () =>
    request<void>(`/api/trips/${tripId}/departures/batch`, { method: 'POST', body: JSON.stringify(payload) }));

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
};

export function listTourOrders(q: TourOrderQuery = {}): Promise<Paged<TourOrder>> {
  return adapt(
    () => {
      const page = q.page ?? 0, size = q.size ?? 20;
      let rows = MOCK_TOUR_ORDERS;
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

export const confirmTourOrderPayment = (id: string, payment: {
  amount: number; receiptReference: string;
}) =>
  adapt(() => undefined, () =>
    request<void>(`/api/tour-orders/${id}/confirm-payment`, {
      method: 'POST', body: JSON.stringify(payment),
    }));

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
