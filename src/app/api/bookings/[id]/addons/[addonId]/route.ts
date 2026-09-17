// DELETE /api/bookings/:id/addons/:addonId — 移除一筆加購（issue #17）。
// 只回沖該筆自己的 applied_amount/applied_minutes（`delete_booking_addon` rpc），
// 軟刪（deleted_at），不重算整張 booking，不影響其他加購或後續的手動調價。
//
// ⚠️ 排程與 schema 安全降級：見 `../route.ts` 檔頭同一段說明——migration
// （0121）拆成獨立 PR，若尚未套用到某個環境，缺欄位／缺 rpc 都要安全降級，
// 不是未分類 500。
import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { createAdminSupabase } from '@/server/supabase';

export const DELETE = handle(async (_req, { params }) => {
  const t = await requireTenant();
  const { id, addonId } = await params;

  // 先確認這筆加購屬於本租戶「這一筆」預約——即使 rpc 內部也用 tenant_id 過濾，
  // 這裡多一層明確檢查可以在 rpc 之前就把「addonId 存在但屬於別筆 booking」
  // 擋成 404，訊息更準確（而不是讓 rpc 用 tenant_id 擋成同一個 404）。
  const { data: addon, error: aErr } = await t.supabase.from('booking_addons')
    .select('id, booking_id').eq('id', addonId).eq('tenant_id', t.tenantId).maybeSingle();
  if (aErr) {
    if (String((aErr as any)?.code ?? '') === '42703') {
      throw new ApiHttpError(503, '加購功能尚未上線，請稍後再試', ERR.INTERNAL);
    }
    throw aErr;
  }
  if (!addon || addon.booking_id !== id) throw new ApiHttpError(404, '找不到此加購項目', ERR.NOT_FOUND);

  const admin = createAdminSupabase();
  const { data, error } = await admin.rpc('delete_booking_addon', {
    p_tenant: t.tenantId,
    p_addon: addonId,
  });
  if (error) {
    const message = String((error as any)?.message ?? '');
    const code = String((error as any)?.code ?? '');
    if (code === 'PGRST202' || code === '42883') {
      throw new ApiHttpError(503, '加購功能尚未上線，請稍後再試', ERR.INTERNAL);
    }
    if (message.includes('ADDON_NOT_FOUND')) throw new ApiHttpError(404, '找不到此加購項目', ERR.NOT_FOUND);
    if (message.includes('BOOKING_NOT_FOUND')) throw new ApiHttpError(404, '找不到此預約', ERR.NOT_FOUND);
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new ApiHttpError(404, '找不到此預約', ERR.NOT_FOUND);

  return ok({
    finalPrice: Number(row.final_price),
    durationMinutes: Number(row.duration_minutes),
    endAt: row.end_at as string,
    alreadyDeleted: !!row.already_deleted,
  });
});
