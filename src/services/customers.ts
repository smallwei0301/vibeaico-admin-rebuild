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

export const createCustomer = (payload: Partial<Customer>) =>
  adapt(() => undefined, () => request<void>('/api/customers', { method: 'POST', body: JSON.stringify(payload) }));

export const updateCustomer = (id: string, payload: Partial<Customer>) =>
  adapt(() => undefined, () => request<void>(`/api/customers/${id}`, { method: 'PUT', body: JSON.stringify(payload) }));

export const deleteCustomer = (id: string) =>
  adapt(() => undefined, () => request<void>(`/api/customers/${id}`, { method: 'DELETE' }));
