// GET /api/support-chat/threads — 列出目前店家自己的客服對話串
// POST /api/support-chat/threads — 「轉人工」：建立新的客服對話串＋第一則訊息
//
// ⚠️ 與 `POST /api/support-chat/ask` 是兩支完全不同語意的端點（見該檔案檔頭
// 說明與 docs/integration/04-API-CONTRACTS.md）。這裡是持久化的客服案件／
// 對話串（issue #25 B 段），走 `t.supabase`（session client），由 0117
// migration 的 RLS 政策把關租戶邊界，不使用 service role。
import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { APP_URL } from '@/config/env';
import { createThread, listThreads } from '@/server/support-chat-threads';

export const GET = handle(async () => {
  const t = await requireTenant();
  const threads = await listThreads(t.supabase, t.tenantId);
  return ok({ threads });
});

const bodySchema = z.object({
  subject: z.string().trim().min(1, '請輸入主旨').max(200),
  body: z.string().trim().min(1, '請輸入內容').max(5000),
});

export const POST = handle(async (req) => {
  const t = await requireTenant();
  const b = bodySchema.parse(await req.json());
  const thread = await createThread(t.supabase, {
    tenantId: t.tenantId,
    shopCode: t.shopCode,
    shopName: t.tenantName,
    userId: t.user.id,
    userEmail: t.user.email ?? '',
    subject: b.subject,
    body: b.body,
    appUrl: APP_URL,
  });
  return ok(thread, { status: 201 });
});
