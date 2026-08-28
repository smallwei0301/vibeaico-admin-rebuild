// GET /api/calendar?from&to — 行事曆頁唯一資料源（04 §B-1）：四種事件合併成
// 一個陣列 { events: CalendarEvent[] }（展示層合一，資料層仍分開）。
//
// 現階段實作 BOOKING + BLOCK + DEPARTURE；EXTERNAL 的資料表尚未建立，仍為空。
import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import type { CalendarEvent } from '@/lib/types';
import { expandWeeklyBlock } from '@/server/business-hours-blocks';
import { departureInterval } from '@/server/staff-availability';

const querySchema = z.object({
  from: z.string().datetime({ offset: true }).min(1, '請提供起始時間'),
  to: z.string().datetime({ offset: true }).min(1, '請提供結束時間'),
});

export const GET = handle(async (req) => {
  const t = await requireTenant();
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const fromDate = q.from.slice(0, 10);
  // API 的 `to` 是不含端點；日期欄位查詢改成最後一個仍在區間內的日期。
  const toDate = new Date(Date.parse(q.to) - 1).toISOString().slice(0, 10);

  const [
    { data: bookings, error: bErr },
    { data: blocks, error: blErr },
    { data: departures, error: dErr },
  ] = await Promise.all([
    // 行事曆只顯示還「佔住時段」或已履行的預約；CANCELLED/NO_SHOW 不佔格。
    t.supabase.from('bookings_view')
      .select('id, booking_no, status, start_at, end_at, customer_name, service_name, staff_id, staff_name')
      .eq('tenant_id', t.tenantId)
      .in('status', ['PENDING', 'CONFIRMED', 'COMPLETED'])
      .lt('start_at', q.to).gt('end_at', q.from),
    /*
     * ⚠️ 這裡**不能**用 .lt('start_at', to).gt('end_at', from) 過濾：
     * WEEKLY 的列（migration 0027）存的是參考週的起訖時間，不是實際發生的
     * 日期，用區間比對會把每一筆每週封鎖都濾掉。改成整批取回、在下面展開後
     * 再過濾（店家量級小，同其他列表端點的口徑）。
     */
    t.supabase.from('block_times')
      .select('id, staff_id, start_at, end_at, reason, title, recurrence, day_of_week, auto, staff(name)')
      .eq('tenant_id', t.tenantId),
    // TOUR_MODULE 是 GUIDE 業態的隨模式贈送能力，不一定有 feature_subscriptions
    // 資料列（13 分冊）；直接依租戶查團次，沒有行程的業態自然得到空陣列。
    t.supabase.from('trip_departures')
      .select('id, trip_id, departs_on, start_time, capacity, seats_booked, status, trips(title), trip_plans(name, duration_minutes), trip_departure_staff(staff_id, role, staff(name))')
      .eq('tenant_id', t.tenantId)
      .gte('departs_on', fromDate).lte('departs_on', toDate),
  ]);
  if (bErr) throw bErr;
  if (blErr) throw blErr;
  if (dErr) throw dErr;

  const events: CalendarEvent[] = [
    ...(bookings ?? []).map((r): CalendarEvent => ({
      id: `booking:${r.id}`,
      type: 'BOOKING',
      title: `${r.service_name}・${r.customer_name}`,
      start: r.start_at,
      end: r.end_at,
      meta: {
        bookingId: r.id, bookingNo: r.booking_no, status: r.status,
        customerName: r.customer_name, serviceName: r.service_name,
        staffId: r.staff_id, staffName: r.staff_name,
      },
    })),
    ...(blocks ?? []).flatMap((r): CalendarEvent[] => {
      // 巢狀 join 在無 Database 型別時被靜態推成陣列，實際為多對一物件
      //（同 src/server/email/notify.ts 說明）。
      const staffName = (r as unknown as { staff: { name: string } | null }).staff?.name ?? null;
      const label = r.title || r.reason || '封鎖時段';
      const meta = {
        reason: r.reason ?? '',
        staffId: r.staff_id,
        staffName,
        recurrence: (r.recurrence ?? 'SINGLE') as string,
        auto: !!r.auto,
      };
      if ((r.recurrence ?? 'SINGLE') !== 'WEEKLY') {
        // SINGLE：照原本的區間過濾（重疊判定 start < to 且 end > from）
        if (!(r.start_at < q.to && r.end_at > q.from)) return [];
        return [{
          id: `block:${r.id}`, type: 'BLOCK', title: label,
          start: r.start_at, end: r.end_at, meta,
        }];
      }
      // WEEKLY：一列 = 一整條每週封鎖，在查詢區間內展開成每一次發生
      //（原站的刪除確認也是這個模型：docs/specs/calendar.json jsStrings[31]
      //  「會把每一週的這個封鎖整條刪除」）。
      return expandWeeklyBlock(r, q.from, q.to).map((occ) => ({
        id: `block:${r.id}:${occ.start}`,
        type: 'BLOCK' as const,
        title: label,
        start: occ.start,
        end: occ.end,
        meta: { ...meta, blockId: r.id },
      }));
    }),
    ...(departures ?? []).map((row): CalendarEvent => {
      const r = row as unknown as {
        id: string; trip_id: string; departs_on: string; start_time: string | null;
        capacity: number; seats_booked: number; status: 'OPEN' | 'CLOSED' | 'CANCELLED';
        trips: { title: string } | null;
        trip_plans: { name: string; duration_minutes: number } | null;
        trip_departure_staff: Array<{
          staff_id: string; role: 'PRIMARY' | 'ASSISTANT'; staff: { name: string } | null;
        }>;
      };
      const interval = departureInterval(
        r.departs_on, r.start_time?.slice(0, 5) ?? '', r.trip_plans?.duration_minutes ?? 60,
      );
      const primary = r.trip_departure_staff.find((item) => item.role === 'PRIMARY');
      const assistants = r.trip_departure_staff.filter((item) => item.role === 'ASSISTANT');
      return {
        id: `departure:${r.id}`,
        type: 'DEPARTURE',
        title: `${r.trips?.title ?? '行程'}・${r.trip_plans?.name ?? '方案'}`,
        start: interval.start,
        end: interval.end,
        meta: {
          departureId: r.id, tripId: r.trip_id,
          tripTitle: r.trips?.title ?? '', planName: r.trip_plans?.name ?? '',
          departureStatus: r.status,
          primaryStaffId: primary?.staff_id ?? null,
          primaryStaffName: primary?.staff?.name ?? null,
          assistantStaffIds: assistants.map((item) => item.staff_id),
          assistantStaffNames: assistants.map((item) => item.staff?.name ?? '').filter(Boolean),
          seatsBooked: Number(r.seats_booked), capacity: Number(r.capacity),
        },
      };
    }),
    // EXTERNAL：對應資料表尚未建，先恆為空。
  ].sort((a, b) => a.start.localeCompare(b.start));

  return ok({ events });
});
