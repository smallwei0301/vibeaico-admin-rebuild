/**
 * POST /api/donations/callback —— 綠界（ECPay）AIO server-to-server 付款通知。
 * -----------------------------------------------------------------------------
 * ECPay 打進來沒有 session，不走 `requireUser()`／`handle()`：這是給金流商呼叫
 * 的端點，body 是 `application/x-www-form-urlencoded`，回應也必須是 ECPay 規定
 * 的純文字格式（成功 `1|OK`，其餘一律視為失敗、ECPay 會重試）。
 *
 * `runtime = 'nodejs'`：驗簽用 `crypto`，Edge runtime 不保證支援。
 *
 * Fail-closed 三道防線在 `processDonationCallback()`（`src/server/donations.ts`）：
 * 簽章錯 → 不查不寫；查無此訂單 → 不寫；訂單已處理過 → 不重覆寫入，直接回成功
 * （同一筆 callback 被重送、或兩個 callback 併發抵達都是這一步擋住的）。
 *
 * 回應內容刻意不回傳任何細節給呼叫端——這是外部端點，多說一個字都是資訊外流。
 */
import { processDonationCallback } from '@/server/donations';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  let params: Record<string, string>;
  try {
    const bodyText = await req.text();
    params = Object.fromEntries(new URLSearchParams(bodyText));
  } catch (e) {
    console.error('[donations/callback] malformed body', e);
    return new Response('0|MalformedBody', { status: 200 });
  }

  try {
    const outcome = await processDonationCallback(params);
    switch (outcome.kind) {
      case 'INVALID_SIGNATURE':
        console.error('[donations/callback] CheckMacValue 驗證失敗，拒絕處理', {
          merchantTradeNo: params.MerchantTradeNo,
        });
        return new Response('0|CheckMacValueError', { status: 200 });
      case 'NOT_CONFIGURED':
        console.error('[donations/callback] 平台 ECPay 憑證尚未設定，無法驗證 callback');
        return new Response('0|NotConfigured', { status: 200 });
      case 'UNKNOWN_ORDER':
        console.error('[donations/callback] 查無此訂單編號，拒絕處理', {
          merchantTradeNo: outcome.merchantTradeNo,
        });
        return new Response('0|OrderNotFound', { status: 200 });
      case 'ALREADY_PROCESSED':
        // 訂單已經是終局狀態（PAID 或 FAILED），這一筆是重送／併發撞上的第二筆
        // callback：不重覆寫入，但仍回 `1|OK`——訂單已經有結論，讓 ECPay 別再重試。
        return new Response('1|OK', { status: 200 });
      case 'PROCESSED':
        return new Response('1|OK', { status: 200 });
      case 'PROCESSED_FAILED': {
        // 這是「第一次」把訂單判定為失敗（金額不符／SimulatePaid／RtnCode 失敗），
        // 呼叫端不能被告知「成功」——回應刻意不是 `1|OK`，見
        // `docs/integration/04-API-CONTRACTS.md`。
        console.error('[donations/callback] 訂單判定失敗，標記 FAILED', {
          donationId: outcome.donationId,
          reason: outcome.reason,
        });
        const code = outcome.reason === 'AMOUNT_MISMATCH'
          ? '0|AmountMismatch'
          : outcome.reason === 'SIMULATED_PAYMENT'
            ? '0|SimulatePaidRejected'
            : '0|PaymentFailed';
        return new Response(code, { status: 200 });
      }
    }
  } catch (e) {
    console.error('[donations/callback] 未預期錯誤', e);
    return new Response('0|InternalError', { status: 200 });
  }
}
