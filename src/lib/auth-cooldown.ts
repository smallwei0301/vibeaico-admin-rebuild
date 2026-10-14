import { ApiError } from '@/lib/api';

/** 重新發送／重新送出冷卻秒數（與後端 send-code 60 秒節流一致） */
export const RESEND_COOLDOWN_SECONDS = 60;

/** 與 src/server/http.ts 的 ERR.RATE_LIMITED 同值（前端不 import server 模組） */
const RATE_LIMITED_CODE = 'REQ_004';

/**
 * 失敗是否屬限流：send-verification-code 命中 60 秒重寄節流時回 HTTP 429
 * （code 為 CONFLICT）；匿名端點節流回 429 + REQ_004。以 status 為主、code 為輔。
 */
export function isRateLimitError(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 429 || e.code === RATE_LIMITED_CODE);
}
