import { handle, ok, fail, ERR } from '@/server/http';
import { isFeatureActive } from '@/server/features';
import { checkRateLimit, clientIpFromHeaders } from '@/server/rate-limit';
import {
  PublicTourRequestError, loadPublicRequestPlan, submitPublicTourRequest,
  submitPublicTourRequestSchema,
} from '@/server/public-tour-request';

/**
 * POST /api/public/tour-requests — 旅客自助送出 REQUEST 申請（issue #46）。
 *
 * ⚠️ 全站第一支不需要登入就能**寫入**資料的 route（其餘一律 `requireTenantManager()`）。
 * 所有驗證（方案是不是 REQUEST 模式、行程是否已發布、團次是否真的屬於這個方案且還有
 * 名額）都在 `src/server/public-tour-request.ts` 裡自己查，這裡只負責：解析輸入、
 * 轉譯業務錯誤成 HTTP 語意、確認 TOUR_MODULE 功能仍然有效。
 *
 * 建單本身呼叫既有 `create_tour_order` rpc（同 GUIDE 側 `/api/tour-orders/manual`），
 * 不是另外一套建單邏輯——見該檔檔頭「為什麼重用」一節。
 *
 * Final Risk F1（節流）：這支端點是全站第一個匿名可寫入端點，在它之前完全沒有
 * 節流層。這裡對「用戶端 IP + shopCode」加固定視窗限流——見
 * `src/server/rate-limit.ts` 檔頭對這個限流實作的誠實限制說明（單 process
 * 記憶體內，不是跨 instance 精確節流，但把攻擊成本從「零延遲打上萬次」拉高
 * 到需要分散來源，足以讓 F1 的 order_no 耗盡攻擊不再是零成本）。
 */
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

export const POST = handle(async (req) => {
  const body = submitPublicTourRequestSchema.parse(await req.json());

  const ip = clientIpFromHeaders(req.headers);
  const rateLimitKey = `${ip}:${body.shopCode}`;
  if (!checkRateLimit(rateLimitKey, { max: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW_MS })) {
    return fail(429, '請求過於頻繁，請稍後再試', ERR.RATE_LIMITED);
  }

  const plan = await loadPublicRequestPlan(body.shopCode, body.planId);
  if (!plan) return fail(404, '找不到此方案，或此方案目前未開放線上申請', ERR.NOT_FOUND);

  // 店家若已停用旅遊模組（欠費／被平台關閉），公開頁不該還能替它收申請。
  if (!(await isFeatureActive(plan.tenantId, 'TOUR_MODULE'))) {
    return fail(403, '此店家目前未開放線上申請，請改用 LINE 或電話聯絡', ERR.FEATURE_LOCKED);
  }

  try {
    const { orderId, orderNo } = await submitPublicTourRequest(body);
    return ok({ orderId, orderNo }, { status: 201 });
  } catch (e) {
    if (e instanceof PublicTourRequestError) {
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
