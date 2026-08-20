import { adapt, request } from '@/lib/api';
import type { Booking, BookingStatus, Paged } from '@/lib/types';
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
