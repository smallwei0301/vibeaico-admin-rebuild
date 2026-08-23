// POST /api/recurring-bookings/:id/renew — 依 rule 從今天（台北）起產生未來的
// 實體 bookings（source='RECURRING'），回 { created, skipped }（04 §B-1）。
// skipped = 「該檔期已有同一顧客同一服務同時刻的 PENDING/CONFIRMED 預約」（重複
// renew 防呆——bookings 沒有 recurring_booking_id 欄位可精準對應，以此近似）
// ＋「DB 排除約束 23P01 擋下的重疊檔期」。
import { z } from 'zod';
import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { taipeiTodayDateString } from '@/server/tz';

const ruleSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  intervalWeeks: z.number().int().min(1),
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** 防呆上限：until 設得太遠時單次 renew 最多產生的檔期數 */
const MAX_OCCURRENCES = 200;

/**
 * booking_no 產號 —— 與 src/app/api/bookings/route.ts 的 nextBookingNo 同一套
 * 規則（'B'+建立日 yymmdd+4 碼流水）。route 檔不能 export 非 HTTP method、
 * §B-1 分工又不允許新增共用模組，故此處複製一份；改規則時兩處一起改。
 */
async function nextBookingNo(
  supabase: Awaited<ReturnType<typeof requireTenant>>['supabase'],
  tenantId: string,
): Promise<string> {
  const yymmdd = taipeiTodayDateString().slice(2).replace(/-/g, '');
  const prefix = `B${yymmdd}`;
  const { data, error } = await supabase.from('bookings')
    .select('booking_no')
    .eq('tenant_id', tenantId)
    .like('booking_no', `${prefix}%`)
    .order('booking_no', { ascending: false })
    .limit(1);
  if (error) throw error;
  const lastSeq = data?.[0] ? Number(data[0].booking_no.slice(prefix.length)) : 0;
  return `${prefix}${String((Number.isFinite(lastSeq) ? lastSeq : 0) + 1).padStart(4, '0')}`;
}

export const POST = handle(async (_req, { params }) => {
  const t = await requireTenant();
  const { id } = await params;

  const { data: rec, error: rErr } = await t.supabase.from('recurring_bookings')
    .select('id, customer_id, service_id, staff_id, rule, active')
    .eq('id', id).eq('tenant_id', t.tenantId).maybeSingle();
  if (rErr) throw rErr;
  if (!rec) throw new ApiHttpError(404, '找不到此週期性預約', ERR.NOT_FOUND);
  if (!rec.active) throw new ApiHttpError(409, '此週期性預約已停用', ERR.CONFLICT);

  const rule = ruleSchema.parse(rec.rule);

  const { data: service, error: sErr } = await t.supabase.from('services')
    .select('id, duration_minutes, price')
    .eq('id', rec.service_id).eq('tenant_id', t.tenantId).maybeSingle();
  if (sErr) throw sErr;
  if (!service) throw new ApiHttpError(404, '找不到此服務', ERR.NOT_FOUND);

  // 檔期展開：今天（台北）起第一個符合 weekday 的日期為錨點，之後每
  // intervalWeeks 週一次，直到 until（含）。全程以「台北日 00:00 的 UTC 瞬間」
  // 為刻度運算（+08:00 固定無日光節約，src/server/tz.ts 同法）。
  const [ty, tm, td] = taipeiTodayDateString().split('-').map(Number);
  const todayStartMs = Date.UTC(ty, tm - 1, td) - TAIPEI_OFFSET_MS;
  const todayWeekday = new Date(Date.UTC(ty, tm - 1, td)).getUTCDay();
  const [uy, um, ud] = rule.until.split('-').map(Number);
  const untilStartMs = Date.UTC(uy, um - 1, ud) - TAIPEI_OFFSET_MS;
  const [hh, mm] = rule.time.split(':').map(Number);
  const timeOffsetMs = (hh * 60 + mm) * 60_000;
  const durationMs = service.duration_minutes * 60_000;

  const firstMs = todayStartMs + ((rule.weekday - todayWeekday + 7) % 7) * DAY_MS;
  const startTimes: number[] = [];
  for (let dayMs = firstMs;
       dayMs <= untilStartMs && startTimes.length < MAX_OCCURRENCES;
       dayMs += rule.intervalWeeks * 7 * DAY_MS) {
    startTimes.push(dayMs + timeOffsetMs);
  }
  if (startTimes.length === 0) return ok({ created: 0, skipped: 0 });

  // 重複 renew 防呆：同顧客+同服務+同開始時刻已有 PENDING/CONFIRMED → 跳過
  const isoList = startTimes.map((ms) => new Date(ms).toISOString());
  const { data: existing, error: eErr } = await t.supabase.from('bookings')
    .select('start_at')
    .eq('tenant_id', t.tenantId)
    .eq('customer_id', rec.customer_id)
    .eq('service_id', rec.service_id)
    .in('status', ['PENDING', 'CONFIRMED'])
    .in('start_at', isoList);
  if (eErr) throw eErr;
  const taken = new Set((existing ?? []).map((r) => new Date(r.start_at).toISOString()));

  let created = 0;
  let skipped = 0;
  for (const startMs of startTimes) {
    const startIso = new Date(startMs).toISOString();
    if (taken.has(startIso)) { skipped++; continue; }

    // 逐筆插入（流水號相依，無法批次）；23P01 = 該檔期與他約重疊 → 跳過統計，
    // 23505 = 併發撞單號 → 重取流水重試。
    let inserted = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      const { error } = await t.supabase.from('bookings').insert({
        tenant_id: t.tenantId,
        booking_no: await nextBookingNo(t.supabase, t.tenantId),
        customer_id: rec.customer_id,
        service_id: rec.service_id,
        staff_id: rec.staff_id,
        start_at: startIso,
        end_at: new Date(startMs + durationMs).toISOString(),
        duration_minutes: service.duration_minutes,
        price: service.price,
        final_price: service.price,
        source: 'RECURRING',
      });
      if (!error) { inserted = true; break; }
      if (error.code === '23P01') break; // 重疊 → 這個檔期放棄
      if (error.code === '23505' && attempt < 2) continue;
      throw error;
    }
    if (inserted) created++; else skipped++;
  }

  return ok({ created, skipped });
});
