/**
 * GET /api/cron/formation-deadline — 成團截止自動推進（Issue #41，18 分冊 §6）。
 *
 * 到 formation_deadline_at 仍是 COLLECTING 的團次：
 *   有效人數 ≥ min_to_depart_snapshot → FORMED（formed_by='SYSTEM'，證據 formed_at／formed_participants 齊備，
 *                                        滿足 0107 的 trip_departures_formed_evidence_ck）
 *   有效人數 <  min_to_depart_snapshot → REVIEW_REQUIRED（通知導遊由收件匣卡片自然顯示；不自動取消、不發通知）
 * 只做 deadline sweep；下單當下「達標即時轉 FORMED」是另一片。
 *
 * 有效人數沿用 #41 的 effectiveParticipants（18 §5：淨已付、排除 REFUND_PENDING／REFUNDED／CANCELLED）。
 *
 * 時間差：人數在 CAS update 之前先算，兩者不在同一交易；期間若發生退款，formed_participants 可能略為過時。
 * 與 formation-decision route 一致——它是「宣布當下」的證據快照，CAS 仍保證狀態轉移原子（只有仍是 COLLECTING 的才寫）。
 *
 * 冪等：CAS 回 0 列（已被導遊／另一輪處理、已取消）視為跳過，不報錯。
 * 分頁終止條件不依賴 PostgREST max_rows（見 src/server/tour-order-no.ts 的 N2）：用 id keyset，只有空頁才算掃完。
 * 只處理尚未出發的團次（店家時區逐列判斷；查詢層以 UTC 今天-1 日保守預篩）：已出發卻仍 COLLECTING 的異常團次不推進，
 *   否則推成 REVIEW_REQUIRED 後導遊無法 EXTEND。跳過者計入 skipped。
 * CAS 同時比對 formation_deadline_at <= 本輪 now：選出後導遊延後截止則不命中。
 * 開關：FORMATION_DEADLINE_SWEEP_ENABLED !== 精確 'true' → 200 { skipped: 'disabled' }，不讀不寫。
 * Schema 缺欄位／表（42703／42P01／PGRST200／204／205）→ 整個 sweep 降級為 no-op（200 + warn），不 500。
 * log 不含個資（只印 id 與計數）。
 * maxDuration = 60 秒：須大於 MAX_RUN_MS（45 秒）並留出收尾餘裕，確保自我截斷發生在平台強制中止之前。
 */
import { NextResponse } from 'next/server';
import { createAdminSupabase } from '@/server/supabase';
import { getGuideDepartureDueAt, normalizeGuideTimeZone } from '@/lib/guide-action-inbox';
import { effectiveParticipants, type ParticipantOrderRow } from '@/lib/departure-formation-decision';

export const runtime = 'nodejs';
export const maxDuration = 60;

const PAGE = 200;
const ORDER_PAGE = 1000;
const MAX_ORDERS_PER_DEPARTURE = 5000;
/** 一輪最多處理的團次數與時間上限；觸頂就停並標 truncated，剩下的下一輪接手 */
const MAX_DEPARTURES = 500;
const MAX_RUN_MS = 45_000;
const SCHEMA_MISSING_CODES = new Set(['42703', '42P01', 'PGRST200', 'PGRST204', 'PGRST205']);

const isSchemaMissing = (e: unknown) => SCHEMA_MISSING_CODES.has(String((e as { code?: unknown } | null)?.code ?? ''));

class SchemaMissing extends Error {}

type DepartureRow = {
  id: string; tenant_id: string; min_to_depart_snapshot: number | string | null;
  departs_on: string | null; start_time: string | null;
};

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`)
    return new Response('unauthorized', { status: 401 });
  if (process.env.FORMATION_DEADLINE_SWEEP_ENABLED !== 'true')
    return NextResponse.json({ skipped: 'disabled' });

  const admin = createAdminSupabase();
  const startedAt = Date.now();
  const nowIso = new Date(startedAt).toISOString();
  const result = { scanned: 0, formed: 0, reviewRequired: 0, skipped: 0, truncated: false };

  const countParticipants = async (tenantId: string, departureId: string): Promise<number | null> => {
    const orders: ParticipantOrderRow[] = [];
    for (let lastId: string | null = null; ;) {
      let q = admin.from('tour_orders')
        .select('id, status, party_size, paid_amount, refunded_amount, payment_status, upfront_required_amount, deposit_mode_snapshot')
        .eq('tenant_id', tenantId).eq('departure_id', departureId).neq('status', 'CANCELLED');
      if (lastId) q = q.gt('id', lastId);
      const { data, error } = await q.order('id', { ascending: true }).limit(ORDER_PAGE);
      if (error) { if (isSchemaMissing(error)) throw new SchemaMissing(); throw error; }
      const rows = (data ?? []) as (ParticipantOrderRow & { id: string })[];
      if (rows.length === 0) break; // 只有空頁才算掃完（N2）
      orders.push(...rows);
      if (orders.length > MAX_ORDERS_PER_DEPARTURE) return null;
      lastId = rows[rows.length - 1].id;
    }
    return effectiveParticipants(orders);
  };

  const tzCache = new Map<string, string>();
  const tenantTimeZone = async (tenantId: string): Promise<string> => {
    const hit = tzCache.get(tenantId);
    if (hit) return hit;
    const { data, error } = await admin.from('tenant_settings').select('basic').eq('tenant_id', tenantId).maybeSingle();
    if (error && !isSchemaMissing(error)) throw error;
    const basic = (data as { basic?: unknown } | null)?.basic;
    const raw = basic && typeof basic === 'object' && !Array.isArray(basic) ? (basic as Record<string, unknown>).timezone : undefined;
    const tz = normalizeGuideTimeZone(raw);
    tzCache.set(tenantId, tz);
    return tz;
  };
  const localDay = (tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(startedAt));
  // 店家時區最西為 UTC-12：其「今天」不會早於 UTC 今天的前一天，故以此作保守預篩
  const utcFloor = new Date(startedAt - 86_400_000).toISOString().slice(0, 10);

  try {
    let lastId: string | null = null;
    outer: for (;;) {
      let q = admin.from('trip_departures')
        .select('id, tenant_id, min_to_depart_snapshot, departs_on, start_time')
        .eq('formation_status', 'COLLECTING').neq('status', 'CANCELLED')
        .not('formation_deadline_at', 'is', null).lte('formation_deadline_at', nowIso)
        .gte('departs_on', utcFloor);
      if (lastId) q = q.gt('id', lastId);
      const { data, error } = await q.order('id', { ascending: true }).limit(PAGE);
      if (error) { if (isSchemaMissing(error)) throw new SchemaMissing(); throw error; }
      const rows = (data ?? []) as DepartureRow[];
      if (rows.length === 0) break;
      lastId = rows[rows.length - 1].id;

      for (const dep of rows) {
        if (result.scanned >= MAX_DEPARTURES || Date.now() - startedAt > MAX_RUN_MS) {
          result.truncated = true;
          console.warn('[cron] formation-deadline: 觸頂（團次數或時間上限），剩餘留給下一輪', result.scanned);
          break outer;
        }
        result.scanned++;
        try {
          const tz = await tenantTimeZone(dep.tenant_id);
          const day = dep.departs_on ? String(dep.departs_on).slice(0, 10) : null;
          const ahead = !day ? false
            : dep.start_time ? Date.parse(getGuideDepartureDueAt(day, dep.start_time, tz)) > startedAt
            : day >= localDay(tz);
          if (!ahead) {
            result.skipped++;
            continue;
          }
          const participants = await countParticipants(dep.tenant_id, dep.id);
          if (participants === null) {
            result.skipped++;
            console.warn('[cron] formation-deadline: 訂單過多，略過', dep.tenant_id, dep.id);
            continue;
          }
          const min = Math.max(1, Number(dep.min_to_depart_snapshot) || 1);
          const formed = participants >= min;
          const patch = formed
            ? { formation_status: 'FORMED', formed_at: nowIso, formed_by: 'SYSTEM', formed_participants: participants }
            : { formation_status: 'REVIEW_REQUIRED' };
          // CAS：只在仍是 COLLECTING（且未取消）時寫入；0 列 = 已被他人處理，冪等跳過
          const { data: updated, error: upError } = await admin.from('trip_departures').update(patch)
            .eq('id', dep.id).eq('tenant_id', dep.tenant_id)
            .eq('formation_status', 'COLLECTING').neq('status', 'CANCELLED')
            .lte('formation_deadline_at', nowIso)
            .select('id');
          if (upError) { if (isSchemaMissing(upError)) throw new SchemaMissing(); throw upError; }
          if (!updated || updated.length === 0) result.skipped++;
          else if (formed) result.formed++;
          else result.reviewRequired++;
        } catch (e) {
          if (e instanceof SchemaMissing) throw e;
          result.skipped++;
          console.error('[cron] formation-deadline: 單筆失敗', dep.tenant_id, dep.id, e);
        }
      }
    }
  } catch (e) {
    if (e instanceof SchemaMissing) {
      console.warn('[cron] formation-deadline: schema 尚未就緒，整體降級為 no-op');
      return NextResponse.json({ degraded: 'schema-missing', ...result });
    }
    console.error('[cron] formation-deadline: 查詢失敗', e);
    return new Response('query failed', { status: 500 });
  }

  return NextResponse.json(result);
}
