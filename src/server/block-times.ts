// src/server/block-times.ts — 封鎖時段的共用查詢／展開邏輯（#169）。
//
// block_times 的 WEEKLY 列採「存規則、查詢時展開」（Owner 裁示，不實體化未來
// 每一週的具體列）：start_at/end_at 只存「首次發生」的日期與時分秒，
// day_of_week 是重複星期的權威欄位。任何要讀 block_times 且需要「這個區間內
// 實際生效的封鎖時段」的呼叫端（目前是 /api/calendar、
// /api/bookings/available-slots），都必須透過這裡的 queryEffectiveBlockTimes，
// 不要各自重寫展開邏輯——WEEKLY 的時區/邊界計算容易出錯，寫一次、共用。
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiHttpError, ERR } from '@/server/http';

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export type BlockTimeRow = {
  id: string;
  staff_id: string | null;
  start_at: string;
  end_at: string;
  reason: string;
  title: string;
  recurrence: 'SINGLE' | 'WEEKLY';
  day_of_week: number | null;
  full_day: boolean;
  auto: boolean;
  staff?: { name: string } | null;
};

/** select 給 .from('block_times').select(...) 用；含 WEEKLY 展開所需的全部欄位 */
export const BLOCK_TIME_SELECT =
  'id, staff_id, start_at, end_at, reason, title, recurrence, day_of_week, full_day, auto, staff(name)';

function taipeiPartsOf(iso: string) {
  const t = new Date(Date.parse(iso) + TAIPEI_OFFSET_MS);
  return {
    y: t.getUTCFullYear(), mo: t.getUTCMonth(), d: t.getUTCDate(),
    weekday: t.getUTCDay(),
    msOfDay: t.getUTCHours() * 3600_000 + t.getUTCMinutes() * 60_000
      + t.getUTCSeconds() * 1000 + t.getUTCMilliseconds(),
  };
}

/** 台北當地某年月日 00:00 對應的 UTC 毫秒 */
function taipeiMidnightMs(y: number, mo: number, d: number): number {
  return Date.UTC(y, mo, d, 0, 0, 0) - TAIPEI_OFFSET_MS;
}

/**
 * 把一列 WEEKLY 規則展開成 [fromIso, toIso) 內的每一次實際發生（半開區間，
 * 與呼叫端既有的 start_at < to && end_at > from 重疊判定一致）。
 * SINGLE 或欄位不完整（day_of_week 缺失，理論上不會發生，資料保護用）時原樣
 * 傳回單一列，交由呼叫端既有的日期範圍過濾決定去留。
 */
export function expandBlockTimeOccurrences(
  row: BlockTimeRow, fromIso: string, toIso: string,
): BlockTimeRow[] {
  if (row.recurrence !== 'WEEKLY' || row.day_of_week == null) return [row];

  const first = taipeiPartsOf(row.start_at);
  const durationMs = Date.parse(row.end_at) - Date.parse(row.start_at);
  if (!(durationMs > 0)) return [];

  const fromMs = Date.parse(fromIso);
  const toMs = Date.parse(toIso);
  const firstOccurrenceDateMs = taipeiMidnightMs(first.y, first.mo, first.d);

  // 從查詢區間起點所在的台北日期，往前對齊到最近一個「星期幾＝day_of_week」的日期，
  // 再逐週往前/往後掃過整個 [from, to)；每次發生不早於「首次發生」的那個日期。
  const fromParts = taipeiPartsOf(fromIso);
  let cursorMs = taipeiMidnightMs(fromParts.y, fromParts.mo, fromParts.d)
    - ((fromParts.weekday - row.day_of_week + 7) % 7) * DAY_MS;
  if (cursorMs < firstOccurrenceDateMs) {
    cursorMs += Math.ceil((firstOccurrenceDateMs - cursorMs) / WEEK_MS) * WEEK_MS;
  }

  const out: BlockTimeRow[] = [];
  for (let dateMs = cursorMs; dateMs < toMs; dateMs += WEEK_MS) {
    const occStartMs = dateMs + first.msOfDay;
    const occEndMs = occStartMs + durationMs;
    if (occEndMs <= fromMs || occStartMs >= toMs) continue;
    out.push({
      ...row,
      start_at: new Date(occStartMs).toISOString(),
      end_at: new Date(occEndMs).toISOString(),
    });
  }
  return out;
}

/**
 * 查詢 [fromIso, toIso) 內「實際生效」的封鎖時段（SINGLE 用資料庫時間範圍直接
 * 過濾；WEEKLY 因為會無限期每週重複，撈全租戶 WEEKLY 列後在應用層展開再套
 * 同一個區間過濾）。回傳依 start_at 排序。
 */
export async function queryEffectiveBlockTimes(
  supabase: SupabaseClient, tenantId: string, fromIso: string, toIso: string,
): Promise<BlockTimeRow[]> {
  const [{ data: singles, error: sErr }, { data: weeklies, error: wErr }] = await Promise.all([
    supabase.from('block_times').select(BLOCK_TIME_SELECT)
      .eq('tenant_id', tenantId).eq('recurrence', 'SINGLE')
      .lt('start_at', toIso).gt('end_at', fromIso),
    supabase.from('block_times').select(BLOCK_TIME_SELECT)
      .eq('tenant_id', tenantId).eq('recurrence', 'WEEKLY'),
  ]);
  if (sErr) throw sErr;
  if (wErr) throw wErr;

  const out: BlockTimeRow[] = [...((singles ?? []) as unknown as BlockTimeRow[])];
  for (const w of (weeklies ?? []) as unknown as BlockTimeRow[]) {
    out.push(...expandBlockTimeOccurrences(w, fromIso, toIso));
  }
  return out.sort((a, b) => a.start_at.localeCompare(b.start_at));
}

/* ========================================================================== */
/* 寫入（POST /api/block-times、PUT /api/block-times/:id 共用）                */
/* 這兩支只能各自匯出 GET/POST/PUT/DELETE（Next.js route 檔的型別限制），       */
/* 所以 schema／驗證／mapper 都放這裡供兩個 route 檔 import。                   */
/* ========================================================================== */

/**
 * SINGLE：startAt/endAt 就是實際區間，dayOfWeek 必須是 null。
 * WEEKLY：startAt/endAt 給「首次發生」的日期＋時分秒（重複的時分秒與時長取自
 * 這兩個值），dayOfWeek 為權威的重複星期、必填。
 */
export const blockTimeWriteSchema = z.object({
  /** 省略或 null = 全店封鎖 */
  staffId: z.string().uuid().nullable().optional(),
  title: z.string().optional(),
  reason: z.string().optional(),
  recurrence: z.enum(['SINGLE', 'WEEKLY']).optional(),
  dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
  fullDay: z.boolean().optional(),
  startAt: z.string().min(1, '請輸入開始時間'),
  endAt: z.string().min(1, '請輸入結束時間'),
});

export function validateBlockTimeTimes(b: z.infer<typeof blockTimeWriteSchema>) {
  const startMs = Date.parse(b.startAt);
  const endMs = Date.parse(b.endAt);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
    throw new ApiHttpError(400, '時間區間格式錯誤（結束需晚於開始）', ERR.VALIDATION);
  }
  const recurrence = b.recurrence ?? 'SINGLE';
  if (recurrence === 'WEEKLY' && (b.dayOfWeek === null || b.dayOfWeek === undefined)) {
    throw new ApiHttpError(400, '每週循環必須選擇星期幾', ERR.VALIDATION);
  }
  return { startMs, endMs, recurrence, dayOfWeek: recurrence === 'WEEKLY' ? b.dayOfWeek! : null };
}

/** block_times 沒有前端契約型別（types.ts 只准新增 CalendarEvent），照 mappers.ts 慣例就地轉 camelCase */
export function mapBlockTime(r: BlockTimeRow) {
  return {
    id: r.id,
    staffId: r.staff_id,
    staffName: r.staff?.name ?? null, // 巢狀 join 實際為多對一物件（同 notify.ts 說明）
    title: r.title,
    reason: r.reason ?? '',
    recurrence: r.recurrence,
    dayOfWeek: r.day_of_week,
    fullDay: r.full_day,
    auto: r.auto,
    startAt: r.start_at,
    endAt: r.end_at,
  };
}
