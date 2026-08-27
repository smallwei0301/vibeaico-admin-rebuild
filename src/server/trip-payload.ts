/**
 * src/server/trip-payload.ts — 行程／方案的欄位轉換與 tour-platform JSON 轉譯
 *
 * 集中在這裡的理由：同一組欄位對照要被四個地方共用（建立、更新、JSON 匯入、
 * JSON 匯出），散在各 route 會漂移。
 *
 * ⚠️ tour-platform 的 JSON 與本專案的契約有三處**不同的命名習慣**，轉譯時要換：
 *   1. enum 大小寫：tour-platform 用 `per_person` / `scheduled`，本專案 types.ts
 *      的 PriceType / TripBookingType 是大寫（`PER_PERSON` / `SCHEDULED`）。
 *   2. 欄位名：`priceTwd`→行程層無對應（本專案價格在方案層）、
 *      `shortDescription`→`summary`、`imageUrls`→`gallery`、`guideSlug`→不匯入
 *      （那是 tour-platform 的導遊代碼，本專案的租戶就是導遊本人）。
 *   3. 陣列 vs 換行字串：tour-platform 匯出時已經是陣列，本專案 DB 也存 jsonb
 *      陣列，因此不需要 split('\n')——但匯入的 JSON 若是人手改過的字串，
 *      `toStringArray()` 仍會容錯處理。
 */
import type { Trip, TripPlan } from '@/lib/types';

/** 容錯：接受陣列、換行字串、undefined，一律回字串陣列。 */
export function toStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === 'string') return v.split('\n').map((x) => x.trim()).filter(Boolean);
  return [];
}

/** tour-platform 的小寫 enum → 本專案大寫 enum。無法識別時回退預設值。 */
function upperEnum<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  const s = String(v ?? '').toUpperCase();
  return (allowed as readonly string[]).includes(s) ? (s as T) : fallback;
}

const PRICE_TYPES = ['PER_PERSON', 'PER_GROUP'] as const;
const BOOKING_TYPES = ['INSTANT', 'REQUEST', 'SCHEDULED'] as const;
const DEPOSIT_MODES = ['NONE', 'DEPOSIT_FIXED', 'DEPOSIT_PERCENT', 'FULL'] as const;

/**
 * 後台方案表單有、但 tour-platform JSON **沒有**的欄位。
 *
 * 為什麼要單獨一支：`planRowFromImport()` 的欄位清單是照 tour-platform 的匯出
 * 格式列的，裡面不含定金設定、啟用開關與販售季節。方案編輯畫面
 * （`/tenant/trips/[id]` 的方案 Modal）**有**這些欄位，若 route 只走
 * `planRowFromImport()`，按下儲存會回 200、畫面顯示「方案已儲存」，
 * 而定金模式與季節其實一個字都沒進資料庫——那正是本專案在清的假成功。
 *
 * 只有「這次真的送了這個鍵」才寫入（`!== undefined`），所以 JSON 匯入
 * 那條路徑不受影響（它不會送這些鍵，欄位維持 DB 預設值）。
 */
export function planAdminFields(p: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (p.depositMode !== undefined) out.deposit_mode = upperEnum(p.depositMode, DEPOSIT_MODES, 'FULL');
  if (p.depositValue !== undefined) out.deposit_value = Number(p.depositValue) || 0;
  if (p.active !== undefined) out.active = !!p.active;
  if (p.yearRound !== undefined) out.year_round = !!p.yearRound;
  if (p.seasons !== undefined) out.seasons = Array.isArray(p.seasons) ? p.seasons : [];
  return out;
}

/** 由名稱產生 slug；tour-platform 未填 slug 時的行為與該站一致。 */
export function slugify(name: string, fallback: string): string {
  const s = name.toLowerCase().trim()
    .replace(/[^a-z0-9一-鿿]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || fallback;
}

/* ------------------------------------------------------------------ 匯入 */

/**
 * tour-platform 匯出的行程 JSON → trips 表的欄位物件。
 * `_instructions` 是該站放在檔案裡的欄位說明，明確標示「不會寫入資料庫」，
 * 這裡照樣忽略。
 */
export function tripRowFromImport(json: any, tenantId: string) {
  const title = String(json.title ?? '').trim();
  return {
    tenant_id: tenantId,
    slug: slugify(String(json.slug ?? title), `trip-${Date.now()}`),
    title,
    tagline: String(json.tagline ?? ''),
    // tour-platform 的 shortDescription 對應本專案的 summary
    summary: String(json.shortDescription ?? json.summary ?? ''),
    description: String(json.description ?? ''),
    region: String(json.region ?? ''),
    category: String(json.category ?? ''),
    cover_image_url: String(json.coverImageUrl ?? ''),
    gallery: Array.isArray(json.imageUrls) ? json.imageUrls : toStringArray(json.gallery),
    duration_minutes: json.durationMinutes != null ? Number(json.durationMinutes) : null,
    meeting_point: String(json.meetingPoint ?? ''),
    meeting_point_map_url: String(json.meetingPointMapUrl ?? ''),
    inclusions: toStringArray(json.inclusions),
    exclusions: toStringArray(json.exclusions),
    notices: toStringArray(json.notices),
    refund_rules: toStringArray(json.refundRules),
    safety_notice: String(json.safetyNotice ?? ''),
    good_for: toStringArray(json.goodFor),
    faq: Array.isArray(json.faq)
      ? json.faq.filter((f: any) => f?.q || f?.a)
        .map((f: any) => ({ q: String(f.q ?? ''), a: String(f.a ?? '') }))
      : [],
    social_proof_quotes: Array.isArray(json.socialProofQuotes)
      ? json.socialProofQuotes.map((q: any) => ({
        author: String(q.author ?? ''),
        rating: Number(q.rating ?? 5),
        text: String(q.text ?? ''),
        photos: toStringArray(q.photos),
      })).filter((q: any) => q.text)
      : [],
  };
}

/** tour-platform activityPlans[] 的一筆 → trip_plans 表的欄位物件。 */
export function planRowFromImport(
  p: any, tenantId: string, tripId: string, index: number,
) {
  const name = String(p.name ?? '').trim() || `方案 ${index + 1}`;
  return {
    tenant_id: tenantId,
    trip_id: tripId,
    slug: String(p.slug ?? '') || slugify(name, `plan-${index + 1}`),
    name,
    description: String(p.description ?? ''),
    duration_minutes: p.durationMinutes != null ? Number(p.durationMinutes) : 60,
    price_type: upperEnum(p.priceType, PRICE_TYPES, 'PER_PERSON'),
    base_price: Number(p.basePrice ?? 0),
    child_price: p.childPrice != null ? Number(p.childPrice) : null,
    min_participants: p.minParticipants != null ? Number(p.minParticipants) : 1,
    max_participants: p.maxParticipants != null ? Number(p.maxParticipants) : 10,
    booking_type: upperEnum(p.bookingType, BOOKING_TYPES, 'SCHEDULED'),
    highlights: toStringArray(p.highlights),
    plan_inclusions: toStringArray(p.planInclusions),
    plan_exclusions: toStringArray(p.planExclusions),
    plan_notices: toStringArray(p.planNotices),
    plan_refund_rules: toStringArray(p.planRefundRules),
    // 每站的 imageUrl 保留（使用者要的「每個時間點的照片」）
    plan_itinerary: Array.isArray(p.planItinerary)
      ? p.planItinerary.map((s: any) => ({
        icon: String(s.icon ?? '📍'),
        title: String(s.title ?? ''),
        duration: String(s.duration ?? ''),
        description: String(s.description ?? ''),
        imageUrl: String(s.imageUrl ?? ''),
      }))
      : [],
    meeting_point_name: String(p.meetingPointName ?? ''),
    meeting_address: String(p.meetingAddress ?? ''),
    experience_point_name: String(p.experiencePointName ?? ''),
    experience_address: String(p.experienceAddress ?? ''),
    language: String(p.language ?? ''),
    // 空字串會讓 date 欄位型別轉換失敗，必須轉成 null
    earliest_departure: p.earliestDeparture ? String(p.earliestDeparture) : null,
    confirm_by_days: p.confirmByDays != null ? Number(p.confirmByDays) : null,
    free_cancel_days: p.freeCancelDays != null ? Number(p.freeCancelDays) : null,
    details_link_text: String(p.detailsLinkText ?? ''),
    booking_btn_text: String(p.bookingBtnText ?? ''),
    sort_order: index,
  };
}

/* ------------------------------------------------------------------ 匯出 */

/**
 * Trip + TripPlan[] → tour-platform 格式的 JSON。
 * 刻意產出與該站 `buildActivityExportTemplate()` 相同的鍵名與小寫 enum，
 * 讓匯出的檔案能反過來被 tour-platform 匯入（雙向互通）。
 */
export function toTourPlatformJson(trip: Trip, plans: TripPlan[]) {
  const lower = (s: string) => s.toLowerCase();
  return {
    _instructions: {
      version: 'VibeAI 後台匯出（欄位與 tour-platform 行程 JSON 對齊，可雙向匯入）',
      note: '_instructions 只做說明，匯入時會被忽略。',
    },
    slug: trip.slug,
    title: trip.title,
    region: trip.region,
    category: trip.category,
    durationMinutes: trip.durationMinutes,
    meetingPoint: trip.meetingPoint,
    meetingPointMapUrl: trip.meetingPointMapUrl,
    coverImageUrl: trip.coverImageUrl,
    imageUrls: trip.galleryUrls,
    tagline: trip.tagline,
    shortDescription: trip.summary,
    description: trip.description,
    inclusions: trip.inclusions,
    exclusions: trip.exclusions,
    notices: trip.notices,
    refundRules: trip.refundRules ?? [],
    safetyNotice: trip.safetyNotice,
    goodFor: trip.goodFor ?? [],
    socialProofQuotes: trip.socialProofQuotes ?? [],
    faq: trip.faq ?? [],
    activityPlans: plans.map((p) => ({
      name: p.name,
      slug: p.slug,
      description: p.description,
      priceType: lower(p.priceType),
      basePrice: p.basePrice,
      childPrice: p.childPrice,
      durationMinutes: p.durationMinutes,
      bookingType: lower(p.bookingType),
      minParticipants: p.minParticipants,
      maxParticipants: p.maxParticipants,
      highlights: p.highlights ?? [],
      planInclusions: p.planInclusions ?? [],
      planExclusions: p.planExclusions ?? [],
      planItinerary: p.planItinerary ?? [],
      planNotices: p.planNotices ?? [],
      planRefundRules: p.planRefundRules ?? [],
      meetingPointName: p.meetingPointName ?? '',
      meetingAddress: p.meetingAddress ?? '',
      experiencePointName: p.experiencePointName ?? '',
      experienceAddress: p.experienceAddress ?? '',
      language: p.language ?? '',
      earliestDeparture: p.earliestDeparture ?? '',
      confirmByDays: p.confirmByDays,
      freeCancelDays: p.freeCancelDays,
      detailsLinkText: p.detailsLinkText ?? '',
      bookingBtnText: p.bookingBtnText ?? '',
    })),
  };
}
