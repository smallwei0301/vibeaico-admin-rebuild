/**
 * 認證頁共用的輸入檢查純函式（#906）。
 * 與後端 schema 對齊：login 用 z.string().email()；reset-password 的
 * code 為 6 位、newPassword 至少 8 字元。
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESET_CODE_RE = /^\d{6}$/;

/** 重設密碼新密碼最小長度（與 /api/auth/reset-password 的 z.string().min(8) 一致） */
export const PASSWORD_MIN_LENGTH = 8;

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

/** 重設驗證碼必須是 6 位數字 */
export function isValidResetCode(value: string | null | undefined): boolean {
  return RESET_CODE_RE.test(value ?? '');
}

/** 重設連結是否完整：email 格式正確且 token 為 6 位數字 */
export function isResetLinkUsable(email: string | null, token: string | null): boolean {
  return isValidEmail(email ?? '') && isValidResetCode(token);
}
