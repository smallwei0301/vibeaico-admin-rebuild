// POST /api/trip-departures/[id]/formation-decision — REVIEW_REQUIRED 團次的導遊決策（Issue #41，18 分冊 §6）。
//   { decision: 'FORM' }                          → FORMED（formed_by=GUIDE_OVERRIDE）
//   { decision: 'EXTEND', newDeadline: ISO }      → 新截止時間、回 COLLECTING
//   { decision: 'CONTINUE' }                      → AT_RISK 繼續出團：回 FORMED，原成團證據不變、不重新計價
// 權限：租戶 MANAGER 以上（與其他 trip_departures 寫入相同）。tenant_id 明確帶入每個查詢；
// 狀態轉移用 CAS（FORM／EXTEND 要求 REVIEW_REQUIRED，CONTINUE 要求 AT_RISK），被別人先改掉 → 409，不覆寫。
import { z } from 'zod';
import { ApiHttpError, ERR, fail, handle, ok } from '@/server/http';
import { requireTenantManager } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { mapTripDeparture } from '@/server/mappers';
import { readDepartureFormationTimeZone } from '@/server/departure-formation-snapshot';
import {
  DECISION_FROM_STATUS, FormationDecisionError, buildContinuePatch, buildExtendPatch, buildFormPatch, effectiveParticipants, formationDecisionSchema, type ParticipantOrderRow,
} from '@/lib/departure-formation-decision';

type Context = { params: Promise<{ id: string }> };
const idSchema = z.string().uuid();
const PAGE = 1000;
const MAX_ORDERS = 5000;

/** 純邏輯的規則錯誤 → 400（validation） */
function toHttp<T>(fn: () => T): T {
  try { return fn(); } catch (e) {
    if (e instanceof FormationDecisionError) throw new ApiHttpError(400, e.message, ERR.VALIDATION);
    throw e;
  }
}

export const POST = handle(async (req, { params }: Context) => {
  const id = idSchema.parse((await params).id);
  const t = await requireTenantManager();
  await requireFeature(t.tenantId, 'TOUR_MODULE');
  const body = formationDecisionSchema.parse(await req.json());

  const { data: current, error: readError } = await t.supabase.from('trip_departures').select('*')
    .eq('tenant_id', t.tenantId).eq('id', id).maybeSingle();
  if (readError) throw readError;
  if (!current) return fail(404, '找不到此團次', ERR.NOT_FOUND);
  if (current.status === 'CANCELLED') return fail(409, '此團次已取消，無法做成團決策', ERR.CONFLICT);
  const fromStatus = DECISION_FROM_STATUS[body.decision];
  if (current.formation_status !== fromStatus) {
    return fail(409, '此團次的成團狀態已變更，請重新整理後再確認', ERR.CONFLICT);
  }

  const now = Date.now();
  let patch: Record<string, unknown>;
  if (body.decision === 'FORM') {
    const orders: ParticipantOrderRow[] = [];
    for (let lastId: string | null = null; ;) {
      let q = t.supabase.from('tour_orders')
        .select('id, status, party_size, paid_amount, refunded_amount, payment_status, upfront_required_amount, deposit_mode_snapshot')
        .eq('tenant_id', t.tenantId).eq('departure_id', id).neq('status', 'CANCELLED');
      if (lastId) q = q.gt('id', lastId);
      const { data, error } = await q.order('id', { ascending: true }).limit(PAGE);
      if (error) throw error;
      const rows = (data ?? []) as (ParticipantOrderRow & { id: string })[];
      orders.push(...rows);
      if (orders.length > MAX_ORDERS) throw new ApiHttpError(422, '此團次訂單過多，無法計算成團人數', ERR.VALIDATION);
      if (rows.length < PAGE) break;
      lastId = rows[rows.length - 1].id;
    }
    // 注意：有效人數在此先算、下方 CAS update 才寫入，兩者不在同一交易；期間若發生退款，formed_participants 可能略為過時。
    // 可接受：該數字是導遊做決策當下的證據快照（GUIDE_OVERRIDE），CAS 仍保證狀態轉移原子；
    // 要做到同交易精準需 RPC／migration，屬 #755 之後。
    // formation_decided_by＝requireTenantManager 回傳的 auth user（代登入時是代入的平台管理者本人，仍是 auth.users 的一列）
    patch = toHttp(() => buildFormPatch(effectiveParticipants(orders), t.user.id, new Date(now).toISOString()));
  } else if (body.decision === 'CONTINUE') {
    // 只改團次成團狀態與決策證據；不讀、不寫 tour_orders（剩餘旅客維持各自成交價格與付款承諾，不重新計價）
    patch = buildContinuePatch(t.user.id, new Date(now).toISOString());
  } else {
    const zone = await readDepartureFormationTimeZone(t.supabase, t.tenantId);
    patch = toHttp(() => buildExtendPatch(current, body.newDeadline, zone, t.user.id, now));
  }

  // CAS：只在仍是 REVIEW_REQUIRED（且未取消）時寫入；零列 → 已被改動 → 409
  const { data: updated, error } = await t.supabase.from('trip_departures').update(patch)
    .eq('tenant_id', t.tenantId).eq('id', id)
    .eq('formation_status', fromStatus).neq('status', 'CANCELLED')
    .select('*, trip_plans(name)').maybeSingle();
  if (error) throw error;
  if (!updated) return fail(409, '此團次的成團狀態已變更，請重新整理後再確認', ERR.CONFLICT);
  return ok(mapTripDeparture(updated));
});
