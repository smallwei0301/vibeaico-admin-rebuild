import { adapt, request } from '@/lib/api';
import type {
  Booking, BookingAddon, BookingAddonNotifyOutcome, BookingStatus, CalendarEvent, Paged,
} from '@/lib/types';
import { MOCK_BOOKINGS } from '@/mock';

export type BookingQuery = {
  page?: number; size?: number; status?: BookingStatus | '';
  keyword?: string; from?: string; to?: string; staffId?: string;
};

export function listBookings(q: BookingQuery = {}): Promise<Paged<Booking>> {
  return adapt(
    () => {
      const page = q.page ?? 0, size = q.size ?? 20;
      let rows = MOCK_BOOKINGS;
      if (q.status) rows = rows.filter((b) => b.status === q.status);
      if (q.staffId) rows = rows.filter((b) => b.staffId === q.staffId);
      if (q.keyword) {
        const k = q.keyword.toLowerCase();
        rows = rows.filter((b) =>
          [b.customerName, b.customerPhone, b.bookingNo, b.serviceName]
            .some((v) => v.toLowerCase().includes(k)));
      }
      return {
        content: rows.slice(page * size, (page + 1) * size),
        totalElements: rows.length,
        totalPages: Math.ceil(rows.length / size),
        number: page,
        size,
      };
    },
    () => request<Paged<Booking>>('/api/bookings', { query: q as Record<string, string> }),
  );
}

export const confirmBooking = (id: string) =>
  adapt(() => undefined, () => request<void>(`/api/bookings/${id}/confirm`, { method: 'POST' }));

export const completeBooking = (id: string) =>
  adapt(() => undefined, () => request<void>(`/api/bookings/${id}/complete`, { method: 'POST' }));

export const cancelBooking = (id: string, reason?: string) =>
  adapt(() => undefined, () =>
    request<void>(`/api/bookings/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }));

export const markNoShow = (id: string) =>
  adapt(() => undefined, () => request<void>(`/api/bookings/${id}/no-show`, { method: 'POST' }));

/* ========================================================================== */
/* Phase 5 寫入操作（04 分冊 §B-1）                                            */
/* mock 分支一律「模擬成功」：不碰網路、回傳合成值，USE_MOCK=true 行為不變。     */
/* ========================================================================== */

export type CreateBookingPayload = {
  customerId: string;
  serviceId: string;
  staffId?: string;
  /** ISO 時間字串 */
  startAt: string;
  note?: string;
};

/** POST /api/bookings — 手動建立預約，回 { id }（mock 回合成 id）。 */
export const createBooking = (payload: CreateBookingPayload) =>
  adapt(
    () => ({ id: `b_mock_${Date.now()}` }),
    () => request<{ id: string }>('/api/bookings', { method: 'POST', body: JSON.stringify(payload) }),
  );

export type UpdateBookingPayload = {
  startAt?: string;
  /** undefined = 不動；null = 清除指定員工（同 API 語意） */
  staffId?: string | null;
  note?: string;
};

/**
 * PUT /api/bookings/:id — 改期／改員工／改備註。
 *
 * 回 `{ notifyTriggered }`：本次有沒有觸發「預約已變更」的顧客端 LINE 推播
 * （時間或服務人員實際有變才觸發；只改備註不推——issue #27 ②）。頁面靠它決定
 * 成功訊息要不要提到「已通知顧客」，不可寫死（00 鐵則 12）。
 *
 * mock 分支固定回 `false`：mock 模式沒有任何推播管道，什麼都沒送出去，回 false
 * 才是誠實的（絕不能為了讓 demo 好看而回 true）。
 */
export const updateBooking = (id: string, payload: UpdateBookingPayload) =>
  adapt<{ notifyTriggered: boolean }>(
    () => ({ notifyTriggered: false }),
    () => request<{ notifyTriggered: boolean }>(`/api/bookings/${id}`, {
      method: 'PUT', body: JSON.stringify(payload),
    }),
  );

/** POST /api/bookings/:id/adjust-price — 手動調價（需 MANAGER）。 */
export const adjustBookingPrice = (id: string, finalPrice: number) =>
  adapt(() => undefined, () =>
    request<void>(`/api/bookings/${id}/adjust-price`, {
      method: 'POST', body: JSON.stringify({ finalPrice }),
    }));

/**
 * POST /api/bookings/:id/apply-coupon — 核銷票券，回 { finalPrice }（折抵後金額）。
 * mock 依頁面既有假邏輯合成：固定折 200、不超過目前金額（讓折抵/實收 toast 數字不變）。
 */
export const applyBookingCoupon = (id: string, code: string) =>
  adapt(
    () => {
      const price = MOCK_BOOKINGS.find((b) => b.id === id)?.finalPrice ?? 0;
      return { finalPrice: price - Math.min(200, price) };
    },
    () => request<{ finalPrice: number }>(`/api/bookings/${id}/apply-coupon`, {
      method: 'POST', body: JSON.stringify({ code }),
    }),
  );

/**
 * POST /api/bookings/:id/apply-points — 點數折抵（1 點 = 1 元），
 * 回 { finalPrice, customerPoints }。點數不足時 API 回 409（POINTS_001），訊息交頁面 toast。
 * `mockBalance` 只有 mock 分支會用：頁面的假顧客點數餘額，讓合成結果沿用
 * 現行「夾在 餘額／金額 以內」的假行為。
 */
export const applyBookingPoints = (id: string, points: number, mockBalance = Number.MAX_SAFE_INTEGER) =>
  adapt(
    () => {
      const price = MOCK_BOOKINGS.find((b) => b.id === id)?.finalPrice ?? 0;
      const applied = Math.min(points, mockBalance, price);
      return { finalPrice: price - applied, customerPoints: Math.max(mockBalance - applied, 0) };
    },
    () => request<{ finalPrice: number; customerPoints: number }>(`/api/bookings/${id}/apply-points`, {
      method: 'POST', body: JSON.stringify({ points }),
    }),
  );

/* ------------------------------------------------------------ 加購（§B-1.1） */

/**
 * GET /api/bookings/:id/addons — 該筆預約的加購明細。
 *
 * mock 分支回 `null` = 頁面沿用頁內 `byMode` 假資料（同 listRecurringBookings
 * 的慣例）：假資料是頁面專屬的（含 staffName 之類 API 也有、但 id 對不上的欄位），
 * 服務層不複製一份。
 */
export const listBookingAddons = (bookingId: string): Promise<BookingAddon[] | null> =>
  adapt<BookingAddon[] | null>(
    () => null,
    () => request<BookingAddon[]>(`/api/bookings/${bookingId}/addons`),
  );

export type CreateBookingAddonPayload = {
  /** 「從服務清單帶入」的來源服務；自由輸入（耗材／商品類）省略 */
  serviceId?: string | null;
  name: string;
  price: number;
  quantity: number;
  durationMinutes: number;
  /** 執行人員；省略 = 同本預約的人員 */
  staffId?: string | null;
  /** 原站 addonNotify：勾了才推 LINE 消費明細 */
  notify: boolean;
};

export type CreateBookingAddonResult = {
  addon: BookingAddon;
  /** 加購後的預約金額（伺服器實算，不由頁面自行推） */
  finalPrice: number;
  endAt: string;
  durationMinutes: number;
  /** 消費明細通知**實際**的結果 */
  notified: BookingAddonNotifyOutcome;
};

/**
 * POST /api/bookings/:id/addons — 新增加購。
 *
 * 推播額度用完時 API 回 409（`REQ_003`）**但加購已經寫入**（04 §B-1.1）；
 * 錯誤訊息本身會說明這件事，頁面照原文顯示並重新載入明細即可。
 *
 * mock 分支：合成一筆明細、金額以 MOCK_BOOKINGS 現值加總，
 * `notified` 固定 `'NONE'` —— mock 模式沒有任何推播管道，什麼都沒送出去，
 * 回 'NONE' 才是誠實的（同 updateBooking 的 notifyTriggered 註解）。
 */
export const createBookingAddon = (bookingId: string, payload: CreateBookingAddonPayload) =>
  adapt<CreateBookingAddonResult>(
    () => {
      const b = MOCK_BOOKINGS.find((x) => x.id === bookingId);
      const amount = payload.price * payload.quantity;
      const minutes = payload.durationMinutes * payload.quantity;
      return {
        addon: {
          id: `ba_mock_${Date.now()}`,
          serviceId: payload.serviceId ?? null,
          name: payload.name,
          price: payload.price,
          quantity: payload.quantity,
          durationMinutes: payload.durationMinutes,
          staffId: payload.staffId ?? null,
          staffName: null,
          appliedAmount: amount,
          appliedMinutes: minutes,
          notified: 'NONE',
          createdAt: new Date().toISOString(),
        },
        finalPrice: (b?.finalPrice ?? 0) + amount,
        endAt: b ? new Date(Date.parse(b.endAt) + minutes * 60_000).toISOString() : '',
        durationMinutes: (b?.durationMinutes ?? 0) + minutes,
        notified: 'NONE',
      };
    },
    () => request<CreateBookingAddonResult>(`/api/bookings/${bookingId}/addons`, {
      method: 'POST', body: JSON.stringify(payload),
    }),
  );

export type DeleteBookingAddonResult = {
  finalPrice: number;
  endAt: string;
  durationMinutes: number;
  /** 本次實際扣回的金額（伺服器實算；頁面照它顯示，不自行推算） */
  revertedAmount: number;
};

/**
 * DELETE /api/bookings/:id/addons/:addonId — 移除加購並回沖金額／時長。
 *
 * 「回沖」＝減去建立當下實際加上去的金額（`appliedAmount`），下限 0；
 * 完整定義與兩種已知不精確的互動見 `src/app/api/bookings/[id]/addons/route.ts`
 * 檔頭與 04 分冊 §B-1.1。
 *
 * `mockAddon` 只有 mock 分支會用（頁面把要刪的那筆帶進來），讓合成結果的數字
 * 與畫面上顯示的一致。
 */
export const deleteBookingAddon = (
  bookingId: string,
  addonId: string,
  mockAddon?: { appliedAmount: number; appliedMinutes: number },
) =>
  adapt<DeleteBookingAddonResult>(
    () => {
      const b = MOCK_BOOKINGS.find((x) => x.id === bookingId);
      const amount = mockAddon?.appliedAmount ?? 0;
      const minutes = mockAddon?.appliedMinutes ?? 0;
      const finalPrice = Math.max(0, (b?.finalPrice ?? 0) - amount);
      return {
        finalPrice,
        endAt: b ? new Date(Date.parse(b.endAt) - minutes * 60_000).toISOString() : '',
        durationMinutes: Math.max(0, (b?.durationMinutes ?? 0) - minutes),
        revertedAmount: (b?.finalPrice ?? 0) - finalPrice,
      };
    },
    () => request<DeleteBookingAddonResult>(
      `/api/bookings/${bookingId}/addons/${addonId}`, { method: 'DELETE' }),
  );

/** POST /api/bookings/:id/mark-paid-offline — 標記現場已收款。 */
export const markBookingPaidOffline = (id: string) =>
  adapt(() => undefined, () =>
    request<void>(`/api/bookings/${id}/mark-paid-offline`, { method: 'POST' }));

/** POST /api/bookings/:id/revert-complete — 已完成退回（需 MANAGER；點數由後端回沖）。 */
export const revertBookingComplete = (id: string) =>
  adapt(() => undefined, () =>
    request<void>(`/api/bookings/${id}/revert-complete`, { method: 'POST' }));

/* ------------------------------------------------------------------ 行事曆 */

export type BlockTimeItem = {
  id: string;
  /** null = 全店封鎖 */
  staffId: string | null;
  staffName: string | null;
  startAt: string;
  endAt: string;
  reason: string;
};

export type CalendarExternalItem = { id: string; title: string; start: string; end: string };

export type CalendarData = {
  bookings: Booking[];
  /**
   * null = mock 模式：封鎖／外部事件的假資料（含每週重複、自動休息等頁面專屬欄位）
   * 住在 calendar 頁內，服務層不複製一份 —— 頁面收到 null 就沿用自己的假資料 state。
   */
  blocks: BlockTimeItem[] | null;
  externals: CalendarExternalItem[] | null;
};

/**
 * GET /api/calendar 的 BOOKING 事件只帶展示 meta（04 §B-1「展示層合一」），
 * 缺 Booking 的金額／付款／備註／來源等欄位 —— 以中性預設補齊供行事曆詳情彈窗使用；
 * 完整資料請顧客到預約列表頁看（詳情彈窗本來就有「查看詳情」連過去）。
 */
function calendarEventToBooking(e: CalendarEvent): Booking {
  const startMs = Date.parse(e.start);
  const endMs = Date.parse(e.end);
  return {
    id: e.meta?.bookingId ?? e.id,
    bookingNo: e.meta?.bookingNo ?? '',
    customerId: '',
    customerName: e.meta?.customerName ?? '',
    customerPhone: '',
    serviceId: '',
    serviceName: e.meta?.serviceName ?? '',
    staffId: e.meta?.staffId ?? null,
    staffName: e.meta?.staffName ?? null,
    startAt: e.start,
    endAt: e.end,
    durationMinutes: Number.isFinite(endMs - startMs)
      ? Math.max(Math.round((endMs - startMs) / 60_000), 0) : 0,
    price: 0,
    finalPrice: 0,
    status: e.meta?.status ?? 'PENDING',
    paymentStatus: 'UNPAID',
    source: 'MANUAL',
    note: '',
    createdAt: e.start,
  };
}

/** GET /api/calendar?from&to — 行事曆頁唯一資料源；mock 分支回完整 MOCK_BOOKINGS（維持現行組裝）。 */
export function listCalendarData(from: string, to: string): Promise<CalendarData> {
  return adapt<CalendarData>(
    () => ({ bookings: [...MOCK_BOOKINGS], blocks: null, externals: null }),
    async () => {
      const { events } = await request<{ events: CalendarEvent[] }>('/api/calendar', {
        query: { from, to },
      });
      return {
        bookings: events.filter((e) => e.type === 'BOOKING').map(calendarEventToBooking),
        blocks: events.filter((e) => e.type === 'BLOCK').map((e) => ({
          id: e.id.replace(/^block:/, ''), // /api/block-times 端點吃來源列 uuid，去掉合併陣列的前綴
          staffId: e.meta?.staffId ?? null,
          staffName: e.meta?.staffName ?? null,
          startAt: e.start,
          endAt: e.end,
          reason: e.meta?.reason ?? e.title,
        })),
        externals: events.filter((e) => e.type === 'EXTERNAL').map((e) => ({
          id: e.id, title: e.title, start: e.start, end: e.end,
        })),
      };
    },
  );
}

/** POST /api/block-times — 新增封鎖時段，回 { id }。省略 staffId = 全店封鎖。 */
export const createBlockTime = (payload: {
  staffId?: string | null; startAt: string; endAt: string; reason?: string;
}) =>
  adapt(
    () => ({ id: `bt_mock_${Date.now()}` }),
    () => request<{ id: string }>('/api/block-times', { method: 'POST', body: JSON.stringify(payload) }),
  );

/** DELETE /api/block-times/:id */
export const deleteBlockTime = (id: string) =>
  adapt(() => undefined, () => request<void>(`/api/block-times/${id}`, { method: 'DELETE' }));

/* -------------------------------------------------------------- 週期性預約 */

/** rule jsonb（0005 migration）：weekday 0-6（0=週日）、time 'HH:mm'、until 'YYYY-MM-DD' */
export type RecurringRule = {
  weekday: number;
  time: string;
  intervalWeeks: number;
  until: string;
};

export type RecurringBookingItem = {
  id: string;
  customerId: string;
  customerName: string;
  serviceId: string;
  serviceName: string;
  staffId: string | null;
  staffName: string | null;
  rule: RecurringRule;
  active: boolean;
  createdAt: string;
};

/**
 * GET /api/recurring-bookings。
 * mock 分支回 null = 頁面沿用頁內 byMode 假資料（含 API 沒有的次數／最後生成欄位，
 * 那套形狀是頁面專屬的，服務層不複製）。
 */
export const listRecurringBookings = (): Promise<RecurringBookingItem[] | null> =>
  adapt<RecurringBookingItem[] | null>(
    () => null,
    () => request<RecurringBookingItem[]>('/api/recurring-bookings'),
  );

/** POST /api/recurring-bookings — 建立範本，回 { id }。 */
export const createRecurringBooking = (payload: {
  customerId: string; serviceId: string; staffId?: string; rule: RecurringRule;
}) =>
  adapt(
    () => ({ id: `rb_mock_${Date.now()}` }),
    () => request<{ id: string }>('/api/recurring-bookings', {
      method: 'POST', body: JSON.stringify(payload),
    }),
  );

/** PUT /api/recurring-bookings/:id — 只送要改的欄位（active:false = 結束範本）。 */
export const updateRecurringBooking = (id: string, payload: {
  customerId?: string; serviceId?: string; staffId?: string | null;
  rule?: RecurringRule; active?: boolean;
}) =>
  adapt(() => undefined, () =>
    request<void>(`/api/recurring-bookings/${id}`, { method: 'PUT', body: JSON.stringify(payload) }));

/**
 * POST /api/recurring-bookings/:id/renew — 依 rule 產生實體預約，回 { created, skipped }。
 * `mockResult` 只有 mock 分支會用：頁面把現行假邏輯算出的數字帶進來，toast 數字不變。
 */
export const renewRecurringBooking = (id: string, mockResult?: { created: number; skipped: number }) =>
  adapt(
    () => ({ created: mockResult?.created ?? 0, skipped: mockResult?.skipped ?? 0 }),
    () => request<{ created: number; skipped: number }>(`/api/recurring-bookings/${id}/renew`, {
      method: 'POST',
    }),
  );
