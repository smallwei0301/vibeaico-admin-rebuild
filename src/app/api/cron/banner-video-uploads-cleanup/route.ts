/**
 * GET /api/cron/banner-video-uploads-cleanup — 孤兒 banner video 上傳清理（Issue #22）
 * -----------------------------------------------------------------------------
 * 與 `src/app/api/cron/promotion-events-cleanup/route.ts` 同一套慣例：
 * `Authorization: Bearer ${CRON_SECRET}` 才放行，其餘一律 401；bounded（只動
 * `BANNER_VIDEO_ORPHAN_RETENTION_HOURS`（24 小時）之前、從未 confirm 的
 * presign 記錄）；失敗回 500 讓 Vercel Cron 的失敗紀錄看得到，不吞成看起來成功。
 *
 * ⚠️ 這支路由**故意沒有**加進 `vercel.json` 的 `crons` 陣列——理由與 #23 的
 * promotion-events-cleanup 完全相同：加進去會讓 main 部署後立刻對 Production
 * 執行刪除，這需要另一輪明確的 Owner／Sol 審核，這裡先把來源檔準備好。
 */
import { cleanupOrphanedBannerVideoUploads } from '@/server/banner-video';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('unauthorized', { status: 401 });
  }

  try {
    const { deletedRows, storageErrors, cutoffIso } = await cleanupOrphanedBannerVideoUploads();
    return Response.json({ success: true, deletedRows, storageErrors, cutoffIso });
  } catch (error) {
    console.error('[cron] banner-video-uploads-cleanup: 清理孤兒上傳失敗', error);
    return new Response('cleanup failed', { status: 500 });
  }
}
