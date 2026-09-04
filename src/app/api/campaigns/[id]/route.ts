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

/**
 * DELETE /api/campaigns/:id（04 分冊 §B-5）。
 * 與 PUT 同樣的租戶隔離：先以 id + tenant_id 取回該列，取不到一律 404
 * （不洩漏其他租戶的活動是否存在），再以同一組雙條件刪除。
 * 與 PUT 不同的是 ENDED 也允許刪除——結束的活動不能再「編輯」，但店家
 * 仍應該能把它從清單移除。
 */
export const DELETE = handle(async (_req, { params }) => {
  const t = await requireTenant('MANAGER');
  const { id } = await params;

  const { data: row, error: e0 } = await t.supabase
    .from('campaigns')
    .select('id')
    .eq('id', id).eq('tenant_id', t.tenantId)
    .maybeSingle();
  if (e0) throw e0;
  if (!row) throw new ApiHttpError(404, '找不到此活動', ERR.NOT_FOUND);

  const { error } = await t.supabase
    .from('campaigns').delete()
    .eq('id', id).eq('tenant_id', t.tenantId);
  if (error) throw error;

  return ok();
});
