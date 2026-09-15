// POST /api/support-chat/threads/:threadId/messages — 在既有客服對話串追加
// 一則店家留言。第一版沒有平台後台可以回覆，所以這支端點只會寫入
// sender_role='TENANT' 的訊息（0116 migration 的 RLS insert policy 也鎖死這一點）。
import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { addMessage } from '@/server/support-chat-threads';

const bodySchema = z.object({
  body: z.string().trim().min(1, '請輸入內容').max(5000),
});

export const POST = handle(async (req, { params }) => {
  const t = await requireTenant();
  const { threadId } = await params;
  const b = bodySchema.parse(await req.json());
  const message = await addMessage(t.supabase, {
    tenantId: t.tenantId,
    threadId,
    userEmail: t.user.email ?? '',
    body: b.body,
  });
  return ok(message, { status: 201 });
});
