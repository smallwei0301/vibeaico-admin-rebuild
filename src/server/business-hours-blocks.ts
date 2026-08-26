/**
 * 「每天不同營業時間」→ 自動產生的每週封鎖時段（issue #33 第 ② 筆）。
 *
 * ⚠️⚠️ **乾跑 vs 存檔的語意是我方選定的，不是原站考據結果。**
 * `docs/specs/settings.json` 只給了 `/api/settings/weekly-business-hours/draft`
 * 這個路徑與四句文案，**沒有給 request / response 形狀**。我方定案：
 *
 *   POST /api/settings/weekly-business-hours/draft  = **乾跑**，只回報影響筆數，
 *                                                     一列都不寫。
 *   PUT  /api/settings（business 群組）             = 真的存檔，並在存檔後
 *                                                     重建 auto 封鎖。
 *
 * 依據（只有這兩點，其餘是推論）：
 *   1. 端點路徑最後一段就是 `draft`——草稿。
 *   2. `docs/specs/settings.json` jsStrings[66]「解析逐日營業時間失敗:」：
 *      這一支會**解析**送進去的逐日營業時間，也就是拿還沒存的輸入去算東西。
 *
 * ⚠️ 反過來說，另外三句文案是**過去式／已存檔語氣**，單看它們會讀成
 *    「這一支自己就會寫入」：
 *      jsStrings[37]+[7]「已依你的營業時段自動建立 N 筆封鎖時段（…）」
 *      jsStrings[9]     「… 設定已儲存，但這些預約「不會」自動取消。…」
 *      jsStrings[6]     「… 已保留（不會自動刪除）。…」
 *    我方的解讀是：這三句是**存檔完成之後**才顯示的，所以過去式成立——
 *    頁面先乾跑拿到偵測數字、再 PUT 存檔拿到實際建立數，最後一起顯示。
 *    **這個解讀沒有原站證據，是我方選的**；日後若擁有者裁決 draft 應該自己
 *    寫入，改的是這個檔與兩支端點，四句文案不用動。
 *
 * 自動封鎖的產生／回收規則（同樣是我方定案，記在 04 分冊 §A-1.2）：
 *   - 產生：perDayMode 開啟時，把每一天「沒開放的時段」補成 WEEKLY 封鎖。
 *     整天沒開放 → 一筆 full_day 的整天封鎖；有開放但有空隙 → 每個空隙一筆。
 *   - 回收：**全刪重建**（不是差異更新）。每次存檔先刪掉本租戶所有 auto 列，
 *     再依新的營業時段重新產生。差異更新要比對「哪一筆對應哪一筆」，而
 *     auto 列沒有穩定的識別依據（時段本身就是識別），比對規則會自己長出
 *     一套隱性狀態。全刪重建的代價是 id 會換，但 auto 列本來就不給人編輯。
 *   - **手動建立的封鎖一律不動**（auto = false 的列一筆都不碰）——
 *     原站文案明講「已保留（不會自動刪除）」。
 *   - perDayMode 關閉時：auto 列全部清掉（回到單一營業時段，沒有空隙要補）。
 */

/** 一天之內的營業時段（'HH:MM'） */
export type DaySlot = { start: string; end: string };

/** 要產生的一筆 auto 封鎖 */
export type AutoBlockSpec = {
  dayOfWeek: number;
  /** 'HH:MM'；整天封鎖為 '00:00'–'24:00' */
  start: string;
  end: string;
  fullDay: boolean;
};

/** business 群組裡本模組會讀到的欄位（src/config/tenant-settings.ts 的子集） */
export type BusinessHoursInput = {
  perDayMode: boolean;
  perDayHours: DaySlot[][];
  /** 以下四個只在 perDayMode 關閉時用到（算「落在非營業時段的預約」） */
  businessStart: string;
  businessEnd: string;
  breakStart: string;
  breakEnd: string;
  closedDays: number[];
};

const DAY_START = '00:00';
const DAY_END = '24:00';

const toMin = (hm: string): number => {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
};

/**
 * 依逐日營業時段算出「沒開放的時段」= 要建立的 WEEKLY 封鎖。
 *
 * perDayMode 關閉 → 空陣列（沒有逐日設定就沒有要補的空隙；一般營業時間的
 * 非營業時段本來就由 available-slots 的營業時間視窗擋掉，不需要封鎖列）。
 */
export function computeAutoBlocks(b: BusinessHoursInput): AutoBlockSpec[] {
  if (!b.perDayMode) return [];

  const out: AutoBlockSpec[] = [];
  for (let day = 0; day < 7; day += 1) {
    const slots = [...(b.perDayHours[day] ?? [])]
      .filter((s) => s.start && s.end && toMin(s.start) < toMin(s.end))
      .sort((x, y) => toMin(x.start) - toMin(y.start));

    if (slots.length === 0) {
      // 整天沒開放 → 一筆整天封鎖
      out.push({ dayOfWeek: day, start: DAY_START, end: DAY_END, fullDay: true });
      continue;
    }

    // 開店前的空隙
    if (toMin(slots[0].start) > 0)
      out.push({ dayOfWeek: day, start: DAY_START, end: slots[0].start, fullDay: false });

    // 時段之間的空隙（輸入已在頁面驗證過不重疊，這裡再擋一次負長度）
    for (let i = 1; i < slots.length; i += 1) {
      const gapStart = slots[i - 1].end;
      const gapEnd = slots[i].start;
      if (toMin(gapStart) < toMin(gapEnd))
        out.push({ dayOfWeek: day, start: gapStart, end: gapEnd, fullDay: false });
    }

    // 打烊後的空隙
    const last = slots[slots.length - 1].end;
    if (toMin(last) < toMin(DAY_END))
      out.push({ dayOfWeek: day, start: last, end: DAY_END, fullDay: false });
  }
  return out;
}

/**
 * WEEKLY 封鎖的 start_at / end_at 要寫什麼。
 *
 * block_times.start_at / end_at 是 not null（0004），而 WEEKLY 的語意是
 * 「每週的這一天、這個時刻」。所以存的是**參考週裡的第一次發生**，實際的
 * 每週重複由讀取端展開（見 expandWeeklyBlock）。參考週固定取
 * 「1970-01-04（週日）起的那一週」的台北時間，不受建立當下的日期影響——
 * 用「這週」當基準會讓同一份設定在不同日子存出不同的 start_at，
 * 之後很難比對「這兩筆是不是同一個時段」。
 */
const REFERENCE_SUNDAY_UTC = Date.UTC(1970, 0, 4); // 1970-01-04 是週日
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

export function weeklyBlockRange(spec: AutoBlockSpec): { startAt: string; endAt: string } {
  const dayMs = REFERENCE_SUNDAY_UTC + spec.dayOfWeek * 86_400_000;
  // 台北牆上時鐘 → UTC 瞬間
  const startAt = new Date(dayMs + toMin(spec.start) * 60_000 - TAIPEI_OFFSET_MS).toISOString();
  const endAt = new Date(dayMs + toMin(spec.end) * 60_000 - TAIPEI_OFFSET_MS).toISOString();
  return { startAt, endAt };
}

/** 從 WEEKLY 列的 start_at 取回台北牆上時鐘的分鐘數（展開用） */
export function taipeiMinutesOfDay(iso: string): number {
  const d = new Date(Date.parse(iso) + TAIPEI_OFFSET_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/**
 * 把一筆 WEEKLY 封鎖展開成 [from, to) 區間內的實際發生。
 * 回傳每次發生的 { start, end }（ISO）。
 *
 * 這是「一列 = 一整條每週封鎖」這個模型的讀取端。原站也是這個模型：
 * docs/specs/calendar.json jsStrings[31] 的刪除確認寫著
 * 「這是「每週重複」的封鎖，會把每一週的這個封鎖整條刪除。」
 */
export function expandWeeklyBlock(
  row: { start_at: string; end_at: string; day_of_week: number | null },
  fromIso: string,
  toIso: string,
): Array<{ start: string; end: string }> {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return [];

  const startMin = taipeiMinutesOfDay(row.start_at);
  const durationMs = Date.parse(row.end_at) - Date.parse(row.start_at);
  if (!(durationMs > 0)) return [];

  const dow = row.day_of_week;
  if (dow == null) return [];

  // 從 from 當天的台北日界線開始，逐日往後找符合 day_of_week 的日子。
  // 上限一年份（365 天）：呼叫端的查詢區間本來就是頁面看得到的範圍，
  // 給一個上限避免有人傳進 100 年的區間時算爆。
  const out: Array<{ start: string; end: string }> = [];
  const firstDayStart = Math.floor((from + TAIPEI_OFFSET_MS) / 86_400_000) * 86_400_000
    - TAIPEI_OFFSET_MS;
  for (let i = 0; i <= 365; i += 1) {
    const dayStart = firstDayStart + i * 86_400_000;
    if (dayStart >= to + 86_400_000) break;
    // 該日在台北是星期幾
    const weekday = new Date(dayStart + TAIPEI_OFFSET_MS).getUTCDay();
    if (weekday !== dow) continue;
    const s = dayStart + startMin * 60_000;
    const e = s + durationMs;
    if (s < to && e > from) out.push({ start: new Date(s).toISOString(), end: new Date(e).toISOString() });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* 影響筆數與重建（會碰 DB 的部分）                                             */
/* -------------------------------------------------------------------------- */

type SupabaseLike = { from: (table: string) => any };
type Ctx = { supabase: SupabaseLike; tenantId: string };

/**
 * 每一天的「開放時段」（分鐘）。conflict 判定用：一筆預約必須整段落在
 * 某一個開放時段裡，否則就是落在非營業時段。
 *
 * perDayMode 開 → 直接用 perDayHours。
 * perDayMode 關 → 公休日沒有開放時段；其餘日子是 businessStart–businessEnd
 *                 扣掉休息時段（休息時段本來就不接預約）。
 */
export function openWindowsByDay(
  b: BusinessHoursInput,
): Array<Array<{ start: number; end: number }>> {
  const days: Array<Array<{ start: number; end: number }>> = [[], [], [], [], [], [], []];
  if (b.perDayMode) {
    for (let d = 0; d < 7; d += 1) {
      days[d] = (b.perDayHours[d] ?? [])
        .filter((s) => s.start && s.end && toMin(s.start) < toMin(s.end))
        .map((s) => ({ start: toMin(s.start), end: toMin(s.end) }))
        .sort((x, y) => x.start - y.start);
    }
    return days;
  }
  const open = toMin(b.businessStart);
  const close = toMin(b.businessEnd);
  const hasBreak = !!b.breakStart && !!b.breakEnd && toMin(b.breakStart) < toMin(b.breakEnd);
  for (let d = 0; d < 7; d += 1) {
    if (b.closedDays.includes(d)) continue;
    if (!(open < close)) continue;
    if (!hasBreak) { days[d] = [{ start: open, end: close }]; continue; }
    const bs = toMin(b.breakStart);
    const be = toMin(b.breakEnd);
    const parts: Array<{ start: number; end: number }> = [];
    if (open < bs) parts.push({ start: open, end: Math.min(bs, close) });
    if (be < close) parts.push({ start: Math.max(be, open), end: close });
    days[d] = parts;
  }
  return days;
}

/**
 * 有多少筆**既有預約**落在新的公休日或非營業時段。
 *
 * 口徑（我方定案，記在 04 分冊 §A-1.2）：
 *   - 只看**還沒發生**的預約（start_at >= now）——已經過去的預約不會因為改了
 *     營業時間而需要處理。
 *   - 只看還佔著時段的狀態 PENDING / CONFIRMED（CANCELLED / NO_SHOW /
 *     COMPLETED 不算）。
 *   - 「落在非營業時段」= 這筆預約**沒有整段**落在該星期幾的任何一個開放時段裡。
 *   - 上限往後一年（與行事曆頁的載入範圍一致），避免一次撈進無邊界的資料。
 */
export async function countConflictingBookings(t: Ctx, b: BusinessHoursInput): Promise<number> {
  const now = new Date();
  const horizon = new Date(now.getTime() + 365 * 86_400_000);
  const { data, error } = await t.supabase.from('bookings')
    .select('start_at, end_at')
    .eq('tenant_id', t.tenantId)
    .in('status', ['PENDING', 'CONFIRMED'])
    .gte('start_at', now.toISOString())
    .lt('start_at', horizon.toISOString());
  if (error) throw error;

  const windows = openWindowsByDay(b);
  let n = 0;
  for (const row of (data ?? []) as Array<{ start_at: string; end_at: string }>) {
    const startMs = Date.parse(row.start_at);
    const weekday = new Date(startMs + TAIPEI_OFFSET_MS).getUTCDay();
    const startMin = taipeiMinutesOfDay(row.start_at);
    // 結束時間換算成「同一天的分鐘數」；跨日的預約用相對長度往後加，
    // 於是跨日預約的 endMin 會超過 1440，永遠不可能整段落在當天的營業時段裡
    // ——會被判成衝突，這是對的。
    const endMin = startMin + Math.round((Date.parse(row.end_at) - startMs) / 60_000);
    const fits = windows[weekday].some((w) => startMin >= w.start && endMin <= w.end);
    if (!fits) n += 1;
  }
  return n;
}

/** 店家**手動**建立的每週封鎖筆數（auto = false 且 recurrence = 'WEEKLY'） */
export async function countManualWeeklyBlocks(t: Ctx): Promise<number> {
  const { count, error } = await t.supabase.from('block_times')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', t.tenantId)
    .eq('auto', false)
    .eq('recurrence', 'WEEKLY');
  if (error) throw error;
  return count ?? 0;
}

/**
 * 重建自動封鎖：**全刪重建**（見檔頭的規則說明）。
 * 手動建立的封鎖（auto = false）一筆都不碰。
 * 回傳這次實際建立的筆數。
 */
export async function rebuildAutoBlocks(
  t: Ctx,
  b: BusinessHoursInput,
  autoTitle: string,
): Promise<number> {
  const { error: delErr } = await t.supabase.from('block_times')
    .delete().eq('tenant_id', t.tenantId).eq('auto', true);
  if (delErr) throw delErr;

  const specs = computeAutoBlocks(b);
  if (specs.length === 0) return 0;

  const rows = specs.map((s) => {
    const { startAt, endAt } = weeklyBlockRange(s);
    return {
      tenant_id: t.tenantId,
      staff_id: null,
      start_at: startAt,
      end_at: endAt,
      reason: '',
      title: autoTitle,
      recurrence: 'WEEKLY',
      day_of_week: s.dayOfWeek,
      full_day: s.fullDay,
      auto: true,
    };
  });
  const { error: insErr } = await t.supabase.from('block_times').insert(rows);
  if (insErr) throw insErr;
  return rows.length;
}
