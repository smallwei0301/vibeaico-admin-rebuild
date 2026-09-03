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
  };
}

export function planRow(input: z.infer<typeof planCreateSchema>, tenantId: string, tripId: string, sortOrder: number) {
  return {
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
