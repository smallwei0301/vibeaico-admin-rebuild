/**
 * GET /api/cron/booking-reminders — 預約提醒推播（07 分冊 §2 各 job 邏輯表）。
 *
 * ⚠️ 執行頻率與時間窗（偏離 07 分冊字面規格，理由如下，勿改回）：
 * 分冊假設每小時執行、時間窗取 `now + reminderHoursBefore ± 30min`（窗寬 1 小時
 * 正好接續）。但 Vercel **Hobby 方案的 cron 只允許「每天一次」**，更頻繁的
 * cron 運算式會讓**整個部署被拒絕**（官方文件：「Hobby accounts are limited to
 * cron jobs that run once per day. Cron expressions that would run more
 * frequently will fail during deployment.」）。在每日一次的節奏下，±30min 的窗
 * 每天只掃到 1 小時的預約，其餘 23 小時的預約永遠收不到提醒。
 *
 * 因此改為「節奏無關」的窗：**start_at 在 (now, now + reminderHoursBefore] 之內
 * 且尚未提醒過**。這個定義在每小時與每天兩種節奏下都正確：
 *   - 每小時跑：與原規格同樣在約 N 小時前送出（第一個涵蓋到的輪次即送）
 *   - 每天跑：當天該送的全部涵蓋，不再漏掉 23/24 的預約
 * 重複由 reminder_sent_at 的條件式搶佔擋掉（見下），故放寬窗不會造成重送。
 * 升級 Pro 方案後可把 vercel.json 改回每小時，本邏輯無需變動。
 *
 * 逐店流程：
 *  1. tenant_settings.notify（zod parse 補預設）→ notifyBookingReminder 關閉 → 跳過
 *  2. BOOKING_REMINDER 功能閘門（09 分冊 §5：cron 逐店過濾，isFeatureActive）
 *  3. 找 start_at ∈ (now, now + reminderHoursBefore] 且 status='CONFIRMED'
 *     且 reminder_sent_at is null 的 bookings（已開始的預約不再提醒）
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

      // (now, now + reminderHoursBefore]：已開始的不提醒、N 小時內開始的都涵蓋。
      const fromIso = new Date(now).toISOString();
      const toIso = new Date(now + notify.reminderHoursBefore * HOUR_MS).toISOString();

      const { data: bookings, error: bErr } = await admin
        .from('bookings')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('status', 'CONFIRMED')
        .is('reminder_sent_at', null)
        .gt('start_at', fromIso)
        .lte('start_at', toIso);
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
