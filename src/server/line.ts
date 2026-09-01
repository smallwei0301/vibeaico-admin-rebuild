/**
 * src/server/line.ts — LINE Messaging API 客戶端（Phase 6，06 分冊 §2 逐字為基底）
 *
 * 不裝 SDK，直接 fetch（端點少、避免依賴膨脹）。
 *
 * 與 §2 原文的差異（僅限規格允許/要求的調整）：
 *  1. `API` / `DATA_API` 改為可用環境變數 `LINE_API_BASE` / `LINE_DATA_API_BASE`
 *     覆寫（12 分冊 Phase 6：整合測試以本地 mock server 取代真 LINE API）。
 *     以函式延遲讀取，確保測試在 import 後才設 env 也生效。
 *  2. `consumePushQuota` 的 quota 依 09 分冊 §5：
 *     `isFeatureActive(tenantId,'EXTRA_PUSH') ? 700 : 200`（06 分冊留的 TODO）。
 *  3. 月份鍵改用 `taipeiCurrentMonthKey()`（§2 原文為 UTC `toISOString().slice(0,7)`）：
 *     tz.ts 明文註記該函式「對應 push_quota_usage.month」，且 A-5 儀表板
 *     （reports/dashboard、dashboard-alerts）已用它讀同一張表——寫讀兩端必須
 *     同一把月份鍵，否則每月頭 8 小時（台北）帳目會分岔。
 */
import { createAdminSupabase } from './supabase';
import { decryptSecret } from './crypto';
import { ApiHttpError, ERR } from './http';
import { isFeatureActive } from './features';
import { taipeiCurrentMonthKey } from './tz';

/** api.line.me 基底；測試以 LINE_API_BASE 指向本地 mock（12 分冊 Phase 6） */
export const lineApiBase = () => process.env.LINE_API_BASE ?? 'https://api.line.me';
/** api-data.line.me 基底（Rich Menu 圖片上傳走這裡），同理可覆寫 */
export const lineDataApiBase = () =>
  process.env.LINE_DATA_API_BASE ?? 'https://api-data.line.me';

/** 讀出該店解密後的 LINE 憑證；未設定 → 丟 LINE_001 */
export async function getLineCredentials(tenantId: string) {
  const admin = createAdminSupabase();
  const { data, error } = await admin.from('tenant_settings')
    .select('line, line_channel_secret_enc, line_channel_access_token_enc')
    .eq('tenant_id', tenantId).single();
  if (error) throw error;
  if (!data) throw new Error('LINE_SETTINGS_UNAVAILABLE');
  const token = decryptSecret(data?.line_channel_access_token_enc ?? '');
  const secret = decryptSecret(data?.line_channel_secret_enc ?? '');
  if (!token) throw new ApiHttpError(400, '尚未設定 LINE Channel', ERR.LINE_NOT_CONFIGURED);
  return { token, secret, lineConfig: (data.line ?? {}) as Record<string, any> };
}

async function lineFetch(token: string, path: string, init?: RequestInit) {
  const res = await fetch(`${lineApiBase()}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`,
               'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    console.error('[line]', path, res.status, body);
    throw new ApiHttpError(502, `LINE API 錯誤（${res.status}）`, ERR.LINE_API_ERROR);
  }
  return res.status === 200 ? res.json().catch(() => ({})) : {};
}

export const lineReply = (token: string, replyToken: string, messages: any[]) =>
  lineFetch(token, '/v2/bot/message/reply', {
    method: 'POST', body: JSON.stringify({ replyToken, messages }) });

export const linePush = (token: string, to: string, messages: any[]) =>
  lineFetch(token, '/v2/bot/message/push', {
    method: 'POST', body: JSON.stringify({ to, messages }) });

export const lineMulticast = (token: string, to: string[], messages: any[]) =>
  lineFetch(token, '/v2/bot/message/multicast', {
    method: 'POST', body: JSON.stringify({ to, messages }) });

export const lineBotInfo = (token: string) => lineFetch(token, '/v2/bot/info');
export const lineProfile = (token: string, userId: string) =>
  lineFetch(token, `/v2/bot/profile/${userId}`);

/**
 * 額度控管（免費 200 則/月；EXTRA_PUSH 訂閱 → 700，09 分冊 §5）。
 * push/multicast 前先過；**reply 不佔額度**（LINE 規則），webhook 內能用 reply 就用 reply。
 */
export type BookingAddonQuotaReservation =
  | { state: 'RESERVED'; month: string; count: number }
  | { state: 'EXHAUSTED' }
  | { state: 'UNKNOWN'; error: unknown };

/**
 * Booking add-on delivery needs to tell quota exhaustion from an unavailable
 * feature/quota read.  The older boolean helper remains for fire-and-forget
 * callers whose contract is simply "do not send when false".
 */
export async function reservePushQuotaForBookingAddon(
  tenantId: string, count: number,
): Promise<BookingAddonQuotaReservation> {
  if (!Number.isInteger(count) || count < 1) return { state: 'EXHAUSTED' };
  const month = taipeiCurrentMonthKey();
  try {
    const quota = (await isFeatureActive(tenantId, 'EXTRA_PUSH')) ? 700 : 200;  // 09 分冊 §5
    const { data, error } = await createAdminSupabase().rpc('consume_push_quota_17', {
      p_tenant_id: tenantId,
      p_month: month,
      p_count: count,
      p_quota: quota,
    });
    if (error) {
      console.error('[line] quota reservation failed', tenantId, error);
      return { state: 'UNKNOWN', error };
    }
    if (data !== true) return { state: 'EXHAUSTED' };
    return { state: 'RESERVED', month, count };
  } catch (error) {
    // Quota state is unknown: do not send a billable LINE push optimistically.
    console.error('[line] quota reservation failed', tenantId, error);
    return { state: 'UNKNOWN', error };
  }
}

export async function consumePushQuota(tenantId: string, count: number): Promise<boolean> {
  const reservation = await reservePushQuotaForBookingAddon(tenantId, count);
  return reservation.state === 'RESERVED';
}

/**
 * Refund only a reservation whose provider outcome is confirmed as no-send.
 * `false` is deliberately ambiguous to the caller: a missing row and an RPC
 * failure both require the notification to remain PENDING.
 */
export async function refundPushQuotaForBookingAddon(
  tenantId: string, month: string, count: number,
): Promise<boolean> {
  try {
    const { data, error } = await createAdminSupabase().rpc('refund_push_quota_17', {
      p_tenant_id: tenantId,
      p_month: month,
      p_count: count,
    });
    if (error) {
      console.error('[line] quota refund failed', tenantId, error);
      return false;
    }
    if (data !== true) {
      console.error('[line] quota refund did not confirm a row update', tenantId);
      return false;
    }
    return true;
  } catch (error) {
    console.error('[line] quota refund failed', tenantId, error);
    return false;
  }
}

/* ------------------------------------------------------------------ 附加匯出
 * 以下為 §2 原文之外「只加不改」的輔助（06 §6/§7 端點需要）。 */

/**
 * 不丟錯版的 GET：verify/test 端點要把每一項檢查的失敗轉成 message 呈現
 * （HTTP 一律 200），不能走 lineFetch 的 502 拋錯路徑。
 */
export async function lineGetRaw(token: string, path: string) {
  const res = await fetch(`${lineApiBase()}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => ({}) as any);
  return { ok: res.ok, status: res.status, body: body as Record<string, any> };
}

/** POST /v2/bot/richmenu → 回 richMenuId（06 §6 ②） */
export async function lineCreateRichMenu(token: string, richMenu: unknown): Promise<string> {
  const body = await lineFetch(token, '/v2/bot/richmenu', {
    method: 'POST', body: JSON.stringify(richMenu) });
  return String(body?.richMenuId ?? '');
}

/** 上傳 Rich Menu 圖片（api-data.line.me，06 §6 ③）；jpeg/png */
export async function lineUploadRichMenuImage(
  token: string, richMenuId: string, image: ArrayBuffer, contentType: string,
) {
  const res = await fetch(`${lineDataApiBase()}/v2/bot/richmenu/${richMenuId}/content`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
    body: image,
  });
  if (!res.ok) {
    const body = await res.text();
    console.error('[line]', `/v2/bot/richmenu/${richMenuId}/content`, res.status, body);
    throw new ApiHttpError(502, `LINE API 錯誤（${res.status}）`, ERR.LINE_API_ERROR);
  }
}

/** POST /v2/bot/user/all/richmenu/{id} — 設為所有使用者預設選單（06 §6 ④） */
export const lineSetDefaultRichMenu = (token: string, richMenuId: string) =>
  lineFetch(token, `/v2/bot/user/all/richmenu/${richMenuId}`, { method: 'POST' });

/** DELETE /v2/bot/richmenu/{id} — 換新選單時清掉舊的（呼叫端自行決定是否吞錯） */
export const lineDeleteRichMenu = (token: string, richMenuId: string) =>
  lineFetch(token, `/v2/bot/richmenu/${richMenuId}`, { method: 'DELETE' });
