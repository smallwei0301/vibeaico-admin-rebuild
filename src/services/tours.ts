import { adapt, request } from '@/lib/api';
import type {
  Trip, TripAddon, TripDeparture, TripPlan, TourOrder, Paged, DepartureStaffAvailability,
} from '@/lib/types';
import {
  MOCK_TOUR_ORDERS, MOCK_TRIPS, MOCK_TRIP_ADDONS,
  MOCK_TRIP_DEPARTURES, MOCK_TRIP_PLANS,
} from '@/mock/tours';
import { MOCK_STAFF } from '@/mock';

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
    // 端點回 { trip, plans }（編輯頁一次要兩者，分兩支只會多一輪 loading）；
    // 本函式的契約是單一 Trip，方案另由 listTripPlans() 取得。
    () => request<{ trip: Trip }>(`/api/trips/${id}`).then((r) => r.trip),
  );

/**
 * 寫入類函式一律回「後端寫完之後的那一份資料」，不是 void。
 *
 * 理由是頁面接線的紀律（00 鐵則 12）：頁面必須先 `await` 到真的成功、
 * 再用**回傳值**更新畫面，才不會出現「畫面已經變了、資料庫沒變」的假成功。
 * 若這些函式回 void，頁面就只能拿自己手上的草稿去 setState，
 * 那份草稿與伺服器實際存下的值（例如後端重算的 slug、定金、單號）可能不同。
 *
 * mock 分支回一份形狀正確的假資料，讓骨架／示範店家模式下的畫面照樣會動。
 */
const nowIso = () => new Date().toISOString();
const mockId = (prefix: string) => `${prefix}_${Date.now().toString(36)}`;

export const createTrip = (payload: Partial<Trip>) =>
  adapt<Trip>(
    () => ({
      id: mockId('tp'), slug: payload.slug ?? '', title: payload.title ?? '',
      tagline: '', summary: '', description: '', region: payload.region ?? '',
      category: payload.category ?? '', coverImageUrl: '', galleryUrls: [],
      meetingPoint: '', meetingPointMapUrl: '',
      inclusions: [], exclusions: [], notices: [], safetyNotice: '',
      refundPolicyType: 'STANDARD', status: 'DRAFT',
      midaoListing: 'NONE', midaoListingNote: '',
      planCount: 0, upcomingDepartureCount: 0, minPrice: 0, updatedAt: nowIso(),
    }),
    () => request<Trip>('/api/trips', { method: 'POST', body: JSON.stringify(payload) }),
  );

export const updateTrip = (id: string, payload: Partial<Trip>) =>
  adapt<Trip>(
    () => ({ ...(MOCK_TRIPS.find((t) => t.id === id) as Trip), ...payload, updatedAt: nowIso() }),
    () => request<Trip>(`/api/trips/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  );

/**
 * 刪除行程。**有訂單的行程後端會改為封存而不是刪除**（10 分冊 §5），
 * 回傳的 `archived` 就是在告訴頁面「那一列還在，不要從清單移除」。
 */
export type DeleteTripResult = {
  deleted: boolean;
  archived: boolean;
  message?: string;
  trip?: Trip;
};

export const deleteTrip = (id: string) =>
  adapt<DeleteTripResult>(
    () => ({ deleted: true, archived: false }),
    () => request<DeleteTripResult>(`/api/trips/${id}`, { method: 'DELETE' }),
  );

/** 只影響 VibeAI 公開商店頁的可見性 */
export const publishTrip = (id: string, publish: boolean) =>
  adapt<Trip>(
    () => ({
      ...(MOCK_TRIPS.find((t) => t.id === id) as Trip),
      status: publish ? 'PUBLISHED' : 'DRAFT',
    }),
    () => request<Trip>(`/api/trips/${id}/${publish ? 'publish' : 'unpublish'}`, { method: 'POST' }),
  );

/**
 * 送出 Midao 上架申請（需 Midao 管理者審核，見 11 分冊 §4.2）。
 * ⚠️ 後端目前只寫狀態，**不會通知 Midao**（webhook 屬 Phase 10）。
 * 文案因此只能寫「已送出申請」，不得寫「Midao 已收到」。
 */
export const requestMidaoListing = (id: string) =>
  adapt<Trip>(
    () => ({
      ...(MOCK_TRIPS.find((t) => t.id === id) as Trip),
      midaoListing: 'PENDING', midaoListingNote: '',
    }),
    () => request<Trip>(`/api/trips/${id}/request-midao-listing`, { method: 'POST' }),
  );

/**
 * 複製行程（行程本體 + 方案 + 加購；團次與訂單不複製）。
 * ⚠️ 端點不在 10 分冊的表格裡，見 `/api/trips/[id]/duplicate` 檔頭的說明。
 */
export const duplicateTrip = (id: string) =>
  adapt<Trip>(
    () => {
      const src = MOCK_TRIPS.find((t) => t.id === id) as Trip;
      return {
        ...src, id: mockId('tp'), title: `${src.title}（複本）`, slug: `${src.slug}-copy`,
        status: 'DRAFT', midaoListing: 'NONE', midaoListingNote: '',
        upcomingDepartureCount: 0,
      };
    },
    () => request<Trip>(`/api/trips/${id}/duplicate`, { method: 'POST' }),
  );

/* ------------------------------------------------------------------ 方案 */
export const listTripPlans = (tripId: string) =>
  adapt<TripPlan[]>(
    () => MOCK_TRIP_PLANS.filter((p) => p.tripId === tripId),
    () => request<TripPlan[]>(`/api/trips/${tripId}/plans`),
  );

export const saveTripPlan = (tripId: string, payload: Partial<TripPlan>) =>
  adapt<TripPlan>(
    () => ({ ...(payload as TripPlan), id: payload.id || mockId('pl'), tripId }),
    () => (payload.id
      ? request<TripPlan>(`/api/trip-plans/${payload.id}`, { method: 'PUT', body: JSON.stringify(payload) })
      : request<TripPlan>(`/api/trips/${tripId}/plans`, { method: 'POST', body: JSON.stringify(payload) })),
  );

export const deleteTripPlan = (planId: string) =>
  adapt<{ deleted: boolean }>(
    () => ({ deleted: true }),
    () => request<{ deleted: boolean }>(`/api/trip-plans/${planId}`, { method: 'DELETE' }),
  );

/* ------------------------------------------------------------------ 團次 */
export const listTripDepartures = (tripId: string) =>
  adapt<TripDeparture[]>(
    () => MOCK_TRIP_DEPARTURES.filter((d) => d.tripId === tripId),
    () => request<TripDeparture[]>(`/api/trips/${tripId}/departures`),
  );

export const saveTripDeparture = (tripId: string, payload: Partial<TripDeparture>) =>
  adapt<TripDeparture>(
    () => ({ ...(payload as TripDeparture), id: payload.id || mockId('dp'), tripId }),
    () => (payload.id
      ? request<TripDeparture>(`/api/trip-departures/${payload.id}`, { method: 'PUT', body: JSON.stringify(payload) })
      : request<TripDeparture>(`/api/trips/${tripId}/departures`, { method: 'POST', body: JSON.stringify(payload) })),
  );

export type DepartureStaffAvailabilityResult = {
  count: number;
  staff: DepartureStaffAvailability[];
};

export const getDepartureStaffAvailability = (
  tripId: string, params: { planId: string; departsOn: string; startTime?: string; excludeDepartureId?: string },
) => adapt<DepartureStaffAvailabilityResult>(
  () => {
    const staff = MOCK_STAFF.filter((item) => item.active && item.bookable)
      .map((item) => ({ staffId: item.id, staffName: item.name, available: true, conflicts: [] }));
    return { count: staff.length, staff };
  },
  () => request<DepartureStaffAvailabilityResult>(`/api/trips/${tripId}/departures/staff-availability`, {
    query: params as Record<string, string>,
  }),
);

/**
 * 批次開團：後端依 weekdays 展開日期區間。
 * `skipped` = 已存在而跳過的筆數（同方案同日同時間已有團次）——
 * 頁面要照實顯示，不能把 skipped 當成 created 一起報成「已建立 N 個」。
 */
export type BatchDepartureResult = {
  created: number;
  skipped: number;
  conflicts?: Array<{ date: string; staffId: string; staffName: string; reason: string }>;
  departures: TripDeparture[];
};

export const batchCreateDepartures = (
  tripId: string,
  payload: { planId: string; from: string; to: string; weekdays: number[]; startTime: string; capacity: number; primaryStaffId?: string | null; assistantStaffIds?: string[] },
) =>
  adapt<BatchDepartureResult>(
    () => ({ created: 0, skipped: 0, departures: [] }),
    () => request<BatchDepartureResult>(`/api/trips/${tripId}/departures/batch`,
      { method: 'POST', body: JSON.stringify(payload) }),
  );

export const deleteTripDeparture = (id: string) =>
  adapt<{ deleted: boolean }>(
    () => ({ deleted: true }),
    () => request<{ deleted: boolean }>(`/api/trip-departures/${id}`, { method: 'DELETE' }),
  );

/* ------------------------------------------------------------------ 加購 */
export const listTripAddons = (tripId: string) =>
  adapt<TripAddon[]>(
    () => MOCK_TRIP_ADDONS.filter((a) => a.tripId === tripId),
    () => request<TripAddon[]>(`/api/trips/${tripId}/addons`),
  );

export const saveTripAddon = (tripId: string, payload: Partial<TripAddon>) =>
  adapt<TripAddon>(
    () => ({ ...(payload as TripAddon), id: payload.id || mockId('ad'), tripId }),
    () => (payload.id
      ? request<TripAddon>(`/api/trip-addons/${payload.id}`, { method: 'PUT', body: JSON.stringify(payload) })
      : request<TripAddon>(`/api/trips/${tripId}/addons`, { method: 'POST', body: JSON.stringify(payload) })),
  );

export const deleteTripAddon = (id: string) =>
  adapt<{ deleted: boolean }>(
    () => ({ deleted: true }),
    () => request<{ deleted: boolean }>(`/api/trip-addons/${id}`, { method: 'DELETE' }),
  );

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

/**
 * 訂單頁四張統計卡的數字（全店統計，不是當前分頁的統計）。
 * 定義見 `/api/tour-orders/summary` 的檔頭。
 */
export type TourOrderSummary = {
  pending: number;
  unpaid: number;
  upcoming: number;
  monthRevenue: number;
};

export const getTourOrderSummary = () =>
  adapt<TourOrderSummary>(
    () => {
      const now = new Date();
      const in7 = new Date(now.getTime() + 7 * 86_400_000);
      return {
        pending: MOCK_TOUR_ORDERS.filter((o) => o.status === 'PENDING').length,
        unpaid: MOCK_TOUR_ORDERS.filter(
          (o) => o.paymentStatus === 'UNPAID' && o.status !== 'CANCELLED').length,
        upcoming: MOCK_TOUR_ORDERS.filter((o) => {
          const d = new Date(o.departsOn);
          return o.status === 'CONFIRMED' && d >= now && d <= in7;
        }).length,
        monthRevenue: MOCK_TOUR_ORDERS
          .filter((o) => o.paymentStatus === 'PAID'
            && o.createdAt.slice(0, 7) === now.toISOString().slice(0, 7))
          .reduce((sum, o) => sum + o.totalAmount, 0),
      };
    },
    () => request<TourOrderSummary>('/api/tour-orders/summary'),
  );

export const getTourOrder = (id: string) =>
  adapt<TourOrder | undefined>(
    () => MOCK_TOUR_ORDERS.find((o) => o.id === id),
    () => request<TourOrder>(`/api/tour-orders/${id}`),
  );

const mockOrder = (id: string, patch: Partial<TourOrder>): TourOrder =>
  ({ ...(MOCK_TOUR_ORDERS.find((o) => o.id === id) as TourOrder), ...patch });

export const confirmTourOrderPayment = (id: string) =>
  adapt<TourOrder>(
    () => mockOrder(id, { paymentStatus: 'PAID', status: 'CONFIRMED', holdExpiresAt: null }),
    () => request<TourOrder>(`/api/tour-orders/${id}/confirm-payment`, { method: 'POST' }),
  );

export const completeTourOrder = (id: string) =>
  adapt<TourOrder>(
    () => mockOrder(id, { status: 'COMPLETED' }),
    () => request<TourOrder>(`/api/tour-orders/${id}/complete`, { method: 'POST' }),
  );

export const cancelTourOrder = (id: string, reason?: string) =>
  adapt<TourOrder>(
    () => mockOrder(id, { status: 'CANCELLED', holdExpiresAt: null }),
    () => request<TourOrder>(`/api/tour-orders/${id}/cancel`,
      { method: 'POST', body: JSON.stringify({ reason }) }),
  );

/**
 * 導遊代旅客下單。金額（單價／總額／定金）一律由後端依方案現值算，
 * 所以這裡**不送任何金額欄位**——送了也不會被採信。
 *
 * `paymentMethodId` 目前是選填：收款方式的資料表 `tenant_payment_methods`
 * 屬 10 分冊 §4（Phase 8c / issue #9），還沒建，因此後端只是原樣存下，
 * 也回不出收款方式的顯示名稱。
 */
export const createManualTourOrder = (payload: {
  departureId: string; customerName: string; customerPhone: string;
  partySize: number; paymentMethodId?: string; note?: string;
  source?: 'MANUAL' | 'LINE';
}) =>
  adapt<TourOrder>(
    () => ({
      id: mockId('to'),
      orderNo: `T${new Date().toISOString().slice(2, 10).replace(/-/g, '')}0001`,
      tripId: '', tripTitle: '', planName: '', departsOn: '', startTime: '',
      customerName: payload.customerName, customerPhone: payload.customerPhone,
      partySize: payload.partySize, unitPrice: 0, totalAmount: 0, depositAmount: 0,
      status: 'PENDING', paymentStatus: 'UNPAID', paymentMethodLabel: '',
      paymentRef: '', source: payload.source ?? 'MANUAL', holdExpiresAt: null,
      note: payload.note ?? '', createdAt: nowIso(),
    }),
    () => request<TourOrder>('/api/tour-orders/manual',
      { method: 'POST', body: JSON.stringify(payload) }),
  );

/* -------------------------------------------------- tour-platform JSON 互通 */

/**
 * 匯入 tour-platform 匯出的行程 JSON（可一次多筆）。
 * 欄位對照與「只新增不覆蓋方案」的規則在後端 /api/trips/import，前端只負責送檔。
 */
export const importTripsJson = (json: unknown) =>
  adapt<{ imported: number; results: Array<{ title: string; tripId: string; created: boolean; plansAdded: number }> } | null>(
    () => null,
    () => request<{ imported: number; results: Array<{ title: string; tripId: string; created: boolean; plansAdded: number }> }>(
      '/api/trips/import', { method: 'POST', body: JSON.stringify(json) }),
  );

/** 匯出成 tour-platform 格式的行程 JSON（可再匯回本後台或匯進 tour-platform）。 */
export const exportTripJson = (id: string) =>
  adapt<{ downloaded: boolean; fileName: string } | null>(
    () => null,
    async () => {
      const json = await request<unknown>(`/api/trips/${id}/export`);
      const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = `trip-${id}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      setTimeout(() => { document.body.removeChild(anchor); URL.revokeObjectURL(href); }, 0);
      return { downloaded: true, fileName: anchor.download };
    },
  );

/** 語意較短的別名，供頁面與外部呼叫端使用。 */
export const importTrips = importTripsJson;
export const exportTrip = exportTripJson;
