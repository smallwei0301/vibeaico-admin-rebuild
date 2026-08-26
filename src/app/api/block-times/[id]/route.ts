// PUT /api/block-times/:id、DELETE /api/block-times/:id — 封鎖時段（04 §B-1「CRUD，欄位同表」）。
import { z } from 'zod';
import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';

/**
 * PUT：只更新 body 裡實際出現的欄位（同 PUT /api/customers/:id 的慣例）。
 * 起訖時間只要有一邊出現，就以「更新後的最終值」重新檢查 end > start——
 * 只送 endAt 也不能把它改到 startAt 之前。
 *
 * 為什麼補這一支：04 分冊 §B-1 這一列寫的是「CRUD，欄位同表」，但只列了
 * GET/POST/DELETE 三個端點，於是 /tenant/block-times 頁的「編輯」按鈕沒有東西
 * 可以打（接線前它是 setTimeout 假儲存）。欄位完全沿用既有的表，不新增任何欄位。
 */
const bodySchema = z.object({
  /** null = 改成全店封鎖 */
  staffId: z.string().uuid().nullable().optional(),
  startAt: z.string().min(1).optional(),
  endAt: z.string().min(1).optional(),
  reason: z.string().optional(),
});

export const PUT = handle(async (req, { params }) => {
  const t = await requireTenant();
  const { id } = await params;
  const b = bodySchema.parse(await req.json());

  const { data: row, error: e0 } = await t.supabase
    .from('block_times')
    .select('id, start_at, end_at')
    .eq('id', id).eq('tenant_id', t.tenantId)
    .maybeSingle();
  if (e0) throw e0;
  if (!row) throw new ApiHttpError(404, '找不到此封鎖時段', ERR.NOT_FOUND);

  const update: Record<string, unknown> = {};

  const startMs = b.startAt !== undefined ? Date.parse(b.startAt) : Date.parse(row.start_at as string);
  const endMs = b.endAt !== undefined ? Date.parse(b.endAt) : Date.parse(row.end_at as string);
  if (b.startAt !== undefined || b.endAt !== undefined) {
    if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs)
      throw new ApiHttpError(400, '時間區間格式錯誤（結束需晚於開始）', ERR.VALIDATION);
    if (b.startAt !== undefined) update.start_at = new Date(startMs).toISOString();
    if (b.endAt !== undefined) update.end_at = new Date(endMs).toISOString();
  }

  if (b.staffId !== undefined) {
    if (b.staffId) {
      const { data: staff, error } = await t.supabase.from('staff').select('id')
        .eq('id', b.staffId).eq('tenant_id', t.tenantId).maybeSingle();
      if (error) throw error;
      if (!staff) throw new ApiHttpError(404, '找不到此服務人員', ERR.NOT_FOUND);
    }
    update.staff_id = b.staffId ?? null;
  }

  if (b.reason !== undefined) update.reason = b.reason;

  if (Object.keys(update).length === 0) return ok();

  const { data, error } = await t.supabase.from('block_times')
    .update(update)
    .eq('id', id).eq('tenant_id', t.tenantId)
    .select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiHttpError(404, '找不到此封鎖時段', ERR.NOT_FOUND);
  return ok();
});

export const DELETE = handle(async (_req, { params }) => {
  const t = await requireTenant();
  const { id } = await params;

  const { data, error } = await t.supabase.from('block_times')
    .delete()
    .eq('id', id).eq('tenant_id', t.tenantId)
    .select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiHttpError(404, '找不到此封鎖時段', ERR.NOT_FOUND);
  return ok();
});
