import { ApiError, adapt, request } from '@/lib/api';
import type { Customer, Paged } from '@/lib/types';
import { MOCK_CUSTOMERS } from '@/mock';

let nextMockCustomerId = 1;

export type CustomerQuery = {
  page?: number; size?: number; keyword?: string; atRisk?: boolean;
  levelId?: string; tag?: string; minSpent?: number; maxSpent?: number; minVisits?: number;
};

export function listCustomers(q: CustomerQuery = {}): Promise<Paged<Customer>> {
  return adapt(
    () => {
      const page = q.page ?? 0, size = q.size ?? 20;
      let rows = MOCK_CUSTOMERS;
      if (q.atRisk) rows = rows.filter((c) => c.atRisk);
      if (q.levelId) rows = rows.filter((c) => c.membershipLevelId === q.levelId);
      if (q.keyword) {
        const k = q.keyword.toLowerCase();
        rows = rows.filter((c) => c.name.toLowerCase().includes(k) || c.phone.includes(k));
      }
      if (q.minSpent != null) rows = rows.filter((c) => c.totalSpent >= q.minSpent!);
      if (q.maxSpent != null) rows = rows.filter((c) => c.totalSpent <= q.maxSpent!);
      if (q.minVisits != null) rows = rows.filter((c) => c.bookingCount >= q.minVisits!);
      return {
        content: rows.slice(page * size, (page + 1) * size),
        totalElements: rows.length,
        totalPages: Math.ceil(rows.length / size),
        number: page, size,
      };
    },
    () => request<Paged<Customer>>('/api/customers', { query: q as Record<string, string> }),
  );
}

/**
 * mock 分支直接寫進 MOCK_CUSTOMERS（沿用陣列參照，非 module 頂層求值），
 * 讓新增/編輯後 listCustomers() 重讀能看到結果，行為對齊真實後端。
 */
export const createCustomer = (payload: Partial<Customer>) =>
  adapt<{ id: string }>(
    () => {
      const id = `c_new_${nextMockCustomerId++}`;
      MOCK_CUSTOMERS.push({
        id,
        name: payload.name ?? '',
        phone: payload.phone ?? '',
        email: payload.email ?? '',
        gender: payload.gender ?? '',
        birthday: payload.birthday ?? '',
        note: payload.note ?? '',
        lineUserId: null,
        lineDisplayName: null,
        membershipLevelId: payload.membershipLevelId ?? null,
        membershipLevelName: null,
        tags: payload.tags ?? [],
        bookingCount: 0,
        totalSpent: 0,
        points: 0,
        lastVisitAt: null,
        atRisk: false,
        active: true,
        createdAt: new Date().toISOString(),
      });
      return { id };
    },
    () => request<{ id: string }>('/api/customers', { method: 'POST', body: JSON.stringify(payload) }),
  );

export const updateCustomer = (id: string, payload: Partial<Customer>) =>
  adapt(
    () => {
      const idx = MOCK_CUSTOMERS.findIndex((c) => c.id === id);
      if (idx >= 0) MOCK_CUSTOMERS[idx] = { ...MOCK_CUSTOMERS[idx], ...payload };
      return undefined;
    },
    () => request<void>(`/api/customers/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  );

export const deleteCustomer = (id: string) =>
  adapt(() => undefined, () => request<void>(`/api/customers/${id}`, { method: 'DELETE' }));

/**
 * POST /api/customers/:id/bind-line — `{lineUserId}`。雙向唯一性：任一端已綁
 * 則後端回 409，訊息（ApiError.message）由頁面原樣呈現，不吞不改寫。
 * mockDisplayName 只給 mock 分支用來同步顯示名稱，真後端不接受此欄位。
 */
export const bindLineUser = (customerId: string, lineUserId: string, mockDisplayName?: string | null) =>
  adapt(
    () => {
      const idx = MOCK_CUSTOMERS.findIndex((c) => c.id === customerId);
      if (idx < 0) throw new ApiError('找不到此顧客', 'NOT_FOUND', 404);
      if (MOCK_CUSTOMERS.some((c) => c.id !== customerId && c.lineUserId === lineUserId))
        throw new ApiError('此 LINE 帳號已綁定其他顧客', 'CONFLICT', 409);
      MOCK_CUSTOMERS[idx] = {
        ...MOCK_CUSTOMERS[idx],
        lineUserId,
        lineDisplayName: mockDisplayName ?? MOCK_CUSTOMERS[idx].lineDisplayName,
      };
      return undefined;
    },
    () => request<void>(`/api/customers/${customerId}/bind-line`, {
      method: 'POST', body: JSON.stringify({ lineUserId }),
    }),
  );

/** POST /api/customers/:id/unbind-line — 冪等，未綁定時直接回成功。 */
export const unbindLineUser = (customerId: string) =>
  adapt(
    () => {
      const idx = MOCK_CUSTOMERS.findIndex((c) => c.id === customerId);
      if (idx >= 0) MOCK_CUSTOMERS[idx] = { ...MOCK_CUSTOMERS[idx], lineUserId: null, lineDisplayName: null };
      return undefined;
    },
    () => request<void>(`/api/customers/${customerId}/unbind-line`, { method: 'POST' }),
  );
