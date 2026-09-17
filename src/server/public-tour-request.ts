/**
 * src/server/public-tour-request.ts — REQUEST 模式的旅客自助申請（issue #46 第二片）
 * -----------------------------------------------------------------------------
 * ## 這個檔存在的理由
 *
 * `src/server/public-shop.ts` 已經讓 `/s/{shopCode}` 打得開、看得到已發布的行程與
 * 方案，但顧客看完之後**沒有任何真的能送出申請的路徑**——整條鏈路仍然只有「用 LINE
 * 或電話聯絡」。這個檔補上其中一種 sales_mode（`REQUEST`：先申請、導遊接受才鎖位）
 * 的最短端到端迴路：挑方案 → 挑一個還有名額的團次 → 填聯絡方式與人數 → 送出。
 *
 * ## 為什麼重用 `create_tour_order`，不是另外寫一支
 *
 * `0111` 已經把「REQUEST 建單不鎖名額、導遊接受才鎖」這件事做進 `create_tour_order`
 * 內部（依 `trip_plans.sales_mode` 分流），GUIDE 側 `/api/tour-orders/manual` 也是
 * 呼叫同一支 rpc。旅客這裡如果另外寫一套建單邏輯，就會出現兩條「怎麼建一筆
 * tour_orders」的路——其中一條算錯任何一個欄位（金額、`seats_reserved`、
 * `refund_policy_snapshot`……）都不會在另一條被抓到。所以完全比照
 * `manual/route.ts` 的呼叫方式：同一支 rpc、同一套 order_no 產生規則。
 *
 * ## 這是全站第二個「不需要登入就能打到」的資料寫入路徑
 *
 * 第一個是 `public-shop.ts` 的讀路徑，那個檔已經寫過三條白名單規則。這裡是
 * **寫入**，風險更高，額外三條：
 *
 * 1. **只接受 `sales_mode = 'REQUEST'` 且 `active = true` 的方案。** 其餘 sales_mode
 *    這一輪不接——issue 明講「不要建 FIXED_DEPARTURE／INSTANT 的付款鏈」，讓這裡
 *    也接受它們，等於是幫忙生出一種「看起來鎖住了名額（其實這幾種 sales_mode 建單
 *    當下就真的會鎖）但完全繞過任何金流」的訂單，比不做還糟。
 * 2. **必須先驗證 departure 屬於這個 plan、這個 tenant、狀態為 OPEN、且尚未額滿。**
 *    不能只信任前端傳來的 partySize／departureId 配對；併發搶最後一席交給
 *    `create_tour_order` 內部的 `reserve_seats`（REQUEST 這裡是 no-op，見下方），
 *    但「這個 departure 到底存不存在、屬不屬於這個方案」必須自己查一次，
 *    否則旅客可以送一個任意 uuid 把訂單掛到別的 tenant 的 departure 上。
 * 3. **不接受未發布行程 (`trips.status <> 'PUBLISHED'`) 底下的方案。** 草稿行程的
 *    方案不該被外部連結直接申請到——`public-shop.ts` 的公開頁本來就不會顯示它，
 *    但 API 端點本身不能只靠「畫面沒有連結」當作唯一防線（連結可以被猜到／分享）。
 */
import { z } from 'zod';
import { createAdminSupabase } from '@/server/supabase';
import { SHOP_CODE_PATTERN } from '@/lib/shop-code';
import { hydrateTourOrders } from '@/server/tour-orders';
import type { TourOrder } from '@/lib/types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function queryFailed(stage: string, cause: unknown): Error {
  return new Error(`PUBLIC_TOUR_REQUEST_QUERY_FAILED:${stage}`, { cause });
}

/** 台北「今天」的日期字串（同 `public-shop.ts`，同一個 +8 常數來源道理）。 */
function taipeiToday(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function taipeiTodayDateStringCompact(): string {
  return taipeiToday().replaceAll('-', '').slice(2);
}

export type PublicRequestDeparture = {
  id: string;
  departsOn: string;
  startTime: string;
  seatsLeft: number;
};

export type PublicRequestPlan = {
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
  /** #46：導遊接受此申請後的預設付款保留時數（`trip_plans.request_hold_hours`）。 */
  requestHoldHours: number;
  /** #46：本方案所屬行程當下的取消／退款政策（`trips.refund_policy_type`）。 */
  refundPolicyType: 'STANDARD' | 'FLEXIBLE' | 'STRICT';
  departures: PublicRequestDeparture[];
};

const MAX_DEPARTURES = 12;

/**
 * 讀一個 REQUEST 方案的申請頁資料。找不到、非 REQUEST、未上架、或所屬行程未發布
 * 一律回 null（呼叫端轉 404）——不區分「不存在」與「不合格」，避免讓外部連結
 * 用回應差異去猜哪些方案存在但被下架。
 */
export async function loadPublicRequestPlan(
  shopCode: string, planId: string,
): Promise<PublicRequestPlan | null> {
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
    .select('id, trip_id, name, description, price_per_person, price_type, min_party, max_party, sales_mode, active, request_hold_hours')
    .eq('id', planId).eq('tenant_id', tenantId).maybeSingle();
  if (planError) throw queryFailed('trip_plans', planError);
  if (!plan || !plan.active || plan.sales_mode !== 'REQUEST') return null;

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

  const departures: PublicRequestDeparture[] = [];
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
    requestHoldHours: Number(plan.request_hold_hours ?? 12),
    refundPolicyType: trip.refund_policy_type === 'FLEXIBLE' || trip.refund_policy_type === 'STRICT'
      ? trip.refund_policy_type : 'STANDARD',
    departures,
  };
}

export const submitPublicTourRequestSchema = z.object({
  shopCode: z.string().min(1).max(64),
  planId: z.string().uuid(),
  departureId: z.string().uuid(),
  partySize: z.coerce.number().int().min(1, '人數至少為 1'),
  contactName: z.string().trim().min(1, '請輸入姓名'),
  /** 至少一種聯絡方式（LINE／電話／Email）——三選一以上，不是三個都必填。 */
  contactPhone: z.string().trim().optional(),
  contactLine: z.string().trim().optional(),
  contactEmail: z.string().trim().email('Email 格式錯誤').optional().or(z.literal('')),
  /** 方案專屬問題（最多 2 題，見 issue 規格「至多 2 題方案專屬必填問題」）。
   *  這一輪沒有方案端的問題設定介面（那是另一塊 UI 工作），所以固定成通用的
   *  「偏好日期/時段補充」與「特殊需求」兩題，並非每方案客製——如實記在
   *  PR 說明裡，不假裝這是已經做完的可設定題目。 */
  preferredNote: z.string().trim().max(500).optional(),
  specialRequest: z.string().trim().max(500).optional(),
}).refine(
  (v) => !!(v.contactPhone || v.contactLine || v.contactEmail),
  { message: '請至少填寫一種聯絡方式（LINE、電話或 Email）', path: ['contactPhone'] },
);

export type SubmitPublicTourRequestInput = z.infer<typeof submitPublicTourRequestSchema>;

export class PublicTourRequestError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

const MAX_ORDER_NO_ATTEMPTS = 3;

/**
 * 建立一筆 REQUEST 訂單。全部驗證都在這裡自己查，**不信任前端傳來的任何配對**
 * （見檔頭第 2、3 條）；實際建單與扣不扣名額由 `create_tour_order` rpc 決定
 * （REQUEST 這裡它會走 `0111` 的不鎖位分支）。
 */
export async function submitPublicTourRequest(
  input: SubmitPublicTourRequestInput,
): Promise<{ orderId: string; orderNo: string }> {
  const admin = createAdminSupabase();

  const plan = await loadPublicRequestPlan(input.shopCode, input.planId);
  if (!plan) throw new PublicTourRequestError('PLAN_NOT_FOUND', '找不到此方案，或此方案目前未開放線上申請');

  if (input.partySize < plan.minParty || input.partySize > plan.maxParty) {
    throw new PublicTourRequestError('PARTY_SIZE_OUT_OF_RANGE', '人數不在此方案的成團人數範圍內');
  }

  // 團次必須是這一次讀到的、屬於這個方案、還有名額的候選之一——不接受前端傳來
  // 但不在候選清單裡的 departureId（例如已經額滿、已被關閉、或根本不屬於此方案）。
  const departure = plan.departures.find((d) => d.id === input.departureId);
  if (!departure) {
    throw new PublicTourRequestError('DEPARTURE_NOT_AVAILABLE', '此團次已不開放申請，請重新選擇日期');
  }

  const contact: Record<string, string> = { name: input.contactName };
  if (input.contactPhone) contact.phone = input.contactPhone;
  if (input.contactLine) contact.line = input.contactLine;
  if (input.contactEmail) contact.email = input.contactEmail;
  const noteParts: string[] = [];
  if (input.preferredNote) noteParts.push(`偏好日期/時段補充：${input.preferredNote}`);
  if (input.specialRequest) noteParts.push(`特殊需求：${input.specialRequest}`);

  const yymmdd = taipeiTodayDateStringCompact();
  let orderId: string | null = null;
  let orderNo = '';
  let lastError: unknown = null;

  for (let attempt = 0; attempt < MAX_ORDER_NO_ATTEMPTS && !orderId; attempt++) {
    const { data: last, error: nError } = await admin
      .from('tour_orders').select('order_no')
      .eq('tenant_id', plan.tenantId).like('order_no', `TO${yymmdd}%`)
      .order('order_no', { ascending: false }).limit(1).maybeSingle();
    if (nError) throw queryFailed('order_no', nError);
    const serial = last ? Number(String(last.order_no).slice(-4)) + 1 : 1;
    const candidateOrderNo = `TO${yymmdd}${String(serial).padStart(4, '0')}`;

    const { data, error } = await admin.rpc('create_tour_order', {
      p_tenant: plan.tenantId,
      p_order_no: candidateOrderNo,
      p_departure: input.departureId,
      p_party_size: input.partySize,
      p_customer: null,
      p_contact: contact,
      // 'LINE' 是既有 tour_order_source 值域的既有值——旅客自助頁與 LINE
      // rich menu／公開連結進來的旅程共用同一個來源標籤，不新增列舉值。
      p_source: 'LINE',
      p_payment_method: null,
      p_note: noteParts.join('\n'),
      // REQUEST 訂單本身不因為「未付款」而自動過期（10 分冊既有慣例：
      // hold_expires_at 只在導遊接受後由 accept_tour_request 算出）。
      p_hold_expires: null,
    });

    if (!error) { orderId = data as string; orderNo = candidateOrderNo; break; }

    const message = String((error as { message?: string } | null)?.message ?? '');
    if ((error as { code?: string } | null)?.code === '23505' || message.includes('duplicate key')) {
      lastError = error; continue;
    }
    if (message.includes('SEATS_UNAVAILABLE')) {
      throw new PublicTourRequestError('SEATS_UNAVAILABLE', '此團次名額已被搶先申請，請重新選擇日期');
    }
    if (message.includes('PARTY_SIZE_OUT_OF_RANGE')) {
      throw new PublicTourRequestError('PARTY_SIZE_OUT_OF_RANGE', '人數不在此方案的成團人數範圍內');
    }
    if (message.includes('DEPARTURE_NOT_FOUND') || message.includes('PLAN_NOT_FOUND')) {
      throw new PublicTourRequestError('DEPARTURE_NOT_AVAILABLE', '此團次已不開放申請，請重新選擇日期');
    }
    throw error;
  }

  if (!orderId) throw lastError ?? new Error('order_no allocation failed');
  return { orderId, orderNo };
}

/**
 * 供旅客申請成功後的狀態頁使用。**沒有旅客登入機制**（#11／#12 尚未落地，見
 * PR 說明的 DEPENDENCY），所以用「訂單 id + 申請時填的聯絡方式其中一項」做
 * 最小可行的身分核對——比對得上才回資料，比對不上一律回 null（呼叫端轉 404），
 * 不得因為 id 猜得到就把別人的訂單內容洩漏出去。
 */
export async function loadPublicTourRequestStatus(
  orderId: string, contact: string,
): Promise<TourOrder | null> {
  if (!UUID_RE.test(orderId)) return null;
  const normalizedContact = contact.trim().toLowerCase();
  if (!normalizedContact) return null;

  const admin = createAdminSupabase();
  const { data: row, error } = await admin
    .from('tour_orders').select('*').eq('id', orderId).maybeSingle();
  if (error) throw queryFailed('tour_orders', error);
  if (!row) return null;

  const c = (row.contact ?? {}) as Record<string, unknown>;
  const candidates = [c.phone, c.line, c.email]
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .map((v) => v.trim().toLowerCase());
  if (!candidates.includes(normalizedContact)) return null;

  const [order] = await hydrateTourOrders(admin, row.tenant_id as string, [row]);
  return order ?? null;
}
