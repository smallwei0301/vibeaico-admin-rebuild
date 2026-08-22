import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { decryptSecret } from '@/server/crypto';
import { buildWebhookUrl } from '@/config/tenant-settings';
import { APP_URL } from '@/config/env';

/**
 * POST /api/settings/line/verify — 五項檢查（06 分冊 §7）。
 *
 * 實作程度（Phase 3 務實版，見 04 分冊 A-1 / 06 分冊 §7）：
 *   TOKEN       — 真檢查：GET /v2/bot/info 成功與否。
 *   WEBHOOK     — 真檢查：GET /v2/bot/channel/webhook/endpoint 的 endpoint 是否
 *                 等於本店 webhookUrl 且 active=true。
 *   AUTO_REPLY  — LINE 無公開 API 可查（06 §7 原文），恆回 pass:false 附提醒文案，
 *                 與原站行為一致，不是漏做。
 *   RICH_MENU   — 真檢查：GET /v2/bot/user/all/richmenu 是否有預設選單。
 *   QUOTA       — 真檢查：GET /v2/bot/message/quota + .../quota/consumption 算剩餘則數。
 * 無 token 時五項全部 pass:false、message 統一提示尚未設定。
 */
type Check = { key: string; pass: boolean; message: string };

const NOT_CONFIGURED = '尚未設定 LINE Channel Token';

async function lineGet(token: string, path: string) {
  const res = await fetch(`https://api.line.me${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => ({}) as any);
  return { ok: res.ok, status: res.status, body };
}

export const POST = handle(async () => {
  const t = await requireTenant();
  const { data: row, error } = await t.supabase
    .from('tenant_settings')
    .select('line_channel_access_token_enc')
    .eq('tenant_id', t.tenantId)
    .maybeSingle();
  if (error) throw error;

  const token = decryptSecret(row?.line_channel_access_token_enc ?? '');

  if (!token) {
    const checks: Check[] = (['TOKEN', 'WEBHOOK', 'AUTO_REPLY', 'RICH_MENU', 'QUOTA'] as const)
      .map((key) => ({ key, pass: false, message: NOT_CONFIGURED }));
    return ok({ checks });
  }

  const checks: Check[] = [];

  // TOKEN
  try {
    const info = await lineGet(token, '/v2/bot/info');
    checks.push(
      info.ok
        ? { key: 'TOKEN', pass: true, message: 'Channel Access Token 有效' }
        : { key: 'TOKEN', pass: false, message: info.body?.message ?? `Token 驗證失敗（${info.status}）` },
    );
  } catch {
    checks.push({ key: 'TOKEN', pass: false, message: '無法連線至 LINE 伺服器' });
  }

  // WEBHOOK
  try {
    const expected = buildWebhookUrl(APP_URL, t.shopCode);
    const wh = await lineGet(token, '/v2/bot/channel/webhook/endpoint');
    const passed = wh.ok && wh.body?.endpoint === expected && wh.body?.active === true;
    checks.push(
      passed
        ? { key: 'WEBHOOK', pass: true, message: 'Webhook URL 已設定且可連線' }
        : {
            key: 'WEBHOOK',
            pass: false,
            message: wh.ok
              ? `LINE 後台設定的 Webhook 網址與本店不符或尚未啟用（目前：${wh.body?.endpoint || '未設定'}）`
              : 'Webhook 設定查詢失敗',
          },
    );
  } catch {
    checks.push({ key: 'WEBHOOK', pass: false, message: '無法連線至 LINE 伺服器' });
  }

  // AUTO_REPLY — 無公開 API 可查，恆回 false 提醒店家手動關閉（與原站一致）
  checks.push({
    key: 'AUTO_REPLY',
    pass: false,
    message: '請至 LINE 官方帳號後台確認「自動回應訊息」已關閉，否則會攔截 Bot 訊息（無公開 API 可自動檢查）',
  });

  // RICH_MENU
  try {
    const rm = await lineGet(token, '/v2/bot/user/all/richmenu');
    checks.push(
      rm.ok && rm.body?.richMenuId
        ? { key: 'RICH_MENU', pass: true, message: 'Rich Menu 已發布' }
        : { key: 'RICH_MENU', pass: false, message: '尚未設定預設 Rich Menu' },
    );
  } catch {
    checks.push({ key: 'RICH_MENU', pass: false, message: '無法連線至 LINE 伺服器' });
  }

  // QUOTA
  try {
    const [quota, consumption] = await Promise.all([
      lineGet(token, '/v2/bot/message/quota'),
      lineGet(token, '/v2/bot/message/quota/consumption'),
    ]);
    if (quota.ok && consumption.ok) {
      const limited = quota.body?.type === 'limited';
      const limit = limited ? Number(quota.body?.value ?? 0) : null;
      const used = Number(consumption.body?.totalUsage ?? 0);
      const remaining = limit === null ? null : Math.max(limit - used, 0);
      checks.push({
        key: 'QUOTA',
        pass: true,
        message: remaining === null ? `本月已發送 ${used} 則（無上限方案）` : `本月推播額度尚有 ${remaining} 則`,
      });
    } else {
      checks.push({ key: 'QUOTA', pass: false, message: '推播額度查詢失敗' });
    }
  } catch {
    checks.push({ key: 'QUOTA', pass: false, message: '無法連線至 LINE 伺服器' });
  }

  return ok({ checks });
});
