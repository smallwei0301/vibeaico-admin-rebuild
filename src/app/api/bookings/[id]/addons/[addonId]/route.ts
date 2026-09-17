// DELETE /api/bookings/:id/addons/:addonId — 移除一筆加購（issue #17）。
// 只回沖該筆自己的 applied_amount/applied_minutes（0119 `delete_booking_addon` rpc），
// 軟刪（deleted_at），不重算整張 booking，不影響其他加購或後續的手動調價。
//
// PREPARE 階段 gate 與寫法理由同 `../route.ts` 檔頭註解：`DELETE` export 本體
// 第一行擋 `bookingAddonsSchemaActive()`，業務邏輯整段留在同一個 export 本體內
// （不拆到未 export 的輔助函式），因此不透過 `handle()` HOF，改手寫等價
// try/catch；同樣的已知取捨——本 PREPARE 階段暫不含代登入寫入稽核，ACTIVATE
// PR 打開 flag 時應改回 `export const DELETE = handle(...)` 既有慣例。
import { NextResponse } from 'next/server';
import { ok, ApiHttpError, ERR, fail } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { createAdminSupabase } from '@/server/supabase';
import { bookingAddonsSchemaActive } from '@/server/booking-addons-notify';

export async function DELETE(
  _req: Request, { params }: { params: Promise<{ id: string; addonId: string }> },
) {
  if (!bookingAddonsSchemaActive()) {
    return NextResponse.json({ success: false, message: '加購功能尚未啟用', code: ERR.NOT_FOUND }, { status: 404 });
  }
  try {
    const t = await requireTenant();
    const { id, addonId } = await params;

    // 先確認這筆加購屬於本租戶「這一筆」預約——即使 rpc 內部也用 tenant_id 過濾，
    // 這裡多一層明確檢查可以在 rpc 之前就把「addonId 存在但屬於別筆 booking」
    // 擋成 404，訊息更準確（而不是讓 rpc 用 tenant_id 擋成同一個 404）。
    const { data: addon, error: aErr } = await t.supabase.from('booking_addons')
      .select('id, booking_id').eq('id', addonId).eq('tenant_id', t.tenantId).maybeSingle();
    if (aErr) throw aErr;
    if (!addon || addon.booking_id !== id) throw new ApiHttpError(404, '找不到此加購項目', ERR.NOT_FOUND);

    const admin = createAdminSupabase();
    const { data, error } = await admin.rpc('delete_booking_addon', {
      p_tenant: t.tenantId,
      p_addon: addonId,
    });
    if (error) {
      const message = String((error as any)?.message ?? '');
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
  } catch (e: any) {
    if (e instanceof ApiHttpError) return fail(e.status, e.message, e.code);
    if (e?.name === 'ZodError') return fail(400, e.issues?.[0]?.message ?? '輸入格式錯誤', ERR.VALIDATION);
    console.error('[api] DELETE /api/bookings/:id/addons/:addonId', e);
    return fail(500, '系統發生錯誤，請稍後再試', ERR.INTERNAL);
  }
}
