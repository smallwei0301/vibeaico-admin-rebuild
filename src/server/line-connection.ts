// LINE 是否「已設定完成」的唯一判斷（#1007）。
// webhook 驗簽需要 Channel Secret，推播需要 Access Token，缺任何一個都不算已連線。
// 純函式、不打 LINE 外部 API；入參是 DB 內的加密欄位值（空字串＝未設定）。

export interface LineCredentialColumns {
  line_channel_access_token_enc?: unknown;
  line_channel_secret_enc?: unknown;
}

const nonEmpty = (v: unknown): boolean => typeof v === 'string' && v.length > 0;

export function hasLineCredentials(row: LineCredentialColumns | null | undefined): boolean {
  return nonEmpty(row?.line_channel_access_token_enc) && nonEmpty(row?.line_channel_secret_enc);
}

export function linePlatformStatusFromRow(
  row: LineCredentialColumns | null | undefined,
): 'CONNECTED' | 'NOT_CONFIGURED' {
  return hasLineCredentials(row) ? 'CONNECTED' : 'NOT_CONFIGURED';
}
