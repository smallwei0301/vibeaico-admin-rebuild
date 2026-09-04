import { ApiError, adapt, request } from '@/lib/api';
import type { Customer, Paged } from '@/lib/types';
import { MOCK_CUSTOMERS, MOCK_MODE } from '@/mock';
import type { BusinessType } from '@/config/modes';

let nextMockCustomerId = 1;

/** GET /api/line-users/unbound 回傳的候選項目：真後端只有這四個欄位，沒有分類概念。 */
export type UnboundLineUser = {
  lineUserId: string;
  displayName: string;
  pictureUrl: string;
  createdAt: string;
};

type MockLineUserRow = UnboundLineUser & { customerId: string | null };

/**
 * page-local 的「未綁定 LINE 用戶」假資料，依業態模式各自一份、延遲初始化
 * （呼叫時才讀 MOCK_MODE，不可在 module 頂層求值 —— 見 CLAUDE.md 的 mock 資料規則）。
 */
const mockLineUserStore = new Map<BusinessType, MockLineUserRow[]>();

function getMockLineUserRows(): MockLineUserRow[] {
  if (!mockLineUserStore.has(MOCK_MODE)) {
    mockLineUserStore.set(MOCK_MODE, [
      { lineUserId: 'lu_1', displayName: 'Kevin', pictureUrl: '', createdAt: '2026-08-28T02:00:00.000Z', customerId: null },
      { lineUserId: 'lu_2', displayName: '', pictureUrl: '', createdAt: '2026-08-20T02:00:00.000Z', customerId: null },
      { lineUserId: 'lu_3', displayName: 'sunny_1988', pictureUrl: '', createdAt: '2026-08-10T02:00:00.000Z', customerId: null },
    ]);
  }
  return mockLineUserStore.get(MOCK_MODE)!;
}

/**
 * GET /api/line-users/unbound — followed=true 且 customer_id is null，
 * 加入時間新→舊。mock 分支與 bindLineUser/unbindLineUser 共用同一份 store，
 * 綁定後該筆會從清單消失、解綁後會回來。
 */
export const listUnboundLineUsers = () =>
  adapt<UnboundLineUser[]>(
    () => getMockLineUserRows()
      .filter((u) => u.customerId === null)
      .map(({ lineUserId, displayName, pictureUrl, createdAt }) => ({
        lineUserId, displayName, pictureUrl, createdAt,
      })),
    () => request<UnboundLineUser[]>('/api/line-users/unbound'),
  );

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

      const rows = getMockLineUserRows();
      let row = rows.find((r) => r.lineUserId === lineUserId);
      if (!row) {
        row = {
          lineUserId, displayName: mockDisplayName ?? '', pictureUrl: '',
          createdAt: new Date().toISOString(), customerId: null,
        };
        rows.unshift(row);
      }
      if (row.customerId && row.customerId !== customerId)
        throw new ApiError('此 LINE 帳號已綁定其他顧客', 'CONFLICT', 409);
      row.customerId = customerId;

      MOCK_CUSTOMERS[idx] = {
        ...MOCK_CUSTOMERS[idx],
        lineUserId,
        lineDisplayName: mockDisplayName ?? row.displayName ?? MOCK_CUSTOMERS[idx].lineDisplayName,
      };
      return undefined;
    },
    () => request<void>(`/api/customers/${customerId}/bind-line`, {
      method: 'POST', body: JSON.stringify({ lineUserId }),
    }),
  );

/**
 * POST /api/customers/:id/unbind-line — 冪等，未綁定時直接回成功。
 * mock 分支同時把 line-user store 的那一列 customerId 清空，讓它重新出現在未綁定清單。
 */
export const unbindLineUser = (customerId: string) =>
  adapt(
    () => {
      const idx = MOCK_CUSTOMERS.findIndex((c) => c.id === customerId);
      if (idx >= 0) {
        const prevLineUserId = MOCK_CUSTOMERS[idx].lineUserId;
        if (prevLineUserId) {
          const row = getMockLineUserRows().find((r) => r.lineUserId === prevLineUserId);
          if (row) row.customerId = null;
        }
        MOCK_CUSTOMERS[idx] = { ...MOCK_CUSTOMERS[idx], lineUserId: null, lineDisplayName: null };
      }
      return undefined;
    },
    () => request<void>(`/api/customers/${customerId}/unbind-line`, { method: 'POST' }),
  );
