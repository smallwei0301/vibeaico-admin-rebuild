import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { encryptSecret } from '@/server/crypto';
import { buildWebhookUrl, lineSettingsSchema } from '@/config/tenant-settings';
import { decryptSecret } from '@/server/crypto';
import { lineSetWebhookEndpoint } from '@/server/line';
import { APP_URL } from '@/config/env';

/**
 * PUT /api/settings/line — body = Partial<LineSettings>。
 *
 * 鐵則 6（逐字實作）：
 *   channelSecret / channelAccessToken 為空字串 → 完全不動 DB 舊值（連欄位都
 *   不列進 update payload，交給 supabase upsert 的 ON CONFLICT DO UPDATE 只碰
 *   有列出的欄位這個特性去保證）；非空 → encryptSecret() 後寫 *_enc 欄位。
 *   這兩個 secret 永遠不進 line jsonb（無論輸入是否帶了它們，寫入前都剔除）。
 */
const bodySchema = lineSettingsSchema.omit({ webhookUrl: true }).partial();

export const PUT = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  const b = bodySchema.parse(await req.json());

  const { data: row, error: rerr } = await t.supabase
    .from('tenant_settings')
    .select('line')
    .eq('tenant_id', t.tenantId)
    .maybeSingle();
  if (rerr) throw rerr;
  const currentLine = { ...(row?.line ?? {}) } as Record<string, unknown>;

  const { channelSecret, channelAccessToken, ...rest } = b;
  // 只合併「這次請求真的帶了」的欄位，其餘保留舊值。
  const nextLine: Record<string, unknown> = { ...currentLine };
  for (const [k, v] of Object.entries(rest)) {
    if (v !== undefined) nextLine[k] = v;
  }
  // jsonb 內永不存這兩個 secret（就算舊資料裡誤存過，這裡一併清掉）。
  delete nextLine.channelSecret;
  delete nextLine.channelAccessToken;

  const update: Record<string, unknown> = { tenant_id: t.tenantId, line: nextLine };
  if (channelSecret) update.line_channel_secret_enc = encryptSecret(channelSecret);
  if (channelAccessToken) update.line_channel_access_token_enc = encryptSecret(channelAccessToken);

  const { error } = await t.supabase
    .from('tenant_settings')
    .upsert(update, { onConflict: 'tenant_id' });
  if (error) throw error;

  /*
   * 儲存後把 webhook 網址直接寫進 LINE。
   *
   * 少了這一步，後台那格 Webhook URL 只是「給店家自己複製去貼」的字串，LINE
   * 伺服器完全不知道；店家按了儲存卻發現「完整檢查」仍說網址不符（那項檢查讀的
   * 是 LINE 上的實際設定），也就是使用者回報的「按下儲存設定後沒有自動變更」。
   *
   * 用「這次送上來的新 token」優先，否則用 DB 既有的——只改 channelId 之類的
   * 欄位時也要能一併把網址推上去。
   * 失敗不讓儲存失敗：Channel 可能還沒開 Messaging API 權限，設定本身仍應存下來，
   * 由回傳的 webhook 欄位讓前端提示店家手動貼。
   */
  const token = channelAccessToken
    || decryptSecret((await t.supabase.from('tenant_settings')
      .select('line_channel_access_token_enc').eq('tenant_id', t.tenantId)
      .maybeSingle()).data?.line_channel_access_token_enc ?? '');

  const endpoint = buildWebhookUrl(APP_URL, t.shopCode);
  let webhook: { synced: boolean; endpoint: string; message?: string } =
    { synced: false, endpoint, message: '尚未設定 Channel Access Token，無法自動寫入' };

  if (token) {
    try {
      const res = await lineSetWebhookEndpoint(token, endpoint);
      webhook = res.ok
        ? { synced: true, endpoint }
        : { synced: false, endpoint, message: res.body?.message ?? `LINE 回應 ${res.status}` };
    } catch {
      webhook = { synced: false, endpoint, message: '無法連線至 LINE 伺服器' };
    }
  }

  return ok({ webhook });
});
