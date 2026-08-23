import { adapt, request } from '@/lib/api';
import type { Paged, PointTransaction } from '@/lib/types';
import { MOCK_POINT_BALANCE, MOCK_POINT_TRANSACTIONS } from '@/mock';

/**
 * 店家平台點數錢包（04 分冊 §B-4：balance / transactions / transfer）。
 * 目前 /tenant/points 頁仍是頁內自組 mock，尚未接線（該頁不在本次接線範圍）；
 * 這裡先備齊 adapt 雙模函式，接線時頁面只需改呼叫這幾支。
 */

/** GET /api/points/balance — 目前點數餘額 */
export const getPointBalance = () =>
  adapt<{ balance: number }>(
    () => ({ balance: MOCK_POINT_BALANCE }),
    () => request<{ balance: number }>('/api/points/balance'),
  );

export type PointTransactionQuery = { page?: number; size?: number };

/** GET /api/points/transactions — 交易紀錄（Spring 式分頁，created_at desc） */
export const listPointTransactions = (q: PointTransactionQuery = {}) =>
  adapt<Paged<PointTransaction>>(
    () => {
      const page = q.page ?? 0;
      const size = q.size ?? 20;
      const rows = MOCK_POINT_TRANSACTIONS;
      return {
        content: rows.slice(page * size, (page + 1) * size),
        totalElements: rows.length,
        totalPages: Math.ceil(rows.length / size),
        number: page,
        size,
      };
    },
    () => request<Paged<PointTransaction>>('/api/points/transactions', { query: q }),
  );

/**
 * POST /api/points/transfer — 跨店點數轉移（⚙OWNER）。
 * 失敗時 ApiError.message 由後端映射（409「點數餘額不足」、404「找不到目標店家」等），
 * 頁面 toast 原樣顯示即可。
 */
export const transferPoints = (payload: { toShopCode: string; amount: number }) =>
  adapt<{ transferred: boolean }>(
    () => ({ transferred: true }),
    () => request<{ transferred: boolean }>('/api/points/transfer', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  );
