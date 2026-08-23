// GET：04-API-CONTRACTS.md §0 參考實作，逐字採用。POST：§B-1 手動建立預約。
import { z } from 'zod';
import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { pageRange, toPaged } from '@/server/paging';
import { mapBooking } from '@/server/mappers';
import { createAdminSupabase } from '@/server/supabase';
import { notifyBookingEvent } from '@/server/email/notify';
import { taipeiTodayDateString } from '@/server/tz';

const querySchema = z.object({
  page: z.coerce.number().int().min(0).default(0),
  size: z.coerce.number().int().min(1).max(100).default(20),
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
 * booking_no = 'B' + yymmdd + 4 碼流水（unique (tenant_id, booking_no)）。
 * yymmdd 取「建立當下」的台北日期（taipeiTodayDateString），流水 = 查該租戶
 * 同前綴的最大單號 +1 補零。兩個併發請求可能取到同一個流水（撞 23505 unique
 * violation），呼叫端以 retry 迴圈處理。
 *
 * ⚠️ 同樣的產號邏輯在 recurring-bookings/[id]/renew/route.ts 也有一份：
 * Next.js route 檔只能 export HTTP method（build 會驗證匯出形狀），而 §B-1
 * 分工僅允許本 agent 動 route 檔與 types.ts，無法放進共用模組，故兩處各留
 * 一份並互相註記；日後抽出時兩處一起改。
 */
async function nextBookingNo(
  supabase: Awaited<ReturnType<typeof requireTenant>>['supabase'],
  tenantId: string,
): Promise<string> {
  const yymmdd = taipeiTodayDateString().slice(2).replace(/-/g, '');
  const prefix = `B${yymmdd}`;
  const { data, error } = await supabase.from('bookings')
    .select('booking_no')
    .eq('tenant_id', tenantId)
    .like('booking_no', `${prefix}%`)
    .order('booking_no', { ascending: false })
    .limit(1);
  if (error) throw error;
  const lastSeq = data?.[0] ? Number(data[0].booking_no.slice(prefix.length)) : 0;
  return `${prefix}${String((Number.isFinite(lastSeq) ? lastSeq : 0) + 1).padStart(4, '0')}`;
}

export const POST = handle(async (req) => {
  const t = await requireTenant();
  const b = createSchema.parse(await req.json());

  const startMs = Date.parse(b.startAt);
  if (Number.isNaN(startMs))
    throw new ApiHttpError(400, '開始時間格式錯誤', ERR.VALIDATION);

  // 404 規則（04 §0 第 7 條）：customerId/serviceId/staffId 查無或屬別店都回 404，
  // 不能只靠 FK —— FK 擋不住「指到別店資源」的情況（RLS 只管本次查詢，不管外鍵值）。
  const [{ data: service, error: sErr }, { data: customer, error: cErr }] = await Promise.all([
    t.supabase.from('services').select('id, duration_minutes, price')
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
  const endAt = new Date(startMs + service.duration_minutes * 60_000).toISOString();

  // booking_no 撞號（併發）重試最多 3 次；重疊（DB 排除約束 x_bookings_overlap）
  // 是業務衝突不重試，直接 409。
  let bookingId: string | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await t.supabase.from('bookings')
      .insert({
        tenant_id: t.tenantId,
        booking_no: await nextBookingNo(t.supabase, t.tenantId),
        customer_id: b.customerId,
        service_id: b.serviceId,
        staff_id: b.staffId ?? null,
        start_at: startAt,
        end_at: endAt,
        duration_minutes: service.duration_minutes,
        price: service.price,
        final_price: service.price,
        source: 'MANUAL',
        note: b.note ?? '',
      })
      .select('id')
      .single();
    if (!error) { bookingId = data.id; break; }
    if (error.code === '23P01')
      throw new ApiHttpError(409, '該時段已有預約', ERR.CONFLICT);
    if (error.code === '23505' && attempt < 2) continue; // 單號撞號 → 重取流水再試
    throw error;
  }
  if (!bookingId) throw new ApiHttpError(409, '預約單號產生失敗，請重試', ERR.CONFLICT);

  // Email 通知（05 分冊 §3 notifyNewBooking / notifyStaffBooking）：不 await ——
  // 寄信慢或失敗都不可拖垮回應，函式內部已吞錯（比照 cancel/route.ts）。
  void notifyBookingEvent(createAdminSupabase(), t.tenantId, bookingId, 'NEW');
  return ok({ id: bookingId });
});
