// GET /api/calendar?from&to — 行事曆頁唯一資料源（04 §B-1）：四種事件合併成
// 一個陣列 { events: CalendarEvent[] }（展示層合一，資料層仍分開）。
//
// 現階段實作 BOOKING + BLOCK + EXTERNAL 三種：
//   - DEPARTURE（行程團次）：trips / trip_departures 表屬 Phase 10 TOUR_MODULE
//     （0004 migration 尾註：長尾功能先不建表；10-TOUR-DOMAIN.md），表未建 →
//     恆回空，Phase 10 建表後在此補查詢（僅 TOUR_MODULE 租戶）。
//   - EXTERNAL（外部 ICS，Issue #21）：讀 external_calendar_events **快取表**，
//     不在這個 request 當下即時去打第三方 ICS——理由見 Issue #21「cache vs
//     realtime」已收斂的 Owner 方向：避免把外部服務延遲／故障耦合進行事曆頁的
//     讀取路徑，並保留 last-known-good 狀態。快取由
//     `/api/cron/external-calendars-sync` 每小時更新（見該檔）；某個外部來源
//     同步失敗只影響它自己的 last_sync_status，快取表裡仍是上次成功的資料，
//     這裡照樣讀得到、不會讓整個 `/api/calendar` 回應失敗。
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

  const [{ data: bookings, error: bErr }, blocks, { data: externals, error: extErr }] = await Promise.all([
    // 行事曆只顯示還「佔住時段」或已履行的預約；CANCELLED/NO_SHOW 不佔格。
    t.supabase.from('bookings_view')
      .select('id, booking_no, status, start_at, end_at, customer_name, service_name, staff_id, staff_name')
      .eq('tenant_id', t.tenantId)
      .in('status', ['PENDING', 'CONFIRMED', 'COMPLETED'])
      .lt('start_at', q.to).gt('end_at', q.from),
    // 共用展開：WEEKLY 封鎖規則在此區間內實際發生的每一次都各自成一個事件。
    queryEffectiveBlockTimes(t.supabase, t.tenantId, q.from, q.to),
    // 外部 ICS 快取事件（見檔頭）；tenant_id 一律等於 session 解析出的
    // t.tenantId，租戶邊界靠這個等式條件 + 0115 migration 的 RLS 雙重把關。
    t.supabase.from('external_calendar_events')
      .select('id, title, start_at, end_at, all_day')
      .eq('tenant_id', t.tenantId)
      .lt('start_at', q.to).gt('end_at', q.from),
  ]);
  if (bErr) throw bErr;
  // external_calendar_events 讀取失敗（例如 0115 migration 尚未套用到本環境、
  // 表還不存在）比照檔頭承諾：只讓 EXTERNAL 那一段變空，不拖垮 BOOKING/BLOCK。
  if (extErr) console.error('[api/calendar] external_calendar_events query failed', extErr);
  const safeExternals = extErr ? [] : externals;

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
    ...(safeExternals ?? []).map((r): CalendarEvent => ({
      id: `external:${r.id}`,
      type: 'EXTERNAL',
      title: r.title,
      start: r.start_at,
      end: r.end_at,
    })),
    // DEPARTURE：對應資料表尚未建（見檔頭註解），先恆為空。
  ].sort((a, b) => a.start.localeCompare(b.start));

  return ok({ events });
});
