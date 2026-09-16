// GET /api/support-chat/threads/:threadId — 讀取單一客服對話串的完整訊息，
// 並在同一次呼叫中把它標記為已讀（見 src/server/support-chat-threads.ts）。
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { getThreadDetail } from '@/server/support-chat-threads';

export const GET = handle(async (_req, { params }) => {
  const t = await requireTenant();
  const { threadId } = await params;
  const thread = await getThreadDetail(t.supabase, t.tenantId, threadId);
  return ok(thread);
});
