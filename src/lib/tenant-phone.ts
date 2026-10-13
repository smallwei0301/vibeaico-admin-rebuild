/** 註冊電話位數（原站規則：10 碼數字）。前端驗證與送出 payload 共用同一個來源。 */
export const TENANT_PHONE_LENGTH = 10;

/** 去除所有非數字字元；驗證與送出都用這個結果，避免兩邊漂移。 */
export function normalizeTenantPhone(raw: string): string {
  return raw.replace(/\D/g, '');
}
