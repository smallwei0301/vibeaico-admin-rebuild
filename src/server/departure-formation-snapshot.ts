import { ApiHttpError, ERR } from '@/server/http';
import type { SupabaseClient } from '@supabase/supabase-js';
import { formationDefaultDeadline, formationTimeZone, formationWallTimeToIso } from '@/lib/departure-formation-time';

type FormationPlan = {
  min_to_depart: unknown;
  formation_deadline_days_before: unknown;
};
type NewDeparture = {
  departsOn: string;
  startTime?: string | null;
  capacity: number;
  formationDeadlineAt?: string;
};

/** Read only the canonical basic settings of the authenticated tenant. */
export async function readDepartureFormationTimeZone(db: SupabaseClient, tenantId: string, expected?: string): Promise<string> {
  const { data, error } = await db.from('tenant_settings').select('basic').eq('tenant_id', tenantId).maybeSingle();
  if (error) throw error;
  let zone: string;
  try {
    if (data?.basic != null && (typeof data.basic !== 'object' || Array.isArray(data.basic))) throw new Error('店家基本設定無效');
    zone = formationTimeZone(data?.basic?.timezone);
  } catch (error) {
    throw new ApiHttpError(400, (error as Error).message, ERR.VALIDATION);
  }
  if (expected !== undefined && expected !== zone) throw new ApiHttpError(409, '店家時區設定已變更，請重新載入後確認成團截止時間', ERR.CONFLICT);
  return zone;
}

const invalid = (message: string): never => { throw new ApiHttpError(400, message, ERR.VALIDATION); };
function departureInstant(date: string, time: string | null | undefined, zone: string): number {
  try { return Date.parse(formationWallTimeToIso(date, time, zone)); }
  catch (error) { return invalid((error as Error).message); }
}
function confirmedDeadline(value: string, departureMs: number, now: number): string {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) invalid('成團截止時間須包含時區');
  const deadlineMs = Date.parse(value);
  if (!Number.isFinite(deadlineMs)) invalid('成團截止時間無效');
  if (deadlineMs <= now) invalid('成團截止時間須晚於現在，請選擇新的成團截止時間並確認');
  if (deadlineMs > departureMs) invalid('成團截止時間不得晚於團次出發時間');
  return new Date(deadlineMs).toISOString();
}

/** Creation snapshots use tenant calendar days and never rewrite earlier rows. */
export function departureFormationSnapshot(plan: FormationPlan, departure: NewDeparture, now = Date.now(), timeZone = formationTimeZone(undefined)) {
  const min = plan.min_to_depart;
  const days = plan.formation_deadline_days_before;
  if (typeof min !== 'number' || !Number.isInteger(min) || min < 1) invalid('方案最低成團人數無效，請確認方案設定');
  if (typeof days !== 'number' || !Number.isInteger(days) || days < 0 || days > 90) invalid('方案成團截止天數無效，請確認方案設定');
  if (!Number.isInteger(departure.capacity) || departure.capacity < (min as number)) {
    invalid(`團次名額不得少於最低成團人數 ${min}`);
  }

  const departureMs = departureInstant(departure.departsOn, departure.startTime, timeZone);
  let deadline: string;
  if (departure.formationDeadlineAt !== undefined) {
    deadline = confirmedDeadline(departure.formationDeadlineAt, departureMs, now);
  } else {
    try { deadline = formationDefaultDeadline(departure.departsOn, departure.startTime, days as number, timeZone); }
    catch (error) { return invalid((error as Error).message); }
    if (Date.parse(deadline) <= now) {
      invalid(`${departure.departsOn} 距出發不足預設天數，請選擇新的成團截止時間並確認（${timeZone}）`);
    }
  }
  return {
    formation_status: 'COLLECTING' as const,
    min_to_depart_snapshot: min as number,
    formation_deadline_at: deadline,
  };
}

/** Edit the immutable departure snapshot only on an explicit cutoff override. */
export function departureFormationUpdate(current: {
  departs_on: string; start_time: string | null; formation_deadline_at: string | null;
  min_to_depart_snapshot: number; seats_booked: number;
}, body: { departsOn?: string; startTime?: string | null; capacity?: number; formationDeadlineAt?: string },
zone: string, now = Date.now()): Record<string, unknown> {
  if (body.capacity !== undefined) {
    if (!Number.isInteger(current.min_to_depart_snapshot) || current.min_to_depart_snapshot < 1) invalid('此團次的成團門檻無效，請確認團次資料');
    if (body.capacity < current.min_to_depart_snapshot) invalid(`名額不得少於此團次最低成團人數（${current.min_to_depart_snapshot} 人）`);
    if (body.capacity < current.seats_booked) invalid(`名額不得少於已報名人數（${current.seats_booked} 人）`);
  }
  const oldTime = current.start_time ? String(current.start_time).slice(0, 5) : null;
  const nextTime = body.startTime === undefined ? oldTime : body.startTime || null;
  const changed = (body.departsOn !== undefined && body.departsOn !== current.departs_on) || nextTime !== oldTime;
  if (!changed && body.formationDeadlineAt === undefined) return {};
  const start = departureInstant(body.departsOn ?? current.departs_on, nextTime, zone);
  if (body.formationDeadlineAt !== undefined) return { formation_deadline_at: confirmedDeadline(body.formationDeadlineAt, start, now) };
  if (current.formation_deadline_at == null) invalid('此團次尚未設定成團截止時間，改期時請選擇新的成團截止時間並確認');
  const existing = Date.parse(current.formation_deadline_at!);
  if (!Number.isFinite(existing) || existing > start) invalid('既有成團截止時間晚於新出發時間，請選擇新的成團截止時間並確認');
  return {};
}
