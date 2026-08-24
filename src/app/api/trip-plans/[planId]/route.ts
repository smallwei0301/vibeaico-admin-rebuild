import { z } from 'zod';
import { handle, ok, fail, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { mapTripPlan } from '@/server/mappers';
import { planRowFromImport } from '@/server/trip-payload';

type Ctx = { params: Promise<{ planId: string }> };

/**
 * 方案的更新／刪除。
 *
 * 路徑刻意是**扁平**的 /api/trip-plans/[planId] 而非掛在行程底下：
 * src/services/tours.ts 的 deleteTripPlan(planId) 只拿得到 planId，
 * 契約既已如此，端點就配合它（planId 本身唯一，加上 tenant_id 過濾就足夠隔離，
 * 不需要 tripId 才能定位）。
 */
const planSchema = z.object({ name: z.string().min(1, '請輸入方案名稱') }).passthrough();

export const PUT = handle(async (req, ctx: Ctx) => {
  const { planId } = await (ctx.params);
  const t = await requireTenant('MANAGER');
  const b = planSchema.parse(await req.json());

  const { data: existing, error: eerr } = await t.supabase.from('trip_plans')
    .select('trip_id, sort_order').eq('tenant_id', t.tenantId).eq('id', planId).maybeSingle();
  if (eerr) throw eerr;
  if (!existing) return fail(404, '找不到此方案', ERR.NOT_FOUND);

  // 整筆覆蓋語意：方案編輯畫面本來就是一次送出完整表單，逐欄位 patch 會讓
  // 「清空某個陣列」變成無法表達的操作。tenant_id / trip_id 不由 body 決定，
  // 避免方案被搬到別人的行程底下。
  const row = planRowFromImport(b, t.tenantId, existing.trip_id, existing.sort_order ?? 0);
  const { tenant_id: _t, trip_id: _tr, ...patch } = row;

  const { data, error } = await t.supabase.from('trip_plans')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('tenant_id', t.tenantId).eq('id', planId).select('*').maybeSingle();
  if (error) throw error;
  if (!data) return fail(404, '找不到此方案', ERR.NOT_FOUND);

  return ok(mapTripPlan(data));
});

export const DELETE = handle(async (_req, ctx: Ctx) => {
  const { planId } = await (ctx.params);
  const t = await requireTenant('MANAGER');

  const { data, error } = await t.supabase.from('trip_plans')
    .delete().eq('tenant_id', t.tenantId).eq('id', planId).select('id').maybeSingle();
  if (error) throw error;
  if (!data) return fail(404, '找不到此方案', ERR.NOT_FOUND);

  return ok({ deleted: true });
});
