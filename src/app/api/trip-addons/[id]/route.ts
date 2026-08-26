import { z } from 'zod';
import { handle, ok, fail, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { mapTripAddon } from '@/server/mappers';

type Ctx = { params: Promise<{ id: string }> };

const updateSchema = z.object({
  name: z.string().min(1, '請輸入加購項名稱').optional(),
  price: z.number().min(0, '價格不得為負數').optional(),
  unit: z.enum(['PER_PERSON', 'PER_GROUP']).optional(),
  stock: z.number().int('庫存必須為整數').min(0, '庫存不得為負數').nullable().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

/** PUT /api/trip-addons/[id] — 更新加購項 ⚙M（10 分冊 §5 補記）。 */
export const PUT = handle(async (req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const t = await requireTenant('MANAGER');
  const b = updateSchema.parse(await req.json());

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (b.name !== undefined) patch.name = b.name;
  if (b.price !== undefined) patch.price = b.price;
  if (b.unit !== undefined) patch.unit = b.unit;
  // stock 明確送 null = 改成不限量，所以用 `!== undefined` 而不是 truthy 判斷
  if (b.stock !== undefined) patch.stock = b.stock;
  if (b.active !== undefined) patch.active = b.active;
  if (b.sortOrder !== undefined) patch.sort_order = b.sortOrder;

  const { data, error } = await t.supabase.from('trip_addons')
    .update(patch).eq('tenant_id', t.tenantId).eq('id', id).select('*').maybeSingle();
  if (error) throw error;
  if (!data) return fail(404, '找不到此加購項', ERR.NOT_FOUND);

  return ok(mapTripAddon(data));
});

/** DELETE /api/trip-addons/[id] — 刪除加購項 ⚙M。 */
export const DELETE = handle(async (_req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const t = await requireTenant('MANAGER');

  const { data, error } = await t.supabase.from('trip_addons')
    .delete().eq('tenant_id', t.tenantId).eq('id', id).select('id').maybeSingle();
  if (error) throw error;
  if (!data) return fail(404, '找不到此加購項', ERR.NOT_FOUND);

  return ok({ deleted: true });
});
