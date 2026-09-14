import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import {
  buildGuideActionInboxFormationItem,
  isGuideActionInboxFormationStatus,
  normalizeGuideTimeZone,
  sortGuideActionInboxItems,
  type GuideActionInboxFormationItem,
} from '@/lib/guide-action-inbox';

type RelatedName = { name?: string | null; title?: string | null } | { name?: string | null; title?: string | null }[] | null;

function relatedValue(value: RelatedName): { name?: string | null; title?: string | null } | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

/**
 * GUIDE 行動收件匣 #43 類別 3／4：
 *   3. REVIEW_REQUIRED — 成團截止不足，需要決定。
 *   4. AT_RISK          — 已成團後人數跌破門檻，需要決定。
 *
 * 唯一真相是 `trip_departures.formation_status`（`supabase/migrations/0107_issue_41_formation_state_model.sql`，
 * #41 canonical）。這支 handler 只讀該欄位與其伴隨的 snapshot 欄位，不重新推算成團與否、
 * 不建立平行狀態機，也不觸發通知、付款或其他外部副作用——那些是 0107 註記明確保留給
 * 日後 transaction 切片的工作。
 *
 * 獨立成一支 route（而不是併進 `../route.ts` 既有回應陣列）是刻意的：`../route.ts` 的
 * 回應型別被 `src/app/tenant/dashboard/page.tsx` 直接消費，該頁面用非窮盡的 kind 判斷
 * （非 BOOKING_REQUEST／BOOKING_PAYMENT 一律當 DEPARTURE），還不認得這兩種新 kind，
 * 而該頁面不在 #43 的 FILE_OWNERSHIP 內。串接進首頁 UI 留給擁有那個檔案的 lane 決定。
 */
export const GET = handle(async () => {
  const t = await requireTenant();
  const settingsResult = await t.supabase
    .from('tenant_settings')
    .select('basic')
    .eq('tenant_id', t.tenantId)
    .maybeSingle();
  if (settingsResult.error) throw settingsResult.error;
  const basic = settingsResult.data?.basic;
  const rawTimeZone = basic && typeof basic === 'object' && !Array.isArray(basic)
    ? (basic as Record<string, unknown>).timezone
    : undefined;
  const timeZone = normalizeGuideTimeZone(rawTimeZone);
  const now = new Date();

  const formationResult = await t.supabase
    .from('trip_departures')
    .select('id, trip_id, plan_id, departs_on, start_time, status, capacity, seats_booked, formation_status, formation_deadline_at, min_to_depart_snapshot, formed_participants, created_at, trips(title), trip_plans(name)')
    .eq('tenant_id', t.tenantId)
    .neq('status', 'CANCELLED')
    .in('formation_status', ['REVIEW_REQUIRED', 'AT_RISK'])
    .order('departs_on', { ascending: true })
    .order('start_time', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: true })
    .limit(20);
  if (formationResult.error) throw formationResult.error;

  const items: GuideActionInboxFormationItem[] = (formationResult.data ?? [])
    .map((row: any): GuideActionInboxFormationItem | null => {
      // 防禦性守衛：query 已用 `.in('formation_status', [...])` 篩過，這裡再擋一次是為了
      // 不讓型別不明的資料庫值悄悄變成一張假卡片；不符合就誠實地不顯示，不猜測分類。
      if (!isGuideActionInboxFormationStatus(row.formation_status)) return null;
      const trip = relatedValue(row.trips as RelatedName);
      const plan = relatedValue(row.trip_plans as RelatedName);
      const departureDate = String(row.departs_on).slice(0, 10);
      const startTime = row.start_time ? String(row.start_time).slice(0, 5) : '';
      return buildGuideActionInboxFormationItem({
        id: row.id,
        tripId: row.trip_id,
        tripName: trip?.title ?? '',
        planName: plan?.name ?? '',
        departureDate,
        startTime,
        capacity: row.capacity,
        seatsBooked: row.seats_booked,
        minToDepart: row.min_to_depart_snapshot ?? 1,
        formationStatus: row.formation_status,
        formationDeadlineAt: row.formation_deadline_at ?? null,
        formedParticipants: row.formed_participants ?? null,
        createdAt: row.created_at,
      }, now, timeZone);
    })
    .filter((item): item is GuideActionInboxFormationItem => item !== null);

  return ok(sortGuideActionInboxItems(items));
});
