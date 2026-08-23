import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';

/**
 * POST /api/chat/messages/:id/read — read_at=now（04 分冊 §B-5）。
 * 已讀過的訊息不覆蓋原 read_at（保留第一次讀取時間），直接回成功。
 */
export const POST = handle(async (_req, { params }) => {
  const t = await requireTenant();
  const { id } = await params;

  const { data: row, error: e0 } = await t.supabase
    .from('chat_messages')
    .select('id, read_at')
    .eq('id', id).eq('tenant_id', t.tenantId)
    .maybeSingle();
  if (e0) throw e0;
  if (!row) throw new ApiHttpError(404, '找不到此訊息', ERR.NOT_FOUND);

  if (!row.read_at) {
    const { error } = await t.supabase
      .from('chat_messages')
      .update({ read_at: new Date().toISOString() })
      .eq('id', id).eq('tenant_id', t.tenantId);
    if (error) throw error;
  }

  return ok();
});
