import { adapt, request } from '@/lib/api';
import type { Customer, Paged } from '@/lib/types';
import { MOCK_CUSTOMERS } from '@/mock';

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
 * POST /api/customers — 建立顧客，回 `{ id }`。
 *
 * ⚠️ 回傳型別原本宣告成 `Promise<void>`，但端點實際回 `{ id }`，於是 bookings 頁
 * 只好寫 `as unknown as { id?: string }` 把它拿回來（見 bookings/page.tsx
 * resolveCustomerId 的註解）。這裡改成如實宣告，斷言那一段仍然成立。
 * mock 分支回一個合成 id（同 createBooking 的慣例），呼叫端不必分兩種寫法。
 */
export const createCustomer = (payload: Partial<Customer>) =>
  adapt<{ id: string }>(
    () => ({ id: `c_mock_${Date.now()}` }),
    () => request<{ id: string }>('/api/customers', { method: 'POST', body: JSON.stringify(payload) }),
  );

export const updateCustomer = (id: string, payload: Partial<Customer>) =>
  adapt(() => undefined, () => request<void>(`/api/customers/${id}`, { method: 'PUT', body: JSON.stringify(payload) }));

export const deleteCustomer = (id: string) =>
  adapt(() => undefined, () => request<void>(`/api/customers/${id}`, { method: 'DELETE' }));

/* ------------------------------------------------------------ LINE 綁定 */

/**
 * ⚠️ 「待綁定的 LINE 好友」清單**不在這個檔案**：`listUnboundLineUsers()` 與
 * `UnboundLineUser` 型別早就存在於 `src/services/chat.ts`（聊天室頁用它把只加了
 * 好友、還沒建檔的人補進對話列表）。customers 頁接線時再寫一份同名函式，短期
 * 兩份看起來一樣，長期一定分岔，而分岔那天沒有任何測試會紅——所以這裡只留指路，
 * 呼叫端一律 `import { listUnboundLineUsers } from '@/services/chat'`。
 */

/** POST /api/customers/:id/bind-line — 雙向寫 customers.line_user_id 與 line_users.customer_id。 */
export const bindCustomerLine = (id: string, lineUserId: string) =>
  adapt<{ bound: boolean }>(
    () => ({ bound: true }),
    () => request<{ bound: boolean }>(`/api/customers/${id}/bind-line`, {
      method: 'POST', body: JSON.stringify({ lineUserId }),
    }),
  );

/**
 * POST /api/customers/:id/unbind-line — 雙向清除。
 *
 * ⚠️ 不可以用 `updateCustomer(id, { lineUserId: '' })` 代替：PUT /api/customers/:id
 * 的 zod 沒有 lineUserId 這個欄位（會被忽略），line_users.customer_id 也不會被清，
 * 畫面卻會顯示「LINE 綁定已解除」——那是假成功。必須打專用端點。
 */
export const unbindCustomerLine = (id: string) =>
  adapt<{ unbound: boolean }>(
    () => ({ unbound: true }),
    () => request<{ unbound: boolean }>(`/api/customers/${id}/unbind-line`, { method: 'POST' }),
  );
