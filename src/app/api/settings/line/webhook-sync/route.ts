import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { decryptSecret } from '@/server/crypto';
import { buildWebhookUrl } from '@/config/tenant-settings';
import { APP_URL } from '@/config/env';
import { linePutRaw } from '@/server/line';

/**
 * POST /api/settings/line/webhook-sync — Issue #477 P1a：把「Webhook 沒開啟」
 * 從一句提示文案變成一顆真的能修好的按鈕。
 *
 * 只做兩件事，且都是**這個租戶自己的**憑證（Owner 裁示：不得 fallback 共用
 * Token，06 分冊 §7 / #47）：
 *   1. `PUT /v2/bot/channel/webhook/endpoint`：把 LINE 後台登記的 endpoint
 *      改成 `buildWebhookUrl(APP_URL, shopCode)`。
 *   2. `PUT /v2/bot/channel/webhook/setActive`：把「Use webhook」開關打開。
 *
 * 誠實原則（#477 canonical rules）：LINE 平台回錯就誠實回報失敗訊息，
 * **不清除、不動任何既有設定**——呼叫端本來就不寫 DB，這裡沒有「復原」的
 * 必要，純粹是不假裝成功。呼叫端（前端）收到 `synced:false` 後應顯示
 * `message` 並保留「依畫面複製設定」的人工 fallback 入口，不得顯示成功。
 */
export const POST = handle(async () => {
  const t = await requireTenant('OWNER');

  const { data: row, error } = await t.supabase
    .from('tenant_settings')
    .select('line_channel_access_token_enc')
    .eq('tenant_id', t.tenantId)
    .maybeSingle();
  if (error) throw error;

  const token = decryptSecret(row?.line_channel_access_token_enc ?? '');
  if (!token) {
    return ok({ synced: false, message: '尚未設定 LINE Channel Access Token，無法同步 Webhook 網址' });
  }

  const endpoint = buildWebhookUrl(APP_URL, t.shopCode);

  const endpointRes = await linePutRaw(token, '/v2/bot/channel/webhook/endpoint', { endpoint });
  if (!endpointRes.ok) {
    return ok({
      synced: false,
      message: `LINE 拒絕更新 Webhook 網址（HTTP ${endpointRes.status}），請依畫面手動複製網址到 LINE 後台設定`,
    });
  }

  const activeRes = await linePutRaw(token, '/v2/bot/channel/webhook/setActive', { active: true });
  if (!activeRes.ok) {
    return ok({
      synced: false,
      message: `Webhook 網址已更新，但「Use webhook」開關開啟失敗（HTTP ${activeRes.status}），請至 LINE 後台手動開啟`,
    });
  }

  return ok({ synced: true, message: 'Webhook 網址已更新並開啟', endpoint });
});
