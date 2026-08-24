import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { decryptSecret } from '@/server/crypto';
import { buildWebhookUrl } from '@/config/tenant-settings';
import { APP_URL } from '@/config/env';
import { lineGetRaw as lineGet } from '@/server/line';

/**
 * POST /api/settings/line/verify — 五項檢查（06 分冊 §7）。
 *
 * 實作程度（見 04 分冊 A-1 / 06 分冊 §7）：
 *   TOKEN       — 真檢查：GET /v2/bot/info 成功與否。
 *   WEBHOOK     — 真檢查：GET /v2/bot/channel/webhook/endpoint 的 endpoint 是否
 *                 等於本店 webhookUrl 且 active=true。
 *   AUTO_REPLY  — LINE 無公開 API 可查（06 §7 原文），恆回 pass:false 附提醒文案，
 *                 與原站行為一致，不是漏做。
 *   RICH_MENU   — 真檢查：GET /v2/bot/user/all/richmenu 是否有預設選單。
 *   QUOTA       — 真檢查：GET /v2/bot/message/quota + .../quota/consumption 算剩餘則數。
 * 無 token 時五項全部 pass:false、message 統一提示尚未設定。
 *
 * Phase 6：LINE 呼叫改走 src/server/line.ts 的 lineGetRaw —— 基底可用
 * LINE_API_BASE 覆寫（12 分冊 Phase 6 測試要求）；回應形狀 {checks:[...]}
 * 不變（前端 line-settings 頁 / services/settings.ts 的期待）。
 */
/**
 * severity 區分「真的壞了」與「我們查不到，提醒你自己確認」。
 * 少了這個分級，AUTO_REPLY 這種無法自動判定的項目只能一直算失敗，報告永遠
 * 不可能顯示「全部通過」，久了店家就整份忽略——警示失去意義。
 * 省略時視為 FAIL（既有呼叫端行為不變）。
 */
type Check = { key: string; pass: boolean; message: string; severity?: 'FAIL' | 'WARN' };

const NOT_CONFIGURED = '尚未設定 LINE Channel Token';

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

  // TOKEN —— 順便留下 bot info，AUTO_REPLY 那項要用裡面的 chatMode
  let botInfo: Record<string, any> | null = null;
  try {
    const info = await lineGet(token, '/v2/bot/info');
    if (info.ok) botInfo = info.body;
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

  /*
   * AUTO_REPLY
   *
   * 原本這項寫死 pass:false —— 不管店家在 LINE 後台怎麼設定，永遠顯示失敗。
   * 使用者實測回報「我已經關掉了，為什麼還是錯」，正是被這個假錯誤誤導。
   *
   * 「自動回應訊息」那個開關本身確實沒有公開 API（原註解這點沒錯），但
   * GET /v2/bot/info 回傳的 chatMode 查得到「聊天」設定，而那是同一個
   * 回應設定頁上、最常造成「Bot 沒反應」的項目：
   *   chat = 聊天 On（真人聊天介面接管，Bot 容易看起來沒反應）
   *   bot  = 聊天 Off（訊息交給 webhook）
   * 依 LINE 官方 OpenAPI 規格 BotInfoResponse.chatMode。
   *
   * 因此改為：能查到的部分給真實結論，查不到的部分降級為 WARN 提醒，
   * 不再是永遠的紅色失敗。
   */
  if (botInfo?.chatMode === 'bot') {
    checks.push({
      key: 'AUTO_REPLY',
      pass: true,
      message: 'LINE 後台「聊天」為關閉，訊息會交給本系統處理。'
        + '（「自動回應訊息」開關 LINE 未開放 API 查詢，若仍收到罐頭回覆請自行確認該項已關閉）',
    });
  } else if (botInfo?.chatMode === 'chat') {
    checks.push({
      key: 'AUTO_REPLY',
      pass: false,
      severity: 'WARN',
      message: 'LINE 後台「聊天」為開啟：訊息會進到 LINE 的真人聊天介面，'
        + 'Bot 可能看起來沒反應。若要走本系統自動回覆，請把「聊天」關閉。',
    });
  } else {
    checks.push({
      key: 'AUTO_REPLY',
      pass: false,
      severity: 'WARN',
      message: '無法讀取 LINE 回應設定，請自行確認「自動回應訊息」已關閉（LINE 未開放此開關的查詢 API）。',
    });
  }

  // RICH_MENU
  try {
    const rm = await lineGet(token, '/v2/bot/user/all/richmenu');
    checks.push(
      rm.ok && rm.body?.richMenuId
        ? { key: 'RICH_MENU', pass: true, message: 'Rich Menu 已發布' }
        // 沒有圖文選單不影響 Bot 收訊息，是「還沒做」而不是「壞了」
        : { key: 'RICH_MENU', pass: false, severity: 'WARN', message: '尚未設定預設 Rich Menu' },
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
