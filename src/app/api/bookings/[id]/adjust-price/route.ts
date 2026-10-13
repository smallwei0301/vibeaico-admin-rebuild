// POST /api/bookings/:id/adjust-price — {finalPrice} 手動調價，需 MANAGER（04 §B-1 ⚙M）。
import { z } from 'zod';
import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';

// 刻意採黑名單：只擋 CANCELLED／NO_SHOW，COMPLETED 仍可調價（服務後更正金額）。
// 注意：日後若新增狀態值，會預設放行，屆時需重新檢視此清單與下方 not in 條件。
const BLOCKED_STATUSES: string[] = ['CANCELLED', 'NO_SHOW'];

const bodySchema = z.object({ finalPrice: z.number().min(0, '金額不可為負') });

export const POST = handle(async (req, { params }) => {
  const t = await requireTenant('MANAGER');
  const { id } = await params;
  const b = bodySchema.parse(await req.json());

  // issue #923：已取消／爽約不可改價；COMPLETED 保留可調（服務後更正金額）。
  const { data: existing, error: sErr } = await t.supabase.from('bookings')
    .select('id, status').eq('id', id).eq('tenant_id', t.tenantId).maybeSingle();
  if (sErr) throw sErr;
  if (!existing) throw new ApiHttpError(404, '找不到此預約', ERR.NOT_FOUND);
  const blocked = () => new ApiHttpError(409, '此預約已取消或未到店，無法調整金額', ERR.CONFLICT);
  if (BLOCKED_STATUSES.includes(existing.status)) throw blocked();

  // 條件式更新擋住「檢查之後狀態才被改掉」的競態。
  const { data, error } = await t.supabase.from('bookings')
    .update({ final_price: b.finalPrice })
    .eq('id', id).eq('tenant_id', t.tenantId)
    .not('status', 'in', '(CANCELLED,NO_SHOW)')
    .select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw blocked();
  return ok();
});
