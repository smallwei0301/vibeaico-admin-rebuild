/**
 * GET /api/promotion/stats?range=7|30|90 — 推廣成效統計（Issue #23）
 * -----------------------------------------------------------------------------
 * 租戶範圍（`requireTenant()`）＋ query-time aggregation（Owner Decision
 * 2026-09-14：第一版直接對 `page_view_events` count / distinct，不先建預聚合
 * 日表）。`uv` = 統計範圍內 distinct `visitor_hash` 數，`approximate` 永遠是
 * true——這是匿名近似值，不是精準去重人口計數。
 *
 * 零資料時回傳 Issue #23 的零資料 contract 逐字：
 * `{ pv: 0, uv: 0, bySource: [], byDay: [], approximate: true, hasData: false }`。
 */
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { taipeiDateKey } from '@/server/promotion-visitor-hash';
import type { PromotionDayStat, PromotionSourceStat, PromotionStats } from '@/lib/types';

const RANGE_DAYS = { '7': 7, '30': 30, '90': 90 } as const;
type RangeKey = keyof typeof RANGE_DAYS;

function parseRangeDays(raw: string | null): number {
  if (raw !== null && Object.prototype.hasOwnProperty.call(RANGE_DAYS, raw)) {
    return RANGE_DAYS[raw as RangeKey];
  }
  // 不合法或缺省一律退回 7 天，不 400——這是 UI 下拉選單餵進來的值，不是使用者
  // 自由輸入的欄位，退回一個合理預設比讓整頁報表噴錯更有用。
  return RANGE_DAYS['7'];
}

export const GET = handle(async (req: Request) => {
  const t = await requireTenant();
  const url = new URL(req.url);
  const days = parseRangeDays(url.searchParams.get('range'));

  const fromIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await t.supabase
    .from('page_view_events')
    .select('source, visitor_hash, created_at')
    .eq('tenant_id', t.tenantId)
    .gte('created_at', fromIso);
  if (error) throw error;

  const rows = data ?? [];
  const pv = rows.length;
  const uv = new Set(rows.map((r) => r.visitor_hash as string)).size;

  const bySourceAgg = new Map<string, { pv: number; visitors: Set<string> }>();
  const byDayAgg = new Map<string, { pv: number; visitors: Set<string> }>();

  for (const row of rows) {
    const source = (row.source as string) || 'DIRECT';
    const visitorHash = row.visitor_hash as string;
    // 事件的 created_at 是 UTC timestamptz；用台北曆日分組，才不會讓台北時間
    // 00:00–08:00 之間的瀏覽被算進「前一天」的趨勢裡（與 src/server/tz.ts 同一個
    // +8 常數來源的道理）。
    const dayKey = taipeiDateKey(new Date(row.created_at as string));

    const s = bySourceAgg.get(source) ?? { pv: 0, visitors: new Set<string>() };
    s.pv += 1;
    s.visitors.add(visitorHash);
    bySourceAgg.set(source, s);

    const d = byDayAgg.get(dayKey) ?? { pv: 0, visitors: new Set<string>() };
    d.pv += 1;
    d.visitors.add(visitorHash);
    byDayAgg.set(dayKey, d);
  }

  const bySource: PromotionSourceStat[] = [...bySourceAgg.entries()]
    .map(([source, v]) => ({ source, pv: v.pv, uv: v.visitors.size }))
    .sort((a, b) => b.pv - a.pv);

  const byDay: PromotionDayStat[] = [...byDayAgg.entries()]
    .map(([day, v]) => ({ day, pv: v.pv, uv: v.visitors.size }))
    .sort((a, b) => a.day.localeCompare(b.day));

  const stats: PromotionStats = {
    pv,
    uv,
    bySource,
    byDay,
    approximate: true,
    hasData: pv > 0,
  };
  return ok(stats);
});
