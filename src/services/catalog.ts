import { adapt, ApiError, request } from '@/lib/api';
import type {
  ApiResponse, Coupon, MembershipLevel, Product, ProductOrder, Service, Staff,
} from '@/lib/types';
import {
  MOCK_COUPONS, MOCK_MEMBERSHIP_LEVELS, MOCK_PRODUCTS,
  MOCK_PRODUCT_ORDERS, MOCK_SERVICES, MOCK_STAFF,
} from '@/mock';

export const listServices = () =>
  adapt<Service[]>(() => MOCK_SERVICES, () => request<Service[]>('/api/services'));

export const listStaff = () =>
  adapt<Staff[]>(() => MOCK_STAFF, () => request<Staff[]>('/api/staff'));

export const listProducts = () =>
  adapt<Product[]>(() => MOCK_PRODUCTS, () => request<Product[]>('/api/products'));

export const listProductOrders = () =>
  adapt<ProductOrder[]>(() => MOCK_PRODUCT_ORDERS, () => request<ProductOrder[]>('/api/product-orders'));

/** Topbar／sidebar 的待處理商品訂單數（04 分冊 §B-3）。 */
export const pendingProductOrderCount = () =>
  adapt<number>(
    () => MOCK_PRODUCT_ORDERS.filter((order) => order.status === 'PENDING').length,
    async () => (await request<{ count: number }>('/api/product-orders/pending/count')).count,
  );

export const listCoupons = () =>
  adapt<Coupon[]>(() => MOCK_COUPONS, () => request<Coupon[]>('/api/coupons'));

export const listMembershipLevels = () =>
  adapt<MembershipLevel[]>(() => MOCK_MEMBERSHIP_LEVELS, () => request<MembershipLevel[]>('/api/membership-levels'));

/* ========================================================================== */
/* 寫入操作（Phase 5 頁面 CRUD 接線：服務／員工／班表域）                        */
/*                                                                            */
/* 慣例：                                                                     */
/* - 回傳型別含 `| null` 的 list/create：mock 分支回 null，表示「頁面維持現狀」 */
/*   （mock 資料與本地 id 產生留在頁面，USE_MOCK=true 行為完全不變）。          */
/* - create 回 `{ id }` 的：mock 分支以本檔計數器合成與原頁面相同格式的 id。    */
/* ========================================================================== */

const BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

/**
 * 同 lib/api 的 request()，但把信封的 message 一併帶回 —— 刪除「改為停用」等
 * 成功情境的後端說明文字要直接 toast（request() 只回 data，message 會遺失）。
 */
async function requestWithMessage<T>(
  path: string,
  init?: RequestInit,
): Promise<{ data: T; message?: string }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    credentials: 'include',
  });

  let body: ApiResponse<T>;
  try {
    body = (await res.json()) as ApiResponse<T>;
  } catch {
    throw new ApiError('伺服器回應格式錯誤', undefined, res.status);
  }

  if (!res.ok || body.success === false) {
    throw new ApiError(body.message ?? '操作失敗，請稍後再試', body.code, res.status);
  }
  return { data: body.data as T, message: body.message };
}

/**
 * 刪除結果：後端在有未來預約（或歷史紀錄擋 FK）時不真刪，改 active=false 並
 * 回 { deactivated: true } + message；真刪回 { deleted: true }。
 */
export type DeleteOutcome = { deleted?: boolean; deactivated?: boolean; message?: string };

const deleteWithFallback = (path: string): Promise<DeleteOutcome> =>
  adapt<DeleteOutcome>(
    () => ({ deleted: true }),
    async () => {
      const { data, message } = await requestWithMessage<{ deleted?: boolean; deactivated?: boolean }>(
        path,
        { method: 'DELETE' },
      );
      return { ...(data ?? {}), message };
    },
  );

/* ------------------------------------------------------------------ 服務 */

/** POST/PUT /api/services 接受的欄位（頁面 ServiceExtras 不在 API 契約內）。 */
export type ServicePayload = {
  name: string;
  categoryId?: string;
  description?: string;
  /** 後端 zod min(1)：號碼掛號等 0 分鐘情境請帶 undefined（略過此欄位） */
  durationMinutes?: number;
  price?: number;
  imageUrl?: string;
  active?: boolean;
  lineFeatured?: boolean;
};

let nextMockServiceId = 1;

export const createService = (payload: ServicePayload) =>
  adapt<{ id: string }>(
    () => ({ id: `sv_new_${nextMockServiceId++}` }),
    () => request<{ id: string }>('/api/services', {
      method: 'POST', body: JSON.stringify(payload),
    }),
  );

export const updateService = (id: string, payload: Partial<ServicePayload>) =>
  adapt(() => undefined, () =>
    request<void>(`/api/services/${id}`, {
      method: 'PUT', body: JSON.stringify(payload),
    }));

export const deleteService = (id: string) => deleteWithFallback(`/api/services/${id}`);

/** POST /api/services/:id/duplicate — 後端複製一筆（name 加「（複本）」）回 {id}。 */
export const duplicateService = (id: string) =>
  adapt<{ id: string }>(
    () => ({ id: `sv_new_${nextMockServiceId++}` }),
    () => request<{ id: string }>(`/api/services/${id}/duplicate`, { method: 'POST' }),
  );

/** POST /api/services/reorder — 依 ids 順序寫 sort_order（= LINE 精選順序）。 */
export const reorderServices = (ids: string[]) =>
  adapt(() => undefined, () =>
    request<void>('/api/services/reorder', {
      method: 'POST', body: JSON.stringify({ ids }),
    }));

/**
 * POST /api/services/:id/toggle-line-featured — 後端取反並回最新值。
 * mock 分支回呼叫端算好的 next（頁面已知目前值，取反即是；同 products 慣例）。
 */
export const toggleServiceLineFeatured = (id: string, next: boolean) =>
  adapt<{ lineFeatured: boolean }>(
    () => ({ lineFeatured: next }),
    () => request<{ lineFeatured: boolean }>(
      `/api/services/${id}/toggle-line-featured`, { method: 'POST' },
    ),
  );

/* -------------------------------------------------------------- 服務分類 */

/** API 回應形狀（無 description/active 欄位；頁面自行補顯示預設值）。 */
export type ServiceCategorySummary = { id: string; name: string; sortOrder: number };

/** GET /api/service-categories — mock 回 null（頁面維持 byMode 頁內假資料）。 */
export const listServiceCategories = () =>
  adapt<ServiceCategorySummary[] | null>(
    () => null,
    () => request<ServiceCategorySummary[]>('/api/service-categories'),
  );

/** POST /api/service-categories — mock 回 null（頁面沿用本地 id，行為不變）。 */
export const createServiceCategory = (name: string) =>
  adapt<{ id: string } | null>(
    () => null,
    () => request<{ id: string }>('/api/service-categories', {
      method: 'POST', body: JSON.stringify({ name }),
    }),
  );

/** PUT /api/service-categories/:id — 僅支援改名（active 切換無對應端點）。 */
export const updateServiceCategory = (id: string, name: string) =>
  adapt(() => undefined, () =>
    request<void>(`/api/service-categories/${id}`, {
      method: 'PUT', body: JSON.stringify({ name }),
    }));

export const deleteServiceCategory = (id: string) =>
  adapt(() => undefined, () =>
    request<void>(`/api/service-categories/${id}`, { method: 'DELETE' }));

export const reorderServiceCategories = (ids: string[]) =>
  adapt(() => undefined, () =>
    request<void>('/api/service-categories/reorder', {
      method: 'POST', body: JSON.stringify({ ids }),
    }));

/* ------------------------------------------------------------------ 員工 */

/** POST/PUT /api/staff 接受的欄位（頁面 StaffExtras 不在 API 契約內）。 */
export type StaffPayload = {
  name: string;
  phone?: string;
  email?: string;
  title?: string;
  avatarUrl?: string;
  bookable?: boolean;
  active?: boolean;
  serviceIds?: string[];
};

let nextMockStaffId = 1;

export const createStaff = (payload: StaffPayload) =>
  adapt<{ id: string }>(
    () => ({ id: `s_new_${nextMockStaffId++}` }),
    () => request<{ id: string }>('/api/staff', {
      method: 'POST', body: JSON.stringify(payload),
    }),
  );

export const updateStaff = (id: string, payload: Partial<StaffPayload>) =>
  adapt(() => undefined, () =>
    request<void>(`/api/staff/${id}`, {
      method: 'PUT', body: JSON.stringify(payload),
    }));

export const deleteStaff = (id: string) => deleteWithFallback(`/api/staff/${id}`);

/* ------------------------------------------------------------------ 請假 */

/**
 * API 回應形狀（staff_leaves：單一時間區間）。頁面的類型／每週循環／整天旗標
 * 不在契約內，由頁面在載入時自行推導、送出時攤平成 startAt/endAt。
 */
export type StaffLeave = {
  id: string;
  staffId: string;
  startAt: string;
  endAt: string;
  reason: string;
};

/** GET /api/staff/:id/leaves — mock 回 null（頁面維持 MOCK_LEAVES 篩選現狀）。 */
export const listStaffLeaves = (staffId: string) =>
  adapt<StaffLeave[] | null>(
    () => null,
    () => request<StaffLeave[]>(`/api/staff/${staffId}/leaves`),
  );

let nextMockLeaveId = 1;

export const createStaffLeave = (
  staffId: string,
  payload: { startAt: string; endAt: string; reason?: string },
) =>
  adapt<{ id: string }>(
    () => ({ id: `lv_new_${nextMockLeaveId++}` }),
    () => request<{ id: string }>(`/api/staff/${staffId}/leaves`, {
      method: 'POST', body: JSON.stringify(payload),
    }),
  );

export const deleteStaffLeave = (staffId: string, leaveId: string) =>
  adapt(() => undefined, () =>
    request<void>(`/api/staff/${staffId}/leaves/${leaveId}`, { method: 'DELETE' }));

/* -------------------------------------------------------------- 班別模板 */

/** API 形狀（shift_templates 無 breakStart/breakEnd 欄位；頁面顯示時補 ''）。 */
export type ShiftTemplateSummary = {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  color: string;
};

export type ShiftTemplatePayload = {
  name: string;
  startTime: string;
  endTime: string;
  color?: string;
};

/** GET /api/shift-templates — mock 回 null（頁面維持 MOCK_TEMPLATES 現狀）。 */
export const listShiftTemplates = () =>
  adapt<ShiftTemplateSummary[] | null>(
    () => null,
    () => request<ShiftTemplateSummary[]>('/api/shift-templates'),
  );

/** POST /api/shift-templates — mock 回 null（頁面沿用本地 id，行為不變）。 */
export const createShiftTemplate = (payload: ShiftTemplatePayload) =>
  adapt<{ id: string } | null>(
    () => null,
    () => request<{ id: string }>('/api/shift-templates', {
      method: 'POST', body: JSON.stringify(payload),
    }),
  );

export const updateShiftTemplate = (id: string, payload: Partial<ShiftTemplatePayload>) =>
  adapt(() => undefined, () =>
    request<void>(`/api/shift-templates/${id}`, {
      method: 'PUT', body: JSON.stringify(payload),
    }));

export const deleteShiftTemplate = (id: string) =>
  adapt(() => undefined, () =>
    request<void>(`/api/shift-templates/${id}`, { method: 'DELETE' }));

/* ------------------------------------------------------------------ 班表 */

/** API 形狀（shifts 無 OFF／休息／備註欄位：OFF＝該日無資料列）。 */
export type ShiftItem = {
  id: string;
  staffId: string;
  workDate: string;
  templateId: string | null;
  startTime: string;
  endTime: string;
};

/** GET /api/shifts?from&to — mock 回 null（頁面維持 MOCK_SHIFTS 現狀）。 */
export const listShifts = (from: string, to: string) =>
  adapt<ShiftItem[] | null>(
    () => null,
    () => request<ShiftItem[]>('/api/shifts', { query: { from, to } }),
  );

export type ShiftUpsertItem = {
  staffId: string;
  workDate: string;
  startTime: string;
  endTime: string;
  templateId?: string | null;
};

/**
 * POST /api/shifts — 批次 upsert（onConflict 由後端以唯一鍵
 * (tenant_id, staff_id, work_date, start_time) 處理），回 { count }。
 */
export const saveShifts = (items: ShiftUpsertItem[]) =>
  adapt<{ count: number }>(
    () => ({ count: items.length }),
    () => request<{ count: number }>('/api/shifts', {
      method: 'POST', body: JSON.stringify(items),
    }),
  );

/**
 * 清空某員工某日的班（含設休／清除格子）。shifts 沒有單筆 DELETE 端點，
 * 以 repeat-cycle 的「weekPattern 值為 null＝該星期整日清除」語意、
 * from=to=該日 達成單日刪除。
 */
export const clearShiftDay = (staffId: string, workDate: string) =>
  adapt<void>(
    () => undefined,
    async () => {
      const day = String(new Date(`${workDate}T00:00:00Z`).getUTCDay());
      await request<unknown>('/api/shifts/repeat-cycle', {
        method: 'POST',
        body: JSON.stringify({ staffId, weekPattern: { [day]: null }, from: workDate, to: workDate }),
      });
    },
  );

export type RepeatCycleResult = { inserted: number; clearedDates: number };

/**
 * POST /api/shifts/repeat-cycle — 每人一次呼叫（API 契約為單一 staffId），
 * 逐一送出後加總結果。weekPattern：key '0'–'6'（0=週日）；value templateId＝
 * 套班、null＝休假日（整日清除）、key 不出現＝不動。
 * mock 分支沿用骨架階段的固定示範值（寫入 14 天、跳過 2 天）。
 */
export const repeatShiftCycles = (
  items: { staffId: string; weekPattern: Record<string, string | null> }[],
  from: string,
  to: string,
) =>
  adapt<RepeatCycleResult>(
    () => ({ inserted: 14, clearedDates: 16 }),
    async () => {
      let inserted = 0;
      let clearedDates = 0;
      for (const item of items) {
        const r = await request<RepeatCycleResult>('/api/shifts/repeat-cycle', {
          method: 'POST', body: JSON.stringify({ ...item, from, to }),
        });
        inserted += r.inserted;
        clearedDates += r.clearedDates;
      }
      return { inserted, clearedDates };
    },
  );
