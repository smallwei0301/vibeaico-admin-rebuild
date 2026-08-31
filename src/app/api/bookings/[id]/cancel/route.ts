// PENDING/CONFIRMED → CANCELLED，寫 cancel_reason。
import { z } from 'zod';
import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { dispatchAfterCommit } from '@/server/notifications/outbox';

const bodySchema = z.object({ reason: z.string().optional() });

export const POST = handle(async (req, { params }) => {
  const t = await requireTenant();
  const { id } = await params;
  const b = bodySchema.parse(await req.json());

  const { data, error } = await t.supabase.from('bookings')
    .update({ status: 'CANCELLED', cancel_reason: b.reason ?? null })
    .eq('id', id).eq('tenant_id', t.tenantId).in('status', ['PENDING', 'CONFIRMED'])
    .select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiHttpError(409, '此預約狀態已變更，請重新整理', ERR.CONFLICT);
  // 0037 booking trigger transactionally records BOOKING_CANCELLED. The
  // worker is best-effort only; retry durability lives in the delivery ledger.
  dispatchAfterCommit();
  return ok();
});
