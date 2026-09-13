/**
 * src/server/staff-availability.ts — 共用人員可用性引擎（issue #37 §5.3）
 * -----------------------------------------------------------------------------
 * 「一般預約」與「團次」原本各自算各自的空檔，於是同一位導遊可以在同一個時段
 * 被排進一場一般預約與兩個團次，三邊都不會有任何錯誤。`10-TOUR-DOMAIN.md` §5.3
 * 要求把判斷抽成一份，由三處共用：
 *
 *   - `/api/bookings/available-slots`
 *   - 團次單筆 create／update
 *   - 團次 batch create
 *
 * 「共用」在這裡是有具體意義的：撞班是**對稱**的。如果團次那側用 A 套規則、
 * 一般預約那側用 B 套，兩套只要有一點不一致，就會出現「開團時說沒撞、排一般
 * 預約時卻說撞了」這種店家無從理解的狀態。所以佔用區間的算法只有這一份。
 *
 * ## 這個檔的分工
 *
 * `loadStaffLoad()` 負責**讀**（唯一碰 DB 的地方），`findStaffConflicts()` 是
 * 純函式負責**判**。分開是為了讓判斷本身可以被單元測試直接餵資料驗證，不必
 * 起一個資料庫；也讓呼叫端可以一次讀、多天判（batch 開團就是這樣用的）。
 *
 * ## ⚠️ 團次佔用區間：規格寫 `plan.duration_minutes`，但那個欄位不存在
 *
 * `10-TOUR-DOMAIN.md` §5.3 寫「`end = start + plan.duration_minutes`」，但
 * `trip_plans` 從 `0066` 以來就**沒有** duration 欄位——時長掛在 `trips.duration_hours`
 * 上（同一個 migration 還把更早的 `trips.duration_minutes` 轉換過去）。這是規格
 * 與 schema 的分歧，本檔照**實際存在的欄位**實作，並在此標明，不假裝規格那個欄位存在。
 *
 * 時長無法得知時（`duration_hours` 為 null 或 <= 0）採**整日佔用**，與「沒有
 * start_time 的團次視為整日佔用」（§5.3）同一個處理。方向刻意偏保守：寧可多擋
 * 一個其實可以帶的團，也不要因為算不出結束時間就當作不佔用，讓同一位導遊被排
 * 進兩團。多擋店家看得到原因（回傳的衝突理由會說是哪一團），漏擋則是出團當天才發現。
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { queryEffectiveBlockTimes } from '@/server/block-times';

/** 台北時區固定 +8，全年無日光節約；與 `src/server/tz.ts`、available-slots 同一個常數。 */
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ConflictReason = 'SHIFT' | 'BOOKING' | 'BLOCK' | 'DEPARTURE';

export type StaffConflict = {
  staffId: string;
  reason: ConflictReason;
  /** 造成衝突的那一段時間；`SHIFT`（當日未排班）沒有具體區間，故為選填。 */
  conflictStart?: string;
  conflictEnd?: string;
  /** `DEPARTURE` 時為造成衝突的團次 id，方便畫面連過去。 */
  departureId?: string;
};

/** 一段 UTC 毫秒區間。 */
export type Interval = { start: number; end: number };

export type StaffLoad = {
  /** 一般預約（PENDING / CONFIRMED）。 */
  bookings: Array<{ staffId: string; start: number; end: number }>;
  /** 封鎖時段；`staffId` 為 null 代表全店封鎖。 */
  blocks: Array<{ staffId: string | null; start: number; end: number }>;
  /** 班表，已展開成 UTC 毫秒區間。 */
  shifts: Array<{ staffId: string; workDate: string; start: number; end: number }>;
  /** 該租戶「有班表資料」的日期集合（YYYY-MM-DD）。 */
  shiftDates: Set<string>;
  /** 其他非 CANCELLED 團次的佔用（PRIMARY 與 ASSISTANT 都算）。 */
  departures: Array<{ departureId: string; staffId: string; start: number; end: number }>;
};

/** 'HH:mm' 或 'HH:mm:ss' → 當日分鐘數。 */
export function hmToMin(value: string): number {
  const [h, m] = value.split(':');
  return Number(h) * 60 + Number(m);
}

/** 台北某日 00:00 對應的 UTC 毫秒。 */
export function taipeiDayStartMs(date: string): number {
  const [y, mo, d] = date.split('-').map(Number);
  return Date.UTC(y, mo - 1, d) - TAIPEI_OFFSET_MS;
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && a.end > b.start;
}

/**
 * 團次的佔用區間。
 *
 * - 有 `startTime` 且時長已知 → `[start, start + duration]`
 * - 其餘（沒有 startTime，或時長未知）→ 該日整日
 *
 * 回傳的 `wholeDay` 讓呼叫端能誠實告訴店家「這團被當成整天佔用」，而不是讓他
 * 看到一個憑空生出來的結束時間。
 */
export function departureInterval(input: {
  departsOn: string;
  startTime: string | null;
  durationHours: number | null;
}): Interval & { wholeDay: boolean } {
  const dayStart = taipeiDayStartMs(input.departsOn);
  const minutes = input.durationHours != null && input.durationHours > 0
    ? Math.round(input.durationHours * 60)
    : null;
  if (!input.startTime || minutes == null) {
    return { start: dayStart, end: dayStart + DAY_MS, wholeDay: true };
  }
  const start = dayStart + hmToMin(input.startTime) * 60_000;
  return { start, end: start + minutes * 60_000, wholeDay: false };
}

/**
 * 一次讀出區間內所有會造成撞班的負載。
 *
 * `excludeDepartureId` 是**編輯既有團次時必要的**：改團時要問的是「除了這團自己
 * 以外還有沒有衝突」，不排除的話任何一次「只改名額」的儲存都會被自己擋下來。
 */
export async function loadStaffLoad(
  supabase: SupabaseClient,
  tenantId: string,
  fromMs: number,
  toMs: number,
  options: { excludeDepartureId?: string } = {},
): Promise<StaffLoad> {
  const fromIso = new Date(fromMs).toISOString();
  const toIso = new Date(toMs).toISOString();
  const fromDate = new Date(fromMs + TAIPEI_OFFSET_MS).toISOString().slice(0, 10);
  const toDate = new Date(toMs + TAIPEI_OFFSET_MS).toISOString().slice(0, 10);

  const [bookingsRes, blocks, shiftsRes, assignRes] = await Promise.all([
    supabase.from('bookings').select('staff_id, start_at, end_at')
      .eq('tenant_id', tenantId).in('status', ['PENDING', 'CONFIRMED'])
      .lt('start_at', toIso).gt('end_at', fromIso),
    queryEffectiveBlockTimes(supabase, tenantId, fromIso, toIso),
    supabase.from('shifts').select('staff_id, work_date, start_time, end_time')
      .eq('tenant_id', tenantId).gte('work_date', fromDate).lte('work_date', toDate),
    supabase.from('trip_departure_staff')
      .select('departure_id, staff_id, trip_departures!inner(id, departs_on, start_time, status, trips!inner(duration_hours))')
      .eq('tenant_id', tenantId)
      .neq('trip_departures.status', 'CANCELLED')
      .gte('trip_departures.departs_on', fromDate)
      .lte('trip_departures.departs_on', toDate),
  ]);

  // ⚠️ PB-023：丟掉 Supabase 的 error 會讓「查詢失敗」冒充「查無資料」，而查無
  // 資料在這裡的意思是「沒有任何衝突」——一次 DB 故障就會變成一路放行的排班。
  if (bookingsRes.error) throw bookingsRes.error;
  if (shiftsRes.error) throw shiftsRes.error;
  if (assignRes.error) throw assignRes.error;

  const shiftDates = new Set<string>();
  const shifts: StaffLoad['shifts'] = [];
  for (const row of shiftsRes.data ?? []) {
    const dayStart = taipeiDayStartMs(row.work_date);
    shiftDates.add(row.work_date);
    shifts.push({
      staffId: row.staff_id,
      workDate: row.work_date,
      start: dayStart + hmToMin(row.start_time) * 60_000,
      end: dayStart + hmToMin(row.end_time) * 60_000,
    });
  }

  const departures: StaffLoad['departures'] = [];
  for (const row of (assignRes.data ?? []) as Array<Record<string, unknown>>) {
    const dep = (Array.isArray(row.trip_departures) ? row.trip_departures[0] : row.trip_departures) as
      undefined | { id: string; departs_on: string; start_time: string | null; trips?: unknown };
    if (!dep) continue;
    if (options.excludeDepartureId && dep.id === options.excludeDepartureId) continue;
    const trip = (Array.isArray(dep.trips) ? dep.trips[0] : dep.trips) as undefined | { duration_hours: number | null };
    const interval = departureInterval({
      departsOn: dep.departs_on,
      startTime: dep.start_time == null ? null : String(dep.start_time).slice(0, 5),
      durationHours: trip?.duration_hours ?? null,
    });
    departures.push({
      departureId: dep.id,
      staffId: String(row.staff_id),
      start: interval.start,
      end: interval.end,
    });
  }

  return {
    bookings: (bookingsRes.data ?? []).map((b) => ({
      staffId: b.staff_id, start: Date.parse(b.start_at), end: Date.parse(b.end_at),
    })),
    blocks: (blocks ?? []).map((b) => ({
      staffId: b.staff_id, start: Date.parse(b.start_at), end: Date.parse(b.end_at),
    })),
    shifts,
    shiftDates,
    departures,
  };
}

/**
 * 判斷一組人員能不能接下 `slot` 這段時間。純函式，不碰 DB。
 *
 * 回傳的是**衝突清單**而不是一個布林：`10-TOUR-DOMAIN.md` §5.1 明文要求
 * 「忙碌人員可顯示但不可儲存；錯誤必須說明衝突來源與時間，不只回 409」。
 * 一個布林沒辦法告訴店家「小美 09:00–12:00 已有預約」。
 *
 * `shiftDate` 為該時段所屬的台北日期。班表的既有慣例（available-slots §B-1 補充
 * 決策）是：該租戶當日**完全沒有**班表資料 → 視為全時段可排；當日有班表資料時，
 * 沒排班的員工視為不上班。這裡沿用同一條，不另立一套。
 */
export function findStaffConflicts(
  staffIds: string[],
  slot: Interval,
  shiftDate: string,
  load: StaffLoad,
): StaffConflict[] {
  const conflicts: StaffConflict[] = [];
  const tenantHasShiftsThatDay = load.shiftDates.has(shiftDate);

  for (const staffId of staffIds) {
    if (tenantHasShiftsThatDay) {
      const mine = load.shifts.filter((s) => s.staffId === staffId && s.workDate === shiftDate);
      const covered = mine.some((s) => s.start <= slot.start && slot.end <= s.end);
      if (!covered) {
        conflicts.push({ staffId, reason: 'SHIFT' });
        continue;
      }
    }

    const booking = load.bookings.find((b) => b.staffId === staffId && overlaps(slot, b));
    if (booking) {
      conflicts.push({
        staffId, reason: 'BOOKING',
        conflictStart: new Date(booking.start).toISOString(),
        conflictEnd: new Date(booking.end).toISOString(),
      });
      continue;
    }

    const block = load.blocks.find((b) => (b.staffId === null || b.staffId === staffId) && overlaps(slot, b));
    if (block) {
      conflicts.push({
        staffId, reason: 'BLOCK',
        conflictStart: new Date(block.start).toISOString(),
        conflictEnd: new Date(block.end).toISOString(),
      });
      continue;
    }

    const departure = load.departures.find((d) => d.staffId === staffId && overlaps(slot, d));
    if (departure) {
      conflicts.push({
        staffId, reason: 'DEPARTURE',
        departureId: departure.departureId,
        conflictStart: new Date(departure.start).toISOString(),
        conflictEnd: new Date(departure.end).toISOString(),
      });
    }
  }

  return conflicts;
}

/** 衝突理由 → 給店家看的說法。放在 server 是因為它會被寫進 API 的錯誤訊息。 */
export const CONFLICT_REASON_TEXT: Record<ConflictReason, string> = {
  SHIFT: '該日未排班',
  BOOKING: '已有一般服務預約',
  BLOCK: '該時段已封鎖（不可接案／私人行程／休假）',
  DEPARTURE: '已被其他團次指派',
};
