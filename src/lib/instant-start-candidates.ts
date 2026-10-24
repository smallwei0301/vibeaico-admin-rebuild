/**
 * src/lib/instant-start-candidates.ts — INSTANT 自選時間的候選起始時刻（issue #46，純函式）
 * -----------------------------------------------------------------------------
 * Owner 2026-10-23 Q1：候選時刻＝方案設定的「固定起始時刻清單」× 店家時區的日期，
 * 受最短提前量（預設 24 小時）與可售天數（預設 60 天）限制。
 *
 * 規則必須與 `public.create_instant_tour_order`（0138）逐項一致，因為 DB 才是權威：
 *   - 牆上時間在店家時區：每個日期 × 每個清單時刻 → 一個 instant。
 *   - DST gap（該牆上時間不存在）與 fold（同一牆上時間出現兩次）的候選一律略過，
 *     不挑一個「看起來合理」的偏移——RPC 對這兩種輸入回 INVALID_START。
 *   - `startsAt >= now + minLeadMinutes`（含等於）。
 *   - 本地日期 `<= 今天（店家時區）+ maxAdvanceDays`（含等於）。
 *
 * 這個函式只產生「規則上合法」的候選；導遊是否有空由 `guide_staff_interval_available`
 * 逐一判定（server 端），本檔不碰 DB。
 */
import { resolvePublicTimeZone } from '@/lib/public-time-zone';

export const INSTANT_DEFAULT_MIN_LEAD_MINUTES = 1440;
export const INSTANT_DEFAULT_MAX_ADVANCE_DAYS = 60;

export type InstantRule = {
  /** 'HH:mm'（或 'HH:mm:ss'，秒必須為 00）；重複、格式錯誤者忽略。 */
  startTimes: readonly string[];
  minLeadMinutes?: number;
  maxAdvanceDays?: number;
  timeZone?: string | null;
};

export type InstantCandidate = {
  /** UTC ISO instant，直接傳給 RPC 的 p_starts_at。 */
  startsAt: string;
  /** 店家時區的日期 YYYY-MM-DD。 */
  localDate: string;
  /** 店家時區的牆上時間 HH:mm。 */
  localTime: string;
};

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::00)?$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

const formatterCache = new Map<string, Intl.DateTimeFormat>();
function formatterFor(zone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    formatterCache.set(zone, f);
  }
  return f;
}

/** 某 instant 在 zone 的牆上時間，以「當成 UTC 的毫秒」表示。 */
function wallAsUtcMs(zone: string, instantMs: number): number {
  const parts = formatterFor(zone).formatToParts(new Date(instantMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
}

/**
 * 牆上時間（以「當成 UTC 的毫秒」給）對應的所有 instant。
 * 長度 0＝gap（不存在）、1＝正常、2＝fold（含兩次）。
 */
export function instantsForWallClock(zone: string, wallMs: number): number[] {
  const found = new Set<number>();
  // 取前後一天的偏移當候選：DST 切換只會在這個範圍內改變偏移。
  for (const probe of [wallMs - DAY_MS, wallMs, wallMs + DAY_MS]) {
    const offset = wallAsUtcMs(zone, probe) - probe;
    const candidate = wallMs - offset;
    if (wallAsUtcMs(zone, candidate) === wallMs) found.add(candidate);
  }
  return [...found].sort((a, b) => a - b);
}

/** 店家時區的「今天」（YYYY-MM-DD）。 */
export function localDateOf(zone: string, instantMs: number): string {
  return new Date(wallAsUtcMs(zone, instantMs)).toISOString().slice(0, 10);
}

function dateToUtcMs(date: string): number | null {
  const m = DATE_RE.exec(date);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === date ? ms : null;
}

function normalizeStartTimes(times: readonly string[]): Array<{ hh: number; mm: number; label: string }> {
  const seen = new Set<string>();
  const out: Array<{ hh: number; mm: number; label: string }> = [];
  for (const raw of times) {
    const m = TIME_RE.exec(String(raw).trim());
    if (!m) continue;
    const label = `${m[1]}:${m[2]}`;
    if (seen.has(label)) continue;
    seen.add(label);
    out.push({ hh: Number(m[1]), mm: Number(m[2]), label });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * 產生候選起始時刻（依 startsAt 升冪）。
 *
 * `range` 為店家時區日期（含端點）的選填篩選；沒給時涵蓋整個可售視窗。
 * `nowMs` 可注入以利測試。
 */
export function generateInstantCandidates(
  rule: InstantRule,
  nowMs: number = Date.now(),
  range: { from?: string; to?: string } = {},
): InstantCandidate[] {
  const zone = resolvePublicTimeZone(rule.timeZone);
  const times = normalizeStartTimes(rule.startTimes);
  if (times.length === 0) return [];
  const lead = Number.isFinite(rule.minLeadMinutes) && (rule.minLeadMinutes as number) >= 0
    ? Math.floor(rule.minLeadMinutes as number) : INSTANT_DEFAULT_MIN_LEAD_MINUTES;
  const advance = Number.isFinite(rule.maxAdvanceDays) && (rule.maxAdvanceDays as number) >= 1
    ? Math.floor(rule.maxAdvanceDays as number) : INSTANT_DEFAULT_MAX_ADVANCE_DAYS;

  const todayMs = dateToUtcMs(localDateOf(zone, nowMs));
  if (todayMs == null) return [];
  const fromMs = range.from ? dateToUtcMs(range.from) : null;
  const toMs = range.to ? dateToUtcMs(range.to) : null;
  if ((range.from && fromMs == null) || (range.to && toMs == null)) return [];

  const earliest = nowMs + lead * MINUTE_MS;
  const out: InstantCandidate[] = [];
  for (let i = 0; i <= advance; i += 1) {
    const dayMs = todayMs + i * DAY_MS;
    if (fromMs != null && dayMs < fromMs) continue;
    if (toMs != null && dayMs > toMs) break;
    const localDate = new Date(dayMs).toISOString().slice(0, 10);
    for (const t of times) {
      const instants = instantsForWallClock(zone, dayMs + (t.hh * 60 + t.mm) * MINUTE_MS);
      if (instants.length !== 1) continue; // gap／fold：與 RPC 一致，一律拒絕。
      if (instants[0] < earliest) continue;
      out.push({ startsAt: new Date(instants[0]).toISOString(), localDate, localTime: t.label });
    }
  }
  return out.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}
