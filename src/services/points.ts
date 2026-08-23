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

/**
 * 原站的異動類型比 lib/types.ts 的 PointTransaction enum 多幾種（功能訂閱、
 * 推薦獎勵、贈送、過期、處理中、駁回、取消）——contract 型別只加不改
 * （CLAUDE.md 鐵則 3），故以斷言承載這批 mock 展示列；real 模式後端只會
 * 回 enum 內的 5 種值，型別仍然成立。原本放在 /tenant/points 頁內
 * （EXTRA_TRANSACTIONS），接線時移入這裡讓 USE_MOCK 行為不變。
 */
const MOCK_EXTRA_TRANSACTIONS = [
  {
    id: 'pt_x1', type: 'SUBSCRIPTION', amount: -49, balanceAfter: 4771,
    description: '訂閱「進階顧客管理」1 個月', createdAt: '2026-08-14T10:05:00+08:00',
  },
  {
    id: 'pt_x2', type: 'REFERRAL', amount: 500, balanceAfter: 4820,
    description: '推薦「晴天美甲工作室」完成首次儲值', createdAt: '2026-07-05T14:22:00+08:00',
  },
  {
    id: 'pt_x3', type: 'BONUS', amount: 250, balanceAfter: 4320,
    description: '儲值贈送 5%', createdAt: '2026-06-28T09:12:00+08:00',
  },
  {
    id: 'pt_x4', type: 'TRANSFER_OUT', amount: -800, balanceAfter: 4070,
    description: '轉出至「示範診所」', createdAt: '2026-06-20T17:44:00+08:00',
  },
  {
    id: 'pt_x5', type: 'PROCESSING', amount: 1000, balanceAfter: 4870,
    description: '線上儲值（付款處理中）', createdAt: '2026-06-18T21:30:00+08:00',
  },
  {
    id: 'pt_x6', type: 'REJECTED', amount: 0, balanceAfter: 3870,
    description: '儲值申請未通過', createdAt: '2026-06-15T13:08:00+08:00',
  },
  {
    id: 'pt_x7', type: 'EXPIRED', amount: -120, balanceAfter: 3870,
    description: '活動贈點到期', createdAt: '2026-06-12T00:05:00+08:00',
  },
] as unknown as PointTransaction[];

/** GET /api/points/transactions — 交易紀錄（Spring 式分頁，created_at desc） */
export const listPointTransactions = (q: PointTransactionQuery = {}) =>
  adapt<Paged<PointTransaction>>(
    () => {
      const page = q.page ?? 0;
      const size = q.size ?? 20;
      // 串接順序 = 原頁面 ALL_TRANSACTIONS 的順序（共用 mock 在前、展示列在後）
      const rows = [...MOCK_POINT_TRANSACTIONS, ...MOCK_EXTRA_TRANSACTIONS];
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
