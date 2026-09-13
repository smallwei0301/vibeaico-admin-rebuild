import { adapt, request } from '@/lib/api';
import { byMode } from '@/mock';

/**
 * 收款方式（/tenant/payment-methods）的資料進出口。
 * -----------------------------------------------------------------------------
 * 端點：`/api/payment-methods`（GET/POST）與 `/[id]`（PUT/DELETE），
 * 資料表 `tenant_payment_methods`（`0094` migration）。
 *
 * ⚠️ 這一層存在的理由：頁面原本**整頁假的**——`load()` 用 `setTimeout(320)` 假裝
 * 網路延遲然後讀頁內的 `MOCK_METHODS`，新增／編輯／啟停／刪除全部只改本地 state
 * 再跳一個成功 toast。而且它**不是** `adapt()` 的 mock 分支，所以不受
 * `NEXT_PUBLIC_USE_MOCK` 影響：正式站上也是那一段。店家設定完收款方式、看到
 * 「已更新」，重新整理就全部消失。
 *
 * ## 這一版涵蓋五種線下收款，不含線上刷卡
 *
 * 「線上刷卡付款」需要藍新／綠界的商店憑證，那條路徑還沒有任何實作也還沒拿到
 * 憑證（#9 第三步，與 #12／#32 綁定）。所以這裡**沒有任何 gateway 欄位**：
 * `ONLINE_PAYMENT` 仍可被建立與列出，但頁面會誠實標示尚未開通，且不提供
 * 「實刷測試」——那顆按鈕原本會在什麼都沒做的情況下宣告「金流已驗證」。
 */

export type PaymentMethodType =
  | 'LINE_PAY' | 'JKOPAY' | 'BANK_TRANSFER' | 'CASH' | 'ONLINE_PAYMENT' | 'OTHER';

/** 頁面用的一列 */
export interface PaymentMethodRow {
  id: string;
  methodType: PaymentMethodType;
  displayName: string;
  qrImageUrl: string;
  /** 以下四欄只有 BANK_TRANSFER 用得到；後端打包進 config jsonb */
  bankName: string;
  bankCode: string;
  accountNumber: string;
  accountHolderName: string;
  instructions: string;
  active: boolean;
  sortOrder: number;
}

/** 寫入端點的 body（POST 全欄、PUT 可局部） */
export interface PaymentMethodPayload {
  methodType: PaymentMethodType;
  displayName: string;
  qrImageUrl: string;
  config: {
    bankName: string;
    bankCode: string;
    accountNumber: string;
    accountHolderName: string;
    instructions: string;
  };
  active: boolean;
  sortOrder: number;
}

/**
 * 頁面列 → 端點 body。
 *
 * ⚠️ 銀行四欄與備註一律送出（即使是空字串），不做「有值才送」的過濾：那會讓
 * 「把銀行帳號清空」這個操作變成 no-op，而畫面顯示已儲存。
 *
 * ⚠️ `sortOrder` 也**必須**在這裡送出。第一版把它 `Omit` 掉，結果是：表單上有
 * 排序欄位、卡片上顯示排序、按儲存跳「已更新」，但那個值從來沒有離開瀏覽器——
 * 重新整理就跳回舊值。那正是這一頁原本的病（畫面說存好了、其實沒存），只是
 * 縮小到一個欄位。由 2026-09-09 的最終風險評估抓出（MAJOR-1）。
 */
export function toApiPayload(row: Omit<PaymentMethodRow, 'id'>): PaymentMethodPayload {
  return {
    methodType: row.methodType,
    displayName: row.displayName.trim(),
    qrImageUrl: row.qrImageUrl,
    config: {
      bankName: row.bankName,
      bankCode: row.bankCode,
      accountNumber: row.accountNumber,
      accountHolderName: row.accountHolderName,
      instructions: row.instructions,
    },
    active: row.active,
    sortOrder: row.sortOrder,
  };
}

/**
 * 骨架模式的示範資料。
 * 三種業態各自一份——沙龍與嚮導的收款習慣不同，共用一份會讓示範店家講出別的
 * 行業的話（CLAUDE.md「mode-aware mock data」）。必須在 callback 內呼叫
 * `byMode()`，模組載入時 `MOCK_MODE` 還沒被 AppShell 設定。
 */
const mockRows = (): PaymentMethodRow[] =>
  byMode<PaymentMethodRow[]>({
    LOCAL_SHOP: [
      {
        id: 'pm_1', methodType: 'LINE_PAY', displayName: 'LINE Pay', qrImageUrl: '',
        bankName: '', bankCode: '', accountNumber: '', accountHolderName: '',
        instructions: '轉帳後請於 LINE 傳送截圖給我們核對。', active: true, sortOrder: 0,
      },
      {
        id: 'pm_2', methodType: 'BANK_TRANSFER', displayName: '國泰世華銀行', qrImageUrl: '',
        bankName: '國泰世華銀行', bankCode: '013', accountNumber: '1234-5678-9012',
        accountHolderName: '王小明', instructions: '', active: true, sortOrder: 1,
      },
      {
        id: 'pm_3', methodType: 'CASH', displayName: '現金', qrImageUrl: '',
        bankName: '', bankCode: '', accountNumber: '', accountHolderName: '',
        instructions: '到店現場付款。', active: true, sortOrder: 2,
      },
    ],
    GUIDE: [
      {
        id: 'pm_1', methodType: 'BANK_TRANSFER', displayName: '玉山銀行（訂金匯款）', qrImageUrl: '',
        bankName: '玉山銀行', bankCode: '808', accountNumber: '0912-345-678901',
        accountHolderName: '陳大山', instructions: '匯款後請提供帳號末五碼以便對帳。',
        active: true, sortOrder: 0,
      },
      {
        id: 'pm_2', methodType: 'LINE_PAY', displayName: 'LINE Pay（尾款）', qrImageUrl: '',
        bankName: '', bankCode: '', accountNumber: '', accountHolderName: '',
        instructions: '出發當天集合時結清尾款亦可。', active: true, sortOrder: 1,
      },
      {
        id: 'pm_3', methodType: 'CASH', displayName: '現場付現', qrImageUrl: '',
        bankName: '', bankCode: '', accountNumber: '', accountHolderName: '',
        instructions: '', active: true, sortOrder: 2,
      },
    ],
    CLINIC: [
      {
        id: 'pm_1', methodType: 'CASH', displayName: '現金', qrImageUrl: '',
        bankName: '', bankCode: '', accountNumber: '', accountHolderName: '',
        instructions: '看診後至櫃檯結帳。', active: true, sortOrder: 0,
      },
      {
        id: 'pm_2', methodType: 'JKOPAY', displayName: '街口支付', qrImageUrl: '',
        bankName: '', bankCode: '', accountNumber: '', accountHolderName: '',
        instructions: '', active: true, sortOrder: 1,
      },
      {
        id: 'pm_3', methodType: 'BANK_TRANSFER', displayName: '台灣銀行', qrImageUrl: '',
        bankName: '台灣銀行', bankCode: '004', accountNumber: '0987-6543-2109',
        accountHolderName: '康健診所', instructions: '', active: true, sortOrder: 2,
      },
    ],
  });

let nextMockPaymentMethodId = 1;

/** GET /api/payment-methods */
export const listPaymentMethods = () =>
  adapt<PaymentMethodRow[]>(
    () => mockRows(),
    () => request<PaymentMethodRow[]>('/api/payment-methods'),
  );

/** POST /api/payment-methods（409「每店最多 30 種收款方式」由呼叫端顯示） */
export const createPaymentMethod = (row: Omit<PaymentMethodRow, 'id'>) =>
  adapt<{ id: string }>(
    () => ({ id: `pm_new_${nextMockPaymentMethodId++}` }),
    () => request<{ id: string }>('/api/payment-methods', {
      method: 'POST',
      body: JSON.stringify(toApiPayload(row)),
    }),
  );

/** PUT /api/payment-methods/:id */
export const updatePaymentMethod = (id: string, row: Omit<PaymentMethodRow, 'id'>) =>
  adapt<void>(
    () => undefined,
    () => request<void>(`/api/payment-methods/${id}`, {
      method: 'PUT',
      body: JSON.stringify(toApiPayload(row)),
    }),
  );

/** PUT /api/payment-methods/:id —— 只切啟用狀態 */
export const setPaymentMethodActive = (id: string, active: boolean) =>
  adapt<void>(
    () => undefined,
    () => request<void>(`/api/payment-methods/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ active }),
    }),
  );

/** DELETE /api/payment-methods/:id */
export const deletePaymentMethod = (id: string) =>
  adapt<void>(
    () => undefined,
    () => request<void>(`/api/payment-methods/${id}`, { method: 'DELETE' }),
  );
