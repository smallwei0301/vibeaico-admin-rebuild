import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { encryptSecret } from '@/server/crypto';
import { lineSettingsSchema } from '@/config/tenant-settings';

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

  return ok();
});
