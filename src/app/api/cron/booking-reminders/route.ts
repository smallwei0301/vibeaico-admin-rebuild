/**
 * GET /api/cron/booking-reminders — 預約提醒推播（07 分冊 §2 各 job 邏輯表）。
 * 每小時執行（vercel.json：0 * * * *）。
 *
 * 逐店流程：
 *  1. tenant_settings.notify（zod parse 補預設）→ notifyBookingReminder 關閉 → 跳過
 *  2. BOOKING_REMINDER 功能閘門（09 分冊 §5：cron 逐店過濾，isFeatureActive）
 *  3. 找 start_at ∈ [now + reminderHoursBefore − 30min, now + reminderHoursBefore + 30min)
 *     且 status='CONFIRMED' 且 reminder_sent_at is null 的 bookings
 *     （每小時跑一次、窗寬正好 1 小時 → 半開區間讓相鄰兩輪不重不漏）
 *  4. 逐筆先「條件式搶佔」reminder_sent_at=now()（.is('reminder_sent_at', null)）——
 *     搶不到（affected 0 列）= 已被並發的另一輪處理，直接跳過，防重發
 *  5. 搶到者 await notifyBookingStatus(tenantId, id, 'REMINDER')（該函式自吞錯、
 *     自查開關與額度；先標記後推播 = 寧可漏推不重複騷擾，與 0013 防重發欄位語意一致）
 *
 * 單店失敗只 log 不中斷整批（07 分冊慣例）。回 { processedTenants, reminded }。
 */
import { NextResponse } from 'next/server';
import { createAdminSupabase } from '@/server/supabase';
import { notifySettingsSchema } from '@/config/tenant-settings';
import { isFeatureActive } from '@/server/features';
import { notifyBookingStatus } from '@/server/line-notify';

export const runtime = 'nodejs';

const HOUR_MS = 60 * 60 * 1000;
const HALF_HOUR_MS = 30 * 60 * 1000;

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`)
    return new Response('unauthorized', { status: 401 });

  const admin = createAdminSupabase();
  const now = Date.now();

  const { data: rows, error } = await admin
    .from('tenant_settings')
    .select('tenant_id, notify');
  if (error) {
    console.error('[cron] booking-reminders: 查詢 tenant_settings 失敗', error);
    return new Response('query failed', { status: 500 });
  }

  let processedTenants = 0;
  let reminded = 0;

  for (const row of rows ?? []) {
    const tenantId = row.tenant_id as string;
    try {
      const notify = notifySettingsSchema.parse(row.notify ?? {});
      if (!notify.notifyBookingReminder) continue;
      if (!(await isFeatureActive(tenantId, 'BOOKING_REMINDER'))) continue; // 09 §5 閘門
      processedTenants++;

      const targetMs = now + notify.reminderHoursBefore * HOUR_MS;
      const fromIso = new Date(targetMs - HALF_HOUR_MS).toISOString();
      const toIso = new Date(targetMs + HALF_HOUR_MS).toISOString();

      const { data: bookings, error: bErr } = await admin
        .from('bookings')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('status', 'CONFIRMED')
        .is('reminder_sent_at', null)
        .gte('start_at', fromIso)
        .lt('start_at', toIso);
      if (bErr) throw bErr;

      for (const b of bookings ?? []) {
        // 條件式搶佔：affected 0 列 = 已被別的執行個體處理 → 跳過（防並發重發）
        const { data: claimed, error: cErr } = await admin
          .from('bookings')
          .update({ reminder_sent_at: new Date().toISOString() })
          .eq('id', b.id)
          .eq('tenant_id', tenantId)
          .is('reminder_sent_at', null)
          .select('id');
        if (cErr) throw cErr;
        if (!claimed?.length) continue;

        await notifyBookingStatus(tenantId, b.id as string, 'REMINDER');
        reminded++;
      }
    } catch (e) {
      console.error('[cron] booking-reminders: 單店處理失敗', tenantId, e);
    }
  }

  return NextResponse.json({ processedTenants, reminded });
}
