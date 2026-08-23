import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';

/**
 * POST /api/settings/line/disconnect —— 解除 LINE 官方帳號連動（06 分冊 §6，⚙OWNER）。
 * 規格：清空兩個 `*_enc` 欄位與 line jsonb 的 channelId。
 * 其餘 line jsonb 欄位（自動回覆、Flex/RichMenu 外觀設定…）保留——重新連動時
 * 店家不必重設所有偏好；規格也只點名 channelId。
 */
export const POST = handle(async () => {
  const t = await requireTenant('OWNER');

  const { data: row, error: rerr } = await t.supabase
    .from('tenant_settings')
    .select('line')
    .eq('tenant_id', t.tenantId)
    .maybeSingle();
  if (rerr) throw rerr;

  const line = { ...((row?.line ?? {}) as Record<string, unknown>) };
  line.channelId = '';
  // 防禦：就算歷史資料誤存過 secret 進 jsonb，這裡一併清掉（與 PUT /api/settings/line 同精神）
  delete line.channelSecret;
  delete line.channelAccessToken;

  const { error } = await t.supabase
    .from('tenant_settings')
    .upsert({
      tenant_id: t.tenantId,
      line,
      line_channel_secret_enc: '',
      line_channel_access_token_enc: '',
    }, { onConflict: 'tenant_id' });
  if (error) throw error;

  return ok();
});
