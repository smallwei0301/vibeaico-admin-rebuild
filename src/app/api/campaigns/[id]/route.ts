import { z } from 'zod';
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';

/**
 * PUT /api/campaigns/:id（04 分冊 §B-5）。只更新 body 裡實際出現的欄位；
 * description/type 併入 content jsonb（見 campaigns/route.ts 註解）。
 * ENDED 後不可再編輯（409）；其餘狀態（含 PUBLISHED/PAUSED）允許改內容。
 */
const bodySchema = z.object({
  name: z.string().min(1, '請輸入活動名稱').optional(),
  keyword: z.string().optional(),
  description: z.string().optional(),
  type: z.string().optional(),
  content: z.record(z.unknown()).optional(),
  startAt: z.string().datetime({ offset: true }).nullable().optional(),
  endAt: z.string().datetime({ offset: true }).nullable().optional(),
});

export const PUT = handle(async (req, { params }) => {
  const t = await requireTenant('MANAGER');
  const { id } = await params;
  const b = bodySchema.parse(await req.json());

  const { data: row, error: e0 } = await t.supabase
    .from('campaigns')
    .select('id, status, content')
    .eq('id', id).eq('tenant_id', t.tenantId)
    .maybeSingle();
  if (e0) throw e0;
  if (!row) throw new ApiHttpError(404, '找不到此活動', ERR.NOT_FOUND);
  if (row.status === 'ENDED')
    throw new ApiHttpError(409, '活動已結束，無法編輯', ERR.CONFLICT);

  const content = { ...(row.content ?? {}), ...(b.content ?? {}) } as Record<string, unknown>;
  if (b.description !== undefined) content.description = b.description;
  if (b.type !== undefined) content.type = b.type;

  const update: Record<string, unknown> = { content };
  if (b.name !== undefined) update.name = b.name;
  if (b.keyword !== undefined) update.keyword = b.keyword;
  if (b.startAt !== undefined) update.start_at = b.startAt;
  if (b.endAt !== undefined) update.end_at = b.endAt;

  const { error } = await t.supabase
    .from('campaigns').update(update)
    .eq('id', id).eq('tenant_id', t.tenantId);
  if (error) throw error;

  return ok();
});
