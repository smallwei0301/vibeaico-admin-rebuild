import { ApiError, adapt, request } from '@/lib/api';
import type {
  Booking, BookingAddon, BookingAddonNotifiedOutcome, BookingAddonPerformanceMode,
  BookingStatus, CalendarEvent, Paged, PaymentStatus,
} from '@/lib/types';
import { MOCK_BOOKINGS, MOCK_MODE, MOCK_STAFF } from '@/mock';
import type { BusinessType } from '@/config/modes';

export type BookingQuery = {
  page?: number; size?: number; status?: BookingStatus | '';
  paymentStatus?: PaymentStatus | '';
  keyword?: string; from?: string; to?: string; staffId?: string; bookingId?: string;
};

export function listBookings(q: BookingQuery = {}): Promise<Paged<Booking>> {
  return adapt(
    () => {
      const page = q.page ?? 0, size = q.size ?? 20;
      let rows = MOCK_BOOKINGS;
      if (q.bookingId) rows = rows.filter((b) => b.id === q.bookingId);
      if (q.status) rows = rows.filter((b) => b.status === q.status);
      if (q.paymentStatus) rows = rows.filter((b) => b.paymentStatus === q.paymentStatus);
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

export type UpdateBookingResult = { notifyTriggered: boolean };

/** PUT /api/bookings/:id — 改期／改員工／改備註，回報是否觸發顧客通知。 */
export const updateBooking = (id: string, payload: UpdateBookingPayload) =>
  adapt<UpdateBookingResult>(
    () => ({ notifyTriggered: false }),
    () => request<UpdateBookingResult>(`/api/bookings/${id}`, {
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

/** POST /api/bookings/:id/mark-paid-offline — 標記現場已收款。 */
export const markBookingPaidOffline = (id: string) =>
  adapt(() => undefined, () =>
    request<void>(`/api/bookings/${id}/mark-paid-offline`, { method: 'POST' }));

/** POST /api/bookings/:id/revert-complete — 已完成退回（需 MANAGER；點數由後端回沖）。 */
export const revertBookingComplete = (id: string) =>
  adapt(() => undefined, () =>
    request<void>(`/api/bookings/${id}/revert-complete`, { method: 'POST' }));

/* ------------------------------------------------------------- 預約加購（#17） */

/**
 * mock 分支的「假倉庫」，取代舊版寫死在頁面內、與 create/delete 完全脫鉤的
 * `ADDON_ITEMS_LOCAL_SHOP` / `ADDON_ITEMS_GUIDE` / `ADDON_ITEMS_CLINIC`。
 * 三業態各自建一份初始示範資料，之後由 createBookingAddon/deleteBookingAddon
 * 的 mock 分支就地增刪，讓 USE_MOCK=true 下同一個 session 內「新增/移除/重新整理」
 * 也讀得回一致的結果——不再是送出即忘的假成功。
 *
 * 延遲初始化＋以 MOCK_MODE 當 key：理由同 mockBlockTimeStore（見上方註解），
 * 避免 module 頂層讀到 AppShell 還沒設定好的業態。
 */
let mockBookingAddonStore: Record<BusinessType, Record<string, BookingAddon[]>> | null = null;

function seedMockAddon(
  bookingId: string, name: string, price: number, quantity: number,
  durationMinutes: number, staffName: string | null, idx: number,
): BookingAddon {
  return {
    id: `ad_mock_${bookingId}_${idx}`,
    bookingId,
    serviceId: null,
    name,
    price,
    quantity,
    durationMinutes,
    staffId: null,
    staffName,
    appliedAmount: price * quantity,
    appliedMinutes: durationMinutes,
    performanceMode: 'INHERIT',
    performanceStaffId: null,
    performanceStaffName: null,
    notificationRequested: false,
    notified: 'NONE',
    createdAt: new Date(Date.now() - (10 - idx) * 60_000).toISOString(),
  };
}

function getMockBookingAddonStore(): Record<BusinessType, Record<string, BookingAddon[]>> {
  if (!mockBookingAddonStore) {
    mockBookingAddonStore = {
      LOCAL_SHOP: {
        b_2: [
          seedMockAddon('b_2', '深層護髮', 800, 1, 30, 'Amy', 0),
          seedMockAddon('b_2', '青草膏', 120, 2, 0, null, 1),
        ],
      },
      GUIDE: {},
      CLINIC: {
        b_2: [
          seedMockAddon('b_2', '甲狀腺超音波', 1200, 1, 20, '陳醫師', 0),
          seedMockAddon('b_2', '肺部 X 光', 600, 1, 10, null, 1),
        ],
      },
    };
  }
  return mockBookingAddonStore;
}

/** mock 分支重複送出同一把 idempotency key 時，回放前一次結果，不重複套用金額。 */
const mockAddonIdempotencyReplay = new Map<string, CreateBookingAddonResult>();

/** 就地套用（或回沖）到 MOCK_BOOKINGS 對應那筆，讓 reload 後金額/時長與明細一致。 */
function applyMockBookingDelta(bookingId: string, amountDelta: number, minutesDelta: number) {
  const b = MOCK_BOOKINGS.find((x) => x.id === bookingId);
  if (!b) return;
  b.finalPrice = Math.max(b.finalPrice + amountDelta, 0);
  b.durationMinutes = Math.max(b.durationMinutes + minutesDelta, 0);
  b.endAt = new Date(new Date(b.endAt).getTime() + minutesDelta * 60_000).toISOString();
}

/** GET /api/bookings/:id/addons — 未刪除的加購明細，依建立時間；頁面必須自行處理 loading/error/empty。 */
export function listBookingAddons(bookingId: string): Promise<BookingAddon[]> {
  return adapt(
    () => [...(getMockBookingAddonStore()[MOCK_MODE][bookingId] ?? [])],
    () => request<BookingAddon[]>(`/api/bookings/${bookingId}/addons`),
  );
}

export type CreateBookingAddonPayload = {
  serviceId?: string | null;
  name: string;
  price: number;
  quantity: number;
  durationMinutes: number;
  staffId?: string | null;
  performanceMode: BookingAddonPerformanceMode;
  performanceStaffId?: string | null;
  notify: boolean;
  /** 由呼叫端（AddonModal 開啟時）產生一次、同一次送出/重試流程沿用同一把。 */
  idempotencyKey: string;
};

export type CreateBookingAddonResult = {
  id: string;
  appliedAmount: number;
  appliedMinutes: number;
  finalPrice: number;
  durationMinutes: number;
  endAt: string;
  performanceMode: BookingAddonPerformanceMode;
  performanceStaffId: string | null;
  notified: BookingAddonNotifiedOutcome;
  /** true = 這把 idempotency key 先前已經成功過，本次是回放，沒有再次套用金額或通知顧客。 */
  replayed: boolean;
};

/**
 * POST /api/bookings/:id/addons — 新增一筆加購，原子套用金額/時長；money/mode
 * 驗證與 C+ 業績語意見 0121 migration。mock 分支就地維護假倉庫＋回沖用的
 * MOCK_BOOKINGS 增量，並用同一把 idempotencyKey 做簡化版重放（避免 demo 下
 * 網路重試就重複加總金額，行為對齊真實分支）。
 */
export function createBookingAddon(
  bookingId: string, payload: CreateBookingAddonPayload,
): Promise<CreateBookingAddonResult> {
  return adapt(
    () => {
      const mockKey = `${MOCK_MODE}:${bookingId}:${payload.idempotencyKey}`;
      const replayed = mockAddonIdempotencyReplay.get(mockKey);
      if (replayed) return { ...replayed, replayed: true };

      if (payload.price < 0) throw new ApiError('加購價不可為負數', 'REQ_001', 400);
      if (payload.quantity <= 0) throw new ApiError('數量需為正整數', 'REQ_001', 400);
      if (payload.durationMinutes < 0) throw new ApiError('佔用時長不可為負數', 'REQ_001', 400);
      if (payload.performanceMode === 'SPECIFIC_STAFF' && !payload.performanceStaffId) {
        throw new ApiError('請選擇業績歸戶人員', 'REQ_001', 400);
      }

      const store = getMockBookingAddonStore();
      const list = store[MOCK_MODE][bookingId] ?? (store[MOCK_MODE][bookingId] = []);
      const appliedAmount = payload.price * payload.quantity;
      const appliedMinutes = payload.durationMinutes;
      const staff = payload.staffId ? MOCK_STAFF.find((s) => s.id === payload.staffId) : undefined;
      const performanceStaff = payload.performanceMode === 'SPECIFIC_STAFF'
        ? MOCK_STAFF.find((s) => s.id === payload.performanceStaffId)
        : undefined;
      const booking = MOCK_BOOKINGS.find((b) => b.id === bookingId);
      const id = `ad_mock_${Date.now()}`;
      const notified: BookingAddonNotifiedOutcome = !payload.notify
        ? 'NONE'
        : (booking?.source === 'LINE' ? 'LINE' : 'NO_LINE');

      list.push({
        id,
        bookingId,
        serviceId: payload.serviceId ?? null,
        name: payload.name,
        price: payload.price,
        quantity: payload.quantity,
        durationMinutes: payload.durationMinutes,
        staffId: payload.staffId ?? null,
        staffName: staff?.name ?? null,
        appliedAmount,
        appliedMinutes,
        performanceMode: payload.performanceMode,
        performanceStaffId: payload.performanceMode === 'SPECIFIC_STAFF' ? payload.performanceStaffId ?? null : null,
        performanceStaffName: performanceStaff?.name ?? null,
        notificationRequested: payload.notify,
        notified,
        createdAt: new Date().toISOString(),
      });

      applyMockBookingDelta(bookingId, appliedAmount, appliedMinutes);

      const result: CreateBookingAddonResult = {
        id,
        appliedAmount,
        appliedMinutes,
        finalPrice: booking?.finalPrice ?? appliedAmount,
        durationMinutes: booking?.durationMinutes ?? appliedMinutes,
        endAt: booking?.endAt ?? new Date().toISOString(),
        performanceMode: payload.performanceMode,
        performanceStaffId: payload.performanceMode === 'SPECIFIC_STAFF' ? payload.performanceStaffId ?? null : null,
        notified,
        replayed: false,
      };
      mockAddonIdempotencyReplay.set(mockKey, result);
      return result;
    },
    () => request<CreateBookingAddonResult>(`/api/bookings/${bookingId}/addons`, {
      method: 'POST', body: JSON.stringify(payload),
    }),
  );
}

export type DeleteBookingAddonResult = {
  finalPrice: number;
  durationMinutes: number;
  endAt: string;
  alreadyDeleted: boolean;
};

/** DELETE /api/bookings/:id/addons/:addonId — 只回沖該筆自己的金額/時長，見 0121 migration 的 rpc。 */
export function deleteBookingAddon(
  bookingId: string, addonId: string,
): Promise<DeleteBookingAddonResult> {
  return adapt(
    () => {
      const store = getMockBookingAddonStore();
      const list = store[MOCK_MODE][bookingId] ?? [];
      const idx = list.findIndex((a) => a.id === addonId);
      const booking = MOCK_BOOKINGS.find((b) => b.id === bookingId);
      if (idx === -1) {
        return {
          finalPrice: booking?.finalPrice ?? 0,
          durationMinutes: booking?.durationMinutes ?? 0,
          endAt: booking?.endAt ?? new Date().toISOString(),
          alreadyDeleted: true,
        };
      }
      const [removed] = list.splice(idx, 1);
      applyMockBookingDelta(bookingId, -removed.appliedAmount, -removed.appliedMinutes);
      return {
        finalPrice: booking?.finalPrice ?? 0,
        durationMinutes: booking?.durationMinutes ?? 0,
        endAt: booking?.endAt ?? new Date().toISOString(),
        alreadyDeleted: false,
      };
    },
    () => request<DeleteBookingAddonResult>(`/api/bookings/${bookingId}/addons/${addonId}`, {
      method: 'DELETE',
    }),
  );
}

/* ------------------------------------------------------------------ 行事曆 */

export type BlockTimeItem = {
  id: string;
  /** null = 全店封鎖 */
  staffId: string | null;
  staffName: string | null;
  title: string;
  reason: string;
  recurrence: 'SINGLE' | 'WEEKLY';
  /** WEEKLY 用，0 = 週日；SINGLE 為 null */
  dayOfWeek: number | null;
  fullDay: boolean;
  /** 由「每天不同營業時間」自動產生；true 時後端拒絕編輯／刪除（409） */
  auto: boolean;
  startAt: string;
  endAt: string;
};

/** POST/PUT 共用的寫入欄位；startAt/endAt 對 WEEKLY 是「首次發生」的日期＋時分秒 */
export type BlockTimeWritePayload = {
  staffId?: string | null;
  title?: string;
  reason?: string;
  recurrence?: 'SINGLE' | 'WEEKLY';
  dayOfWeek?: number | null;
  fullDay?: boolean;
  startAt: string;
  endAt: string;
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
        blocks: events.filter((e) => e.type === 'BLOCK').map((e): BlockTimeItem => ({
          // WEEKLY 規則展開後同一列會出現多次，e.id 各自唯一但不是來源列 uuid；
          // /api/block-times 端點要吃來源列 uuid，一律用 meta.blockTimeId
          // （SINGLE 沒有這個 meta 時退回舊的前綴去除法，向後相容）。
          id: e.meta?.blockTimeId ?? e.id.replace(/^block:/, ''),
          staffId: e.meta?.staffId ?? null,
          staffName: e.meta?.staffName ?? null,
          startAt: e.start,
          endAt: e.end,
          reason: e.meta?.reason ?? e.title,
          // /api/calendar 的事件已經是「這個區間內實際發生的那一次」（WEEKLY
          // 在 queryEffectiveBlockTimes 展開過），此處不再需要規則本身的
          // title/recurrence/dayOfWeek/auto——calendar 頁的行事曆卡片只用得到
          // 上面幾個欄位，這裡補上型別要求的預設值，不影響顯示。
          title: '',
          recurrence: 'SINGLE',
          dayOfWeek: null,
          fullDay: false,
          auto: false,
        })),
        externals: events.filter((e) => e.type === 'EXTERNAL').map((e) => ({
          id: e.id, title: e.title, start: e.start, end: e.end,
        })),
      };
    },
  );
}

/**
 * 封鎖時段的 mock 分支「假倉庫」：三種業態各自的示範資料 + 之後透過
 * createBlockTime/deleteBlockTime 的異動，讓 mock 模式下新增/刪除也像真實
 * 後端一樣可讀回、可持久（同一頁面 session 內）。
 *
 * 延遲初始化：整個 Record<BusinessType, …> 在「第一次被任何一個函式呼叫」
 * 時才建立一次，建立當下不看目前是哪個業態（三套都建好），因此不會踩
 * 「module 頂層讀 MOCK_MODE / 呼叫 byMode() 會凍結錯誤業態」這個坑——
 * AppShell 呼叫 applyMockMode() 切換業態後，之後每次讀寫都用當下的
 * MOCK_MODE 當 key，自然對到正確的一份。
 */
let mockBlockTimeStore: Record<BusinessType, BlockTimeItem[]> | null = null;

/** 自動產生的休息時段（auto=true）在 mock 分支也拒絕編輯／刪除，訊息對齊真實 API 的 409。 */
const AUTO_BLOCK_TIME_LOCKED_MESSAGE =
  '自動產生的休息時段無法編輯或刪除，請至「營運時間」調整每天不同的營業時間設定';

function getMockBlockTimeStore(): Record<BusinessType, BlockTimeItem[]> {
  if (!mockBlockTimeStore) {
    mockBlockTimeStore = {
      LOCAL_SHOP: [
        { id: 'bt_mock_1', staffId: null, staffName: null, title: '店休', reason: '中秋連假', recurrence: 'SINGLE', dayOfWeek: null, fullDay: true, auto: false, startAt: '2026-09-05T00:00:00+08:00', endAt: '2026-09-06T00:00:00+08:00' },
        { id: 'bt_mock_2', staffId: null, staffName: null, title: '團隊會議', reason: '每週例會', recurrence: 'WEEKLY', dayOfWeek: 2, fullDay: false, auto: false, startAt: '2026-09-08T09:00:00+08:00', endAt: '2026-09-08T10:30:00+08:00' },
        { id: 'bt_mock_3', staffId: null, staffName: null, title: '午休', reason: '', recurrence: 'WEEKLY', dayOfWeek: 3, fullDay: false, auto: true, startAt: '2026-09-09T14:00:00+08:00', endAt: '2026-09-09T15:00:00+08:00' },
      ],
      GUIDE: [
        { id: 'bt_mock_1', staffId: null, staffName: null, title: '私人行程', reason: '暫停接團', recurrence: 'SINGLE', dayOfWeek: null, fullDay: true, auto: false, startAt: '2026-09-10T00:00:00+08:00', endAt: '2026-09-12T00:00:00+08:00' },
        { id: 'bt_mock_2', staffId: null, staffName: null, title: '午休', reason: '', recurrence: 'WEEKLY', dayOfWeek: 3, fullDay: false, auto: true, startAt: '2026-09-09T12:00:00+08:00', endAt: '2026-09-09T13:00:00+08:00' },
      ],
      CLINIC: [
        { id: 'bt_mock_1', staffId: null, staffName: null, title: '院所公休', reason: '醫學會', recurrence: 'SINGLE', dayOfWeek: null, fullDay: true, auto: false, startAt: '2026-09-07T00:00:00+08:00', endAt: '2026-09-08T00:00:00+08:00' },
        { id: 'bt_mock_2', staffId: null, staffName: null, title: '設備消毒維護', reason: '', recurrence: 'SINGLE', dayOfWeek: null, fullDay: false, auto: false, startAt: '2026-09-09T12:00:00+08:00', endAt: '2026-09-09T14:00:00+08:00' },
        { id: 'bt_mock_3', staffId: null, staffName: null, title: '午休', reason: '', recurrence: 'WEEKLY', dayOfWeek: 3, fullDay: false, auto: true, startAt: '2026-09-09T12:30:00+08:00', endAt: '2026-09-09T13:30:00+08:00' },
      ],
    };
  }
  return mockBlockTimeStore;
}

function toMockBlockTime(id: string, payload: BlockTimeWritePayload): BlockTimeItem {
  const recurrence = payload.recurrence ?? 'SINGLE';
  return {
    id,
    staffId: payload.staffId ?? null,
    staffName: null,
    title: payload.title ?? '',
    reason: payload.reason ?? '',
    recurrence,
    dayOfWeek: recurrence === 'WEEKLY' ? payload.dayOfWeek ?? null : null,
    fullDay: payload.fullDay ?? false,
    auto: false,
    startAt: payload.startAt,
    endAt: payload.endAt,
  };
}

/** GET /api/block-times?from&to — 封鎖時段頁（/tenant/block-times）唯一資料源；不傳區間 = 全部。 */
export function listBlockTimes(from?: string, to?: string): Promise<BlockTimeItem[]> {
  return adapt(
    () => [...getMockBlockTimeStore()[MOCK_MODE]],
    () => request<BlockTimeItem[]>('/api/block-times', { query: { from, to } }),
  );
}

/** POST /api/block-times — 新增封鎖時段，回 { id }。省略 staffId = 全店封鎖；auto 只能由系統寫入。 */
export const createBlockTime = (payload: BlockTimeWritePayload) =>
  adapt(
    () => {
      const id = `bt_mock_${Date.now()}`;
      getMockBlockTimeStore()[MOCK_MODE].push(toMockBlockTime(id, payload));
      return { id };
    },
    () => request<{ id: string }>('/api/block-times', { method: 'POST', body: JSON.stringify(payload) }),
  );

/** PUT /api/block-times/:id — 編輯封鎖時段；auto=true 的列一律拒絕（409）。 */
export const updateBlockTime = (id: string, payload: BlockTimeWritePayload) =>
  adapt(
    () => {
      const list = getMockBlockTimeStore()[MOCK_MODE];
      const idx = list.findIndex((b) => b.id === id);
      if (idx === -1) throw new ApiError('找不到此封鎖時段', 'REQ_002', 404);
      if (list[idx].auto) throw new ApiError(AUTO_BLOCK_TIME_LOCKED_MESSAGE, 'REQ_003', 409);
      list[idx] = toMockBlockTime(id, payload);
      return undefined;
    },
    () => request<void>(`/api/block-times/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  );

/** DELETE /api/block-times/:id — auto=true 的列一律拒絕（409）。 */
export const deleteBlockTime = (id: string) =>
  adapt(
    () => {
      const store = getMockBlockTimeStore();
      const target = store[MOCK_MODE].find((b) => b.id === id);
      if (target?.auto) throw new ApiError(AUTO_BLOCK_TIME_LOCKED_MESSAGE, 'REQ_003', 409);
      store[MOCK_MODE] = store[MOCK_MODE].filter((b) => b.id !== id);
      return undefined;
    },
    () => request<void>(`/api/block-times/${id}`, { method: 'DELETE' }),
  );

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
