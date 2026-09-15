import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { decryptSecret } from '@/server/crypto';
import { buildWebhookUrl } from '@/config/tenant-settings';
import { APP_URL } from '@/config/env';
import { lineGetRaw as lineGet } from '@/server/line';

/**
 * POST /api/settings/line/verify — 五項檢查（06 分冊 §7；Issue #477 P0 修正）。
 *
 * 實作程度（見 04 分冊 A-1 / 06 分冊 §7）：
 *   TOKEN       — 真檢查：GET /v2/bot/info 成功與否。PASS/FAIL。
 *   WEBHOOK     — 真檢查：GET /v2/bot/channel/webhook/endpoint 的 endpoint 是否
 *                 等於本店 webhookUrl 且 active=true。PASS/FAIL。
 *   AUTO_REPLY  — 恆回 WARN（見下方 Issue #477 說明），不是 PASS 也不是 FAIL。
 *   RICH_MENU   — 真檢查：GET /v2/bot/user/all/richmenu 是否有預設選單。PASS/FAIL。
 *   QUOTA       — 真檢查：GET /v2/bot/message/quota + .../quota/consumption 算剩餘則數。PASS/FAIL。
 * 無 token 時五項全部 status:FAIL（真的沒設定，不是「無法判定」），message 統一提示尚未設定。
 *
 * Issue #477（P0，取代舊版「AUTO_REPLY 恆回 pass:false」的假故障）：
 *   LINE 官方沒有公開 API 能直接讀取「自動回應訊息」這顆開關本身。
 *   GET /v2/bot/info 的 chatMode 欄位只代表 LINE OA Manager 的「Chat」開／關，
 *   **不是**自動回應開關，不能拿 chatMode=bot / chatMode=chat 去推論
 *   AUTO_REPLY 的 PASS 或 FAIL（那是舊版的錯誤推論，這次一併移除，不再讀取
 *   chatMode 做任何判斷）。無法用可觀察證據判定的項目，正確語意是 WARN——
 *   既不能謊稱 PASS（沒讀到證據），也不能誤報 FAIL（沒有失敗證據，只是
 *   「查不到」），一律導引店家自行到 LINE Official Account Manager 確認，
 *   文案不得宣稱系統已經讀到該開關狀態。
 *
 * Phase 6：LINE 呼叫改走 src/server/line.ts 的 lineGetRaw —— 基底可用
 * LINE_API_BASE 覆寫（12 分冊 Phase 6 測試要求）；回應形狀 {checks:[...]}
 * 不變（前端 line-settings 頁 / services/settings.ts 的期待），checks 每項新增
 * `status: 'PASS' | 'WARN' | 'FAIL'` 三態欄位；既有 `pass: boolean` 欄位保留
 * 相容（`pass = status === 'PASS'`），前端摘要「失敗數」須改用 status==='FAIL'
 * 計算，不得把 WARN 算進失敗數。
 */
type CheckStatus = 'PASS' | 'WARN' | 'FAIL';
type Check = { key: string; status: CheckStatus; pass: boolean; message: string };

const NOT_CONFIGURED = '尚未設定 LINE Channel Token';

const AUTO_REPLY_WARN_MESSAGE =
  '「自動回應訊息」開關無公開 API 可直接查詢，請自行至 LINE Official Account Manager 確認並視需要關閉，避免攔截 Bot 訊息';

function mkCheck(key: string, status: CheckStatus, message: string): Check {
  return { key, status, pass: status === 'PASS', message };
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
      .map((key) => mkCheck(key, 'FAIL', NOT_CONFIGURED));
    return ok({ checks });
  }

  const checks: Check[] = [];

  // TOKEN
  try {
    const info = await lineGet(token, '/v2/bot/info');
    checks.push(
      info.ok
        ? mkCheck('TOKEN', 'PASS', 'Channel Access Token 有效')
        : mkCheck('TOKEN', 'FAIL', info.body?.message ?? `Token 驗證失敗（${info.status}）`),
    );
  } catch {
    checks.push(mkCheck('TOKEN', 'FAIL', '無法連線至 LINE 伺服器'));
  }

  // WEBHOOK
  try {
    const expected = buildWebhookUrl(APP_URL, t.shopCode);
    const wh = await lineGet(token, '/v2/bot/channel/webhook/endpoint');
    const passed = wh.ok && wh.body?.endpoint === expected && wh.body?.active === true;
    checks.push(
      passed
        ? mkCheck('WEBHOOK', 'PASS', 'Webhook URL 已設定且可連線')
        : mkCheck(
            'WEBHOOK',
            'FAIL',
            wh.ok
              ? `LINE 後台設定的 Webhook 網址與本店不符或尚未啟用（目前：${wh.body?.endpoint || '未設定'}）`
              : 'Webhook 設定查詢失敗',
          ),
    );
  } catch {
    checks.push(mkCheck('WEBHOOK', 'FAIL', '無法連線至 LINE 伺服器'));
  }

  // AUTO_REPLY — LINE 無公開 API 可直接查詢該開關本身，恆回 WARN（見檔頭 Issue
  // #477 說明）。刻意不讀取 chatMode 做任何 PASS/FAIL/WARN 判斷——chatMode
  // 只代表 OA Manager 的 Chat 開關，與自動回應訊息是兩件事，兩者不得混用。
  checks.push(mkCheck('AUTO_REPLY', 'WARN', AUTO_REPLY_WARN_MESSAGE));

  // RICH_MENU
  try {
    const rm = await lineGet(token, '/v2/bot/user/all/richmenu');
    checks.push(
      rm.ok && rm.body?.richMenuId
        ? mkCheck('RICH_MENU', 'PASS', 'Rich Menu 已發布')
        : mkCheck('RICH_MENU', 'FAIL', '尚未設定預設 Rich Menu'),
    );
  } catch {
    checks.push(mkCheck('RICH_MENU', 'FAIL', '無法連線至 LINE 伺服器'));
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
      checks.push(
        mkCheck(
          'QUOTA',
          'PASS',
          remaining === null ? `本月已發送 ${used} 則（無上限方案）` : `本月推播額度尚有 ${remaining} 則`,
        ),
      );
    } else {
      checks.push(mkCheck('QUOTA', 'FAIL', '推播額度查詢失敗'));
    }
  } catch {
    checks.push(mkCheck('QUOTA', 'FAIL', '無法連線至 LINE 伺服器'));
  }

  return ok({ checks });
});
