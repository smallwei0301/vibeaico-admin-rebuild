/**
 * GET /api/cron/birthday-greetings — 生日祝福推播（07 分冊 §2 各 job 邏輯表）。
 * 每日執行（vercel.json：0 1 * * * = 台北 09:00）。
 *
 * 逐店流程：
 *  1. tenant_settings.notify → enableBirthdayGreeting 關閉 → 跳過
 *  2. BIRTHDAY_GREETING 功能閘門（09 分冊 §5，isFeatureActive）
 *  3. birthdayGreetingMessage 空字串 → 該店跳過（沒有文案可推）
 *  4. customers 生日「月-日」= 台北今天（taipeiTodayDateString().slice(5)；
 *     date 欄位以字串回傳，直接比對尾五碼——閏年 02-29 只在真正的 02-29 當天推）
 *     且 line_user_id 非空
 *  5. 逐位：consumePushQuota(tenantId, 1) 失敗 → 該店額度用罄，停止整店
 *     → linePush 文案 → 寫 chat_messages（direction='OUT'，後台聊天頁看得到）
 *
 * 冪等性：每日只跑一次、同日重跑會重複推播（原站同行為，無防重欄位）；
 * 額度控管天然限制重複量。單店失敗只 log 不中斷整批。
 * 回 { processedTenants, greeted }。
 */
import { NextResponse } from 'next/server';
import { createAdminSupabase } from '@/server/supabase';
import { notifySettingsSchema } from '@/config/tenant-settings';
import { isFeatureActive } from '@/server/features';
import { getLineCredentials, linePush, consumePushQuota } from '@/server/line';
import { taipeiTodayDateString } from '@/server/tz';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`)
    return new Response('unauthorized', { status: 401 });

  const admin = createAdminSupabase();
  const todayMmDd = taipeiTodayDateString().slice(5); // 'MM-DD'（台北日曆日）

  const { data: rows, error } = await admin
    .from('tenant_settings')
    .select('tenant_id, notify');
  if (error) {
    console.error('[cron] birthday-greetings: 查詢 tenant_settings 失敗', error);
    return new Response('query failed', { status: 500 });
  }

  let processedTenants = 0;
  let greeted = 0;

  for (const row of rows ?? []) {
    const tenantId = row.tenant_id as string;
    try {
      const notify = notifySettingsSchema.parse(row.notify ?? {});
      if (!notify.enableBirthdayGreeting) continue;
      if (!(await isFeatureActive(tenantId, 'BIRTHDAY_GREETING'))) continue; // 09 §5 閘門
      const message = notify.birthdayGreetingMessage.trim();
      if (!message) continue;                          // 沒文案 → 跳過該店
      processedTenants++;

      // 未設定 LINE → getLineCredentials 丟 LINE_001，落到單店 catch（log 後下一店）
      const { token } = await getLineCredentials(tenantId);

      const { data: customers, error: cErr } = await admin
        .from('customers')
        .select('id, birthday, line_user_id')
        .eq('tenant_id', tenantId)
        .not('birthday', 'is', null)
        .not('line_user_id', 'is', null);
      if (cErr) throw cErr;

      const birthdayToday = (customers ?? []).filter(
        (c) => String(c.birthday).slice(5) === todayMmDd && c.line_user_id,
      );

      for (const c of birthdayToday) {
        if (!(await consumePushQuota(tenantId, 1))) {
          console.error('[cron] birthday-greetings: 推播額度不足，該店停止', tenantId);
          break;                                       // 過額度 → 整店停
        }
        await linePush(token, c.line_user_id as string, [{ type: 'text', text: message }]);
        await admin.from('chat_messages').insert({
          tenant_id: tenantId,
          line_user_id: c.line_user_id,
          direction: 'OUT',
          message_type: 'text',
          content: { text: message },
        });
        greeted++;
      }
    } catch (e) {
      console.error('[cron] birthday-greetings: 單店處理失敗', tenantId, e);
    }
  }

  return NextResponse.json({ processedTenants, greeted });
}
