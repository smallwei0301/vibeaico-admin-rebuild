/**
 * 人員可用性共用核心（#37；10-TOUR-DOMAIN.md §5.3）。
 *
 * 所有候選時間都先轉成 UTC interval，再由這個純函式判斷；booking 的
 * available-slots 與團次單筆／批次建立不可各自重寫重疊規則。
 */
export type AvailabilityPolicy = 'DEFAULT_AVAILABLE' | 'EXPLICIT_ONLY';
export type AvailabilityReason = 'SHIFT' | 'BOOKING' | 'BLOCK' | 'DEPARTURE';

export type AvailabilityInterval = { start: string; end: string };
export type AvailabilityStaff = { id: string; name: string; availabilityPolicy: AvailabilityPolicy };
export type AvailabilityBooking = AvailabilityInterval & { staffId: string | null };
export type AvailabilityBlock = AvailabilityInterval & { staffId: string | null };
export type AvailabilityDeparture = AvailabilityInterval & {
  id: string;
  staffIds: string[];
  status: 'OPEN' | 'CLOSED' | 'CANCELLED';
};
export type AvailabilityConflict = {
  reason: AvailabilityReason;
  conflictStart?: string;
  conflictEnd?: string;
};
export type StaffAvailability = {
  staffId: string;
  available: boolean;
  conflicts: AvailabilityConflict[];
};
export type AvailabilityInput = {
  staff: AvailabilityStaff;
  interval: AvailabilityInterval;
  shifts: Array<AvailabilityInterval & { staffId: string }>;
  bookings: AvailabilityBooking[];
  blocks: AvailabilityBlock[];
  departures: AvailabilityDeparture[];
  /** 編輯團次時不能把自己當作衝突。 */
  excludeDepartureId?: string;
};

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

export function overlaps(a: AvailabilityInterval, b: AvailabilityInterval): boolean {
  return Date.parse(a.start) < Date.parse(b.end) && Date.parse(a.end) > Date.parse(b.start);
}

/** 台北 date + HH:mm + duration → UTC；空時間為該台北日整日占用。 */
export function departureInterval(
  departsOn: string,
  startTime: string | null | undefined,
  durationMinutes: number,
): AvailabilityInterval {
  const [year, month, day] = departsOn.split('-').map(Number);
  const dayStart = Date.UTC(year, month - 1, day) - TAIPEI_OFFSET_MS;
  if (!startTime) {
    return {
      start: new Date(dayStart).toISOString(),
      end: new Date(dayStart + 24 * 60 * 60 * 1000).toISOString(),
    };
  }
  const [hour, minute] = startTime.split(':').map(Number);
  const start = dayStart + (hour * 60 + minute) * 60_000;
  return {
    start: new Date(start).toISOString(),
    end: new Date(start + durationMinutes * 60_000).toISOString(),
  };
}

/**
 * 僅回事實衝突：前端可顯示原因，route 則用同一結果做最後儲存前驗證。
 * DEFAULT_AVAILABLE 的 shift 不設門檻；EXPLICIT_ONLY 必須被一段班表完整涵蓋。
 */
export function evaluateStaffAvailability(input: AvailabilityInput): StaffAvailability {
  const { staff, interval } = input;
  const conflicts: AvailabilityConflict[] = [];

  if (staff.availabilityPolicy === 'EXPLICIT_ONLY' && !input.shifts.some((shift) =>
    shift.staffId === staff.id
      && Date.parse(shift.start) <= Date.parse(interval.start)
      && Date.parse(shift.end) >= Date.parse(interval.end))) {
    conflicts.push({ reason: 'SHIFT' });
  }

  for (const booking of input.bookings) {
    if (booking.staffId === staff.id && overlaps(interval, booking)) {
      conflicts.push({ reason: 'BOOKING', conflictStart: booking.start, conflictEnd: booking.end });
    }
  }
  for (const block of input.blocks) {
    if ((block.staffId === null || block.staffId === staff.id) && overlaps(interval, block)) {
      conflicts.push({ reason: 'BLOCK', conflictStart: block.start, conflictEnd: block.end });
    }
  }
  for (const departure of input.departures) {
    if (departure.id !== input.excludeDepartureId && departure.status !== 'CANCELLED'
      && departure.staffIds.includes(staff.id) && overlaps(interval, departure)) {
      conflicts.push({ reason: 'DEPARTURE', conflictStart: departure.start, conflictEnd: departure.end });
    }
  }

  return { staffId: staff.id, available: conflicts.length === 0, conflicts };
}

/**
 * Route adapter: read the four occupancy sources once, then delegate every
 * candidate to the pure evaluator above.  `supabase` is intentionally narrow
 * (`any`) because this repository has no generated Database type yet.
 */
export async function loadStaffAvailability(params: {
  supabase: any;
  tenantId: string;
  date: string;
  staff: AvailabilityStaff[];
  interval: AvailabilityInterval;
  excludeDepartureId?: string;
}): Promise<StaffAvailability[]> {
  const [year, month, day] = params.date.split('-').map(Number);
  const dayStartMs = Date.UTC(year, month - 1, day) - TAIPEI_OFFSET_MS;
  const dayStart = new Date(dayStartMs).toISOString();
  const dayEnd = new Date(dayStartMs + 24 * 60 * 60 * 1000).toISOString();
  const [{ data: bookings, error: bookingError }, { data: blocks, error: blockError },
    { data: shifts, error: shiftError }, { data: assignments, error: assignmentError }] = await Promise.all([
    params.supabase.from('bookings').select('staff_id, start_at, end_at')
      .eq('tenant_id', params.tenantId).in('status', ['PENDING', 'CONFIRMED'])
      .lt('start_at', dayEnd).gt('end_at', dayStart),
    // Weekly blocks are expanded in Node, exactly as available-slots already did.
    params.supabase.from('block_times').select('staff_id, start_at, end_at, recurrence, day_of_week')
      .eq('tenant_id', params.tenantId),
    params.supabase.from('shifts').select('staff_id, start_time, end_time')
      .eq('tenant_id', params.tenantId).eq('work_date', params.date),
    params.supabase.from('trip_departure_staff')
      .select('staff_id, trip_departures!inner(id, departs_on, start_time, status, trip_plans!inner(duration_minutes))')
      .eq('tenant_id', params.tenantId),
  ]);
  if (bookingError) throw bookingError;
  if (blockError) throw blockError;
  if (shiftError) throw shiftError;
  if (assignmentError) throw assignmentError;

  // Import here keeps the pure evaluator independent from the existing
  // recurrence helper while preserving one expansion rule for both callers.
  const { expandWeeklyBlock } = await import('@/server/business-hours-blocks');
  const blockRanges: AvailabilityBlock[] = [];
  for (const block of blocks ?? []) {
    if ((block.recurrence ?? 'SINGLE') === 'WEEKLY') {
      for (const occurrence of expandWeeklyBlock(block, dayStart, dayEnd)) {
        blockRanges.push({ staffId: block.staff_id, start: occurrence.start, end: occurrence.end });
      }
    } else if (Date.parse(block.start_at) < Date.parse(dayEnd) && Date.parse(block.end_at) > Date.parse(dayStart)) {
      blockRanges.push({ staffId: block.staff_id, start: block.start_at, end: block.end_at });
    }
  }

  const departureMap = new Map<string, AvailabilityDeparture>();
  for (const assignment of assignments ?? []) {
    const departure = Array.isArray(assignment.trip_departures)
      ? assignment.trip_departures[0] : assignment.trip_departures;
    if (!departure) continue;
    const plan = Array.isArray(departure.trip_plans) ? departure.trip_plans[0] : departure.trip_plans;
    if (!plan) continue;
    const existing = departureMap.get(departure.id);
    if (existing) {
      existing.staffIds.push(assignment.staff_id);
      continue;
    }
    const interval = departureInterval(departure.departs_on, departure.start_time, Number(plan.duration_minutes));
    departureMap.set(departure.id, {
      id: departure.id, status: departure.status, start: interval.start, end: interval.end,
      staffIds: [assignment.staff_id],
    });
  }

  const shiftRanges = (shifts ?? []).map((shift: any) => ({
    staffId: shift.staff_id,
    ...departureInterval(params.date, shift.start_time, minutesBetween(shift.start_time, shift.end_time)),
  }));
  const bookingRanges = (bookings ?? []).map((booking: any) => ({
    staffId: booking.staff_id, start: booking.start_at, end: booking.end_at,
  }));

  return params.staff.map((staff) => evaluateStaffAvailability({
    staff,
    interval: params.interval,
    shifts: shiftRanges,
    bookings: bookingRanges,
    blocks: blockRanges,
    departures: [...departureMap.values()],
    excludeDepartureId: params.excludeDepartureId,
  }));
}

function minutesBetween(start: string, end: string): number {
  const [startHour, startMinute] = start.split(':').map(Number);
  const [endHour, endMinute] = end.split(':').map(Number);
  return (endHour * 60 + endMinute) - (startHour * 60 + startMinute);
}
