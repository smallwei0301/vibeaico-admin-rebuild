import { z } from 'zod';
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';

/**
 * PUT / DELETE /api/campaigns/:id（04 分冊 §B-5）。
 *
 * PUT：只更新 body 裡實際出現的欄位；description/type 併入 content jsonb
 * （見 campaigns/route.ts 註解）。ENDED 後不可再編輯（409）；其餘狀態
 * （含 PUBLISHED/PAUSED）允許改內容。
 *
 * DELETE：**先前不存在**（issue #7 (乙) 補上）。04 分冊 §B-5 的表列只寫了
 * 「GET/POST `/api/campaigns`、PUT `:id`、publish/pause/resume/end」，漏了刪除；
 * 但原站確實有這個動作——`docs/specs/campaigns.json` 的 jsStrings 收錄了
 * 「活動已刪除」「刪除失敗」「確定要刪除活動「${name}」嗎？此操作無法復原。」，
 * 且每一列都有刪除鈕、不分狀態。依 15 分冊「規格與分冊衝突時以規格為準」，
 * 這裡照原站行為做：不限狀態，找不到回 404。
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

export const DELETE = handle(async (_req, { params }) => {
  const t = await requireTenant('MANAGER');
  const { id } = await params;

  // 先確認存在且屬於本店 —— 少了這一步，刪一筆不存在的 id 也會回成功，
  // 頁面就會顯示「活動已刪除」卻什麼都沒刪（假成功）。
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

  return ok({ deleted: true });
});
