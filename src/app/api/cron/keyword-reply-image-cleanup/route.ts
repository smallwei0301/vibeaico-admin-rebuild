import { createAdminSupabase } from '@/server/supabase';
import { drainKeywordReplyImageCleanup } from '@/server/keyword-reply-images';
import { ERR, fail, ok } from '@/server/http';

/** 每日重試已成功移除 DB 引用、但 Storage 當時暫不可刪的關鍵字圖片。 */
export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`)
    return fail(401, '未授權的 cron 請求', ERR.UNAUTHORIZED);
  const result = await drainKeywordReplyImageCleanup(createAdminSupabase());
  return ok(result);
}
