import { adapt, ApiError, request } from '@/lib/api';
import type { Paged, PointTransaction } from '@/lib/types';
import type { BusinessType } from '@/config/modes';
import { MOCK_MODE, MOCK_POINT_BALANCE, MOCK_POINT_TRANSACTIONS, MOCK_TENANTS } from '@/mock';

/**
 * 店家平台點數錢包（04 分冊 §B-4：balance / transactions / transfer）。
 * /tenant/points 頁已接線，balance / transactions / transfer 皆走這裡的
 * adapt 雙模函式；儲值（requestPointTopup）目前 real 分支後端固定回 501
 * （MVP 不接金流，見 /api/points/topup/pay route 註解），頁面把
 * ApiError.message 原樣顯示給使用者，不得假裝成功。
 */

/**
 * mock 分支的可變狀態：per-mode（延遲初始化，呼叫當下才讀 MOCK_MODE /
 * MOCK_POINT_BALANCE / MOCK_POINT_TRANSACTIONS，絕不可在 module scope 讀取
 * 這幾個 live binding——AppShell 切換租戶時才會 reassign 它們）。
 * 讓 mock 模式下轉點能真的扣款、真的多一筆交易，而不是靜態常數。
 */
type MockPointsState = { balance: number; transactions: PointTransaction[] };
const mockPointsStore = new Map<BusinessType, MockPointsState>();

function getMockPointsState(): MockPointsState {
  const mode = MOCK_MODE;
  let state = mockPointsStore.get(mode);
  if (!state) {
    state = {
      balance: MOCK_POINT_BALANCE,
      transactions: [...MOCK_POINT_TRANSACTIONS, ...MOCK_EXTRA_TRANSACTIONS],
    };
    mockPointsStore.set(mode, state);
  }
  return state;
}

/** GET /api/points/balance — 目前點數餘額 */
export const getPointBalance = () =>
  adapt<{ balance: number }>(
    () => ({ balance: getMockPointsState().balance }),
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
      // per-mode store：共用 mock 在前、展示列在後（初始順序），
      // 轉點成功後新交易會 unshift 到最前面。
      const rows = getMockPointsState().transactions;
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
 * 頁面 toast 原樣顯示即可。mock 分支複製同一組錯誤情境（不足、找不到、轉給自己、
 * 非正整數），並真的扣款、真的多一筆交易，行為與 real 一致。
 */
export const transferPoints = (payload: { toShopCode: string; amount: number }) =>
  adapt<{ transferred: boolean }>(
    () => {
      const { toShopCode, amount } = payload;
      if (!Number.isInteger(amount) || amount <= 0)
        throw new ApiError('轉移點數必須大於 0', 'REQ_001', 400);

      const me = MOCK_TENANTS.find((x) => x.current);
      if (me && me.shopCode === toShopCode)
        throw new ApiError('不能轉移點數給自己的店家', 'REQ_001', 400);

      const target = MOCK_TENANTS.find((x) => x.shopCode === toShopCode);
      if (!target) throw new ApiError('找不到目標店家', 'REQ_002', 404);

      const state = getMockPointsState();
      if (amount > state.balance) throw new ApiError('點數餘額不足', 'POINTS_001', 409);

      state.balance -= amount;
      const txn: PointTransaction = {
        id: `pt_transfer_${Date.now()}`,
        type: 'TRANSFER_OUT',
        amount: -amount,
        balanceAfter: state.balance,
        description: `轉出至「${target.name}」`,
        createdAt: new Date().toISOString(),
      };
      state.transactions = [txn, ...state.transactions];

      return { transferred: true };
    },
    () => request<{ transferred: boolean }>('/api/points/transfer', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  );

/**
 * POST /api/points/topup/pay — 申請儲值。
 * MVP 階段後端固定回 501「請聯絡平台客服儲值」（不接金流，見該 route 註解）。
 * mock 分支回傳語意相同的「不可用」錯誤，兩種模式都不得假裝儲值成功——
 * 頁面把這裡拋出的 ApiError.message 原樣顯示。
 */
export type PointTopupPayload = {
  amount: number;
  invoiceUbn?: string;
  invoiceTitle?: string;
  remark?: string;
};

export const requestPointTopup = (payload: PointTopupPayload) =>
  adapt<{ topupRequested: boolean }>(
    () => {
      throw new ApiError('請聯絡平台客服儲值', undefined, 501);
    },
    () => request<{ topupRequested: boolean }>('/api/points/topup/pay', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  );
