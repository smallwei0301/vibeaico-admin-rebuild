import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { decryptSecret } from '@/server/crypto';
import { lineGetRaw } from '@/server/line';

/**
 * POST /api/settings/line/test — 解密 token → GET /v2/bot/info（06 分冊 §7 TOKEN 項）。
 * 規格明定 HTTP 一律 200，結果放 data；網路層失敗也回 ok:false，不丟 500。
 * LINE 呼叫走 src/server/line.ts 的 lineGetRaw —— 基底可用 LINE_API_BASE 覆寫
 * （12 分冊 Phase 6 測試要求），且不走 lineFetch 的 502 拋錯路徑。
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
    const res = await lineGetRaw(token, '/v2/bot/info');
    if (res.ok) return ok({ ok: true, message: '連線正常' });
    return ok({ ok: false, message: res.body?.message ?? `LINE API 錯誤（${res.status}）` });
  } catch {
    return ok({ ok: false, message: '無法連線至 LINE 伺服器，請稍後再試' });
  }
});
