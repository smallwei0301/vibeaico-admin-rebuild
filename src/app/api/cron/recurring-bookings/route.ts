/**
 * GET /api/cron/recurring-bookings — 週期性預約自動補建（07 分冊 §2 各 job 邏輯表）。
 * 每日執行（vercel.json：30 16 * * * = 台北 00:30）。
 *
 * 逐 active 規則處理（跨全店，單筆失敗只 log 不中斷）：
 *  1. rule {weekday,time,intervalWeeks,until} 依「錨點演算法」展開（與
 *     src/app/api/recurring-bookings/[id]/renew/route.ts 同一套）：台北今天起第一個
 *     符合 weekday 的日期為錨點，之後每 intervalWeeks 週一次，直到 until（含）。
 *  2. 只取落在「未來 7 天」（[台北今天 00:00, +7 天) 半開區間）內的場次——每天跑，
 *     視窗天天前移，缺的自然補上；錨點自今天算起，intervalWeeks ≥ 1 時窗內至多 1 場。
 *  3. 已存在「同顧客＋同服務＋同開始時刻的 PENDING/CONFIRMED」→ skipped（renew 的
 *     重複防呆近似——bookings 無 recurring_booking_id 欄位可精準對應）。
 *  4. 缺的補建 bookings：source='RECURRING'、status='CONFIRMED'、booking_no 流水同
 *     renew；23P01（員工時段重疊排除約束）→ skipped；23505（併發撞單號）→ 重取重試。
 *
 * 回 { processedRules, created, skipped }。
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminSupabase } from '@/server/supabase';
import { taipeiTodayDateString } from '@/server/tz';

export const runtime = 'nodejs';

const ruleSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  intervalWeeks: z.number().int().min(1),
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** 補建視窗：未來 7 天（07 分冊 §2） */
const HORIZON_DAYS = 7;

/**
 * booking_no 產號 —— 與 src/app/api/bookings/route.ts、renew route 的 nextBookingNo
 * 同一套規則（'B'+建立日 yymmdd+4 碼流水）。route 檔不能 export 非 HTTP method、
 * 分工不允許動既有檔案，故此處再複製一份；改規則時三處一起改。
 */
async function nextBookingNo(
  admin: ReturnType<typeof createAdminSupabase>,
  tenantId: string,
): Promise<string> {
  const yymmdd = taipeiTodayDateString().slice(2).replace(/-/g, '');
  const prefix = `B${yymmdd}`;
  const { data, error } = await admin.from('bookings')
    .select('booking_no')
    .eq('tenant_id', tenantId)
    .like('booking_no', `${prefix}%`)
    .order('booking_no', { ascending: false })
    .limit(1);
  if (error) throw error;
  const lastSeq = data?.[0] ? Number(data[0].booking_no.slice(prefix.length)) : 0;
  return `${prefix}${String((Number.isFinite(lastSeq) ? lastSeq : 0) + 1).padStart(4, '0')}`;
}

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`)
    return new Response('unauthorized', { status: 401 });

  const admin = createAdminSupabase();

  const { data: rules, error } = await admin
    .from('recurring_bookings')
    .select('id, tenant_id, customer_id, service_id, staff_id, rule')
    .eq('active', true);
  if (error) {
    console.error('[cron] recurring-bookings: 查詢 recurring_bookings 失敗', error);
    return new Response('query failed', { status: 500 });
  }

  // 展開刻度（renew 同法）：全程以「台北日 00:00 的 UTC 瞬間」運算（+08:00 固定）
  const [ty, tm, td] = taipeiTodayDateString().split('-').map(Number);
  const todayStartMs = Date.UTC(ty, tm - 1, td) - TAIPEI_OFFSET_MS;
  const todayWeekday = new Date(Date.UTC(ty, tm - 1, td)).getUTCDay();
  const horizonEndMs = todayStartMs + HORIZON_DAYS * DAY_MS;

  let processedRules = 0;
  let created = 0;
  let skipped = 0;

  for (const rec of rules ?? []) {
    const tenantId = rec.tenant_id as string;
    try {
      processedRules++;
      const rule = ruleSchema.parse(rec.rule);

      const { data: service, error: sErr } = await admin.from('services')
        .select('id, duration_minutes, price')
        .eq('id', rec.service_id).eq('tenant_id', tenantId).maybeSingle();
      if (sErr) throw sErr;
      if (!service) continue;                          // 服務已不存在 → 略過此規則

      const [uy, um, ud] = rule.until.split('-').map(Number);
      const untilStartMs = Date.UTC(uy, um - 1, ud) - TAIPEI_OFFSET_MS;
      const [hh, mm] = rule.time.split(':').map(Number);
      const timeOffsetMs = (hh * 60 + mm) * 60_000;
      const durationMs = service.duration_minutes * 60_000;

      // 錨點：今天起第一個符合 weekday 的日期，之後每 intervalWeeks 週一次；
      // 只留 until（含）以內、且落在 7 天視窗內的場次
      const firstMs = todayStartMs + ((rule.weekday - todayWeekday + 7) % 7) * DAY_MS;
      const startTimes: number[] = [];
      for (let dayMs = firstMs;
           dayMs <= untilStartMs && dayMs < horizonEndMs;
           dayMs += rule.intervalWeeks * 7 * DAY_MS) {
        startTimes.push(dayMs + timeOffsetMs);
      }
      if (startTimes.length === 0) continue;

      // 重複防呆：同顧客+同服務+同開始時刻已有 PENDING/CONFIRMED → skipped
      const isoList = startTimes.map((ms) => new Date(ms).toISOString());
      const { data: existing, error: eErr } = await admin.from('bookings')
        .select('start_at')
        .eq('tenant_id', tenantId)
        .eq('customer_id', rec.customer_id)
        .eq('service_id', rec.service_id)
        .in('status', ['PENDING', 'CONFIRMED'])
        .in('start_at', isoList);
      if (eErr) throw eErr;
      const taken = new Set((existing ?? []).map((r) => new Date(r.start_at).toISOString()));

      for (const startMs of startTimes) {
        const startIso = new Date(startMs).toISOString();
        if (taken.has(startIso)) { skipped++; continue; }

        // 逐筆插入（流水號相依）；23P01 = 與他約重疊 → skipped，
        // 23505 = 併發撞單號 → 重取流水重試（renew 同法）
        let inserted = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          const { error: iErr } = await admin.from('bookings').insert({
            tenant_id: tenantId,
            booking_no: await nextBookingNo(admin, tenantId),
            customer_id: rec.customer_id,
            service_id: rec.service_id,
            staff_id: rec.staff_id,
            start_at: startIso,
            end_at: new Date(startMs + durationMs).toISOString(),
            duration_minutes: service.duration_minutes,
            price: service.price,
            final_price: service.price,
            source: 'RECURRING',
            status: 'CONFIRMED',
          });
          if (!iErr) { inserted = true; break; }
          if (iErr.code === '23P01') break;            // 重疊 → 這個檔期放棄
          if (iErr.code === '23505' && attempt < 2) continue;
          throw iErr;
        }
        if (inserted) created++; else skipped++;
      }
    } catch (e) {
      console.error('[cron] recurring-bookings: 單筆規則處理失敗', rec.id, tenantId, e);
    }
  }

  return NextResponse.json({ processedRules, created, skipped });
}
