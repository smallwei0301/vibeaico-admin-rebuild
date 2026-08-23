// POST /api/bookings/:id/adjust-price — {finalPrice} 手動調價，需 MANAGER（04 §B-1 ⚙M）。
import { z } from 'zod';
import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';

const bodySchema = z.object({ finalPrice: z.number().min(0, '金額不可為負') });

export const POST = handle(async (req, { params }) => {
  const t = await requireTenant('MANAGER');
  const { id } = await params;
  const b = bodySchema.parse(await req.json());

  const { data, error } = await t.supabase.from('bookings')
    .update({ final_price: b.finalPrice })
    .eq('id', id).eq('tenant_id', t.tenantId)
    .select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiHttpError(404, '找不到此預約', ERR.NOT_FOUND);
  return ok();
});
