/**
 * GET /api/cron/external-calendars-sync — 每小時同步所有 active 外部行事曆訂閱
 * （Issue #21）。
 * -----------------------------------------------------------------------------
 * 與 `promotion-events-cleanup`／`banner-video-uploads-cleanup` 同一套慣例：
 * `Authorization: Bearer ${CRON_SECRET}` 才放行，其餘一律 401；單一訂閱失敗
 * 用獨立 try/catch 隔離，絕不讓一個來源掛掉拖垮其他訂閱（Issue「單一來源失敗
 * 不得中斷其他來源」）；整支路由本身若在迴圈之外就出錯（例如列不出訂閱清單）
 * 才回 500，讓 Vercel Cron 的失敗紀錄看得到，不吞成看起來成功。
 *
 * ⚠️ 這支路由**故意沒有**加進 `vercel.json` 的 `crons` 陣列——理由與 #22／#23
 * 完全相同：加進去會讓 main 部署後立刻對 Production 執行外部網路請求＋資料庫
 * 寫入，這需要另一輪明確的 Owner／Sol 審核，這裡先把來源檔準備好，行為與其餘
 * cron route 完全一致。
 */
import { createAdminSupabase } from '@/server/supabase';
import { listActiveExternalCalendars, syncExternalCalendar } from '@/server/external-calendar-sync';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('unauthorized', { status: 401 });
  }

  const admin = createAdminSupabase();
  let subscriptions;
  try {
    subscriptions = await listActiveExternalCalendars(admin);
  } catch (error) {
    console.error('[cron] external-calendars-sync: 列出 active 訂閱失敗', error);
    return new Response('sync failed', { status: 500 });
  }

  let succeeded = 0;
  let failed = 0;
  const errors: { id: string; error: string }[] = [];

  for (const subscription of subscriptions) {
    try {
      const result = await syncExternalCalendar(admin, subscription);
      if (result.ok) {
        succeeded += 1;
      } else {
        failed += 1;
        errors.push({ id: subscription.id, error: result.error });
      }
    } catch (error) {
      // syncExternalCalendar 本身設計成不丟例外，這裡的 catch 是最後一道保險
      // ——一個訂閱在這裡意外丟例外，絕不能讓迴圈中斷、拖垮其餘訂閱的同步。
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ id: subscription.id, error: message });
      console.error('[cron] external-calendars-sync: 單一訂閱同步意外丟出例外', subscription.id, error);
    }
  }

  return Response.json({ success: true, total: subscriptions.length, succeeded, failed, errors });
}
