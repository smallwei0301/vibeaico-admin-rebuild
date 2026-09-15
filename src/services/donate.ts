import { adapt, request } from '@/lib/api';
import { byMode } from '@/mock';
import type { DonationCheckout, DonationOrder, DonationSummary } from '@/lib/types';

/**
 * 平台贊助（/tenant/donate）的資料進出口 —— issue #25 C 段。
 * -----------------------------------------------------------------------------
 * 在這一層存在之前，`/tenant/donate` 整頁是假的：`MOCK_DONORS` /
 * `MOCK_TOTAL_DONATED` / `MOCK_MY_DONATED` 是頁面檔內的模組層級常數，
 * `submit()` 只是 `setTimeout(420)` 假裝打錢，永遠成功、永遠不驗證任何東西。
 * 而且它們**不是** `adapt()` 的 mock 分支——不管 `NEXT_PUBLIC_USE_MOCK` 開關
 * 在哪一邊都是同一段假資料，正式站上看到的贊助名單、累積金額全部是假的。
 *
 * 這裡把示範資料收斂進 `adapt()` 的 mock 分支（骨架展示模式該有的行為），
 * `NEXT_PUBLIC_USE_MOCK=false` 時一律打真實 `/api/donations/**`——沒有資料
 * 就是沒有資料，頁面顯示誠實的空狀態，不再假裝有人贊助過。
 */

/** 對應 `src/server/http.ts` 的 `ERR.EXTERNAL_CONFIG_BLOCKED`。 */
export const DONATION_CHECKOUT_BLOCKED_CODE = 'EXT_001';

let nextMockDonationId = 1;

const mockSummary = (): DonationSummary =>
  byMode<DonationSummary>({
    LOCAL_SHOP: {
      totalDonated: 48650,
      myDonated: 500,
      donors: [
        { id: 'dn_ls_1', displayName: '晴天美甲工作室', donatedAt: '2026-08-18T21:04:00+08:00' },
        { id: 'dn_ls_2', displayName: '木子按摩會館', donatedAt: '2026-08-15T13:27:00+08:00' },
        { id: 'dn_ls_3', displayName: '匿名好心人', donatedAt: '2026-08-09T10:12:00+08:00' },
      ],
    },
    GUIDE: {
      totalDonated: 32100,
      myDonated: 0,
      donors: [
        { id: 'dn_gd_1', displayName: '玉山嚮導工作室', donatedAt: '2026-08-20T09:12:00+08:00' },
        { id: 'dn_gd_2', displayName: '匿名好心人', donatedAt: '2026-08-11T18:40:00+08:00' },
      ],
    },
    CLINIC: {
      totalDonated: 15900,
      myDonated: 0,
      donors: [
        { id: 'dn_cl_1', displayName: '康健診所', donatedAt: '2026-08-22T14:03:00+08:00' },
      ],
    },
  });

/** GET /api/donations/summary */
export const getDonationSummary = () =>
  adapt<DonationSummary>(
    () => mockSummary(),
    () => request<DonationSummary>('/api/donations/summary'),
  );

/** POST /api/donations */
export const createDonationOrder = (input: { amount: number; displayName: string }) =>
  adapt<DonationOrder>(
    () => ({ id: `dn_new_${nextMockDonationId++}`, merchantTradeNo: `MOCKTRADE${nextMockDonationId}`, amount: input.amount }),
    () => request<DonationOrder>('/api/donations', { method: 'POST', body: JSON.stringify(input) }),
  );

/**
 * GET /api/donations/:id/checkout
 * 骨架模式沒有真的金流可以導向，回一個空的表單（頁面會用 `payment=success` 的
 * mock 導向流程代替，見 `DonatePage`），不假裝有一個真的 checkout 頁面存在。
 */
export const getDonationCheckout = (id: string) =>
  adapt<DonationCheckout>(
    () => ({ actionUrl: '', fields: {} }),
    () => request<DonationCheckout>(`/api/donations/${id}/checkout`),
  );
