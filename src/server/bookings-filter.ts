// 預約列表（/api/bookings）與預約匯出（/api/export/bookings*）共用的篩選語意（#974）。
// 狀態／付款列舉、statuses 解析、keyword 跳脫與 query 套用只在這一份，兩邊不各寫一遍。
import { z } from 'zod';
import { ilikeAnyOf } from '@/server/postgrest-filter';

export const BOOKING_STATUS = z.enum(['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']);
export const BOOKING_PAYMENT_STATUS = z.enum(['UNPAID', 'PAID_ONLINE', 'PAID_OFFLINE', 'REFUNDED']);

/** #934：逗號分隔多值（如 PENDING,CONFIRMED），每個值都須在白名單內。 */
export const bookingStatusesParam = z.string().optional().transform((v, ctx) => {
  if (v === undefined || v === '') return undefined;
  const out: z.infer<typeof BOOKING_STATUS>[] = [];
  for (const part of v.split(',').map((x) => x.trim()).filter(Boolean)) {
    const r = BOOKING_STATUS.safeParse(part);
    if (!r.success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'statuses 含不合法的狀態值' });
      return z.NEVER;
    }
    if (!out.includes(r.data)) out.push(r.data);
  }
  return out.length ? out : undefined;
});

export const bookingExcludeCancelledParam = z.enum(['true', 'false']).optional()
  .transform((v) => v === 'true');

export const BOOKING_KEYWORD_COLUMNS = ['customer_name', 'customer_phone', 'booking_no'];

export type BookingListFilters = {
  status?: z.infer<typeof BOOKING_STATUS>;
  statuses?: z.infer<typeof BOOKING_STATUS>[];
  excludeCancelled?: boolean;
  paymentStatus?: z.infer<typeof BOOKING_PAYMENT_STATUS>;
  keyword?: string;
};

/** 套用狀態／付款／關鍵字篩選到 bookings_view 的 query builder（列表與匯出同語意）。 */
export function applyBookingFilters<Q extends {
  eq(c: string, v: string): Q;
  neq(c: string, v: string): Q;
  in(c: string, v: string[]): Q;
  or(f: string): Q;
}>(query: Q, q: BookingListFilters): Q {
  let r = query;
  if (q.status) r = r.eq('status', q.status);
  if (q.statuses) r = r.in('status', q.statuses);
  if (q.excludeCancelled) r = r.neq('status', 'CANCELLED');
  if (q.paymentStatus) r = r.eq('payment_status', q.paymentStatus);
  if (q.keyword) r = r.or(ilikeAnyOf(BOOKING_KEYWORD_COLUMNS, q.keyword));
  return r;
}
