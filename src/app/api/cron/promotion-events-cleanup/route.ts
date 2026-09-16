/**
 * GET /api/cron/promotion-events-cleanup — page_view_events 180 天 retention（Issue #23）
 * -----------------------------------------------------------------------------
 * 與其他 `src/app/api/cron/**` 路由同一套慣例：`Authorization: Bearer
 * ${CRON_SECRET}` 才放行，其餘一律 401；bounded（只刪超過
 * `PROMOTION_EVENT_RETENTION_DAYS` 的舊列，保留視窗內完全不動）；失敗只 log，
 * 不影響任何其他服務——尤其是公開頁的正常回應，這條路由與公開頁完全不同棧，
 * 但一併寫在這裡明確：cleanup 失敗必須回 500 讓 Vercel Cron 的失敗紀錄看得到，
 * 不能吞掉變成看起來成功。
 *
 * ⚠️ 這支路由**故意沒有**加進 `vercel.json` 的 `crons` 陣列——加進去會讓 main
 * 部署後立刻開始對 Production 執行刪除。Issue #23 的施工邊界明講「不得把本
 * Issue 當 Production migration/deploy 授權」，把排程實際掛上去需要另一輪
 * 明確的 Owner／Sol 審核，這裡先把來源檔準備好，行為與其餘 cron route 完全一致。
 */
import { cleanupExpiredPromotionEvents } from '@/server/promotion-events';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('unauthorized', { status: 401 });
  }

  try {
    const { deleted, cutoffIso } = await cleanupExpiredPromotionEvents();
    return Response.json({ success: true, deleted, cutoffIso });
  } catch (error) {
    console.error('[cron] promotion-events-cleanup: 刪除逾期 page_view_events 失敗', error);
    return new Response('cleanup failed', { status: 500 });
  }
}
