// GET  /api/bookings/:id/addons — 加購明細（未刪除者，依建立時間），issue #17。
// POST /api/bookings/:id/addons — 新增一筆加購，原子套用到 bookings.final_price/
//      duration_minutes/end_at（`create_booking_addon` rpc），並依 `notify`
//      嘗試一次消費明細通知（結果與加購本身是否成功分離，見 04 §B-1.1）。
//
// ⚠️ 排程與 schema 安全降級：本 PR 依 #530 staged schema release 政策把
// migration（`0121_issue_17_booking_addons_hardening.sql`，`agent/
// issue-17-addons-migration` 分支）拆成獨立 PR，兩支 PR 的合併／套用順序不
// 保證同時發生。若本 PR 先於 migration 套用到某個環境上線，`booking_addons`
// 還沒有 performance_mode 等新欄位、`create_booking_addon`／
// `delete_booking_addon` 兩支 rpc 也還不存在——GET 對缺欄位（Postgres
// `42703 undefined_column`）安全收斂成空陣列（比照 #46 `mapTourOrder` 對缺
// 欄位收斂成 null 的既有先例，見 `src/server/tour-orders.ts`），POST/DELETE
// 對呼叫不到的 rpc（PostgREST `PGRST202` 或 Postgres `42883
// undefined_function`）回可讀的 503，而不是未分類的 500。
import { z } from 'zod';
import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { createAdminSupabase } from '@/server/supabase';
import { notifyBookingAddonReceipt } from '@/server/line-notify';
import type { BookingAddon, BookingAddonNotifiedOutcome } from '@/lib/types';

const ADDON_SELECT = [
  'id', 'booking_id', 'service_id', 'name', 'price', 'quantity', 'duration_minutes',
  'staff_id', 'applied_amount', 'applied_minutes', 'performance_mode', 'performance_staff_id',
  'notification_requested', 'notified', 'created_at',
  'executor:staff!booking_addons_staff_id_fkey(name)',
  'performance:staff!booking_addons_performance_staff_id_fkey(name)',
].join(', ');

function toBookingAddon(row: any): BookingAddon {
  return {
    id: row.id,
    bookingId: row.booking_id,
    serviceId: row.service_id,
    name: row.name,
    price: Number(row.price),
    quantity: Number(row.quantity),
    durationMinutes: Number(row.duration_minutes),
    staffId: row.staff_id,
    staffName: row.executor?.name ?? null,
    appliedAmount: Number(row.applied_amount),
    appliedMinutes: Number(row.applied_minutes),
    performanceMode: row.performance_mode,
    performanceStaffId: row.performance_staff_id,
    performanceStaffName: row.performance?.name ?? null,
    notificationRequested: !!row.notification_requested,
    notified: row.notified,
    createdAt: row.created_at,
  };
}

export const GET = handle(async (req, { params }) => {
  const t = await requireTenant();
  const { id } = await params;

  // 先確認這筆預約屬於本租戶（不存在／不屬於本店一律 404，不洩漏他店資料）。
  const { data: booking, error: bErr } = await t.supabase.from('bookings')
    .select('id').eq('id', id).eq('tenant_id', t.tenantId).maybeSingle();
  if (bErr) throw bErr;
  if (!booking) throw new ApiHttpError(404, '找不到此預約', ERR.NOT_FOUND);

  const { data, error } = await t.supabase.from('booking_addons')
    .select(ADDON_SELECT)
    .eq('tenant_id', t.tenantId).eq('booking_id', id)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });
  if (error) {
    // 42703 = undefined_column：搭配的 migration（0121）尚未套用到這個環境，
    // 新欄位（如 performance_staff_id）還不存在。
    // PGRST200 = PostgREST「relationship not found」：上面的 select 內嵌了
    // `performance:staff!booking_addons_performance_staff_id_fkey(name)`，這個
    // FK 同樣由 0121 建立，尚未套用時 PostgREST 找不到這個關聯，回的是
    // PGRST200 而不是 42703（欄位缺失走 Postgres 錯誤碼、關聯缺失走
    // PostgREST 自己的錯誤碼），兩者都是「這個環境還沒套 0121」的同一種情境。
    // 兩者都不是「這筆預約真的沒有加購」以外的錯誤，但對使用者而言效果相
    // 同——安全收斂成空陣列，不讓整頁因為 500 掛掉。
    const code = String((error as any)?.code ?? '');
    if (code === '42703' || code === 'PGRST200') return ok([]);
    throw error;
  }

  return ok((data ?? []).map(toBookingAddon));
});

const bodySchema = z.object({
  serviceId: z.string().uuid().optional().nullable(),
  name: z.string().trim().min(1, '請輸入項目名稱'),
  price: z.number().min(0, '加購價不可為負數'),
  quantity: z.number().int().positive('數量需為正整數'),
  durationMinutes: z.number().int().min(0, '佔用時長不可為負數'),
  staffId: z.string().uuid().optional().nullable(),
  performanceMode: z.enum(['INHERIT', 'SPECIFIC_STAFF', 'NONE']),
  performanceStaffId: z.string().uuid().optional().nullable(),
  notify: z.boolean().optional().default(false),
  /** 由前端在開啟加購視窗時產生一次、整個送出/重試流程沿用同一把（見 addon-modal 前端註解）。 */
  idempotencyKey: z.string().trim().min(1, '缺少冪等金鑰'),
}).refine((v) => v.performanceMode !== 'SPECIFIC_STAFF' || !!v.performanceStaffId, {
  message: '請選擇業績歸戶人員', path: ['performanceStaffId'],
});

export const POST = handle(async (req, { params }) => {
  const t = await requireTenant();
  const { id } = await params;
  const b = bodySchema.parse(await req.json());

  const admin = createAdminSupabase();
  const { data, error } = await admin.rpc('create_booking_addon', {
    p_tenant: t.tenantId,
    p_booking: id,
    p_idempotency_key: b.idempotencyKey,
    p_service_id: b.serviceId ?? null,
    p_name: b.name,
    p_price: b.price,
    p_quantity: b.quantity,
    p_duration_minutes: b.durationMinutes,
    p_staff_id: b.staffId ?? null,
    p_performance_mode: b.performanceMode,
    p_performance_staff_id: b.performanceMode === 'SPECIFIC_STAFF' ? b.performanceStaffId : null,
    p_notification_requested: b.notify,
  });

  if (error) {
    const message = String((error as any)?.message ?? '');
    const code = String((error as any)?.code ?? '');
    // PGRST202（PostgREST 找不到函式）／42883（undefined_function）：搭配的
    // migration（0121）尚未套用到這個環境。這是環境排程問題，不是使用者輸入
    // 錯誤，回可讀的 503 而不是未分類 500。
    if (code === 'PGRST202' || code === '42883')
      throw new ApiHttpError(503, '加購功能尚未上線，請稍後再試', ERR.INTERNAL);
    if (code === '23P01') throw new ApiHttpError(409, '加購後時段與其他預約重疊', ERR.CONFLICT);
    if (message.includes('BOOKING_NOT_FOUND')) throw new ApiHttpError(404, '找不到此預約', ERR.NOT_FOUND);
    if (message.includes('SERVICE_NOT_FOUND')) throw new ApiHttpError(404, '找不到此服務', ERR.NOT_FOUND);
    if (message.includes('PERFORMANCE_STAFF_NOT_FOUND') || message.includes('STAFF_NOT_FOUND'))
      throw new ApiHttpError(404, '找不到此服務人員', ERR.NOT_FOUND);
    if (message.includes('PERFORMANCE_STAFF_REQUIRED'))
      throw new ApiHttpError(400, '請選擇業績歸戶人員', ERR.VALIDATION);
    if (message.includes('PERFORMANCE_MODE_INVALID'))
      throw new ApiHttpError(400, '業績歸戶模式不正確', ERR.VALIDATION);
    if (message.includes('PRICE_INVALID')) throw new ApiHttpError(400, '加購價不可為負數', ERR.VALIDATION);
    if (message.includes('QUANTITY_INVALID')) throw new ApiHttpError(400, '數量需為正整數', ERR.VALIDATION);
    if (message.includes('DURATION_INVALID'))
      throw new ApiHttpError(400, '佔用時長不可為負數', ERR.VALIDATION);
    if (message.includes('NAME_REQUIRED')) throw new ApiHttpError(400, '請輸入項目名稱', ERR.VALIDATION);
    if (message.includes('IDEMPOTENCY_KEY_REQUIRED'))
      throw new ApiHttpError(400, '缺少冪等金鑰', ERR.VALIDATION);
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new ApiHttpError(404, '找不到此預約', ERR.NOT_FOUND);

  // 通知：只有「這次是真的新建、且有要求通知」才嘗試——重放（replayed）永遠不重送，
  // 避免同一把 idempotency key 因為呼叫端重試而重複通知顧客。
  let notified: BookingAddonNotifiedOutcome = 'NONE';
  if (!row.replayed) {
    if (b.notify) {
      notified = await notifyBookingAddonReceipt(t.tenantId, id, {
        name: b.name, quantity: b.quantity, amount: Number(row.applied_amount),
      });
      const { error: updErr } = await admin.from('booking_addons')
        .update({ notified }).eq('id', row.addon_id).eq('tenant_id', t.tenantId);
      if (updErr) console.error('[booking-addons] 寫回 notified 失敗', updErr);
    }
  } else {
    const { data: existing } = await admin.from('booking_addons')
      .select('notified').eq('id', row.addon_id).eq('tenant_id', t.tenantId).maybeSingle();
    notified = (existing?.notified as BookingAddonNotifiedOutcome | undefined) ?? 'NONE';
  }

  return ok({
    id: row.addon_id as string,
    appliedAmount: Number(row.applied_amount),
    appliedMinutes: Number(row.applied_minutes),
    finalPrice: Number(row.final_price),
    durationMinutes: Number(row.duration_minutes),
    endAt: row.end_at as string,
    performanceMode: row.performance_mode as string,
    performanceStaffId: (row.performance_staff_id as string | null) ?? null,
    notified,
    replayed: !!row.replayed,
  });
});
