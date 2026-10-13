/**
 * LINE 連線檢查（verify／test route 共用）的中文訊息分類。
 * 只依 HTTP 狀態碼與 LINE 回報的固定 reason 代碼選用文案，不回傳 LINE 原文。
 */

export function tokenFailMessage(status: number): string {
  if (status === 401) return 'Access Token 無效或已失效，請到 LINE Developers 重新發行後貼上';
  if (status === 403) {
    return 'LINE 拒絕存取（403），請確認此 Channel 與官方帳號狀態正常、Messaging API 已啟用，必要時聯絡 LINE 客服';
  }
  return `Token 驗證失敗（HTTP ${status}），請稍後再試`;
}

export function idSecretPairFailMessage(status: number): string {
  if (status === 400 || status === 401) {
    return 'Channel ID 與 Secret 配對失敗，請確認兩者來自同一個 Channel';
  }
  if (status === 429) return 'LINE 暫時限制請求次數，請稍後再按完整檢查';
  if (status >= 500) return 'LINE 伺服器暫時異常，請稍後再試';
  return `配對檢查失敗（HTTP ${status}），請確認 Channel ID 與 Secret`;
}

export const WEBHOOK_SECRET_HINT =
  'Webhook 網址已設定，但 LINE 測試請求未通過驗證；最常見原因是 Channel Secret 不正確，請確認 Secret 與 Channel ID 來自同一個 Channel，重新貼上並儲存後，再按「完整檢查」';

/** LINE webhook/test 回應 200 但 success≠true 時，依 reason／statusCode 翻譯。 */
export function webhookTestFailMessage(body: unknown): string {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const reason = typeof b.reason === 'string' ? b.reason : '';
  const code = typeof b.statusCode === 'number' ? b.statusCode : Number(b.statusCode);
  if (reason === 'COULD_NOT_CONNECT') return 'LINE 連不到 Webhook 網址，請確認網站可正常連線';
  if (reason === 'REQUEST_TIMEOUT') return 'Webhook 回應逾時，請稍後再試';
  if (reason === 'ERROR_STATUS_CODE') {
    return code === 401
      ? WEBHOOK_SECRET_HINT
      : `Webhook 回應錯誤（HTTP ${Number.isFinite(code) ? code : '未知'}），請稍後再試或聯絡客服`;
  }
  return 'Webhook 測試未通過，請稍後再按「完整檢查」';
}
