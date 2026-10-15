/**
 * src/server/verify-code-throttle.ts — 驗證碼驗證失敗節流（#1030）
 * 獨立成檔，避免既有測試對 '@/server/verify-code' 的部分 mock 缺少新匯出。
 */

import { ApiHttpError, ERR } from './http';
import { checkRateLimit, peekRateLimit, clientIpFromHeaders } from './rate-limit';

type CodePurpose = 'REGISTER' | 'RESET_PASSWORD';

/**
 * 驗證碼「驗證失敗」節流（#1030）。
 *
 * 誠實的限制：沿用 rate-limit.ts 的單 process 記憶體固定視窗，serverless 多 instance 各自計數、
 * 重新部署即歸零，屬盡力而為（best-effort），**不是**完整防護。持久化的嘗試計數（例如
 * auth_verification_codes.attempts 欄位）需要 schema 變更，另案處理。
 * 搭配 send-code 的「寄新碼即作廢舊碼」，可大幅降低可同時猜測的有效碼數量，但不宣稱已完全封堵暴力猜碼。
 *
 * 不洩漏帳號是否存在：計數鍵只由請求帶來的 email／IP 決定，不查帳號；驗證碼無效（不論 email 是否存在）
 * 一律同樣計一次，超額一律同樣回 429。
 */
export const CODE_FAILURE_EMAIL_LIMIT = { max: 5, windowMs: 10 * 60_000 };
export const CODE_FAILURE_IP_LIMIT = { max: 30, windowMs: 10 * 60_000 };
export const CODE_RATE_LIMITED_MESSAGE = '驗證碼嘗試次數過多，請稍後再試或重新申請驗證碼';

function failureKeys(headers: Headers, email: string, purpose: CodePurpose) {
  return {
    emailKey: `verify-code-fail:email:${purpose}:${email.trim().toLowerCase()}`,
    ipKey: `verify-code-fail:ip:${clientIpFromHeaders(headers)}`,
  };
}

/** 驗證碼驗證「之前」呼叫：email 或 IP 的失敗額度已滿 → 429（只 peek，不建立 bucket）。 */
export function assertCodeAttemptsAllowed(headers: Headers, email: string, purpose: CodePurpose): void {
  const { emailKey, ipKey } = failureKeys(headers, email, purpose);
  const emailOk = peekRateLimit(emailKey, CODE_FAILURE_EMAIL_LIMIT);
  const ipOk = peekRateLimit(ipKey, CODE_FAILURE_IP_LIMIT);
  if (!emailOk || !ipOk) throw new ApiHttpError(429, CODE_RATE_LIMITED_MESSAGE, ERR.RATE_LIMITED);
}

/** 只在驗證碼無效（CODE_INVALID）時記一次失敗；其他錯誤（系統失敗等）不計。 */
export function recordCodeFailureIfInvalid(headers: Headers, email: string, purpose: CodePurpose, err: unknown): void {
  if (!(err instanceof ApiHttpError) || err.code !== ERR.CODE_INVALID) return;
  const { emailKey, ipKey } = failureKeys(headers, email, purpose);
  checkRateLimit(emailKey, CODE_FAILURE_EMAIL_LIMIT);
  checkRateLimit(ipKey, CODE_FAILURE_IP_LIMIT);
}
