/**
 * 平台贊助金流 —— issue #25 C 段。
 * -----------------------------------------------------------------------------
 * `platform_donations` 對 authenticated 完全不開放（`0118` migration），
 * 所有讀寫都經這裡、用 service role client，由這一層決定「誰能看到什麼」：
 *   - 自己的贊助總額：只能查自己的 `donor_user_id`。
 *   - 公開感謝名單／全平台累積：只挑 `status = 'PAID'`，不外流 `provider_trade_no`
 *     / `raw_callback` / 其他使用者的 `donor_user_id`。
 */
import { randomUUID } from 'crypto';
import { createAdminSupabase } from './supabase';
import { serverEnv } from '@/config/env';
import { ApiHttpError, ERR } from './http';
import {
  buildAioCheckoutFields,
  ECPAY_AIO_CHECKOUT_URL_PRODUCTION,
  ECPAY_AIO_CHECKOUT_URL_STAGE,
  formatEcpayDate,
  verifyCheckMacValue,
} from './ecpay';

export const DONATION_MIN_AMOUNT = 10;
export const DONATION_MAX_AMOUNT = 100000;
export const DISPLAY_NAME_MAX = 50;
export const DONOR_LIST_LIMIT = 50;

export type DonationStatus = 'PENDING' | 'PAID' | 'FAILED';

export interface DonationSummary {
  /** 全平台累積贊助金額（只計入 PAID） */
  totalDonated: number;
  /** 目前登入使用者累積贊助金額（只計入 PAID） */
  myDonated: number;
  /** 感謝名單（最近 50 筆 PAID，依付款時間排序） */
  donors: { id: string; displayName: string; donatedAt: string }[];
}

/** `DNyyyyMMddHHmmss` + 隨機碼，<=20 碼、純英數，符合 ECPay MerchantTradeNo 限制。 */
function generateMerchantTradeNo(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();
  return `DN${ts}${rand}`.slice(0, 20);
}

/** POST /api/donations —— 建立一筆待付款贊助訂單。 */
export async function createDonationOrder(input: {
  donorUserId: string;
  amount: number;
  displayName: string;
}): Promise<{ id: string; merchantTradeNo: string; amount: number }> {
  const admin = createAdminSupabase();
  const merchantTradeNo = generateMerchantTradeNo();

  const { data, error } = await admin
    .from('platform_donations')
    .insert({
      donor_user_id: input.donorUserId,
      display_name: input.displayName,
      amount: input.amount,
      status: 'PENDING',
      provider: 'ECPAY',
      merchant_trade_no: merchantTradeNo,
    })
    .select('id')
    .single();
  if (error) throw error;

  return { id: data.id as string, merchantTradeNo, amount: input.amount };
}

/**
 * GET /api/donations/:id/checkout —— 組出送往 ECPay 的自動送出表單欄位。
 *
 * 平台目前沒有真實 ECPay 商店憑證（issue #25 C 段「Live credential truth」），
 * 這條路徑因此 fail closed：憑證任一項缺漏就丟 503 + `EXTERNAL_CONFIG_BLOCKED`，
 * **不會**用假值簽出一組看起來能用、實際上會被 ECPay 拒絕的表單。
 */
export async function buildDonationCheckout(input: {
  donationId: string;
  donorUserId: string;
  appUrl: string;
}): Promise<{ actionUrl: string; fields: Record<string, string> }> {
  const admin = createAdminSupabase();
  const { data: donation, error } = await admin
    .from('platform_donations')
    .select('id, donor_user_id, amount, status, merchant_trade_no, display_name')
    .eq('id', input.donationId)
    .maybeSingle();
  if (error) throw error;
  if (!donation || donation.donor_user_id !== input.donorUserId) {
    throw new ApiHttpError(404, '找不到這筆贊助訂單', ERR.NOT_FOUND);
  }
  if (donation.status !== 'PENDING') {
    throw new ApiHttpError(409, '這筆贊助訂單已經處理過了', ERR.CONFLICT);
  }

  const { ECPAY_MERCHANT_ID, ECPAY_HASH_KEY, ECPAY_HASH_IV, ECPAY_ENV } = serverEnv;
  if (!ECPAY_MERCHANT_ID || !ECPAY_HASH_KEY || !ECPAY_HASH_IV) {
    throw new ApiHttpError(
      503,
      '平台金流尚未設定完成，暫時無法建立付款頁面，請稍後再試或聯絡平台',
      ERR.EXTERNAL_CONFIG_BLOCKED,
    );
  }

  const fields = buildAioCheckoutFields({
    merchantId: ECPAY_MERCHANT_ID,
    hashKey: ECPAY_HASH_KEY,
    hashIv: ECPAY_HASH_IV,
    merchantTradeNo: donation.merchant_trade_no as string,
    merchantTradeDate: formatEcpayDate(new Date()),
    totalAmount: donation.amount as number,
    tradeDesc: '平台贊助',
    itemName: `平台贊助 x1（${donation.display_name || '匿名'}）`,
    returnUrl: `${input.appUrl}/api/donations/callback`,
    clientBackUrl: `${input.appUrl}/tenant/donate`,
  });

  const actionUrl = ECPAY_ENV === 'production'
    ? ECPAY_AIO_CHECKOUT_URL_PRODUCTION
    : ECPAY_AIO_CHECKOUT_URL_STAGE;

  return { actionUrl, fields };
}

/** `PROCESSED_FAILED` 的理由，決定 route 層要回哪一種 ECPay 失敗代碼。 */
export type ProcessedFailedReason = 'AMOUNT_MISMATCH' | 'SIMULATED_PAYMENT' | 'RTN_CODE_FAILED';

export type CallbackOutcome =
  | { kind: 'INVALID_SIGNATURE' }
  | { kind: 'NOT_CONFIGURED' }
  | { kind: 'UNKNOWN_ORDER'; merchantTradeNo: string }
  | { kind: 'ALREADY_PROCESSED'; donationId: string }
  | { kind: 'PROCESSED'; donationId: string; status: 'PAID' }
  /**
   * 這一筆 callback 是「第一次」把訂單從 PENDING 轉成 FAILED（金額不符／
   * SimulatePaid／RtnCode 失敗）。刻意跟 `ALREADY_PROCESSED` 分開：同一筆
   * callback 之後被 ECPay 重送、打到一個已經是 FAILED 的訂單，走
   * `ALREADY_PROCESSED`（回 `1|OK`，不重試已經終局的訂單）；但「第一次」
   * 判定為失敗時，呼叫端必須知道這不是成功——回應不能是 `1|OK`
   * （見 `docs/integration/04-API-CONTRACTS.md` 與
   * `tests/integration/api/donations.25c.test.ts`「金額不符」案例）。
   */
  | { kind: 'PROCESSED_FAILED'; donationId: string; reason: ProcessedFailedReason };

/**
 * POST /api/donations/callback —— ECPay server-to-server 通知（`ReturnURL`）。
 *
 * Fail-closed 三道防線：
 *   1. 簽章不對 → 直接拒絕，不查、不寫任何一筆訂單資料。
 *   2. 查無此訂單編號 → 拒絕（偽造的 callback 常見手法就是亂猜一個編號）。
 *   3. 訂單已經不是 PENDING → 視為已處理，冪等回成功、**不重覆寫入**
 *      （同一筆 callback 被 ECPay 重送，或兩個 callback 併發抵達都靠這一步擋）。
 *
 * `.eq('status', 'PENDING')` 是這裡唯一的併發防護：兩個請求同時打進來，只有一個
 * 的 UPDATE 會真的命中列（`updated` 非 null），另一個会因為那一列已經不是
 * PENDING 而 0 rows affected，兩邊都不會出現「重複記帳」。
 */
export async function processDonationCallback(
  raw: Record<string, string>,
): Promise<CallbackOutcome> {
  const { ECPAY_HASH_KEY, ECPAY_HASH_IV } = serverEnv;
  if (!ECPAY_HASH_KEY || !ECPAY_HASH_IV) return { kind: 'NOT_CONFIGURED' };
  if (!verifyCheckMacValue(raw, ECPAY_HASH_KEY, ECPAY_HASH_IV)) {
    return { kind: 'INVALID_SIGNATURE' };
  }

  const tradeNo = raw.MerchantTradeNo;
  if (!tradeNo) return { kind: 'INVALID_SIGNATURE' };

  const admin = createAdminSupabase();
  const { data: existing, error: e0 } = await admin
    .from('platform_donations')
    .select('id, amount, status')
    .eq('merchant_trade_no', tradeNo)
    .maybeSingle();
  if (e0) throw e0;
  if (!existing) return { kind: 'UNKNOWN_ORDER', merchantTradeNo: tradeNo };
  if (existing.status !== 'PENDING') return { kind: 'ALREADY_PROCESSED', donationId: existing.id as string };

  const rtnCode = raw.RtnCode;
  const paidAmount = Number(raw.TradeAmt ?? raw.TotalAmount ?? NaN);
  const amountMatches = paidAmount === existing.amount;
  const rtnOk = rtnCode === '1';
  // `SimulatePaid=1`：ECPay 商店後台「模擬付款」測試功能，簽章合法但**不是**真的
  // 收到款項——真商家可以從自己的 ECPay 後台觸發，絕不能被當成真實付款放行。
  const isSimulated = raw.SimulatePaid === '1';
  const isSuccess = rtnOk && amountMatches && !isSimulated;
  const nextStatus: 'PAID' | 'FAILED' = isSuccess ? 'PAID' : 'FAILED';
  const failedReason: ProcessedFailedReason | null = isSuccess
    ? null
    : isSimulated
      ? 'SIMULATED_PAYMENT'
      : !amountMatches
        ? 'AMOUNT_MISMATCH'
        : 'RTN_CODE_FAILED';

  const { data: updated, error: e1 } = await admin
    .from('platform_donations')
    .update({
      status: nextStatus,
      provider_trade_no: raw.TradeNo ?? null,
      raw_callback: raw,
      paid_at: isSuccess ? new Date().toISOString() : null,
    })
    .eq('id', existing.id)
    .eq('status', 'PENDING')
    .select('id')
    .maybeSingle();
  if (e1) throw e1;
  if (!updated) return { kind: 'ALREADY_PROCESSED', donationId: existing.id as string };

  if (isSuccess) return { kind: 'PROCESSED', donationId: existing.id as string, status: 'PAID' };
  return { kind: 'PROCESSED_FAILED', donationId: existing.id as string, reason: failedReason! };
}

/** GET /api/donations/summary */
export async function getDonationSummary(donorUserId: string): Promise<DonationSummary> {
  const admin = createAdminSupabase();

  const [{ data: paidRows, error: e0 }, { data: mineRows, error: e1 }] = await Promise.all([
    admin
      .from('platform_donations')
      .select('id, display_name, amount, paid_at')
      .eq('status', 'PAID')
      .order('paid_at', { ascending: false })
      .limit(DONOR_LIST_LIMIT),
    admin
      .from('platform_donations')
      .select('amount')
      .eq('status', 'PAID')
      .eq('donor_user_id', donorUserId),
  ]);
  if (e0) throw e0;
  if (e1) throw e1;

  // 全平台累積用同一個 status=PAID 條件做 sum，避免「感謝名單只顯示 50 筆」與
  // 「累積金額」用兩套不同的口徑（例如漏算第 51 筆之後的贊助）。
  const { data: totalRow, error: e2 } = await admin
    .from('platform_donations')
    .select('amount')
    .eq('status', 'PAID');
  if (e2) throw e2;

  const totalDonated = (totalRow ?? []).reduce((sum, r) => sum + (r.amount as number), 0);
  const myDonated = (mineRows ?? []).reduce((sum, r) => sum + (r.amount as number), 0);
  const donors = (paidRows ?? []).map((r) => ({
    id: r.id as string,
    displayName: (r.display_name as string) || '匿名好心人',
    donatedAt: r.paid_at as string,
  }));

  return { totalDonated, myDonated, donors };
}
