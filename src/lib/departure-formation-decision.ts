/**
 * REVIEW_REQUIRED 團次的導遊決策（18 分冊 §3／§6「導遊需要操作」第 2 項）的純邏輯。
 * 欄位與不變量全部來自 0107（≤ 0108，Production 已有）：
 *   - 「仍然成團」→ FORMED：CHECK trip_departures_formed_evidence_ck 要求 formed_at、formed_by、
 *     formed_participants 同時非 null；formed_by ∈ {SYSTEM, GUIDE_OVERRIDE}；formed_participants ≥ 1。
 *   - 「延長募集」→ 新 formation_deadline_at（須晚於現在、不晚於出發時間、晚於舊截止時間），回 COLLECTING。
 *   - 兩者都記 formation_decided_at／formation_decided_by（決策證據）。
 * 「繼續出團」（AT_RISK → FORMED，Owner Decision 2026-09-02 已成團後價格保護）：只改狀態與決策證據；
 *   原成團證據 formed_at／formed_by／formed_participants 一律不動（0107 CHECK 對 FORMED 與 AT_RISK 都要求證據齊全，
 *   保留原值即滿足；那是「曾經宣布成團」的證據，不是現在的人數）；完全不碰 tour_orders——不重新計價、不產生補差額應收。
 * 「取消本團／取消整團」不在這裡（退款流程）。
 */
import { z } from 'zod';
import { formationWallTimeToIso } from '@/lib/departure-formation-time';

/**
 * 決策驗證錯誤（一律是 400 類的輸入／規則錯誤）。這個檔案要被 mock（client bundle）共用，
 * 所以不能 import '@/server/http'（會拉進 next/headers）；route 負責把它轉成 400。
 */
export class FormationDecisionError extends Error {}

function departureInstant(date: string, time: string | null, zone: string): number {
  try { return Date.parse(formationWallTimeToIso(date, time, zone)); }
  catch (e) { throw new FormationDecisionError((e as Error).message); }
}

/** 與 departure-formation-snapshot 的 confirmedDeadline 同一組規則：含時區、晚於現在、不晚於出發時間。 */
function confirmedDeadline(value: string, departureMs: number, now: number): string {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new FormationDecisionError('成團截止時間須包含時區');
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new FormationDecisionError('成團截止時間無效');
  if (ms <= now) throw new FormationDecisionError('成團截止時間須晚於現在，請選擇新的成團截止時間並確認');
  if (ms > departureMs) throw new FormationDecisionError('成團截止時間不得晚於團次出發時間');
  return new Date(ms).toISOString();
}

export const formationDecisionSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('FORM') }).strict(),
  z.object({ decision: z.literal('EXTEND'), newDeadline: z.string().min(1).max(40) }).strict(),
  z.object({ decision: z.literal('CONTINUE') }).strict(),
]);

/** 各決策允許的起始成團狀態（CAS 條件）：FORM／EXTEND 針對 REVIEW_REQUIRED，CONTINUE 針對 AT_RISK。 */
export const DECISION_FROM_STATUS = { FORM: 'REVIEW_REQUIRED', EXTEND: 'REVIEW_REQUIRED', CONTINUE: 'AT_RISK' } as const;
export type FormationDecisionBody = z.infer<typeof formationDecisionSchema>;

export type ParticipantOrderRow = {
  status: string;
  party_size: number | string;
  paid_amount: number | string | null;
  upfront_required_amount: number | string | null;
  deposit_mode_snapshot: string | null;
  /** 0108：已退出金額；未提供視為 0 */
  refunded_amount?: number | string | null;
  /** tour_payment_status；REFUND_PENDING／REFUNDED 的訂單不算有效報名 */
  payment_status?: string | null;
};

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/**
 * 有效成團人數（18 §5）：容量占用（seats_booked，含未付款占位）與成團計數是兩本帳，這裡由 TourOrders 現算。
 *  - 已取消的訂單不算；付款狀態為 REFUND_PENDING／REFUNDED（退款處理中或已退）的訂單不算，不論訂單狀態。
 *  - deposit_mode_snapshot = NONE：訂單成立（CONFIRMED／COMPLETED）即算；PENDING（待導遊接受或尚未成立）不算。
 *  - DEPOSIT_FIXED／DEPOSIT_PERCENT／FULL：淨實收（paid_amount − refunded_amount）> 0 且 ≥ 成交當下要求的頭期款
 *    upfront_required_amount。部分退款後若淨實收低於頭期款，就不再算。
 *  - 沒有收款政策快照（0108 之前的舊訂單、手動單）：保守處理——只有 CONFIRMED／COMPLETED 且淨實收 > 0 才算，
 *    不高估人數、不猜測它的收款政策。
 */
export function effectiveParticipants(orders: ParticipantOrderRow[]): number {
  let total = 0;
  for (const o of orders) {
    if (o.status === 'CANCELLED') continue;
    if (o.payment_status === 'REFUND_PENDING' || o.payment_status === 'REFUNDED') continue;
    const paid = num(o.paid_amount) - num(o.refunded_amount);
    const confirmed = o.status === 'CONFIRMED' || o.status === 'COMPLETED';
    let ok: boolean;
    switch (o.deposit_mode_snapshot) {
      case 'NONE': ok = confirmed; break;
      case 'DEPOSIT_FIXED': case 'DEPOSIT_PERCENT': case 'FULL':
        ok = paid > 0 && paid >= num(o.upfront_required_amount); break;
      default: ok = confirmed && paid > 0;
    }
    if (ok) total += Math.max(0, Math.trunc(num(o.party_size)));
  }
  return total;
}

/** 「仍然成團」：寫入欄位必須滿足 0107 的證據 CHECK；沒有任何有效報名人數時拒絕（formed_participants ≥ 1）。 */
export function buildFormPatch(participants: number, userId: string, nowIso: string): Record<string, unknown> {
  if (!Number.isInteger(participants) || participants < 1) {
    throw new FormationDecisionError('目前沒有有效報名人數，無法宣布成團；請改選「延長募集」或取消本團');
  }
  return {
    formation_status: 'FORMED',
    formed_at: nowIso,
    formed_by: 'GUIDE_OVERRIDE',
    formed_participants: participants,
    formation_decided_at: nowIso,
    formation_decided_by: userId,
  };
}

/** 「延長募集」：新截止時間須含時區、晚於現在、不晚於出發時間（店家時區），且晚於舊截止時間。 */
export function buildExtendPatch(
  current: { departs_on: string; start_time: string | null; formation_deadline_at: string | null },
  newDeadline: string, zone: string, userId: string, now: number,
): Record<string, unknown> {
  const start = departureInstant(current.departs_on, current.start_time ? String(current.start_time).slice(0, 5) : null, zone);
  const iso = confirmedDeadline(newDeadline, start, now);
  if (current.formation_deadline_at && Date.parse(iso) <= Date.parse(current.formation_deadline_at)) {
    throw new FormationDecisionError('延長後的成團截止時間必須晚於目前的截止時間');
  }
  return {
    formation_status: 'COLLECTING',
    formation_deadline_at: iso,
    formation_decided_at: new Date(now).toISOString(),
    formation_decided_by: userId,
  };
}

/** 「繼續出團」：AT_RISK → FORMED。只寫狀態與決策證據，不覆寫原成團證據、不碰任何訂單金額。 */
export function buildContinuePatch(userId: string, nowIso: string): Record<string, unknown> {
  return { formation_status: 'FORMED', formation_decided_at: nowIso, formation_decided_by: userId };
}
