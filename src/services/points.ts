import { ApiError, adapt, request } from '@/lib/api';
import type { Paged, PointTransaction } from '@/lib/types';
import { MOCK_POINT_BALANCE, MOCK_POINT_TRANSACTIONS } from '@/mock';

/**
 * 店家平台點數錢包（04 分冊 §B-4：balance / transactions / transfer）＋
 * 儲值申請（09 分冊 §4）。/tenant/points 頁的餘額、異動記錄、轉點、儲值
 * 都走這一組函式。
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

/* --------------------------------------------------------------- 儲值 */

/**
 * 線上儲值的結果。`accepted:false` **不是錯誤**，是規格內的誠實回覆：
 * MVP 階段不接金流（09 分冊 §4），`POST /api/points/topup/pay` 一律回
 * 501 +「請聯絡平台客服儲值」，平台管理者收到轉帳後才用 service role 寫 TOPUP 交易。
 */
export type TopupOutcome = {
  /** true = 真的建立了付款；目前後端不可能回 true，留著是為了將來接上金流不用改頁面 */
  accepted: boolean;
  /** 後端給的說明原文；null = mock 分支（沒有後端可問，由頁面用自己的文案說明） */
  message: string | null;
};

/**
 * POST /api/points/topup/pay。
 *
 * ⚠️ 端點路徑是 `/api/points/topup/**pay**`，不是 `/api/points/topup`
 * （後者不存在，打過去會是 404，訊息就變成「找不到」而不是客服提示）。
 *
 * 501 在這裡**刻意不往上丟成例外**：頁面若用 catch 顯示，訊息會被歸進
 * 「付款建立失敗：…」那類紅色錯誤，看起來像系統壞了；實際上是這個功能就是要
 * 走客服。因此轉成 `{accepted:false, message}` 讓頁面照實呈現後端說的那句話。
 * 其他狀態碼（401/403/500…）仍然是真的錯誤，照常往上丟。
 *
 * mock 分支同樣回 `accepted:false`：骨架模式一樣沒有金流，回成功就是假成功。
 */
export const requestPointTopup = (payload: { amount: number; invoiceUbn?: string; invoiceTitle?: string; remark?: string }) =>
  adapt<TopupOutcome>(
    () => ({ accepted: false, message: null }),
    async () => {
      try {
        await request<unknown>('/api/points/topup/pay', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        return { accepted: true, message: null };
      } catch (e) {
        if (e instanceof ApiError && e.status === 501) {
          return { accepted: false, message: e.message };
        }
        throw e;
      }
    },
  );
