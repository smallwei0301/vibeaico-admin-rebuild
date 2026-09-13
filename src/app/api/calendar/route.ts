// GET /api/calendar?from&to — 行事曆頁唯一資料源（04 §B-1）：四種事件合併成
// 一個陣列 { events: CalendarEvent[] }（展示層合一，資料層仍分開）。
//
// 現階段實作 BOOKING + BLOCK 兩種：
//   - DEPARTURE（行程團次）：trips / trip_departures 表屬 Phase 10 TOUR_MODULE
//     （0004 migration 尾註：長尾功能先不建表；10-TOUR-DOMAIN.md），表未建 →
//     恆回空，Phase 10 建表後在此補查詢（僅 TOUR_MODULE 租戶）。
//   - EXTERNAL（外部 ICS）：external_calendars 表同樣未建（0004 尾註）→ 恆回空。
import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { queryEffectiveBlockTimes } from '@/server/block-times';
import type { CalendarEvent } from '@/lib/types';

const querySchema = z.object({
  from: z.string().min(1, '請提供起始時間'),
  to: z.string().min(1, '請提供結束時間'),
});

export const GET = handle(async (req) => {
  const t = await requireTenant();
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));

  const [{ data: bookings, error: bErr }, blocks] = await Promise.all([
    // 行事曆只顯示還「佔住時段」或已履行的預約；CANCELLED/NO_SHOW 不佔格。
    t.supabase.from('bookings_view')
      .select('id, booking_no, status, start_at, end_at, customer_name, service_name, staff_id, staff_name')
      .eq('tenant_id', t.tenantId)
      .in('status', ['PENDING', 'CONFIRMED', 'COMPLETED'])
      .lt('start_at', q.to).gt('end_at', q.from),
    // 共用展開：WEEKLY 封鎖規則在此區間內實際發生的每一次都各自成一個事件。
    queryEffectiveBlockTimes(t.supabase, t.tenantId, q.from, q.to),
  ]);
  if (bErr) throw bErr;

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
    ...blocks.map((r): CalendarEvent => ({
      // WEEKLY 規則在區間內可能展開成好幾次發生，用 start_at 讓每次發生的
      // id 各自唯一；真正的來源規則列 id 另外帶在 meta.blockTimeId。
      id: `block:${r.id}:${r.start_at}`,
      type: 'BLOCK',
      title: r.title || r.reason || '封鎖時段',
      start: r.start_at,
      end: r.end_at,
      meta: {
        reason: r.reason ?? '',
        staffId: r.staff_id,
        staffName: r.staff?.name ?? null,
        blockTimeId: r.id,
      },
    })),
    // DEPARTURE / EXTERNAL：對應資料表尚未建（見檔頭註解），先恆為空。
  ].sort((a, b) => a.start.localeCompare(b.start));

  return ok({ events });
});
