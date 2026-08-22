import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { decryptSecret } from '@/server/crypto';

/**
 * POST /api/settings/line/test — 解密 token → GET /v2/bot/info。
 * 規格明定 HTTP 一律 200，結果放 data；網路層失敗也回 ok:false，不丟 500。
 */
export const POST = handle(async () => {
  const t = await requireTenant();
  const { data: row, error } = await t.supabase
    .from('tenant_settings')
    .select('line_channel_access_token_enc')
    .eq('tenant_id', t.tenantId)
    .maybeSingle();
  if (error) throw error;

  const token = decryptSecret(row?.line_channel_access_token_enc ?? '');
  if (!token) return ok({ ok: false, message: '尚未設定 LINE Channel Token' });

  try {
    const res = await fetch('https://api.line.me/v2/bot/info', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) return ok({ ok: true, message: '連線正常' });
    const body = await res.json().catch(() => ({}) as any);
    return ok({ ok: false, message: body?.message ?? `LINE API 錯誤（${res.status}）` });
  } catch {
    return ok({ ok: false, message: '無法連線至 LINE 伺服器，請稍後再試' });
  }
});
