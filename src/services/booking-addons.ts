/**
 * src/services/booking-addons.ts — 預約加購（issue #17），PREPARE 階段獨立檔案。
 *
 * #530 staged schema release（`scripts/agents/schema-staged-release-policy.mjs`）：
 * 本 PR 同時帶 migration 與新的 Product runtime 檔案，因此本檔每一個 export
 * 都必須以 `if (!bookingAddonsSchemaActive()) throw …` 作為函式本體第一行。
 * 刻意**不**匯入 `@/server/booking-addons-notify` 的 gate 函式──本檔會被
 * `'use client'` 的 `/tenant/bookings/page.tsx`（ACTIVATE PR 才會接線）匯入，
 * 若跨界匯入 `src/server/**` 會把伺服器端模組拉進瀏覽器 bundle。這裡改成本檔
 * 自己的小型同義判斷式，兩邊各自獨立、易於 ACTIVATE PR 時一起刪除。
 *
 * 也刻意**不**改動既有 `src/services/bookings.ts`（哪怕只加一行
 * `export * from './booking-addons'`）：那個檔案裡所有既有、現正運作中的
 * export（`listBookings` 等）會因為檔案被改動而一併落入這個 guard 的掃描
 * 範圍，逼著它們全部補 gate——等同 flag 關閉時整個既有 booking service 失效。
 * ACTIVATE PR 再讓 `/tenant/bookings/page.tsx` 直接
 * `import { listBookingAddons } from '@/services/booking-addons'`。
 *
 * mock 分支同樣走 gate——本檔目前沒有任何呼叫端（頁面尚未接線），gate 之後
 * 這裡的邏輯本來就是為 ACTIVATE PR 準備、原封不動保留即可。
 */
import { ApiError, adapt, request } from '@/lib/api';
import type {
  BookingAddon, BookingAddonNotifiedOutcome, CreateBookingAddonPayload, CreateBookingAddonResult,
  DeleteBookingAddonResult,
} from '@/types/booking-addons';
import { MOCK_BOOKINGS, MOCK_MODE, MOCK_STAFF } from '@/mock';
import type { BusinessType } from '@/config/modes';

/** 見檔頭：與 `src/server/booking-addons-notify.ts` 的 `bookingAddonsSchemaActive` 同義，刻意不共用匯入。 */
function bookingAddonsSchemaActive(): boolean {
  return process.env.BOOKING_ADDONS_SCHEMA_ACTIVE === 'true';
}

const NOT_ACTIVE_MESSAGE = '加購功能尚未啟用';

/**
 * mock 分支的「假倉庫」，取代舊版寫死在頁面內、與 create/delete 完全脫鉤的
 * `ADDON_ITEMS_LOCAL_SHOP` / `ADDON_ITEMS_GUIDE` / `ADDON_ITEMS_CLINIC`。
 * 三業態各自建一份初始示範資料，之後由 createBookingAddon/deleteBookingAddon
 * 的 mock 分支就地增刪，讓 USE_MOCK=true 下同一個 session 內「新增/移除/
 * 重新整理」也讀得回一致的結果。延遲初始化＋以 MOCK_MODE 當 key的理由同
 * `src/services/bookings.ts` 既有的 `mockBlockTimeStore`。
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

/**
 * GET /api/bookings/:id/addons — 未刪除的加購明細，依建立時間；頁面必須自行處理
 * loading/error/empty。
 *
 * ⚠️ 本檔所有 export 都刻意不寫回傳型別註記：`scripts/agents/
 * schema-staged-release-policy.mjs` 偵測 exported entry 的正則要求參數列
 * 右括號後只能接空白就是函式本體的 `{`，插一段回傳型別註記會讓整個 export
 * 偵測不到，PREPARE 階段的 gate 因此形同虛設。TypeScript 仍從 `adapt<T>()`
 * 的參數推回正確的 `Promise<T>`，型別安全不受影響。
 */
export function listBookingAddons(bookingId: string) {
  if (!bookingAddonsSchemaActive()) throw new ApiError(NOT_ACTIVE_MESSAGE, 'REQ_002', 404);
  return adapt<BookingAddon[]>(
    () => [...(getMockBookingAddonStore()[MOCK_MODE][bookingId] ?? [])],
    () => request<BookingAddon[]>(`/api/bookings/${bookingId}/addons`),
  );
}

/**
 * POST /api/bookings/:id/addons — 新增一筆加購，原子套用金額/時長；money/mode
 * 驗證與 C+ 業績語意見 0119 migration。mock 分支就地維護假倉庫＋回沖用的
 * MOCK_BOOKINGS 增量，並用同一把 idempotencyKey 做簡化版重放（避免 demo 下
 * 網路重試就重複加總金額，行為對齊真實分支）。見上方註解：刻意不寫回傳型別。
 */
export function createBookingAddon(
  bookingId: string, payload: CreateBookingAddonPayload,
) {
  if (!bookingAddonsSchemaActive()) throw new ApiError(NOT_ACTIVE_MESSAGE, 'REQ_002', 404);
  return adapt<CreateBookingAddonResult>(
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

/** DELETE /api/bookings/:id/addons/:addonId — 只回沖該筆自己的金額/時長，見 0119 rpc。見檔頭：刻意不寫回傳型別。 */
export function deleteBookingAddon(
  bookingId: string, addonId: string,
) {
  if (!bookingAddonsSchemaActive()) throw new ApiError(NOT_ACTIVE_MESSAGE, 'REQ_002', 404);
  return adapt<DeleteBookingAddonResult>(
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
