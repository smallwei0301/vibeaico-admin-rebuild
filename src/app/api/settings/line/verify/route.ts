import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { decryptSecret } from '@/server/crypto';
import { buildWebhookUrl } from '@/config/tenant-settings';
import { APP_URL } from '@/config/env';
import {
  lineGetRaw as lineGet,
  linePostRaw,
  lineOAuthClientCredentialsRaw,
} from '@/server/line';

/**
 * POST /api/settings/line/verify — 六項可查證檢查 + 一項人工確認提示。
 *
 * 沿革：舊版（06 分冊 §7 原文）是五項 TOKEN/WEBHOOK/AUTO_REPLY/RICH_MENU/QUOTA。
 * Issue #477 P0 先把 AUTO_REPLY 從「恆假 FAIL」修成「恆 WARN」。這次再依 Owner
 * 提供的新版報告設計，把「可由系統實際查證」與「LINE 沒有公開 API、只能人工
 * 確認」兩類徹底拆開，不再混在同一份 PASS/WARN/FAIL 清單裡：
 *
 *   六項可查證檢查（status 只會是 PASS 或 FAIL，全數通過才顯示「全部通過」）：
 *     CREDENTIALS     — Channel ID / Secret / Access Token 是否都已填寫（本地檢查，
 *                        不呼叫 LINE）。
 *     TOKEN           — GET /v2/bot/info 成功 → Access Token 有效。
 *     ID_SECRET_PAIR  — POST /oauth2/v2.1/token（client_credentials）用 Channel
 *                        ID + Secret 換發短期 token 成功 → 兩者確實互相配對
 *                        （不是各自單獨有效但湊錯對）。這與 webhook 收到訊息時
 *                        用 Secret 算 HMAC 簽章驗證是同一把 Secret，但 OAuth
 *                        換token是唯一能同時驗證 ID 與 Secret 配對關係、且不需要
 *                        真的收一次 LINE 事件就能查證的方式。
 *     BOT_MODE        — GET /v2/bot/info 的 chatMode 欄位。⚠️ 這與下面 AUTO_REPLY
 *                        是兩個完全不同的 LINE 設定：chatMode 代表 LINE Official
 *                        Account Manager「設定 → 回應設定 → 回應方式」的
 *                        Bot／聊天 兩個模式，是 LINE 官方有公開 API 的欄位，
 *                        chatMode='bot' 才會把訊息事件送進 webhook；這裡讀它
 *                        判斷「回應方式」完全正當。AUTO_REPLY 檢查的是同一個
 *                        設定頁裡「自動回應訊息」這顆*另外*的開關，LINE 未對外
 *                        公開讀取 API，兩者不可混用同一個判斷來源（Issue #477
 *                        踩過的坑：舊版誤用 chatMode 去推論 AUTO_REPLY）。
 *     WEBHOOK         — GET /v2/bot/channel/webhook/endpoint 的 endpoint 是否
 *                        等於本店 webhookUrl 且 active=true（「Use webhook」開關）。
 *     WEBHOOK_TEST    — POST /v2/bot/channel/webhook/test：LINE 官方主動對已註冊
 *                        的 endpoint 送一次測試請求，回傳 success/statusCode。
 *                        這是 LINE → 本系統方向的真實連線測試，跟上面 WEBHOOK
 *                        只讀設定值不同。
 *
 *   一項人工確認提示（AUTO_REPLY，status 恆為 INFO，不計入通過／失敗）：
 *     LINE 沒有公開 API 能讀「自動回應訊息」這顆開關本身，只能請店家自行到
 *     LINE Official Account Manager 確認並視需要關閉。前端把這項獨立渲染成
 *     藍色資訊提示（不是黃色警告），因為這不是一個「可能有問題」的偵測結果，
 *     而是一個系統本來就查不到、需要人工動作的既定事實。
 *
 * 無 token 時六項可查證檢查一律 FAIL（真的沒設定，不是「無法判定」），且不顯示
 * AUTO_REPLY 人工提示——連基本設定都還沒接上，提醒一個還沒生效的開關沒有意義。
 *
 * Phase 6：LINE 呼叫改走 src/server/line.ts；基底可用 LINE_API_BASE 覆寫（12 分冊
 * Phase 6 測試要求）；回應形狀 {checks:[...]} 不變，每項 `status` 現為
 * 'PASS' | 'FAIL' | 'INFO'（AUTO_REPLY 專用；不再有 WARN——原本的 WARN 語意
 * 已拆成獨立的 INFO 提示，六項可查證檢查只剩 PASS/FAIL 兩態）；
 * `pass:boolean` 欄位保留相容（`pass = status === 'PASS'`）。
 */
type CheckStatus = 'PASS' | 'FAIL' | 'INFO';
type Check = { key: string; status: CheckStatus; pass: boolean; message: string };

const NOT_CONFIGURED = '尚未設定 LINE Channel Token';

const AUTO_REPLY_INFO_MESSAGE =
  '「自動回應訊息」開關無公開 API 可直接查詢，請自行至 LINE Official Account Manager 確認並關閉，避免 LINE 內建自動回應攔截 Bot 訊息';

function mkCheck(key: string, status: CheckStatus, message: string): Check {
  return { key, status, pass: status === 'PASS', message };
}

const VERIFIABLE_KEYS = [
  'CREDENTIALS',
  'TOKEN',
  'ID_SECRET_PAIR',
  'BOT_MODE',
  'WEBHOOK',
  'WEBHOOK_TEST',
] as const;

export const POST = handle(async () => {
  const t = await requireTenant();
  const { data: row, error } = await t.supabase
    .from('tenant_settings')
    .select('line, line_channel_secret_enc, line_channel_access_token_enc')
    .eq('tenant_id', t.tenantId)
    .maybeSingle();
  if (error) throw error;

  const channelId = String((row?.line as Record<string, unknown> | null)?.channelId ?? '').trim();
  const secret = decryptSecret(row?.line_channel_secret_enc ?? '');
  const token = decryptSecret(row?.line_channel_access_token_enc ?? '');

  if (!token) {
    // 尚未設定 LINE 憑證：只回六項可查證檢查（皆 FAIL），不顯示 AUTO_REPLY 人工
    // 提示——連基本設定都還沒接上，提醒店家去關一個還沒生效的開關沒有意義。
    const checks: Check[] = VERIFIABLE_KEYS.map((key) => mkCheck(key, 'FAIL', NOT_CONFIGURED));
    return ok({ checks });
  }

  const checks: Check[] = [];

  // CREDENTIALS — 本地檢查，不呼叫 LINE。
  checks.push(
    channelId && secret && token
      ? mkCheck('CREDENTIALS', 'PASS', 'Channel ID / Secret / Access Token 都已填寫')
      : mkCheck('CREDENTIALS', 'FAIL', '尚未完整填寫 Channel ID / Channel Secret / Access Token'),
  );

  // TOKEN + BOT_MODE 共用同一次 GET /v2/bot/info（chatMode 欄位見檔頭說明）。
  let botInfo: { ok: boolean; status: number; body: Record<string, any> } | null = null;
  try {
    botInfo = await lineGet(token, '/v2/bot/info');
  } catch {
    botInfo = null;
  }

  checks.push(
    botInfo?.ok
      ? mkCheck('TOKEN', 'PASS', 'Access Token 有效（LINE 認證通過）')
      : mkCheck(
          'TOKEN',
          'FAIL',
          botInfo ? (botInfo.body?.message ?? `Token 驗證失敗（${botInfo.status}）`) : '無法連線至 LINE 伺服器',
        ),
  );

  if (!botInfo?.ok) {
    checks.push(mkCheck('BOT_MODE', 'FAIL', '無法讀取回應方式設定（Access Token 驗證未通過）'));
  } else {
    const chatMode = botInfo.body?.chatMode;
    checks.push(
      chatMode === 'bot'
        ? mkCheck('BOT_MODE', 'PASS', 'LINE 官方帳號後台「回應方式」為 Bot 模式（推薦）')
        : mkCheck(
            'BOT_MODE',
            'FAIL',
            chatMode === 'chat'
              ? 'LINE 官方帳號後台「回應方式」目前是「聊天」模式，LINE 會攔截訊息、不會轉送到本系統，請至 LINE Official Account Manager → 設定 → 回應設定 改為「Bot」模式'
              : `無法確認回應方式（LINE 回傳 chatMode=${chatMode ?? '未知'}），請至 LINE Official Account Manager 確認「回應方式」為 Bot 模式`,
          ),
    );
  }

  // ID_SECRET_PAIR
  if (!secret) {
    checks.push(mkCheck('ID_SECRET_PAIR', 'FAIL', '尚未填寫 Channel Secret，無法驗證配對關係'));
  } else {
    try {
      const pair = await lineOAuthClientCredentialsRaw(channelId, secret);
      checks.push(
        pair.ok
          ? mkCheck('ID_SECRET_PAIR', 'PASS', 'Channel ID 與 Secret 配對正確（webhook 簽章可通過）')
          : mkCheck(
              'ID_SECRET_PAIR',
              'FAIL',
              `Channel ID 與 Secret 配對失敗（${pair.body?.error ?? pair.status}），請確認兩者是否來自同一個 Channel`,
            ),
      );
    } catch {
      checks.push(mkCheck('ID_SECRET_PAIR', 'FAIL', '無法連線至 LINE 伺服器'));
    }
  }

  // WEBHOOK — Use webhook 開關 + endpoint 是否等於本店網址。
  const expectedWebhook = buildWebhookUrl(APP_URL, t.shopCode);
  let webhookPassed = false;
  try {
    const wh = await lineGet(token, '/v2/bot/channel/webhook/endpoint');
    webhookPassed = wh.ok && wh.body?.endpoint === expectedWebhook && wh.body?.active === true;
    checks.push(
      webhookPassed
        ? mkCheck('WEBHOOK', 'PASS', 'Use webhook 已開啟（LINE 會把使用者點選／訊息事件送到本系統）')
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

  // WEBHOOK_TEST — LINE 主動對已註冊 endpoint 送一次測試請求。
  try {
    const test = await linePostRaw(token, '/v2/bot/channel/webhook/test');
    const passed = test.ok && test.body?.success === true;
    checks.push(
      passed
        ? mkCheck('WEBHOOK_TEST', 'PASS', 'Webhook 實際測試通過（LINE → 本系統 200 OK）')
        : mkCheck(
            'WEBHOOK_TEST',
            'FAIL',
            test.ok
              ? `Webhook 測試未通過（LINE 回報：${test.body?.reason ?? test.body?.detail ?? '未知原因'}）`
              : 'Webhook 測試請求失敗',
          ),
    );
  } catch {
    checks.push(mkCheck('WEBHOOK_TEST', 'FAIL', '無法連線至 LINE 伺服器'));
  }

  // AUTO_REPLY — 人工確認提示，恆為 INFO，見檔頭說明。
  checks.push(mkCheck('AUTO_REPLY', 'INFO', AUTO_REPLY_INFO_MESSAGE));

  return ok({ checks });
});
