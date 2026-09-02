import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';

function rpcError(error: any): never {
  const message = String(error?.message ?? '');
  if (message.includes('FORBIDDEN')) throw new ApiHttpError(403, '權限不足', ERR.FORBIDDEN);
  if (message.includes('NOT_FOUND')) throw new ApiHttpError(404, '找不到預約或加購項目', ERR.NOT_FOUND);
  if (message.includes('STATUS_CONFLICT') || message.includes('DURATION_CONFLICT') || message.includes('SNAPSHOT_CONFLICT'))
    throw new ApiHttpError(409, '此加購無法安全回沖，資料未變更', ERR.CONFLICT);
  throw error;
}

export const DELETE = handle(async (_req, { params }) => {
  const t = await requireTenant('MANAGER');
  const { id, addonId } = await params;
  const { data, error } = await t.supabase.rpc('delete_booking_addon_17', {
    p_tenant_id: t.tenantId, p_booking_id: id, p_addon_id: addonId,
  });
  if (error) rpcError(error);
  if (!data?.length) throw new ApiHttpError(500, '加購回沖交易未回傳結果', ERR.INTERNAL);
  return ok({
    finalPrice: Number(data[0].final_price),
    durationMinutes: Number(data[0].duration_minutes),
    endAt: data[0].end_at,
  });
});
