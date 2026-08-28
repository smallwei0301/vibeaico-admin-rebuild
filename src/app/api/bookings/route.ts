// GET：04-API-CONTRACTS.md §0 參考實作，逐字採用。POST：§B-1 手動建立預約。
import { z } from 'zod';
import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { pageRange, toPaged, pageSizeSchema } from '@/server/paging';
import { mapBooking } from '@/server/mappers';
import { createAdminSupabase } from '@/server/supabase';
import { notifyBookingEvent } from '@/server/email/notify';
import { notifyOwnerNewBooking } from '@/server/owner-notify';
import { throwAvailabilityRpcError } from '@/server/availability-rpc';

const querySchema = z.object({
  page: z.coerce.number().int().min(0).default(0),
  size: pageSizeSchema(20),
  status: z.enum(['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']).optional(),
  keyword: z.string().optional(),
  from: z.string().optional(), // ISO 日期
  to: z.string().optional(),
  staffId: z.string().uuid().optional(),
});

export const GET = handle(async (req) => {
  const t = await requireTenant();
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const { from, to, page, size } = pageRange(q.page, q.size);

  let query = t.supabase.from('bookings_view')
    .select('*', { count: 'exact' })
    .eq('tenant_id', t.tenantId)
    .order('start_at', { ascending: false })
    .range(from, to);
  if (q.status) query = query.eq('status', q.status);
  if (q.staffId) query = query.eq('staff_id', q.staffId);
  if (q.from) query = query.gte('start_at', q.from);
  if (q.to) query = query.lte('start_at', q.to);
  if (q.keyword) query = query.or(
    `customer_name.ilike.%${q.keyword}%,customer_phone.ilike.%${q.keyword}%,booking_no.ilike.%${q.keyword}%`);

  const { data, count, error } = await query;
  if (error) throw error;
  return ok(toPaged(data.map(mapBooking), count, page, size));
});

/* ------------------------------------------------------- POST 手動建立（§B-1） */

const createSchema = z.object({
  customerId: z.string().uuid(),
  serviceId: z.string().uuid(),
  staffId: z.string().uuid().optional(),
  startAt: z.string().min(1, '請輸入開始時間'),
  note: z.string().optional(),
});

/**
 * 手動建單走 `create_booking_with_availability`：產單號、讀服務時長、共用
 * availability check 與 insert 都在同一 transaction，避免和團次指派互相穿透。
 */
export const POST = handle(async (req) => {
  const t = await requireTenant();
  const b = createSchema.parse(await req.json());

  const startMs = Date.parse(b.startAt);
  if (Number.isNaN(startMs))
    throw new ApiHttpError(400, '開始時間格式錯誤', ERR.VALIDATION);

  // 404 規則（04 §0 第 7 條）：customerId/serviceId/staffId 查無或屬別店都回 404，
  // 不能只靠 FK —— FK 擋不住「指到別店資源」的情況（RLS 只管本次查詢，不管外鍵值）。
  const [{ data: service, error: sErr }, { data: customer, error: cErr }] = await Promise.all([
    t.supabase.from('services').select('id')
      .eq('id', b.serviceId).eq('tenant_id', t.tenantId).maybeSingle(),
    t.supabase.from('customers').select('id')
      .eq('id', b.customerId).eq('tenant_id', t.tenantId).maybeSingle(),
  ]);
  if (sErr) throw sErr;
  if (cErr) throw cErr;
  if (!service) throw new ApiHttpError(404, '找不到此服務', ERR.NOT_FOUND);
  if (!customer) throw new ApiHttpError(404, '找不到此顧客', ERR.NOT_FOUND);
  if (b.staffId) {
    const { data: staff, error } = await t.supabase.from('staff').select('id')
      .eq('id', b.staffId).eq('tenant_id', t.tenantId).maybeSingle();
    if (error) throw error;
    if (!staff) throw new ApiHttpError(404, '找不到此服務人員', ERR.NOT_FOUND);
  }

  const startAt = new Date(startMs).toISOString();
  const { data: bookingId, error: rpcError } = await t.supabase.rpc('create_booking_with_availability', {
    p_tenant: t.tenantId, p_customer_id: b.customerId, p_service_id: b.serviceId,
    p_staff_id: b.staffId ?? null, p_start: startAt, p_note: b.note ?? '',
  });
  if (rpcError) throwAvailabilityRpcError(rpcError);

  // Email 通知（05 分冊 §3 notifyNewBooking / notifyStaffBooking）：不 await ——
  // 寄信慢或失敗都不可拖垮回應，函式內部已吞錯（比照 cancel/route.ts）。
  void notifyBookingEvent(createAdminSupabase(), t.tenantId, bookingId, 'NEW');

  // 老闆通知（06 分冊 §5.5，issue #18）：新預約 → 推給通知名單上的**每一位**
  // （n 位＝n 則＝額度 -n）。名單為空就一則都不發。同樣 fire-and-forget，
  // 函式內部整段 try/catch 吞錯。
  // ⚠️ 與上面那行的 Email 通知是兩條獨立通道（一條寄信給店家信箱、一條推 LINE
  // 給名單），不可互相取代。
  void notifyOwnerNewBooking(t.tenantId, bookingId);
  return ok({ id: bookingId });
});
