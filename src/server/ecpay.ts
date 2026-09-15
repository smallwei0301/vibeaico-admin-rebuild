/**
 * 綠界（ECPay）AIO 金流簽章模組 —— issue #25 C 段（平台贊助金流）。
 * -----------------------------------------------------------------------------
 * repo 內在本檔之前**沒有任何** CheckMacValue 簽章／驗簽實作（2026-09-15 以
 * `search_code` 對 `CheckMacValue` 盤點過，只有文件提到這個名詞，沒有程式碼）。
 * `tour-platform` 姊妹 repo 有等價能力，但那是另一個 repo、另一個 deployment，
 * 不能跨 repo import——這裡是依 ECPay 官方演算法重寫的一份，供本 repo（目前只
 * 有 platform donate 這一個呼叫端）共用。
 *
 * ## 演算法（ECPay官方 CheckMacValue 規則）
 *
 * 1. 排除 `CheckMacValue` 本身，其餘參數依 key 字母序（A→Z）排序。
 * 2. 組成 `HashKey=xxx&k1=v1&k2=v2&...&HashIV=yyy`。
 * 3. 對整串做 `encodeURIComponent`，再轉小寫。
 * 4. 因為 JS 的 `encodeURIComponent` 與 .NET 的 `UrlEncode` 對某些字元的編碼不同，
 *    ECPay 的官方文件要求做以下取代（皆在小寫化之後）：
 *    `%2d`→`-`、`%5f`→`_`、`%2e`→`.`、`%21`→`!`、`%2a`→`*`、`%28`→`(`、`%29`→`)`，
 *    以及空白（`%20`）→`+`。
 * 5. SHA256 雜湊，轉大寫，得到 `CheckMacValue`。
 *
 * ## ⚠️ 本檔沒有、也不能有官方驗證向量
 *
 * 沒有真實商店憑證就無法對 ECPay 正式或測試環境送出請求驗證雜湊值是否與官方
 * 實作逐位元相同（issue #25 C 段：「真實 provider acceptance 屬外部缺件」）。
 * 因此 `tests/unit/ecpay.test.ts` 驗的是**演算法的內部一致性與安全性質**
 * （簽出來的值能驗證通過、參數順序不影響結果、竄改任一欄會讓驗證失敗、
 * 大小寫不敏感……），而不是「跟 ECPay 官方算出來的值逐字相同」——那件事要等
 * 拿到真實憑證、能打 sandbox 才能補驗。
 */
import { createHash } from 'crypto';

export type EcpayParams = Record<string, string | number>;

/** 依官方規則把單一 value 轉成要參與雜湊的字串（數字原樣轉字串，不做千分位） */
function stringifyValue(v: string | number): string {
  return typeof v === 'number' ? String(v) : v;
}

/**
 * ECPay 專用的 `.NET UrlEncode` 相容編碼。
 * 只在 `computeCheckMacValue` 內部使用，輸入已經是整串待編碼字串。
 */
function dotNetStyleEncode(input: string): string {
  return encodeURIComponent(input)
    .toLowerCase()
    .replace(/%2d/g, '-')
    .replace(/%5f/g, '_')
    .replace(/%2e/g, '.')
    .replace(/%21/g, '!')
    .replace(/%2a/g, '*')
    .replace(/%28/g, '(')
    .replace(/%29/g, ')')
    .replace(/%20/g, '+');
}

/**
 * 計算 CheckMacValue。`params` 不應包含 `CheckMacValue` 自己
 * （若含有會被忽略，計算時排除）。
 */
export function computeCheckMacValue(
  params: EcpayParams,
  hashKey: string,
  hashIv: string,
): string {
  const sortedKeys = Object.keys(params)
    .filter((k) => k !== 'CheckMacValue')
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const raw = [
    `HashKey=${hashKey}`,
    ...sortedKeys.map((k) => `${k}=${stringifyValue(params[k])}`),
    `HashIV=${hashIv}`,
  ].join('&');

  const encoded = dotNetStyleEncode(raw);
  return createHash('sha256').update(encoded).digest('hex').toUpperCase();
}

/**
 * 驗證一組（通常是 callback 送來的）參數的 `CheckMacValue` 是否正確。
 * 大小寫不敏感（ECPay 回傳與官方範例都可能是任一種大小寫）。
 */
export function verifyCheckMacValue(
  params: Record<string, string>,
  hashKey: string,
  hashIv: string,
): boolean {
  const received = params.CheckMacValue;
  if (!received) return false;
  const expected = computeCheckMacValue(params, hashKey, hashIv);
  return received.toUpperCase() === expected;
}

export interface AioCheckoutInput {
  merchantId: string;
  hashKey: string;
  hashIv: string;
  merchantTradeNo: string;
  /** `yyyy/MM/dd HH:mm:ss`，呼叫端負責格式化（見 `formatEcpayDate`） */
  merchantTradeDate: string;
  totalAmount: number;
  tradeDesc: string;
  itemName: string;
  /** 綠界 server-to-server 通知網址（官方欄位名叫 ReturnURL，是伺服器對伺服器，不是瀏覽器導回頁） */
  returnUrl: string;
  /** 使用者付款完成後瀏覽器導回的網址（官方欄位 ClientBackURL，選填） */
  clientBackUrl?: string;
}

/** `yyyy/MM/dd HH:mm:ss`——ECPay AIO 要求的日期格式，用本地時間（Asia/Taipei 部署） */
export function formatEcpayDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} `
    + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * 組出送到 ECPay AIO Checkout（`/Cashier/AioCheckOut/V5`）的完整表單欄位
 * （含 `CheckMacValue`）。前端把這些欄位組成一個自動送出的 `<form>` POST。
 *
 * `PaymentType` 固定 `aio`；`ChoosePayment` 固定 `Credit`（贊助第一版只開信用卡，
 * 與 donate 頁 `payHint` 文案一致）。
 */
export function buildAioCheckoutFields(input: AioCheckoutInput): Record<string, string> {
  const base: EcpayParams = {
    MerchantID: input.merchantId,
    MerchantTradeNo: input.merchantTradeNo,
    MerchantTradeDate: input.merchantTradeDate,
    PaymentType: 'aio',
    TotalAmount: input.totalAmount,
    TradeDesc: input.tradeDesc,
    ItemName: input.itemName,
    ReturnURL: input.returnUrl,
    ChoosePayment: 'Credit',
    EncryptType: 1,
    ...(input.clientBackUrl ? { ClientBackURL: input.clientBackUrl } : {}),
  };
  const checkMacValue = computeCheckMacValue(base, input.hashKey, input.hashIv);
  const fields: Record<string, string> = { CheckMacValue: checkMacValue };
  for (const [k, v] of Object.entries(base)) fields[k] = stringifyValue(v);
  return fields;
}

export const ECPAY_AIO_CHECKOUT_URL_PRODUCTION = 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5';
export const ECPAY_AIO_CHECKOUT_URL_STAGE = 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5';
