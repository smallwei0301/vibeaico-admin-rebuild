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
  GuideReportRangeError, MAX_ROWS, computeGuideReport, resolveReportRange, zonedToday, addDays,
  type GuideReportOrderRow,
} from '@/server/guide-report';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const querySchema = z.object({
  from: z.string().regex(DATE_RE, 'from 需為 YYYY-MM-DD').optional(),
  to: z.string().regex(DATE_RE, 'to 需為 YYYY-MM-DD').optional(),
});

const PAGE = 1000;
const ORDER_COLUMNS =
  'id, trip_id, plan_id, party_size, status, payment_status, paid_amount, refunded_amount, created_at';

const ID_BATCH = 200;

/** 名稱查詢分批（避免 URL 過長／PostgREST 列數上限），每批都帶 tenant_id；任一批失敗就丟出（500），不退回顯示 UUID。 */
async function fetchNames(
  db: Awaited<ReturnType<typeof requireTenantManager>>['supabase'],
  table: 'trips' | 'trip_plans',
  column: 'title' | 'name',
  tenantId: string,
  ids: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < ids.length; i += ID_BATCH) {
    const { data, error } = await db.from(table).select(`id, ${column}`)
      .eq('tenant_id', tenantId).in('id', ids.slice(i, i + ID_BATCH));
    if (error) throw error;
    for (const x of (data ?? []) as unknown as Record<string, string>[]) out.set(x.id, x[column]);
  }
  return out;
}

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
  let truncated = false;
  const fetchPage = async (offset: number, last: number) => {
    const { data, error } = await t.supabase.from('tour_orders').select(ORDER_COLUMNS)
      .eq('tenant_id', t.tenantId)
      .gte('created_at', new Date(range.prevFromMs).toISOString())
      .lt('created_at', new Date(range.curToMs).toISOString())
      .order('id', { ascending: true })
      .range(offset, last);
    if (error) throw error;
    return (data ?? []) as GuideReportOrderRow[];
  };
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    const page = await fetchPage(offset, offset + PAGE - 1);
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  // 剛好讀滿 MAX_ROWS：多探測第 MAX_ROWS+1 筆，確實存在才標 truncated（計算只用前 MAX_ROWS 筆）
  if (rows.length >= MAX_ROWS) truncated = (await fetchPage(MAX_ROWS, MAX_ROWS)).length > 0;

  const tripIds = [...new Set(rows.map((r) => r.trip_id))];
  const planIds = [...new Set(rows.map((r) => r.plan_id))];
  const [tripNames, planNames] = await Promise.all([
    fetchNames(t.supabase, 'trips', 'title', t.tenantId, tripIds),
    fetchNames(t.supabase, 'trip_plans', 'name', t.tenantId, planIds),
  ]);

  return ok(computeGuideReport({
    rows, from, to, timeZone, truncated,
    tripNames, planNames,
  }));
});
