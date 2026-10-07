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
import { fetchPriorCustomers, ID_BATCH } from '@/server/guide-report-repeat';
import { requireEntitlement } from '@/server/features';
import { resolvePublicTimeZone } from '@/lib/public-time-zone';
import {
  GuideReportRangeError, MAX_ROWS, computeGuideReport, currentCustomerIds, resolveReportRange, zonedToday, addDays,
  type GuideReportOrderRow,
} from '@/server/guide-report';
import type { GuideDepartureRow } from '@/server/guide-report-formation';

/** Postgres／PostgREST 的「欄位或資料表不存在」錯誤碼：undefined_column、undefined_table、PostgREST 找不到關聯／欄位 */
const MISSING_SCHEMA_CODES = new Set(['42703', '42P01', 'PGRST200', 'PGRST204', 'PGRST205']);
function isMissingSchemaError(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === 'string' && MISSING_SCHEMA_CODES.has(code);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const querySchema = z.object({
  from: z.string().regex(DATE_RE, 'from 需為 YYYY-MM-DD').optional(),
  to: z.string().regex(DATE_RE, 'to 需為 YYYY-MM-DD').optional(),
});

const PAGE = 1000;
const ORDER_COLUMNS =
  'id, trip_id, plan_id, party_size, status, payment_status, paid_amount, refunded_amount, created_at, source, customer_id';


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
  const requestStartedAt = Date.now();
  const t = await requireTenantManager();
  await requireEntitlement({ tenantId: t.tenantId, businessType: t.businessType }, 'GUIDE_BASIC_REPORT');
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));

  const { data: settings, error: se } = await t.supabase
    .from('tenant_settings').select('basic').eq('tenant_id', t.tenantId).maybeSingle();
  if (se) throw se;
  const timeZone = resolvePublicTimeZone((settings?.basic as { timezone?: unknown } | null)?.timezone);

  const today = zonedToday(timeZone);
  // 未來日期沒有資料，卻會被當成完整區間與上一期比較（如明天起 30 天 → -100%），直接拒絕。
  if ((q.to && q.to > today) || (q.from && q.from > today)) {
    throw new ApiHttpError(400, `日期不可晚於店家時區的今天（${today}）`, ERR.VALIDATION);
  }
  const to = q.to ?? today;
  const from = q.from ?? addDays(to, -29); // 預設近 30 天（含今天）
  let range;
  try {
    range = resolveReportRange(from, to, timeZone);
  } catch (e) {
    if (e instanceof GuideReportRangeError) throw new ApiHttpError(400, e.message, ERR.VALIDATION);
    throw e;
  }

  // 本期＋上一等長期間一次撈回（半開區間），Node 端聚合；分頁避開 PostgREST 預設 1000 列上限。
  // 讀取上界取「本期終點」與「請求開始時間」較小者：讀取期間新建立的訂單一律不計入（無 DB 快照時的成本相稱作法）。
  const upperMs = Math.min(range.curToMs, requestStartedAt);
  // keyset 分頁（order id + gt lastId）：讀取期間有新寫入也不會重複／漏讀；固定上界 created_at < 本期終點。
  const rows: GuideReportOrderRow[] = [];
  const fetchPage = async (afterId: string | null, limit: number) => {
    let query = t.supabase.from('tour_orders').select(ORDER_COLUMNS)
      .eq('tenant_id', t.tenantId)
      .gte('created_at', new Date(range.prevFromMs).toISOString())
      .lt('created_at', new Date(upperMs).toISOString());
    if (afterId) query = query.gt('id', afterId);
    const { data, error } = await query.order('id', { ascending: true }).limit(limit);
    if (error) throw error;
    return (data ?? []) as GuideReportOrderRow[];
  };
  let lastId: string | null = null;
  while (rows.length < MAX_ROWS) {
    const limit = Math.min(PAGE, MAX_ROWS - rows.length);
    const page = await fetchPage(lastId, limit);
    rows.push(...page);
    if (page.length < limit) break; // 短頁 = 已讀完
    lastId = page[page.length - 1].id;
  }
  // 剛好讀滿 MAX_ROWS：再以 keyset 探測下一筆，確實存在才標 truncated（計算只用前 MAX_ROWS 筆）
  const truncated = rows.length >= MAX_ROWS && (await fetchPage(lastId, 1)).length > 0;

  const tripIds = [...new Set(rows.map((r) => r.trip_id))];
  const planIds = [...new Set(rows.map((r) => r.plan_id))];
  const [tripNames, planNames] = await Promise.all([
    fetchNames(t.supabase, 'trips', 'title', t.tenantId, tripIds),
    fetchNames(t.supabase, 'trip_plans', 'name', t.tenantId, planIds),
  ]);

  const priorCustomerIds = await fetchPriorCustomers(
    t.supabase, t.tenantId, new Date(range.curFromMs).toISOString(),
    currentCustomerIds(rows, from, to, timeZone),
  );

  // 成團表現：期間（含上一期）內出發的團次；同樣 keyset＋MAX_ROWS 探測，不假裝完整。
  // 只有「欄位／資料表不存在」類錯誤（Production 尚未套用 0107 等）才降級成「暫時無法取得」，
  // 報表其餘部分照常回 200；其他任何錯誤維持 500，不靜默吞掉。
  const depFrom = range.prevFrom;
  const fetchDeps = async (afterId: string | null, limit: number) => {
    let dq = t.supabase.from('trip_departures').select('id, departs_on, status, formation_status')
      .eq('tenant_id', t.tenantId).gte('departs_on', depFrom).lte('departs_on', to);
    if (afterId) dq = dq.gt('id', afterId);
    const { data, error } = await dq.order('id', { ascending: true }).limit(limit);
    if (error) throw error;
    return (data ?? []) as GuideDepartureRow[];
  };
  const departures: GuideDepartureRow[] = [];
  let departuresTruncated = false;
  let formationUnavailable: 'SCHEMA_MISSING' | undefined;
  try {
    let depLast: string | null = null;
    while (departures.length < MAX_ROWS) {
      const limit = Math.min(PAGE, MAX_ROWS - departures.length);
      const pg = await fetchDeps(depLast, limit);
      departures.push(...pg);
      if (pg.length < limit) break;
      depLast = pg[pg.length - 1].id;
    }
    departuresTruncated = departures.length >= MAX_ROWS && (await fetchDeps(depLast, 1)).length > 0;
  } catch (e) {
    if (!isMissingSchemaError(e)) throw e;
    formationUnavailable = 'SCHEMA_MISSING';
  }

  return ok(computeGuideReport({
    rows, from, to, timeZone, truncated, priorCustomerIds, departures, departuresTruncated, formationUnavailable, asOf: new Date(requestStartedAt).toISOString(),
    tripNames, planNames,
  }));
});
