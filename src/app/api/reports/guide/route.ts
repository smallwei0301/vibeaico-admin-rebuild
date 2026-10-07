// GET /api/reports/guide?from&to — GUIDE 導遊營運報表（Issue #45 第一個 Delivery Slice）。
//
// 權限：MANAGER 以上（requireTenantManager）。報表含營收與全租戶訂單，STAFF 不開放；
// GUIDE 的基本報表能力是 baseline（GUIDE_BASIC_REPORT），不走舊 BASIC_REPORT feature。
// 所有查詢明確帶 tenant_id（requireTenantManager 回的是 service-role client，租戶邊界
// 完全靠這裡的 .eq('tenant_id')）。計算全在 src/server/guide-report.ts 的純函式。
// 日期界線用租戶時區（tenant_settings.basic.timezone，缺值回退 Asia/Taipei）。
import { z } from 'zod';
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenantManager } from '@/server/tenant';
import { requireEntitlement } from '@/server/features';
import { resolvePublicTimeZone } from '@/lib/public-time-zone';
import {
  GuideReportRangeError, computeGuideReport, resolveReportRange, zonedToday, addDays,
  type GuideReportOrderRow,
} from '@/server/guide-report';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const querySchema = z.object({
  from: z.string().regex(DATE_RE, 'from 需為 YYYY-MM-DD').optional(),
  to: z.string().regex(DATE_RE, 'to 需為 YYYY-MM-DD').optional(),
});

const PAGE = 1000;
const MAX_ROWS = 20000;
const ORDER_COLUMNS =
  'id, trip_id, plan_id, party_size, status, payment_status, paid_amount, refunded_amount, created_at';

export const GET = handle(async (req) => {
  const t = await requireTenantManager();
  await requireEntitlement({ tenantId: t.tenantId, businessType: t.businessType }, 'GUIDE_BASIC_REPORT');
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));

  const { data: settings, error: se } = await t.supabase
    .from('tenant_settings').select('basic').eq('tenant_id', t.tenantId).maybeSingle();
  if (se) throw se;
  const timeZone = resolvePublicTimeZone((settings?.basic as { timezone?: unknown } | null)?.timezone);

  const to = q.to ?? zonedToday(timeZone);
  const from = q.from ?? addDays(to, -29); // 預設近 30 天（含今天）
  let range;
  try {
    range = resolveReportRange(from, to, timeZone);
  } catch (e) {
    if (e instanceof GuideReportRangeError) throw new ApiHttpError(400, e.message, ERR.VALIDATION);
    throw e;
  }

  // 本期＋上一等長期間一次撈回（半開區間），Node 端聚合；分頁避開 PostgREST 預設 1000 列上限。
  const rows: GuideReportOrderRow[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    const { data, error } = await t.supabase.from('tour_orders').select(ORDER_COLUMNS)
      .eq('tenant_id', t.tenantId)
      .gte('created_at', new Date(range.prevFromMs).toISOString())
      .lt('created_at', new Date(range.curToMs).toISOString())
      .order('id', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as GuideReportOrderRow[]));
    if ((data ?? []).length < PAGE) break;
  }

  const tripIds = [...new Set(rows.map((r) => r.trip_id))];
  const planIds = [...new Set(rows.map((r) => r.plan_id))];
  const [tripsRes, plansRes] = await Promise.all([
    tripIds.length
      ? t.supabase.from('trips').select('id, title').eq('tenant_id', t.tenantId).in('id', tripIds)
      : Promise.resolve({ data: [], error: null }),
    planIds.length
      ? t.supabase.from('trip_plans').select('id, name').eq('tenant_id', t.tenantId).in('id', planIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (tripsRes.error) throw tripsRes.error;
  if (plansRes.error) throw plansRes.error;

  return ok(computeGuideReport({
    rows, from, to, timeZone,
    tripNames: new Map((tripsRes.data ?? []).map((x: { id: string; title: string }) => [x.id, x.title])),
    planNames: new Map((plansRes.data ?? []).map((x: { id: string; name: string }) => [x.id, x.name])),
  }));
});
