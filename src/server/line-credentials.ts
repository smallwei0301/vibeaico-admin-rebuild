import { decryptSecret } from './crypto';
import { ApiHttpError, ERR } from './http';

export type LineSettingsRow = {
  line?: unknown;
  line_channel_secret_enc?: string | null;
  line_channel_access_token_enc?: string | null;
} | null | undefined;

/** Lightweight credential seam shared by LINE calls and the webhook route. */
export function decryptLineCredentials(row: LineSettingsRow) {
  const token = decryptSecret(row?.line_channel_access_token_enc ?? '');
  const secret = decryptSecret(row?.line_channel_secret_enc ?? '');
  if (!token) throw new ApiHttpError(400, '尚未設定 LINE Channel', ERR.LINE_NOT_CONFIGURED);
  return { token, secret, lineConfig: (row?.line ?? {}) as Record<string, any> };
}
