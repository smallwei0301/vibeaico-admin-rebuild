import { createAdminSupabase } from '@/server/supabase';
import { drainKeywordReplyImageCleanup } from '@/server/keyword-reply-images';
import { ERR, fail, ok } from '@/server/http';

export const runtime = 'nodejs';

/** Retry Storage removal after DB unlink; each job rechecks live references. */
export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`)
    return fail(401, '未授權的 cron 請求', ERR.UNAUTHORIZED);

  return ok(await drainKeywordReplyImageCleanup(createAdminSupabase()));
}
