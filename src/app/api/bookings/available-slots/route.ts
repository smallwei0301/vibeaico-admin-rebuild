// GET /api/bookings/available-slots?serviceId&staffId?&date=YYYY-MM-DD（04 §B-1）
//
// 演算法（全部以台北時區的「分鐘刻度」計算，最後才轉 UTC ISO）：
//   1. 營業時段窗（tenant_settings.business）：
//      - perDayMode=false：closedDays 含該日 weekday → 無時段；否則窗 =
//        [businessStart, businessEnd]，有午休（breakStart/breakEnd 皆非空）就切成兩段。
//      - perDayMode=true：窗 = perDayHours[weekday]（空陣列 = 該日不營業；
//        closedDays 只在非逐日模式使用，逐日模式以空陣列表達公休）。
//   2. 候選時段：每個窗內從窗起點起、每 slotInterval 分鐘一個起點，
//      時段長度 = 該服務 duration_minutes，起點+長度須落在窗內。
//   3. 員工池：
//      - 有給 staffId → 只算該員工（404 檢查歸屬；不再限 staff_services，
//        店家指名即視為可做）。
//      - 未給 → active 且 bookable 且在 staff_services 掛了該服務的員工；
//        若這個服務完全沒掛任何員工（多數店不維護對照表），退回全部
//        active+bookable 員工。
//   4. 逐員工檢查每個候選時段是否空檔：
//      - shifts：該日「該租戶完全沒有班表資料」→ 視為全時段可排（§B-1 補充
//        決策）；該日有班表資料時，沒排班的員工視為不上班，有排班的員工只在
//        自己班段內可排。
//      - 已有 bookings（PENDING/CONFIRMED、該員工）重疊 → 不可排。
//      - block_times：該員工的、或 staff_id null（全店封鎖）重疊 → 不可排。
//   5. 回 { slots: [{ start, end, staffIds[] }] }（ISO），staffIds 為空的時段不回。
//
// 契約未要求的過濾（過去時段、advanceBooking/minAdvance/cutoff 等公開頁預約
// 政策）此處不做——這是後台端點，政策過濾屬公開預約頁的責任。
import { z } from 'zod';
import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { businessSettingsSchema } from '@/config/tenant-settings';
import { queryEffectiveBlockTimes } from '@/server/block-times';

const querySchema = z.object({
  serviceId: z.string().uuid(),
  staffId: z.string().uuid().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式須為 YYYY-MM-DD'),
});

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 'HH:mm' 或 'HH:mm:ss'（shifts 的 time 欄位）→ 當日分鐘數 */
function hmToMin(s: string): number {
  const [h, m] = s.split(':');
  return Number(h) * 60 + Number(m);
}

export const GET = handle(async (req) => {
  const t = await requireTenant();
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));

  const { data: service, error: sErr } = await t.supabase.from('services')
    .select('id, duration_minutes')
    .eq('id', q.serviceId).eq('tenant_id', t.tenantId).maybeSingle();
  if (sErr) throw sErr;
  if (!service) throw new ApiHttpError(404, '找不到此服務', ERR.NOT_FOUND);
  const duration = service.duration_minutes;

  // 台北該日 00:00 對應的 UTC 瞬間（同 src/server/tz.ts 的作法）與 weekday。
  const [y, mo, d] = q.date.split('-').map(Number);
  const dayStartMs = Date.UTC(y, mo - 1, d) - TAIPEI_OFFSET_MS;
  const dayEndMs = dayStartMs + 24 * 60 * 60 * 1000;
  const weekday = new Date(Date.UTC(y, mo - 1, d)).getUTCDay(); // 0 = 週日
  const dayStartIso = new Date(dayStartMs).toISOString();
  const dayEndIso = new Date(dayEndMs).toISOString();

  const { data: settingsRow, error: setErr } = await t.supabase.from('tenant_settings')
    .select('business').eq('tenant_id', t.tenantId).maybeSingle();
  if (setErr) throw setErr;
  const biz = businessSettingsSchema.parse(settingsRow?.business ?? {});

  // 1. 營業時段窗（當日分鐘數區間）
  let windows: Array<{ start: number; end: number }> = [];
  if (biz.perDayMode) {
    windows = (biz.perDayHours[weekday] ?? [])
      .map((w) => ({ start: hmToMin(w.start), end: hmToMin(w.end) }));
  } else if (!biz.closedDays.includes(weekday)) {
    const open = hmToMin(biz.businessStart);
    const close = hmToMin(biz.businessEnd);
    if (biz.breakStart && biz.breakEnd) {
      windows = [
        { start: open, end: hmToMin(biz.breakStart) },
        { start: hmToMin(biz.breakEnd), end: close },
      ];
    } else {
      windows = [{ start: open, end: close }];
    }
  }
  windows = windows.filter((w) => w.end - w.start >= duration);
  if (windows.length === 0) return ok({ slots: [] });

  // 3. 員工池
  let pool: string[] = [];
  if (q.staffId) {
    const { data: staff, error } = await t.supabase.from('staff').select('id')
      .eq('id', q.staffId).eq('tenant_id', t.tenantId)
      .eq('active', true).eq('bookable', true).maybeSingle();
    if (error) throw error;
    if (!staff) throw new ApiHttpError(404, '找不到此服務人員', ERR.NOT_FOUND);
    pool = [staff.id];
  } else {
    const [{ data: allStaff, error: stErr }, { data: links, error: lkErr }] = await Promise.all([
      t.supabase.from('staff').select('id')
        .eq('tenant_id', t.tenantId).eq('active', true).eq('bookable', true),
      t.supabase.from('staff_services').select('staff_id')
        .eq('tenant_id', t.tenantId).eq('service_id', q.serviceId),
    ]);
    if (stErr) throw stErr;
    if (lkErr) throw lkErr;
    const bookableIds = (allStaff ?? []).map((s) => s.id);
    const linked = new Set((links ?? []).map((l) => l.staff_id));
    const linkedBookable = bookableIds.filter((id) => linked.has(id));
    pool = linkedBookable.length > 0 ? linkedBookable : bookableIds;
  }
  if (pool.length === 0) return ok({ slots: [] });

  // 該日既有負載（重疊判定用 start < dayEnd && end > dayStart 撈整天）
  // block_times 走共用的 queryEffectiveBlockTimes：WEEKLY 規則在這裡展開成
  // 「今天」實際發生的那一次，不能只用 start_at 的日期範圍過濾（那是首次發生
  // 的日期，可能遠早於今天）。
  const [{ data: bookings, error: bErr }, blocks,
         { data: shifts, error: shErr }] = await Promise.all([
    t.supabase.from('bookings').select('staff_id, start_at, end_at')
      .eq('tenant_id', t.tenantId).in('status', ['PENDING', 'CONFIRMED'])
      .lt('start_at', dayEndIso).gt('end_at', dayStartIso),
    queryEffectiveBlockTimes(t.supabase, t.tenantId, dayStartIso, dayEndIso),
    t.supabase.from('shifts').select('staff_id, start_time, end_time')
      .eq('tenant_id', t.tenantId).eq('work_date', q.date),
  ]);
  if (bErr) throw bErr;
  if (shErr) throw shErr;

  const tenantHasShiftsToday = (shifts ?? []).length > 0;
  const shiftsByStaff = new Map<string, Array<{ start: number; end: number }>>();
  for (const s of shifts ?? []) {
    const list = shiftsByStaff.get(s.staff_id) ?? [];
    list.push({ start: hmToMin(s.start_time), end: hmToMin(s.end_time) });
    shiftsByStaff.set(s.staff_id, list);
  }

  const overlaps = (aS: number, aE: number, bS: number, bE: number) => aS < bE && aE > bS;

  // 2+4. 產時段並逐員工檢查
  const slots: Array<{ start: string; end: string; staffIds: string[] }> = [];
  for (const w of windows) {
    for (let min = w.start; min + duration <= w.end; min += biz.slotInterval) {
      const slotStartMs = dayStartMs + min * 60_000;
      const slotEndMs = slotStartMs + duration * 60_000;

      const staffIds = pool.filter((staffId) => {
        // shifts：該日有排班資料時，只有自己班段涵蓋整個時段的員工可排
        if (tenantHasShiftsToday) {
          const myShifts = shiftsByStaff.get(staffId);
          if (!myShifts) return false; // 當天沒排班 = 不上班
          if (!myShifts.some((s) => s.start <= min && min + duration <= s.end)) return false;
        }
        // 既有預約（該員工）重疊
        if ((bookings ?? []).some((b) => b.staff_id === staffId &&
          overlaps(slotStartMs, slotEndMs, Date.parse(b.start_at), Date.parse(b.end_at))))
          return false;
        // 封鎖時段（該員工或全店）重疊
        if ((blocks ?? []).some((bl) => (bl.staff_id === null || bl.staff_id === staffId) &&
          overlaps(slotStartMs, slotEndMs, Date.parse(bl.start_at), Date.parse(bl.end_at))))
          return false;
        return true;
      });

      if (staffIds.length > 0) {
        slots.push({
          start: new Date(slotStartMs).toISOString(),
          end: new Date(slotEndMs).toISOString(),
          staffIds,
        });
      }
    }
  }

  return ok({ slots });
});
