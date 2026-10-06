import { hasStartedToday } from '@/lib/public-time-zone';

/**
 * #761：預約頁（loadPublicBookingPlan）、申請頁（loadPublicRequestPlan）、方案詳情頁與店家首頁的入口（bookingCtaState）
 * 對「這個方案有沒有可訂／可申請團次」必須用同一套候選規則，否則入口與目的頁會分岔。
 * 本檔是唯一來源：載入器用它挑候選團次，詳情頁／首頁用同一個 tracker 判斷入口，兩邊不會各寫各的。
 */

/** 預約頁／申請頁最多提供給旅客選擇的團次數（依日期、時間排序的前 N 個「候選」團次）。 */
export const MAX_BOOKING_CANDIDATE_DEPARTURES = 12;

/** 方案最低人數；缺值或不合法時比照預約頁預設（`Number(min_party ?? 1)`）視為 1。 */
export function normalizeMinParty(minParty: unknown): number {
  return Number.isInteger(minParty) && (minParty as number) >= 1 ? (minParty as number) : 1;
}

/**
 * 預約頁／申請頁的候選團次：（OPEN、今天以後由查詢決定）尚未開始且未客滿。
 * 回傳剩餘名額；不是候選回傳 null。
 */
export function bookingCandidateSeatsLeft(
  row: { departs_on?: unknown; start_time?: unknown; capacity?: unknown; seats_booked?: unknown },
  now: { today: string; hm: string },
): number | null {
  if (hasStartedToday(row, now)) return null;
  const capacity = Number(row.capacity ?? 0);
  const seatsBooked = Number(row.seats_booked ?? 0);
  if (seatsBooked >= capacity) return null;
  return capacity - seatsBooked;
}

/** 單一候選團次是否「可訂」：剩餘名額 >= 方案最低人數。 */
export function candidateIsBookable(seatsLeft: number, minParty: unknown): boolean {
  return seatsLeft >= normalizeMinParty(minParty);
}

/**
 * 依序餵入候選團次的剩餘名額（已排序、已過濾為候選）。只有前 MAX_BOOKING_CANDIDATE_DEPARTURES 個算數，
 * 與預約頁／申請頁實際提供的選項一致；超出者即使名額足夠也不算（目的頁看不到它）。
 */
export function createCandidateTracker(minParty: unknown) {
  let seen = 0;
  let bookable = false;
  return {
    observe(seatsLeft: number): void {
      if (seen >= MAX_BOOKING_CANDIDATE_DEPARTURES) return;
      seen += 1;
      if (candidateIsBookable(seatsLeft, minParty)) bookable = true;
    },
    /** 前 N 個候選中是否至少有一個可訂。 */
    get bookable(): boolean { return bookable; },
    /** 已無需再掃描：找到可訂的，或候選已達預約頁上限。 */
    get settled(): boolean { return bookable || seen >= MAX_BOOKING_CANDIDATE_DEPARTURES; },
  };
}

/** 純函式版：由依序的候選剩餘名額判斷（測試與非串流情境）。 */
export function hasBookableCandidate(seatsLeftInOrder: number[], minParty: unknown): boolean {
  const tracker = createCandidateTracker(minParty);
  for (const seats of seatsLeftInOrder) tracker.observe(seats);
  return tracker.bookable;
}
