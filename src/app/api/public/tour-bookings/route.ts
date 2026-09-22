import { handle, ok, fail, ERR } from '@/server/http';
import { isFeatureActive } from '@/server/features';
import { checkRateLimit, clientIpFromHeaders } from '@/server/rate-limit';
import {
  PublicTourBookingError, loadPublicBookingPlan, submitPublicTourBooking,
  submitPublicTourBookingSchema,
} from '@/server/public-tour-booking';

/**
 * POST /api/public/tour-bookings — 旅客自助預約 FIXED_DEPARTURE 方案（issue #46）。
 *
 * 與 `/api/public/tour-requests` 同一套匿名寫入防線（見該檔檔頭）：這裡只負責
 * 解析輸入、轉譯業務錯誤成 HTTP 語意、確認 TOUR_MODULE 功能仍然有效，全部業務
 * 驗證在 `src/server/public-tour-booking.ts` 自己查。同樣沿用 F1 節流。
 *
 * 與 REQUEST 端點的關鍵差異：這裡建單當下就真的鎖位（見
 * `public-tour-booking.ts` 檔頭），所以成功回應直接視為「已預約」，不是
 * 「已送出申請」。
 */
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

export const POST = handle(async (req) => {
  const body = submitPublicTourBookingSchema.parse(await req.json());

  const ip = clientIpFromHeaders(req.headers);
  const rateLimitKey = `${ip}:${body.shopCode}`;
  if (!checkRateLimit(rateLimitKey, { max: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW_MS })) {
    return fail(429, '請求過於頻繁，請稍後再試', ERR.RATE_LIMITED);
  }

  const plan = await loadPublicBookingPlan(body.shopCode, body.planId);
  if (!plan) return fail(404, '找不到此方案，或此方案目前未開放線上預約', ERR.NOT_FOUND);

  // 店家若已停用旅遊模組（欠費／被平台關閉），公開頁不該還能替它收預約。
  if (!(await isFeatureActive(plan.tenantId, 'TOUR_MODULE'))) {
    return fail(403, '此店家目前未開放線上預約，請改用 LINE 或電話聯絡', ERR.FEATURE_LOCKED);
  }

  try {
    const { orderId, orderNo } = await submitPublicTourBooking(body);
    return ok({ orderId, orderNo }, { status: 201 });
  } catch (e) {
    if (e instanceof PublicTourBookingError) {
      const status = e.code === 'SEATS_UNAVAILABLE' ? 409
        : e.code === 'PARTY_SIZE_OUT_OF_RANGE' ? 400
          : e.code === 'DEPARTURE_NOT_AVAILABLE' ? 409
            : 404;
      const code = e.code === 'SEATS_UNAVAILABLE' ? ERR.SEATS_UNAVAILABLE
        : e.code === 'PARTY_SIZE_OUT_OF_RANGE' ? ERR.VALIDATION
          : e.code === 'DEPARTURE_NOT_AVAILABLE' ? ERR.CONFLICT
            : ERR.NOT_FOUND;
      return fail(status, e.message, code);
    }
    throw e;
  }
});
