// GET  /api/bookings/:id/addons — 加購明細（未刪除者，依建立時間），issue #17。
// POST /api/bookings/:id/addons — 新增一筆加購，原子套用到 bookings.final_price/
//      duration_minutes/end_at（0119 `create_booking_addon` rpc），並依 `notify`
//      嘗試一次消費明細通知（結果與加購本身是否成功分離，見 04 §B-1.1）。
//
// PREPARE 階段（#530 staged schema release，`scripts/agents/schema-staged-release-policy.mjs`）：
// 本檔與同一 PR 的 migration 一起出現，`GET`/`POST` 兩個 export 都必須以
// `bookingAddonsSchemaActive()` 這顆 default-off gate 擋在函式本體第一行，
// 且函式本體以外（top-level）不得出現任何 DB/network 呼叫——這代表業務邏輯
// 必須整段寫在被 gate 擋住的 export 本體內，不能拆到檔案內的另一個未 export
// 輔助函式（那段程式碼會被判定成「top-level 呼叫」而擋下 PR）。因此本檔刻意
// **不**透過既有的 `handle()` HOF 包一層（`export const GET = handle(...)`
// 這個寫法本身就偵測不到是受 gate 保護的 entry），改成直接手寫等價的
// try/catch 錯誤映射（讀取型 GET 本來就是 `handle()` 內部對非寫入方法的
// 行為，逐字等價）。
//
// ⚠️ 已知取捨：POST 是寫入方法，既有 `handle()` 對寫入方法會額外跑一層
// 「代登入稽核」（`withImpersonationAudit`，見 `src/server/http.ts`）。本
// PREPARE 階段的 POST 暫時**不含**這層稽核（gate 預設關閉，此路由本來就
// 打不到）；ACTIVATE PR 打開 flag、且不再需要滿足這顆 mechanical gate 時，
// 應改回 `export const POST = handle(async (req, ctx) => { … })` 的既有慣例，
// 讓平台管理者代入時的寫入稽核與其他寫入路由一致。
import { z } from 'zod';
import { NextResponse } from 'next/server';
import { ok, ApiHttpError, ERR, fail } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { createAdminSupabase } from '@/server/supabase';
import { bookingAddonsSchemaActive, notifyBookingAddonReceipt } from '@/server/booking-addons-notify';
import type { BookingAddon, BookingAddonNotifiedOutcome } from '@/types/booking-addons';

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

function mapThrown(e: any, routeLabel: string): Response {
  if (e instanceof ApiHttpError) return fail(e.status, e.message, e.code);
  if (e?.name === 'ZodError') return fail(400, e.issues?.[0]?.message ?? '輸入格式錯誤', ERR.VALIDATION);
  console.error('[api]', routeLabel, e);
  return fail(500, '系統發生錯誤，請稍後再試', ERR.INTERNAL);
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!bookingAddonsSchemaActive()) {
    return NextResponse.json({ success: false, message: '加購功能尚未啟用', code: ERR.NOT_FOUND }, { status: 404 });
  }
  try {
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
    if (error) throw error;

    return ok((data ?? []).map(toBookingAddon));
  } catch (e: any) {
    return mapThrown(e, 'GET /api/bookings/:id/addons');
  }
}

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

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!bookingAddonsSchemaActive()) {
    return NextResponse.json({ success: false, message: '加購功能尚未啟用', code: ERR.NOT_FOUND }, { status: 404 });
  }
  try {
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
  } catch (e: any) {
    return mapThrown(e, 'POST /api/bookings/:id/addons');
  }
}
