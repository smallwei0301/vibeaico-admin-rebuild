/**
 * GET /api/cron/customer-recall — 沉睡顧客喚回推播（07 分冊 §2 各 job 邏輯表）。
 * 每日執行（vercel.json：0 6 * * * = 台北 14:00）。
 *
 * 逐店流程：
 *  1. tenant_settings.notify → enableCustomerRecall 關閉 → 跳過
 *  2. CUSTOMER_RECALL 功能閘門（09 分冊 §5，isFeatureActive）
 *  3. customerRecallMessage 空字串 → 該店跳過
 *  4. customers_view：last_visit_at < now() − customerRecallDays 天、line_user_id 非空、
 *     (last_recall_at is null 或 < now() − 30 天)（0013 防重欄位：30 天內不重推），
 *     每店每日上限 50 位（原站規則，limit 50；最久未回的優先）
 *  5. 逐位：consumePushQuota(tenantId, 1) 失敗 → 該店停止
 *     → linePush 文案 → update customers.last_recall_at=now()（推成功才標記，
 *     push 丟錯落到單店 catch，未標記者次日重試）→ 寫 chat_messages（direction='OUT'）
 *
 * 單店失敗只 log 不中斷整批。回 { processedTenants, recalled }。
 */
import { NextResponse } from 'next/server';
import { createAdminSupabase } from '@/server/supabase';
import { notifySettingsSchema } from '@/config/tenant-settings';
import { isFeatureActive } from '@/server/features';
import { getLineCredentials, linePush, consumePushQuota } from '@/server/line';

export const runtime = 'nodejs';

const DAY_MS = 24 * 60 * 60 * 1000;
/** 每店每日喚回上限（原站規則） */
const DAILY_LIMIT = 50;
/** 同一顧客兩次喚回的最短間隔（天） */
const RECALL_COOLDOWN_DAYS = 30;

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`)
    return new Response('unauthorized', { status: 401 });

  const admin = createAdminSupabase();
  const now = Date.now();

  const { data: rows, error } = await admin
    .from('tenant_settings')
    .select('tenant_id, notify');
  if (error) {
    console.error('[cron] customer-recall: 查詢 tenant_settings 失敗', error);
    return new Response('query failed', { status: 500 });
  }

  let processedTenants = 0;
  let recalled = 0;

  for (const row of rows ?? []) {
    const tenantId = row.tenant_id as string;
    try {
      const notify = notifySettingsSchema.parse(row.notify ?? {});
      if (!notify.enableCustomerRecall) continue;
      if (!(await isFeatureActive(tenantId, 'CUSTOMER_RECALL'))) continue; // 09 §5 閘門
      const message = notify.customerRecallMessage.trim();
      if (!message) continue;                          // 沒文案 → 跳過該店
      processedTenants++;

      const { token } = await getLineCredentials(tenantId); // 未設 LINE → 單店 catch

      const visitCutoffIso = new Date(now - notify.customerRecallDays * DAY_MS).toISOString();
      const recallCutoffIso = new Date(now - RECALL_COOLDOWN_DAYS * DAY_MS).toISOString();

      const { data: customers, error: cErr } = await admin
        .from('customers_view')
        .select('id, line_user_id, last_visit_at, last_recall_at')
        .eq('tenant_id', tenantId)
        .not('line_user_id', 'is', null)
        .lt('last_visit_at', visitCutoffIso)           // 隱含 last_visit_at 非 null
        .or(`last_recall_at.is.null,last_recall_at.lt.${recallCutoffIso}`)
        .order('last_visit_at', { ascending: true })   // 最久未回的優先
        .limit(DAILY_LIMIT);
      if (cErr) throw cErr;

      for (const c of customers ?? []) {
        if (!(await consumePushQuota(tenantId, 1))) {
          console.error('[cron] customer-recall: 推播額度不足，該店停止', tenantId);
          break;                                       // 過額度 → 整店停
        }
        await linePush(token, c.line_user_id as string, [{ type: 'text', text: message }]);
        await admin
          .from('customers')
          .update({ last_recall_at: new Date().toISOString() })
          .eq('id', c.id)
          .eq('tenant_id', tenantId);
        await admin.from('chat_messages').insert({
          tenant_id: tenantId,
          line_user_id: c.line_user_id,
          direction: 'OUT',
          message_type: 'text',
          content: { text: message },
        });
        recalled++;
      }
    } catch (e) {
      console.error('[cron] customer-recall: 單店處理失敗', tenantId, e);
    }
  }

  return NextResponse.json({ processedTenants, recalled });
}
