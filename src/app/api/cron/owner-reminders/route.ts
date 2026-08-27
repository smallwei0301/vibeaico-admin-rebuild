/**
 * GET /api/cron/owner-reminders — 老闆通知的「訂閱到期／儲值提醒」（06 分冊 §5.5，issue #18）。
 * 每日執行（vercel.json：0 18 * * * = 台北 02:00）。
 *
 * 規格逐字（`docs/specs/dashboard.json`）：
 *   「『主要』接收者另外會收到訂閱到期／儲值提醒（**僅發給主要一位**）。」
 * 所以這支 cron 送出的每一則都走 `notifyOwnerPrimary()`——名單上的其他人一則都收不到。
 *
 * ## 兩種提醒的判定條件（何者是既有的、何者是我方設計）
 *
 * | 提醒 | 判定 | 出處 |
 * |---|---|---|
 * | 訂閱到期 | `feature_subscriptions.active` 且 `expires_at` 落在「現在 ~ 現在 + `FEATURE_EXPIRY_WARNING_DAYS` 天」 | **既有常數**：`src/config/features.ts`，`/api/reports/dashboard-alerts` 的 `expiringFeatures` 用的是同一個窗 |
 * | 儲值 | 該店點數餘額 < 上述即將到期訂閱的續訂所需點數總和 | **我方設計**（見下） |
 *
 * ⚠️ 儲值提醒的門檻是**我們選的，不是原站考據結果**。`docs/specs/*.json` 全文
 * 只有「主要接收者會收到訂閱到期／儲值提醒」這一句，**沒有任何一句記錄門檻是多少**
 * （`grep -rn 儲值 docs/specs/` 的命中全部在點數頁與功能商店頁，都是儲值流程本身）。
 * 選這個條件的理由：它不引進任何新的魔術數字——兩個數都是系統裡已經有的
 * （點數餘額 = `tenant_point_transactions` 最新一筆的 `balance_after`；
 * 續訂所需 = `FEATURE_CATALOG` 的月費），而且它解釋了規格為什麼把
 * 「訂閱到期」與「儲值」寫成同一組提醒——點數不足正是續訂不了的原因
 * （`docs/specs/feature-store.json`：「點數不足時可前往『點數管理』儲值」）。
 * 這一段已在 issue #18 留言列為規格缺口，日後找到出處再改。
 *
 * ## 去重（每日跑，同一件事不可以連發七天）
 * `owner_notify_reminder_log`（migration 0022）：
 *   - 訂閱到期：`ref = '<code>@<expires_at>'` → 同一張訂閱只提醒一次
 *   - 儲值：`ref = 台北月份鍵 'YYYY-MM'` → 同一個月最多提醒一次
 * **推播真的送出去了才寫紀錄**（`notifyOwnerPrimary` 回 false ＝額度不足／LINE
 * 打不通／沒有主要接收者），否則這次沒送到、下次也不會再送。
 *
 * 單店失敗只 log，不中斷整批（07 分冊慣例）。回 `{ processedTenants, expiryReminders, topupReminders }`。
 */
import { NextResponse } from 'next/server';
import { createAdminSupabase } from '@/server/supabase';
import { FEATURE_CATALOG, FEATURE_EXPIRY_WARNING_DAYS } from '@/config/features';
import { taipeiCurrentMonthKey } from '@/server/tz';
import {
  buildOwnerPointsLowText, buildOwnerSubscriptionExpiryText, notifyOwnerPrimary,
} from '@/server/owner-notify';
import { featureStorePage } from '@/i18n/zh-TW/pages/feature-store';

export const runtime = 'nodejs';

const DAY_MS = 24 * 60 * 60 * 1000;

/** 功能碼 → 顯示名稱（讀 i18n 字典，不在 server 端再抄一份中文清單） */
function featureName(code: string): string {
  const entry = (featureStorePage.features as Record<string, { name?: string } | undefined>)[code];
  return entry?.name ?? code;
}

/** 功能碼 → 月費（點/月）；目錄查不到（舊碼）算 0，不要瞎猜一個價 */
function monthlyPrice(code: string): number {
  return FEATURE_CATALOG.find((f) => f.key === code)?.price ?? 0;
}

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`)
    return new Response('unauthorized', { status: 401 });

  const admin = createAdminSupabase();
  const now = Date.now();
  const windowEnd = new Date(now + FEATURE_EXPIRY_WARNING_DAYS * DAY_MS).toISOString();
  const nowIso = new Date(now).toISOString();

  // 只處理「名單上有主要接收者」的店——其他店送不出任何一則，連查都不必查
  const { data: primaries, error } = await admin
    .from('owner_notify_recipients')
    .select('tenant_id')
    .eq('is_primary', true);
  if (error) {
    console.error('[cron] owner-reminders: 查詢主要接收者失敗', error);
    return new Response('query failed', { status: 500 });
  }

  const tenantIds = [...new Set((primaries ?? []).map((r) => r.tenant_id as string))];
  let processedTenants = 0;
  let expiryReminders = 0;
  let topupReminders = 0;
  const monthKey = taipeiCurrentMonthKey();

  for (const tenantId of tenantIds) {
    try {
      processedTenants++;

      const [{ data: subs }, { data: tenant }, { data: pointRow }, { data: log }] =
        await Promise.all([
          admin.from('feature_subscriptions')
            .select('code, expires_at')
            .eq('tenant_id', tenantId).eq('active', true)
            .not('expires_at', 'is', null)
            .gt('expires_at', nowIso).lte('expires_at', windowEnd),
          admin.from('tenants').select('name').eq('id', tenantId).maybeSingle(),
          admin.from('tenant_point_transactions').select('balance_after')
            .eq('tenant_id', tenantId)
            .order('created_at', { ascending: false }).order('id', { ascending: false })
            .limit(1).maybeSingle(),
          admin.from('owner_notify_reminder_log').select('kind, ref').eq('tenant_id', tenantId),
        ]);

      const expiring = subs ?? [];
      if (!expiring.length) continue;

      const shop = tenant?.name ?? '';
      const sent = new Set((log ?? []).map((r) => `${r.kind}|${r.ref}`));

      /* ---- ① 訂閱到期提醒（一張訂閱一次） ---- */
      for (const s of expiring) {
        const ref = `${s.code}@${s.expires_at}`;
        if (sent.has(`SUBSCRIPTION_EXPIRY|${ref}`)) continue;
        const delivered = await notifyOwnerPrimary(tenantId, buildOwnerSubscriptionExpiryText({
          shop, featureName: featureName(String(s.code)), expiresAt: String(s.expires_at),
        }));
        if (!delivered) continue;                       // 沒送出就不寫紀錄，明天再試
        await admin.from('owner_notify_reminder_log')
          .upsert({ tenant_id: tenantId, kind: 'SUBSCRIPTION_EXPIRY', ref });
        expiryReminders++;
      }

      /* ---- ② 儲值提醒（同月一次；門檻見檔頭，我方設計） ---- */
      if (sent.has(`POINTS_LOW|${monthKey}`)) continue;
      const needed = expiring.reduce((sum, s) => sum + monthlyPrice(String(s.code)), 0);
      const balance = Number(pointRow?.balance_after ?? 0);
      if (needed <= 0 || balance >= needed) continue;
      const delivered = await notifyOwnerPrimary(tenantId, buildOwnerPointsLowText({
        shop, balance, needed,
      }));
      if (!delivered) continue;
      await admin.from('owner_notify_reminder_log')
        .upsert({ tenant_id: tenantId, kind: 'POINTS_LOW', ref: monthKey });
      topupReminders++;
    } catch (e) {
      console.error('[cron] owner-reminders: 單店處理失敗', tenantId, e);
    }
  }

  return NextResponse.json({ processedTenants, expiryReminders, topupReminders });
}
