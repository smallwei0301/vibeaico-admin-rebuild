/**
 * 綠界 CheckMacValue 簽章／驗簽 —— issue #25 C 段。
 *
 * ⚠️ 這裡沒有「跟官方逐位元相同」的向量測試——那需要真實商店憑證去打 ECPay
 * sandbox，而目前平台沒有這組憑證（EXTERNAL_CONFIG_BLOCKED，見
 * `src/server/ecpay.ts` 檔頭）。全部使用測試用的假 hash key/iv（不是任何真實
 * 憑證），驗的是演算法本身的性質：能簽出來、能驗證通過、竄改會被抓到。
 */
import { describe, expect, it } from 'vitest';
import {
  buildAioCheckoutFields,
  computeCheckMacValue,
  formatEcpayDate,
  verifyCheckMacValue,
} from '@/server/ecpay';

// 純測試用假憑證，不對應任何真實 ECPay 商店（issue 要求：不得含任何真實憑證）。
const TEST_HASH_KEY = 'unit-test-hash-key-only';
const TEST_HASH_IV = 'unit-test-hash-iv-only';

describe('computeCheckMacValue / verifyCheckMacValue', () => {
  it('簽出來的值可以驗證通過（round-trip）', () => {
    const params = {
      MerchantID: '9999999',
      MerchantTradeNo: 'DNTEST0000000001',
      TotalAmount: 500,
      TradeDesc: '平台贊助',
    };
    const mac = computeCheckMacValue(params, TEST_HASH_KEY, TEST_HASH_IV);
    expect(mac).toMatch(/^[0-9A-F]{64}$/); // sha256 hex → 64 位大寫十六進位
    expect(verifyCheckMacValue({ ...params, TotalAmount: '500', CheckMacValue: mac }, TEST_HASH_KEY, TEST_HASH_IV))
      .toBe(true);
  });

  it('參數物件 key 的插入順序不影響簽章結果（依規則排序後才組字串）', () => {
    const a = computeCheckMacValue(
      { MerchantID: '123', TotalAmount: 100, TradeDesc: 'x' },
      TEST_HASH_KEY, TEST_HASH_IV,
    );
    const b = computeCheckMacValue(
      { TradeDesc: 'x', TotalAmount: 100, MerchantID: '123' },
      TEST_HASH_KEY, TEST_HASH_IV,
    );
    expect(a).toBe(b);
  });

  it('計算時忽略輸入裡既有的 CheckMacValue 欄位', () => {
    const withoutMac = computeCheckMacValue({ MerchantID: '123', TotalAmount: 100 }, TEST_HASH_KEY, TEST_HASH_IV);
    const withStaleMac = computeCheckMacValue(
      { MerchantID: '123', TotalAmount: 100, CheckMacValue: 'STALE_VALUE' },
      TEST_HASH_KEY, TEST_HASH_IV,
    );
    expect(withStaleMac).toBe(withoutMac);
  });

  it('竄改任一欄位的值都會讓驗證失敗（偽造 callback 必須被擋下）', () => {
    const params = { MerchantID: '9999999', MerchantTradeNo: 'DNTEST0000000002', TotalAmount: 500 };
    const mac = computeCheckMacValue(params, TEST_HASH_KEY, TEST_HASH_IV);

    // 金額被竄改
    expect(verifyCheckMacValue(
      { ...params, TotalAmount: '999', CheckMacValue: mac } as unknown as Record<string, string>,
      TEST_HASH_KEY, TEST_HASH_IV,
    )).toBe(false);

    // 訂單編號被竄改
    expect(verifyCheckMacValue(
      { ...params, MerchantTradeNo: 'DNTEST0000000099', TotalAmount: String(params.TotalAmount), CheckMacValue: mac },
      TEST_HASH_KEY, TEST_HASH_IV,
    )).toBe(false);
  });

  it('用錯的 hash key/iv 驗證會失敗（不同商店的憑證不能互簽）', () => {
    const params = { MerchantID: '9999999', TotalAmount: 500 };
    const mac = computeCheckMacValue(params, TEST_HASH_KEY, TEST_HASH_IV);
    expect(verifyCheckMacValue(
      { ...params, TotalAmount: '500', CheckMacValue: mac },
      'someone-elses-hash-key', 'someone-elses-hash-iv',
    )).toBe(false);
  });

  it('CheckMacValue 大小寫不敏感', () => {
    const params = { MerchantID: '9999999', TotalAmount: 500 };
    const mac = computeCheckMacValue(params, TEST_HASH_KEY, TEST_HASH_IV);
    expect(verifyCheckMacValue(
      { ...params, TotalAmount: '500', CheckMacValue: mac.toLowerCase() },
      TEST_HASH_KEY, TEST_HASH_IV,
    )).toBe(true);
  });

  it('缺少 CheckMacValue 欄位一律視為驗證失敗，不當成空字串比對', () => {
    expect(verifyCheckMacValue({ MerchantID: '9999999' }, TEST_HASH_KEY, TEST_HASH_IV)).toBe(false);
  });

  it('特殊字元（中文、空白、符號）也能正確 round-trip', () => {
    const params = { ItemName: '平台贊助 x1', TradeDesc: 'a+b=c & (test)!', TotalAmount: 500 };
    const mac = computeCheckMacValue(params, TEST_HASH_KEY, TEST_HASH_IV);
    expect(verifyCheckMacValue({ ...params, TotalAmount: '500', CheckMacValue: mac }, TEST_HASH_KEY, TEST_HASH_IV))
      .toBe(true);
  });
});

describe('formatEcpayDate', () => {
  it('輸出 yyyy/MM/dd HH:mm:ss 格式並補零', () => {
    const d = new Date(2026, 0, 5, 9, 3, 7); // 本地時間 2026/01/05 09:03:07
    expect(formatEcpayDate(d)).toBe('2026/01/05 09:03:07');
  });
});

describe('buildAioCheckoutFields', () => {
  it('組出的欄位含正確簽章，且欄位本身可以再次通過驗證', () => {
    const fields = buildAioCheckoutFields({
      merchantId: '9999999',
      hashKey: TEST_HASH_KEY,
      hashIv: TEST_HASH_IV,
      merchantTradeNo: 'DNTEST0000000003',
      merchantTradeDate: formatEcpayDate(new Date(2026, 8, 15, 10, 0, 0)),
      totalAmount: 300,
      tradeDesc: '平台贊助',
      itemName: '平台贊助 x1',
      returnUrl: 'https://example.test/api/donations/callback',
      clientBackUrl: 'https://example.test/tenant/donate',
    });

    expect(fields.PaymentType).toBe('aio');
    expect(fields.ChoosePayment).toBe('Credit');
    expect(fields.TotalAmount).toBe('300');
    expect(verifyCheckMacValue(fields, TEST_HASH_KEY, TEST_HASH_IV)).toBe(true);
  });

  it('未提供 clientBackUrl 時不含該欄位', () => {
    const fields = buildAioCheckoutFields({
      merchantId: '9999999',
      hashKey: TEST_HASH_KEY,
      hashIv: TEST_HASH_IV,
      merchantTradeNo: 'DNTEST0000000004',
      merchantTradeDate: formatEcpayDate(new Date()),
      totalAmount: 100,
      tradeDesc: 'x',
      itemName: 'x',
      returnUrl: 'https://example.test/api/donations/callback',
    });
    expect(fields.ClientBackURL).toBeUndefined();
  });
});
