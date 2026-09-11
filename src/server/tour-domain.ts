import { z } from 'zod';

export const tripStatus = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export const departureStatus = ['OPEN', 'CLOSED', 'CANCELLED'] as const;
export const depositModes = ['NONE', 'DEPOSIT_FIXED', 'DEPOSIT_PERCENT', 'FULL'] as const;
export const addonUnits = ['PER_PERSON', 'PER_GROUP'] as const;

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

const optionalText = z.string().optional();

function validDate(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const dateField = z.string().regex(datePattern, '日期格式錯誤').refine(validDate, '日期不存在');

export const tripCreateSchema = z.object({
  title: z.string().trim().min(1, '請輸入行程名稱'),
  slug: z.string().trim().min(1).max(160).optional(),
  summary: optionalText,
  description: optionalText,
  coverImageUrl: optionalText,
  gallery: z.array(z.unknown()).optional(),
  location: optionalText,
  durationHours: z.number().finite().nonnegative().nullable().optional(),
  meetingPoint: optionalText,
  includes: optionalText,
  notes: optionalText,
  /* ---- issue #259：`0089` 補上欄位後才收得下的五個顯示欄位 ---- */
  tagline: optionalText,
  meetingPointMapUrl: optionalText,
  exclusions: z.array(z.string()).optional(),
  notices: z.array(z.string()).optional(),
  refundPolicyType: z.enum(['STANDARD', 'FLEXIBLE', 'STRICT']).optional(),
});

export const tripUpdateSchema = tripCreateSchema.partial();

const planFields = {
  name: z.string().trim().min(1, '請輸入方案名稱').optional(),
  description: optionalText,
  pricePerPerson: z.number().finite().nonnegative('價格不得為負數').optional(),
  childPrice: z.number().finite().nonnegative('兒童價不得為負數').nullable().optional(),
  minParty: z.number().int().min(1, '最低人數必須至少為 1').optional(),
  maxParty: z.number().int().min(1, '最高人數必須至少為 1').optional(),
  depositMode: z.enum(depositModes).optional(),
  depositValue: z.number().finite().nonnegative('定金不得為負數').optional(),
  sortOrder: z.number().int().optional(),
  active: z.boolean().optional(),
};

export const planCreateSchema = z.object({
  ...planFields,
  name: planFields.name.unwrap(),
  pricePerPerson: planFields.pricePerPerson.unwrap(),
}).superRefine((value, ctx) => {
  validatePlanRange(value, ctx);
  const paymentError = planPaymentError({
    pricePerPerson: value.pricePerPerson,
    depositMode: value.depositMode ?? 'FULL',
    depositValue: value.depositValue ?? 0,
  });
  if (paymentError) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['depositValue'], message: paymentError });
  }
});

export const planUpdateSchema = z.object(planFields).superRefine((value, ctx) => {
  validatePlanRange(value, ctx);
  const paymentError = planDepositError(value);
  if (paymentError) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['depositValue'], message: paymentError });
  }
});

function validatePlanRange(value: {
  minParty?: number;
  maxParty?: number;
}, ctx: z.RefinementCtx) {
  if (value.minParty !== undefined && value.maxParty !== undefined && value.minParty > value.maxParty) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['maxParty'], message: '最高人數不得小於最低人數' });
  }
}

/**
 * Shared with the Service payment semantics (Owner Decision 2026-08-27).
 * A TripPlan's bounded #8-A price is per person, so a fixed deposit cannot
 * exceed that known per-person amount.  The later order slice calculates the
 * actual party total from its immutable snapshot.
 */
export function planPaymentError(value: {
  pricePerPerson: number;
  depositMode: typeof depositModes[number];
  depositValue: number;
}): string | null {
  return planDepositError(value);
}

function planDepositError(value: {
  pricePerPerson?: number;
  depositMode?: typeof depositModes[number];
  depositValue?: number;
}): string | null {
  if (value.pricePerPerson !== undefined
    && (!Number.isFinite(value.pricePerPerson) || value.pricePerPerson < 0)) return '方案價格無效';
  if (value.depositValue !== undefined
    && (!Number.isFinite(value.depositValue) || value.depositValue < 0)) return '訂金金額無效';
  if (value.depositMode !== undefined && !depositModes.includes(value.depositMode)) return '訂金模式無效';
  if (value.depositMode === undefined || value.depositValue === undefined) return null;

  if (value.depositMode === 'DEPOSIT_FIXED') {
    if (value.depositValue <= 0) return '固定訂金必須大於 0';
    if (value.pricePerPerson !== undefined && value.depositValue > value.pricePerPerson) {
      return '固定訂金不得超過方案每人價格';
    }
  } else if (value.depositMode === 'DEPOSIT_PERCENT') {
    if (value.depositValue <= 0 || value.depositValue > 100) return '訂金比例必須介於 1 到 100%';
  } else if (value.depositValue !== 0) {
    return '不預收或全額付清模式不得設定訂金金額';
  }

  return null;
}

const departureFields = {
  planId: z.string().uuid('請選擇方案').optional(),
  departsOn: dateField.optional(),
  startTime: z.string().refine((value) => value === '' || timePattern.test(value), '出發時間格式錯誤').nullable().optional(),
  capacity: z.number().int('名額必須為整數').min(1, '名額必須大於 0').optional(),
  status: z.enum(departureStatus).optional(),
  note: optionalText,
  /* ---- issue #37：團次實際執行人員。null = 明確清空；undefined = 這次不動它 ---- */
  primaryStaffId: z.string().uuid('請選擇主導遊').nullable().optional(),
  assistantStaffIds: z.array(z.string().uuid('協同導遊 id 格式錯誤')).optional(),
};

export const departureCreateSchema = z.object({
  ...departureFields,
  planId: departureFields.planId.unwrap(),
  departsOn: departureFields.departsOn.unwrap(),
  capacity: departureFields.capacity.unwrap(),
});

export const departureUpdateSchema = z.object(departureFields);

export const departureBatchSchema = z.object({
  planId: z.string().uuid('請選擇方案'),
  from: dateField,
  to: dateField,
  weekdays: z.array(z.number().int().min(0).max(6)).min(1, '請至少選一個星期'),
  startTime: z.string().refine((value) => value === '' || timePattern.test(value), '出發時間格式錯誤').nullable().optional(),
  capacity: z.number().int('名額必須為整數').min(1, '名額必須大於 0'),
  primaryStaffId: z.string().uuid('請選擇主導遊').nullable().optional(),
  assistantStaffIds: z.array(z.string().uuid('協同導遊 id 格式錯誤')).optional(),
}).superRefine((value, ctx) => {
  if (new Set(value.weekdays).size !== value.weekdays.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['weekdays'], message: '星期不可重複' });
  }
  if (value.to < value.from) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: '結束日期不得早於起始日期' });
  }
});

export const addonCreateSchema = z.object({
  name: z.string().trim().min(1, '請輸入加購項名稱'),
  price: z.number().finite().nonnegative('價格不得為負數').optional(),
  unit: z.enum(addonUnits).optional(),
  stock: z.number().int('庫存必須為整數').nonnegative('庫存不得為負數').nullable().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export const addonUpdateSchema = addonCreateSchema.partial();

export function slugFromTitle(value: string): string {
  const slug = value.toLowerCase().trim()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || `trip-${Date.now()}`;
}

export function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(String);
}

export function dateRange(from: string, to: string): string[] {
  const start = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
  const end = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)));
  const dates: string[] = [];
  for (let cursor = start; cursor <= end; cursor += 86_400_000) {
    dates.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return dates;
}

/** Number of inclusive UTC calendar days, computed without allocating dates. */
export function dateRangeLength(from: string, to: string): number {
  const start = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
  const end = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)));
  return Math.floor((end - start) / 86_400_000) + 1;
}

export function tripRow(input: z.infer<typeof tripCreateSchema>, tenantId: string) {
  return {
    tenant_id: tenantId,
    slug: input.slug ?? slugFromTitle(input.title),
    title: input.title,
    summary: input.summary ?? '',
    description: input.description ?? '',
    cover_image_url: input.coverImageUrl ?? '',
    gallery: input.gallery ?? [],
    location: input.location ?? '',
    duration_hours: input.durationHours ?? null,
    meeting_point: input.meetingPoint ?? '',
    includes: input.includes ?? '',
    notes: input.notes ?? '',
    // 0089 補上的展示欄位：建立時就要一起寫入，否則新行程永遠只有空值。
    tagline: input.tagline ?? '',
    meeting_point_map_url: input.meetingPointMapUrl ?? '',
    exclusions: input.exclusions ?? [],
    notices: input.notices ?? [],
    refund_policy_type: input.refundPolicyType ?? 'STANDARD',
  };
}

/**
 * `source` 是**必填參數**，不是選填。
 *
 * 21 分冊 §6 要求「代登入下建立的資料自動標成 `PLATFORM_ASSISTED`」，而且是**伺服器端
 * 決定、不接受客戶端傳入**。做成必填是為了讓「忘記帶」變成編譯錯誤而不是靜默的
 * `GUIDE`——一筆被誤標成導遊自建的代建資料，事後沒有任何方法分辨得出來。
 *
 * 它只是來源標記，**不改變任何權限**：導遊仍是資料 owner，照樣改得動、刪得掉。
 */
export function planRow(
  input: z.infer<typeof planCreateSchema>,
  tenantId: string,
  tripId: string,
  sortOrder: number,
  source: 'GUIDE' | 'PLATFORM_ASSISTED' | 'IMPORTED',
) {
  return {
    source,
    tenant_id: tenantId,
    trip_id: tripId,
    name: input.name,
    description: input.description ?? '',
    price_per_person: input.pricePerPerson,
    child_price: input.childPrice ?? null,
    min_party: input.minParty ?? 1,
    max_party: input.maxParty ?? 10,
    deposit_mode: input.depositMode ?? 'FULL',
    deposit_value: input.depositValue ?? 0,
    sort_order: input.sortOrder ?? sortOrder,
    active: input.active ?? true,
  };
}

export function timeValue(value: string | null | undefined): string | null {
  return value ? value : null;
}

/* ------------------------------------------------------------- 旅遊訂單（#8-B）
 * 10 分冊 §1.1（schema）／§3（生命週期）。狀態機與名額釋放的判準只有這一份。 */

export const tourOrderStatuses = ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED'] as const;
export const tourPaymentStatuses = ['UNPAID', 'PAID', 'REFUNDED'] as const;
export const tourOrderSources = ['MIDAO', 'VIBEAI_SHOP', 'LINE', 'MANUAL'] as const;

export type TourOrderStatusValue = (typeof tourOrderStatuses)[number];

export const manualTourOrderSchema = z.object({
  departureId: z.string().uuid(),
  customerName: z.string().trim().min(1, '請輸入顧客姓名'),
  customerPhone: z.string().trim().min(1, '請輸入聯絡電話'),
  partySize: z.coerce.number().int().min(1, '人數至少為 1'),
  /**
   * 收款方式 id。**目前一律存不進去，而且這是誠實的**：
   * `tenant_payment_methods` 表在 supabase/migrations 裡零命中，
   * `/tenant/payment-methods` 頁讀的是頁內的 MOCK_METHODS 常數，
   * 也沒有任何 `/api/payment-methods` 路由——收款方式整條鏈路還沒有後端。
   *
   * 前端送過來的會是 mock id（`pm_1` 之類），不是 uuid。**不用 `.uuid()`**，
   * 否則整張手動建單表單會因為一個還沒有後端的欄位而 400，把可用的功能一起擋掉。
   * 只有真的是 uuid 的值才落庫（見 route），其餘視為 null。
   */
  paymentMethodId: z.string().trim().nullable().optional(),
  note: optionalText,
});

export const cancelTourOrderSchema = z.object({
  reason: optionalText,
});

/**
 * 狀態機（10 分冊 §3）：
 *
 *   PENDING（已佔名額）──付款確認──► CONFIRMED ──出團後──► COMPLETED
 *      │                                 │
 *      └── 過期／取消 ─► CANCELLED ◄──── 取消（已付款須人工退款）
 *
 * COMPLETED 與 CANCELLED 是終態。**回 false 的轉換一律 409**，不得靜默成功——
 * 「已經是這個狀態了」與「這個轉換不合法」對店家是同一件事：他按下去沒有發生
 * 他以為會發生的事，就必須被告知。
 */
export function canTransitionTourOrder(
  from: TourOrderStatusValue, to: TourOrderStatusValue,
): boolean {
  if (from === to) return false;
  if (from === 'PENDING') return to === 'CONFIRMED' || to === 'CANCELLED';
  if (from === 'CONFIRMED') return to === 'COMPLETED' || to === 'CANCELLED';
  return false; // COMPLETED / CANCELLED 是終態
}

/**
 * 取消時要不要釋放名額。
 *
 * 只有還佔著名額的單（PENDING／CONFIRMED）才釋放。已 CANCELLED 的單再取消一次
 * 不得再釋放一次——那會讓名額憑空多出來（同樣的守門也寫在 `cancel_tour_order`
 * rpc 裡，這裡是給呼叫端與測試看的同一條規則）。
 */
export function shouldReleaseSeats(from: TourOrderStatusValue): boolean {
  return from === 'PENDING' || from === 'CONFIRMED';
}
