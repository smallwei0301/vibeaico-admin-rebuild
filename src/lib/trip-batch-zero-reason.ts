/**
 * issue #1009：批次開團對話框 `batchCount === 0` 時，說明「為什麼是 0」。
 * 只做前端預覽用的原因判斷；實際日期展開仍由後端負責。
 */
export type BatchZeroReason = 'missingDates' | 'endBeforeStart' | 'noWeekdays' | 'noMatchingDays';

export function batchZeroReason(batch: { from: string; to: string; weekdays: number[] }): BatchZeroReason | null {
  if (!batch.from || !batch.to) return 'missingDates';
  const from = new Date(batch.from);
  const to = new Date(batch.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 'missingDates';
  if (to < from) return 'endBeforeStart';
  if (batch.weekdays.length === 0) return 'noWeekdays';
  for (const d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    if (batch.weekdays.includes(d.getDay())) return null;
  }
  return 'noMatchingDays';
}
