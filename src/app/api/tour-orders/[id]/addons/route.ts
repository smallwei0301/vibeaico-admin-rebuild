import { z } from 'zod';
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';

type Ctx = { params: Promise<{ id: string }> };
const SELECT = 'id, trip_addon_id, name, unit_price, quantity, applied_amount, performance_mode, specific_staff_id, performance_staff_id, performance_amount, created_at';
const bodySchema = z.object({
  tripAddonId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1),
  unitPrice: z.number().min(0),
  quantity: z.number().int().min(1),
  performanceMode: z.enum(['PRIMARY', 'SPECIFIC_STAFF', 'NONE']).default('PRIMARY'),
  specificStaffId: z.string().uuid().nullable().optional(),
});

export const GET = handle(async (_req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const t = await requireTenant();
  const { data, error } = await t.supabase.from('tour_order_addons').select(SELECT)
    .eq('tenant_id', t.tenantId).eq('order_id', id).order('created_at');
  if (error) throw error;
  return ok((data ?? []).map(mapTourOrderAddon));
});

/** Creates the immutable order-time snapshot; completion resolves the performance owner. */
export const POST = handle(async (req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const t = await requireTenant('MANAGER');
  const b = bodySchema.parse(await req.json());
  const { data: order, error: orderError } = await t.supabase.from('tour_orders')
    .select('id, trip_id, status').eq('tenant_id', t.tenantId).eq('id', id).maybeSingle();
  if (orderError) throw orderError;
  if (!order) throw new ApiHttpError(404, '找不到此訂單', ERR.NOT_FOUND);
  if (!['PENDING', 'CONFIRMED'].includes(order.status))
    throw new ApiHttpError(409, '已結案或取消的訂單不能再加購', ERR.CONFLICT);
  if (b.performanceMode === 'SPECIFIC_STAFF' && !b.specificStaffId)
    throw new ApiHttpError(400, '請選擇業績歸屬人員', ERR.VALIDATION);
  if (b.tripAddonId) {
    const { data: addon, error } = await t.supabase.from('trip_addons').select('id')
      .eq('tenant_id', t.tenantId).eq('trip_id', order.trip_id).eq('id', b.tripAddonId).maybeSingle();
    if (error) throw error;
    if (!addon) throw new ApiHttpError(404, '找不到此行程加購項目', ERR.NOT_FOUND);
  }
  if (b.specificStaffId) {
    const { data: staff, error } = await t.supabase.from('staff').select('id')
      .eq('tenant_id', t.tenantId).eq('id', b.specificStaffId).maybeSingle();
    if (error) throw error;
    if (!staff) throw new ApiHttpError(404, '找不到業績歸屬人員', ERR.NOT_FOUND);
  }
  const amount = b.unitPrice * b.quantity;
  const { data, error } = await t.supabase.from('tour_order_addons').insert({
    tenant_id: t.tenantId, order_id: id, trip_addon_id: b.tripAddonId ?? null,
    name: b.name, unit_price: b.unitPrice, quantity: b.quantity, applied_amount: amount,
    performance_mode: b.performanceMode,
    specific_staff_id: b.performanceMode === 'SPECIFIC_STAFF' ? b.specificStaffId : null,
  }).select(SELECT).single();
  if (error) throw error;
  return ok(mapTourOrderAddon(data));
});

function mapTourOrderAddon(row: any) {
  return {
    id: row.id, tripAddonId: row.trip_addon_id, name: row.name,
    unitPrice: Number(row.unit_price), quantity: Number(row.quantity), appliedAmount: Number(row.applied_amount),
    performanceMode: row.performance_mode, specificStaffId: row.specific_staff_id,
    performanceStaffId: row.performance_staff_id,
    performanceAmount: row.performance_amount == null ? null : Number(row.performance_amount),
    createdAt: row.created_at,
  };
}
