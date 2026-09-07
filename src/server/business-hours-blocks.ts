// src/server/business-hours-blocks.ts — 逐日營業時間 → 自動封鎖時段（issue #33 第 ② 筆）。
//
// ════════════════════════════════════════════════════════════════════════
// ⚠️ 這一整支的語意是**我方選定**的，不是原站考據結果
// ════════════════════════════════════════════════════════════════════════
//
// `docs/specs/settings.json` 對 `/api/settings/weekly-business-hours/draft`
// **只給了字串，沒有給 request/response 形狀**。我方選「乾跑（dry-run）」，
// 依據只有兩點：
//
//   1. 路徑最後一段是 `draft`。
//   2. jsStrings 有一句「**解析**逐日營業時間失敗:」——「解析」代表它拿還沒
//      存檔的輸入去算東西。
//
// **反面證據一併列出，沒有藏起來**：另外三句文案是過去式／已存檔的語氣
// （「已依你的營業時段自動建立 N 筆」「設定已儲存，但…」「偵測到 N 筆…已保留」），
// 單看那三句會讀成「這一支自己就會寫入」。我方的解讀是那三句在**存檔完成後**
// 才顯示——**這個解讀沒有原站證據**。真正的寫入仍走 `PUT /api/settings`。
//
// ── 自動封鎖的產生／回收規則（同樣是我方選定，issue 要求二選一寫死）──────
//
// 採「**全刪重建**」：每次帶 business 群組存檔時，先刪掉本租戶所有 `auto=true`
// 的列，再依當前設定重建。理由是差異更新需要一組穩定的識別鍵，而營業時段本身
// 就是識別鍵的一部分（改時段＝改鍵），差異更新會退化成全刪重建又多一層出錯機會。
//
// **手動建立的封鎖（`auto=false`）一律不動**——原站文案明講「已保留（不會自動
// 刪除）」。刪除條件永遠帶 `.eq('auto', true)`，這是本檔最重要的一條不變式。
//
// ── 產生規則 ──────────────────────────────────────────────────────────
//
// 對每個星期 d（0 = 週日，與 JS getDay() 及原站 btDayOfWeek 同一個值域）：
//   * d 在 closedDays 內，或 perDayHours[d] 沒有任何時段 → 整天封鎖（full_day）
//   * 否則 → 把當天 00:00–24:00 扣掉所有營業時段，**剩下的空隙**各成為一筆封鎖
//
// 產生的列一律 `recurrence='WEEKLY'`、`auto=true`、`staff_id=null`（全店適用）。
// WEEKLY 採「存規則、查詢時展開」（見 src/server/block-times.ts），所以
// start_at/end_at 只存「首次發生」那一天的日期與時分。
import type { SupabaseClient } from '@supabase/supabase-js';

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MINUTES = 24 * 60;

/** 自動產生的封鎖時段的 title；封鎖時段頁靠 `auto` 欄位顯示徽章，這只是可讀文字。 */
export const AUTO_BLOCK_TITLE = '非營業時間（自動產生）';

export type DayInterval = { start: string; end: string };

export type BusinessHoursInput = {
  perDayMode: boolean;
  perDayHours: DayInterval[][];
  closedDays: number[];
  businessStart: string;
  businessEnd: string;
  breakStart: string;
  breakEnd: string;
};

export type AutoBlockPlan = {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  fullDay: boolean;
};

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * 一天的營業時段（可能多段）→ 該天要封鎖的空隙。
 * 空陣列的營業時段代表整天不營業，回傳單一整天封鎖。
 */
export function closedIntervalsForDay(open: DayInterval[]): { start: number; end: number }[] {
  const sorted = open
    .map((i) => ({ start: toMinutes(i.start), end: toMinutes(i.end) }))
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start);

  if (!sorted.length) return [{ start: 0, end: DAY_MINUTES }];

  // 先把重疊／相鄰的營業時段合併，否則兩段重疊會算出一個負長度的空隙。
  const merged: { start: number; end: number }[] = [];
  for (const cur of sorted) {
    const last = merged[merged.length - 1];
    if (last && cur.start <= last.end) last.end = Math.max(last.end, cur.end);
    else merged.push({ ...cur });
  }

  const gaps: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const seg of merged) {
    if (seg.start > cursor) gaps.push({ start: cursor, end: seg.start });
    cursor = Math.max(cursor, seg.end);
  }
  if (cursor < DAY_MINUTES) gaps.push({ start: cursor, end: DAY_MINUTES });
  return gaps;
}

/**
 * 整週設定 → 要建立的自動封鎖清單。
 *
 * perDayMode 關閉時，七天共用 businessStart/businessEnd（中間再扣掉休息時間），
 * 這樣「關閉逐日模式」不會變成「完全沒有自動封鎖」——那會讓非營業時間突然
 * 全部開放預約。
 */
export function planAutoBlocks(input: BusinessHoursInput): AutoBlockPlan[] {
  const closed = new Set(input.closedDays);
  const plans: AutoBlockPlan[] = [];

  const uniformOpen: DayInterval[] = (() => {
    const hasBreak = Boolean(input.breakStart && input.breakEnd)
      && toMinutes(input.breakEnd) > toMinutes(input.breakStart);
    if (!hasBreak) return [{ start: input.businessStart, end: input.businessEnd }];
    return [
      { start: input.businessStart, end: input.breakStart },
      { start: input.breakEnd, end: input.businessEnd },
    ];
  })();

  for (let day = 0; day < 7; day += 1) {
    if (closed.has(day)) {
      plans.push({ dayOfWeek: day, startMinute: 0, endMinute: DAY_MINUTES, fullDay: true });
      continue;
    }
    const open = input.perDayMode ? (input.perDayHours[day] ?? []) : uniformOpen;
    for (const gap of closedIntervalsForDay(open)) {
      plans.push({
        dayOfWeek: day,
        startMinute: gap.start,
        endMinute: gap.end,
        fullDay: gap.start === 0 && gap.end === DAY_MINUTES,
      });
    }
  }
  return plans;
}

function taipeiParts(d: Date) {
  const t = new Date(d.getTime() + TAIPEI_OFFSET_MS);
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth(), d: t.getUTCDate(), weekday: t.getUTCDay() };
}

/**
 * 某個 AutoBlockPlan 的「首次發生」ISO 起訖。
 * 取 `now` 所在台北日期起，往後第一個符合 dayOfWeek 的日期（含今天）。
 */
export function firstOccurrenceIso(plan: AutoBlockPlan, now: Date): { startAt: string; endAt: string } {
  const { y, mo, d, weekday } = taipeiParts(now);
  const delta = (plan.dayOfWeek - weekday + 7) % 7;
  const midnight = Date.UTC(y, mo, d + delta, 0, 0, 0) - TAIPEI_OFFSET_MS;
  return {
    startAt: new Date(midnight + plan.startMinute * 60_000).toISOString(),
    endAt: new Date(midnight + plan.endMinute * 60_000).toISOString(),
  };
}

/**
 * 一個 timestamptz 是否落在「新設定的非營業時間」內。
 * 用台北牆上時鐘的星期與分鐘數比對，與 planAutoBlocks 同一個座標系。
 */
export function fallsInClosedTime(iso: string, plans: AutoBlockPlan[]): boolean {
  const t = new Date(Date.parse(iso) + TAIPEI_OFFSET_MS);
  const weekday = t.getUTCDay();
  const minute = t.getUTCHours() * 60 + t.getUTCMinutes();
  return plans.some(
    (p) => p.dayOfWeek === weekday && minute >= p.startMinute && minute < p.endMinute,
  );
}

export type BusinessHoursImpact = {
  perDayMode: boolean;
  /** 會建立（乾跑）／已建立（存檔）的自動封鎖筆數 */
  autoBlockCount: number;
  /** 落在新的非營業時段的既有預約筆數 */
  conflictBookingCount: number;
  /** 使用者手動建立的每週封鎖筆數，這些一律保留 */
  manualWeeklyBlockCount: number;
};

/**
 * 只算影響、**一列都不寫**（乾跑）。
 *
 * 衝突預約只看「現在之後」的預約，且排除已取消的：已經發生過的預約不會因為
 * 改營業時間而需要處理，把它們算進去只會讓數字虛胖，那就是在誤導店家。
 */
export async function measureBusinessHoursImpact(
  supabase: SupabaseClient,
  tenantId: string,
  input: BusinessHoursInput,
  now: Date = new Date(),
): Promise<BusinessHoursImpact> {
  const plans = planAutoBlocks(input);

  const { data: bookings, error: bErr } = await supabase
    .from('bookings')
    .select('id, start_at, status')
    .eq('tenant_id', tenantId)
    .gte('start_at', now.toISOString())
    .not('status', 'in', '(CANCELLED,NO_SHOW)');
  if (bErr) throw bErr;

  const conflictBookingCount = (bookings ?? []).filter((b) =>
    fallsInClosedTime(b.start_at as string, plans),
  ).length;

  const { count: manualWeekly, error: mErr } = await supabase
    .from('block_times')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('auto', false)
    .eq('recurrence', 'WEEKLY');
  if (mErr) throw mErr;

  return {
    perDayMode: input.perDayMode,
    autoBlockCount: plans.length,
    conflictBookingCount,
    manualWeeklyBlockCount: manualWeekly ?? 0,
  };
}

/**
 * 全刪重建自動封鎖，回傳**實際建立**的筆數與同一組影響數字。
 *
 * ⚠️ 刪除條件永遠帶 `.eq('auto', true)`。手動建立的封鎖不在此函式的職責範圍內，
 * 一列都不能碰。
 */
export async function rebuildAutoBlocks(
  supabase: SupabaseClient,
  tenantId: string,
  input: BusinessHoursInput,
  now: Date = new Date(),
): Promise<BusinessHoursImpact> {
  const impact = await measureBusinessHoursImpact(supabase, tenantId, input, now);
  const plans = planAutoBlocks(input);

  const { error: dErr } = await supabase
    .from('block_times')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('auto', true);
  if (dErr) throw dErr;

  if (!plans.length) return { ...impact, autoBlockCount: 0 };

  const rows = plans.map((plan) => {
    const { startAt, endAt } = firstOccurrenceIso(plan, now);
    return {
      tenant_id: tenantId,
      staff_id: null,
      start_at: startAt,
      end_at: endAt,
      reason: AUTO_BLOCK_TITLE,
      title: AUTO_BLOCK_TITLE,
      recurrence: 'WEEKLY' as const,
      day_of_week: plan.dayOfWeek,
      full_day: plan.fullDay,
      auto: true,
    };
  });

  const { data: inserted, error: iErr } = await supabase
    .from('block_times')
    .insert(rows)
    .select('id');
  if (iErr) throw iErr;

  // 回報「實際建立」的筆數，不是「打算建立」的筆數——兩者不同時，說實話的是前者。
  return { ...impact, autoBlockCount: inserted?.length ?? 0 };
}
