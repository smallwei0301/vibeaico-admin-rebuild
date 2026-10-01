import { ApiHttpError, ERR } from '@/server/http';

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

/**
 * Snapshot only at creation. GUIDE currently uses fixed Asia/Taipei (+08:00),
 * matching the existing departure availability path. This bounded slice does
 * not implement configurable timezone resolution for formation snapshots.
 * A missing time means the start of that local day, as in departureInterval.
 * Plan columns are NOT NULL with canonical defaults 1/7: missing/invalid values
 * here indicate a broken read/contract, and must not become invented defaults.
 */
export function departureFormationSnapshot(plan: FormationPlan, departure: NewDeparture, now = Date.now()) {
  const min = plan.min_to_depart;
  const days = plan.formation_deadline_days_before;
  const invalid = (message: string): never => { throw new ApiHttpError(400, message, ERR.VALIDATION); };
  if (typeof min !== 'number' || !Number.isInteger(min) || min < 1) invalid('方案最低成團人數無效，請確認方案設定');
  if (typeof days !== 'number' || !Number.isInteger(days) || days < 0 || days > 90) invalid('方案成團截止天數無效，請確認方案設定');
  if (!Number.isInteger(departure.capacity) || departure.capacity < (min as number)) {
    invalid(`團次名額不得少於最低成團人數 ${min}`);
  }

  const departureMs = Date.parse(`${departure.departsOn}T${departure.startTime || '00:00'}+08:00`);
  if (!Number.isFinite(departureMs)) invalid('團次出發日期或時間無效');
  let deadlineMs = departureMs - (days as number) * 24 * 60 * 60 * 1000;
  if (departure.formationDeadlineAt !== undefined) {
    // Explicit offset prevents browser/server host timezone from deciding the instant.
    if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(departure.formationDeadlineAt)) invalid('成團截止時間須包含時區');
    deadlineMs = Date.parse(departure.formationDeadlineAt);
    if (!Number.isFinite(deadlineMs)) invalid('成團截止時間無效');
  }
  if (deadlineMs <= now) {
    invalid(`${departure.departsOn} 距出發不足預設天數，請選擇新的成團截止時間並確認（台北時間）`);
  }
  if (deadlineMs > departureMs) invalid('成團截止時間不得晚於團次出發時間');
  return {
    formation_status: 'COLLECTING' as const,
    min_to_depart_snapshot: min as number,
    formation_deadline_at: new Date(deadlineMs).toISOString(),
  };
}
