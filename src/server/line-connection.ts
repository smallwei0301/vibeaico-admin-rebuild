// LINE 是否「已設定完成」的唯一判斷（#1007）。
// 與 /tenant/line-settings 的 configured、verify endpoint 一致：
// Channel ID（line jsonb）、Channel Secret（webhook 驗簽）、Access Token（推播）三者皆需設定。
// 純函式、不打 LINE 外部 API；入參是 DB 內的加密欄位值（空字串＝未設定）與 line jsonb。

export interface LineCredentialColumns {
  line_channel_access_token_enc?: unknown;
  line_channel_secret_enc?: unknown;
  line?: unknown;
}

const nonEmpty = (v: unknown): boolean => typeof v === 'string' && v.length > 0;

function hasChannelId(line: unknown): boolean {
  if (!line || typeof line !== 'object') return false;
  const id = (line as Record<string, unknown>).channelId;
  return typeof id === 'string' && id.trim().length > 0;
}

export function hasLineCredentials(row: LineCredentialColumns | null | undefined): boolean {
  return (
    nonEmpty(row?.line_channel_access_token_enc) &&
    nonEmpty(row?.line_channel_secret_enc) &&
    hasChannelId(row?.line)
  );
}

export function linePlatformStatusFromRow(
  row: LineCredentialColumns | null | undefined,
): 'CONNECTED' | 'NOT_CONFIGURED' {
  return hasLineCredentials(row) ? 'CONNECTED' : 'NOT_CONFIGURED';
}
