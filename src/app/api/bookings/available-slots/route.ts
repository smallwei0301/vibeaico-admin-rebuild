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
import { departureInterval, loadStaffAvailability, type AvailabilityStaff } from '@/server/staff-availability';

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
  let pool: AvailabilityStaff[] = [];
  if (q.staffId) {
    const { data: staff, error } = await t.supabase.from('staff').select('id, name, availability_policy')
      .eq('id', q.staffId).eq('tenant_id', t.tenantId)
      .eq('active', true).eq('bookable', true).maybeSingle();
    if (error) throw error;
    if (!staff) throw new ApiHttpError(404, '找不到此服務人員', ERR.NOT_FOUND);
    pool = [{ id: staff.id, name: staff.name, availabilityPolicy: staff.availability_policy ?? 'DEFAULT_AVAILABLE' }];
  } else {
    const [{ data: allStaff, error: stErr }, { data: links, error: lkErr }] = await Promise.all([
      t.supabase.from('staff').select('id, name, availability_policy')
        .eq('tenant_id', t.tenantId).eq('active', true).eq('bookable', true),
      t.supabase.from('staff_services').select('staff_id')
        .eq('tenant_id', t.tenantId).eq('service_id', q.serviceId),
    ]);
    if (stErr) throw stErr;
    if (lkErr) throw lkErr;
    const bookable = (allStaff ?? []).map((s: any) => ({
      id: s.id, name: s.name, availabilityPolicy: s.availability_policy ?? 'DEFAULT_AVAILABLE',
    } satisfies AvailabilityStaff));
    const bookableIds = bookable.map((s) => s.id);
    const linked = new Set((links ?? []).map((l) => l.staff_id));
    const linkedBookable = bookableIds.filter((id) => linked.has(id));
    const selected = linkedBookable.length > 0 ? new Set(linkedBookable) : new Set(bookableIds);
    pool = bookable.filter((staff) => selected.has(staff.id));
  }
  if (pool.length === 0) return ok({ slots: [] });

  // 2+4. 產時段並將每位候選交給共用 availability engine。
  const slots: Array<{ start: string; end: string; staffIds: string[] }> = [];
  for (const w of windows) {
    for (let min = w.start; min + duration <= w.end; min += biz.slotInterval) {
      const candidate = departureInterval(q.date, `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`, duration);
      const availability = await loadStaffAvailability({
        supabase: t.supabase, tenantId: t.tenantId, date: q.date, staff: pool, interval: candidate,
      });
      const staffIds = availability.filter((item) => item.available).map((item) => item.staffId);

      if (staffIds.length > 0) {
        slots.push({
          start: candidate.start,
          end: candidate.end,
          staffIds,
        });
      }
    }
  }

  return ok({ slots });
});
