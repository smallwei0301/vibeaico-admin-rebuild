/**
 * issue #1009：批次開團對話框 `batchCount === 0` 時，說明「為什麼是 0」。
 * 只做前端預覽用的原因判斷；實際日期展開仍由後端負責。
 */
export type BatchZeroReason = 'missingDates' | 'endBeforeStart' | 'noWeekdays' | 'noMatchingDays';

export type BatchInput = { from: string; to: string; weekdays: number[] };

/** 單一計算來源：預覽筆數與「為什麼是 0」共用同一份展開邏輯；reason 為 null 若且唯若 count > 0。 */
export function batchDatePlan(batch: BatchInput): { count: number; reason: BatchZeroReason | null } {
  if (!batch.from || !batch.to) return { count: 0, reason: 'missingDates' };
  const from = new Date(batch.from);
  const to = new Date(batch.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return { count: 0, reason: 'missingDates' };
  if (to < from) return { count: 0, reason: 'endBeforeStart' };
  if (batch.weekdays.length === 0) return { count: 0, reason: 'noWeekdays' };
  let count = 0;
  for (const d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    if (batch.weekdays.includes(d.getDay())) count += 1;
  }
  return count > 0 ? { count, reason: null } : { count: 0, reason: 'noMatchingDays' };
}

export function batchZeroReason(batch: BatchInput): BatchZeroReason | null {
  return batchDatePlan(batch).reason;
}
