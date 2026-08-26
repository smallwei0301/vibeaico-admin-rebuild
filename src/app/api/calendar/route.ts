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
import type { CalendarEvent } from '@/lib/types';
import { expandWeeklyBlock } from '@/server/business-hours-blocks';

const querySchema = z.object({
  from: z.string().min(1, '請提供起始時間'),
  to: z.string().min(1, '請提供結束時間'),
});

export const GET = handle(async (req) => {
  const t = await requireTenant();
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));

  const [{ data: bookings, error: bErr }, { data: blocks, error: blErr }] = await Promise.all([
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
  ]);
  if (bErr) throw bErr;
  if (blErr) throw blErr;

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
    // DEPARTURE / EXTERNAL：對應資料表尚未建（見檔頭註解），先恆為空。
  ].sort((a, b) => a.start.localeCompare(b.start));

  return ok({ events });
});
