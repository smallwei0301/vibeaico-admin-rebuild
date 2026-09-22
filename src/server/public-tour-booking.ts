/**
 * src/server/public-tour-booking.ts — FIXED_DEPARTURE 方案的旅客自助預約
 * （issue #46：三種販售方式共用同一視覺語言的第二種——固定團次）
 * -----------------------------------------------------------------------------
 * ## 這個檔存在的理由
 *
 * `src/server/public-tour-request.ts` 已經補上 REQUEST 模式的自助迴路，但
 * `/s/{shopCode}` 至今對 `FIXED_DEPARTURE` 方案仍只顯示「用 LINE 或電話聯絡」——
 * `page.tsx` 檔頭明講這是刻意的 truthful fallback，不是完成品。這個檔補上
 * FIXED_DEPARTURE 的最短端到端迴路：挑方案 → 挑一個還有名額的團次 → 填聯絡方式
 * 與人數 → 送出 → 真的鎖位。
 *
 * ## 與 REQUEST 的關鍵差異：這裡送出當下就真的鎖位
 *
 * `create_tour_order` 依 `sales_mode` 分流（`0111`）：REQUEST 不鎖位，其餘
 * （含這裡的 FIXED_DEPARTURE）建單當下原子扣減名額，扣不到就整個交易回滾。
 * 因此這裡**不能**沿用 `public-tour-request.ts` 的「PENDING＝尚未鎖位」狀態頁
 * 文案——那句話對這裡是假的。訂單建立後名額已經是真的鎖住了，只是**付款**
 * 尚未完成（#12 金流 provider 尚未落地，這裡不造假付款連結）。呼叫端的狀態頁
 * 需要依 `order.salesMode` 分流顯示正確文案（見
 * `src/app/s/[shopCode]/requests/[orderId]/page.tsx` 的 `StatusBody`）。
 *
 * ## 為什麼重用 `create_tour_order`，不是另外寫一支
 *
 * 同 `public-tour-request.ts` 檔頭：同一支 rpc、同一套 order_no 產生規則，
 * 避免出現兩條「怎麼建一筆 tour_orders」的路互相漂移。
 *
 * ## 這是全站第三個「不需要登入就能打到」的資料寫入路徑
 *
 * 沿用 `public-tour-request.ts` 已建立的三條白名單規則（只接受指定
 * sales_mode 且 active＝true 的方案／必須先驗證 departure 屬於這個 plan、
 * tenant、狀態為 OPEN 且尚未額滿／不接受未發布行程底下的方案），只是這裡把
 * 「指定 sales_mode」換成 `FIXED_DEPARTURE`。
 */
import { z } from 'zod';
import { createAdminSupabase } from '@/server/supabase';
import { SHOP_CODE_PATTERN } from '@/lib/shop-code';
import { nextTourOrderNo } from '@/server/tour-order-no';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function queryFailed(stage: string, cause: unknown): Error {
  return new Error(`PUBLIC_TOUR_BOOKING_QUERY_FAILED:${stage}`, { cause });
}

/** 台北「今天」的日期字串（同 `public-tour-request.ts`，同一個 +8 常數來源道理）。 */
function taipeiToday(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function taipeiTodayDateStringCompact(): string {
  return taipeiToday().replaceAll('-', '').slice(2);
}

export type PublicBookingDeparture = {
  id: string;
  departsOn: string;
  startTime: string;
  seatsLeft: number;
};

export type PublicBookingPlan = {
  tenantId: string;
  shopName: string;
  tripId: string;
  tripTitle: string;
  planId: string;
  planName: string;
  planDescription: string;
  pricePerPerson: number;
  priceType: 'PER_PERSON' | 'PER_GROUP';
  minParty: number;
  maxParty: number;
  /** #46：成交當下取消／退款政策 snapshot 的來源；本方案所屬行程當下的政策。 */
  refundPolicyType: 'STANDARD' | 'FLEXIBLE' | 'STRICT';
  departures: PublicBookingDeparture[];
};

const MAX_DEPARTURES = 12;

/**
 * 讀一個 FIXED_DEPARTURE 方案的預約頁資料。找不到、非 FIXED_DEPARTURE、未上架、
 * 或所屬行程未發布一律回 null（呼叫端轉 404）——同 `loadPublicRequestPlan`，
 * 不區分「不存在」與「不合格」，避免讓外部連結用回應差異去猜哪些方案存在但
 * 被下架。
 */
export async function loadPublicBookingPlan(
  shopCode: string, planId: string,
): Promise<PublicBookingPlan | null> {
  if (!SHOP_CODE_PATTERN.test(shopCode)) return null;
  if (!UUID_RE.test(planId)) return null;

  const admin = createAdminSupabase();

  const { data: tenantRow, error: tenantError } = await admin
    .from('tenants').select('id, tenant_settings(basic)')
    .eq('shop_code', shopCode).maybeSingle();
  if (tenantError) throw queryFailed('tenants', tenantError);
  if (!tenantRow) return null;
  const tenantId = tenantRow.id as string;
  const rawSettings = (tenantRow as Record<string, unknown>).tenant_settings;
  const settings = (Array.isArray(rawSettings) ? rawSettings[0] : rawSettings) as
    | { basic?: Record<string, unknown> } | null | undefined;
  const shopName = (settings?.basic?.tenantName as string) || '';

  const { data: plan, error: planError } = await admin
    .from('trip_plans')
    .select('id, trip_id, name, description, price_per_person, price_type, min_party, max_party, sales_mode, active')
    .eq('id', planId).eq('tenant_id', tenantId).maybeSingle();
  if (planError) throw queryFailed('trip_plans', planError);
  if (!plan || !plan.active || plan.sales_mode !== 'FIXED_DEPARTURE') return null;

  const { data: trip, error: tripError } = await admin
    .from('trips').select('id, title, status, refund_policy_type')
    .eq('id', plan.trip_id).eq('tenant_id', tenantId).maybeSingle();
  if (tripError) throw queryFailed('trips', tripError);
  if (!trip || trip.status !== 'PUBLISHED') return null;

  const today = taipeiToday();
  const { data: departureRows, error: departureError } = await admin
    .from('trip_departures')
    .select('id, departs_on, start_time, capacity, seats_booked')
    .eq('tenant_id', tenantId).eq('plan_id', planId).eq('status', 'OPEN')
    .gte('departs_on', today)
    .order('departs_on', { ascending: true })
    .order('start_time', { ascending: true, nullsFirst: true });
  if (departureError) throw queryFailed('trip_departures', departureError);

  const departures: PublicBookingDeparture[] = [];
  for (const row of departureRows ?? []) {
    const capacity = Number(row.capacity ?? 0);
    const seatsBooked = Number(row.seats_booked ?? 0);
    if (seatsBooked >= capacity) continue;
    if (departures.length >= MAX_DEPARTURES) break;
    departures.push({
      id: row.id as string,
      departsOn: row.departs_on as string,
      startTime: row.start_time == null ? '' : String(row.start_time).slice(0, 5),
      seatsLeft: capacity - seatsBooked,
    });
  }

  return {
    tenantId,
    shopName,
    tripId: trip.id as string,
    tripTitle: (trip.title as string) ?? '',
    planId: plan.id as string,
    planName: (plan.name as string) ?? '',
    planDescription: (plan.description as string) ?? '',
    pricePerPerson: Number(plan.price_per_person ?? 0),
    priceType: plan.price_type === 'PER_GROUP' ? 'PER_GROUP' : 'PER_PERSON',
    minParty: Number(plan.min_party ?? 1),
    maxParty: Number(plan.max_party ?? 1),
    refundPolicyType: trip.refund_policy_type === 'FLEXIBLE' || trip.refund_policy_type === 'STRICT'
      ? trip.refund_policy_type : 'STANDARD',
    departures,
  };
}

export const submitPublicTourBookingSchema = z.object({
  shopCode: z.string().min(1).max(64),
  planId: z.string().uuid(),
  departureId: z.string().uuid(),
  partySize: z.coerce.number().int().min(1, '人數至少為 1'),
  // Final Risk F2 慣例同 `public-tour-request.ts`：自由文字欄位一律有上限。
  contactName: z.string().trim().min(1, '請輸入姓名').max(100, '姓名長度超過上限'),
  contactPhone: z.string().trim().max(40, '電話長度超過上限').optional(),
  contactLine: z.string().trim().max(100, 'LINE ID 長度超過上限').optional(),
  contactEmail: z.string().trim().max(254, 'Email 長度超過上限').email('Email 格式錯誤').optional().or(z.literal('')),
  note: z.string().trim().max(500).optional(),
}).refine(
  (v) => !!(v.contactPhone || v.contactLine || v.contactEmail),
  { message: '請至少填寫一種聯絡方式（LINE、電話或 Email）', path: ['contactPhone'] },
);

export type SubmitPublicTourBookingInput = z.infer<typeof submitPublicTourBookingSchema>;

export class PublicTourBookingError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

const MAX_ORDER_NO_ATTEMPTS = 3;

/**
 * 建立一筆 FIXED_DEPARTURE 訂單。全部驗證都在這裡自己查，**不信任前端傳來的
 * 任何配對**（同 `submitPublicTourRequest` 檔頭第 2、3 條）；建單當下由
 * `create_tour_order` 內部的 `reserve_seats` 原子扣減名額，扣不到就整個交易
 * 回滾、不留下空單。
 */
export async function submitPublicTourBooking(
  input: SubmitPublicTourBookingInput,
): Promise<{ orderId: string; orderNo: string }> {
  const admin = createAdminSupabase();

  const plan = await loadPublicBookingPlan(input.shopCode, input.planId);
  if (!plan) throw new PublicTourBookingError('PLAN_NOT_FOUND', '找不到此方案，或此方案目前未開放線上預約');

  if (input.partySize < plan.minParty || input.partySize > plan.maxParty) {
    throw new PublicTourBookingError('PARTY_SIZE_OUT_OF_RANGE', '人數不在此方案的成團人數範圍內');
  }

  const departure = plan.departures.find((d) => d.id === input.departureId);
  if (!departure) {
    throw new PublicTourBookingError('DEPARTURE_NOT_AVAILABLE', '此團次已不開放預約，請重新選擇日期');
  }

  const contact: Record<string, string> = { name: input.contactName };
  if (input.contactPhone) contact.phone = input.contactPhone;
  if (input.contactLine) contact.line = input.contactLine;
  if (input.contactEmail) contact.email = input.contactEmail;

  const yymmdd = taipeiTodayDateStringCompact();
  let orderId: string | null = null;
  let orderNo = '';
  let lastError: unknown = null;

  for (let attempt = 0; attempt < MAX_ORDER_NO_ATTEMPTS && !orderId; attempt++) {
    let candidateOrderNo: string;
    try {
      candidateOrderNo = await nextTourOrderNo(admin, plan.tenantId, yymmdd);
    } catch (nError) {
      throw queryFailed('order_no', nError);
    }

    const { data, error } = await admin.rpc('create_tour_order', {
      p_tenant: plan.tenantId,
      p_order_no: candidateOrderNo,
      p_departure: input.departureId,
      p_party_size: input.partySize,
      p_customer: null,
      p_contact: contact,
      // 同 `public-tour-request.ts`：'LINE' 是既有 tour_order_source 值域的既有
      // 值，旅客自助頁與 LINE rich menu／公開連結進來的旅程共用同一個來源標籤。
      p_source: 'LINE',
      // #12 金流 provider 尚未落地：不生成假付款連結、不冒充已付款。訂單建立
      // 後名額已真的鎖住，付款方式與期限由店家後續透過既有聯絡方式與旅客確認。
      p_payment_method: null,
      p_note: input.note ?? '',
      // FIXED_DEPARTURE 訂單同既有 GUIDE 側手動建單慣例：不自動設定付款保留
      // 到期時間（那是 REQUEST 被接受後才有意義的機制，見 0111）。
      p_hold_expires: null,
    });

    if (!error) { orderId = data as string; orderNo = candidateOrderNo; break; }

    const message = String((error as { message?: string } | null)?.message ?? '');
    if ((error as { code?: string } | null)?.code === '23505' || message.includes('duplicate key')) {
      lastError = error; continue;
    }
    if (message.includes('SEATS_UNAVAILABLE')) {
      throw new PublicTourBookingError('SEATS_UNAVAILABLE', '此團次名額已被搶先預約，請重新選擇日期');
    }
    if (message.includes('PARTY_SIZE_OUT_OF_RANGE')) {
      throw new PublicTourBookingError('PARTY_SIZE_OUT_OF_RANGE', '人數不在此方案的成團人數範圍內');
    }
    if (message.includes('DEPARTURE_NOT_FOUND') || message.includes('PLAN_NOT_FOUND')) {
      throw new PublicTourBookingError('DEPARTURE_NOT_AVAILABLE', '此團次已不開放預約，請重新選擇日期');
    }
    throw error;
  }

  if (!orderId) throw lastError ?? new Error('order_no allocation failed');
  return { orderId, orderNo };
}
