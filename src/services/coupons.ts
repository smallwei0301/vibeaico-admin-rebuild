import { adapt, request } from '@/lib/api';
import type { Coupon, MembershipLevel } from '@/lib/types';

/**
 * 票券／會員等級的寫入操作（04 分冊 §B-4）。
 * 讀取（listCoupons / listMembershipLevels）維持在 src/services/catalog.ts；
 * 這裡只放 CRUD 與狀態機動作。mock 分支一律回傳 undefined（或形狀相同的空結果），
 * 頁面照舊以本地 state 模擬寫入結果，USE_MOCK=true 行為完全不變。
 */

/* ------------------------------------------------------------------ 票券 */

/** POST /api/coupons、PUT /api/coupons/:id 接受的欄位（status 走子端點，不在此） */
export type CouponPayload = {
  name: string;
  description?: string;
  discountType: Coupon['discountType'];
  discountValue?: number;
  /** 0 = 不限量 */
  totalQuantity?: number;
  /** 空字串 = 未設定／清空 */
  startAt?: string;
  endAt?: string;
};

/** 新增票券；real 回 { id }（新票券一律 DRAFT），mock 回 undefined（頁面自產本地 id） */
export const createCoupon = (payload: CouponPayload) =>
  adapt<{ id: string } | undefined>(
    () => undefined,
    () => request<{ id: string }>('/api/coupons', { method: 'POST', body: JSON.stringify(payload) }),
  );

export const updateCoupon = (id: string, payload: Partial<CouponPayload>) =>
  adapt<void>(
    () => undefined,
    () => request<void>(`/api/coupons/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  );

/** 僅 DRAFT 可刪；其他狀態後端回 409（訊息由頁面 toast 原樣顯示） */
export const deleteCoupon = (id: string) =>
  adapt<void>(
    () => undefined,
    () => request<void>(`/api/coupons/${id}`, { method: 'DELETE' }),
  );

/* ------------------------------------------------- 票券狀態機（子端點） */

export const publishCoupon = (id: string) =>
  adapt<void>(() => undefined, () => request<void>(`/api/coupons/${id}/publish`, { method: 'POST' }));

export const pauseCoupon = (id: string) =>
  adapt<void>(() => undefined, () => request<void>(`/api/coupons/${id}/pause`, { method: 'POST' }));

export const resumeCoupon = (id: string) =>
  adapt<void>(() => undefined, () => request<void>(`/api/coupons/${id}/resume`, { method: 'POST' }));

/* -------------------------------------------------------- 發放與核銷 */

/** 批次發放；real 回實際發放張數，mock 回傳選取張數（頁面行為不變） */
export const batchIssueCoupon = (id: string, customerIds: string[]) =>
  adapt<{ issued: number }>(
    () => ({ issued: customerIds.length }),
    () => request<{ issued: number }>(`/api/coupons/${id}/batch-issue`, {
      method: 'POST',
      body: JSON.stringify({ customerIds }),
    }),
  );

/** POST /api/coupons/redeem-by-code 成功時回的票券摘要 */
export type RedeemedCoupon = {
  id: string;
  couponId: string;
  couponName: string;
  /** mock 分支為 null（骨架階段沒有代碼對應的票券資料） */
  discountType: Coupon['discountType'] | null;
  discountValue: number;
  customerId: string;
  customerName: string;
};

/** 輸碼核銷；mock 回空摘要（頁面沿用「未命名／未知顧客」的現行文案組裝） */
export const redeemCouponByCode = (code: string) =>
  adapt<RedeemedCoupon>(
    () => ({
      id: '', couponId: '', couponName: '',
      discountType: null, discountValue: 0,
      customerId: '', customerName: '',
    }),
    () => request<RedeemedCoupon>('/api/coupons/redeem-by-code', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),
  );

/**
 * 發放明細單列（GET /api/coupons/instances?couponId）。
 * lib/types.ts 尚無此型別（契約檔不得改），暫放 service 層，之後可上移。
 */
export type CouponInstance = {
  id: string;
  couponId: string;
  customerId: string;
  customerName: string;
  code: string;
  issuedAt: string;
  /** null = 尚未核銷 */
  redeemedAt: string | null;
};

/** 發放明細（issued_at desc）；mock 回空陣列（骨架頁沒有明細資料） */
export const listCouponInstances = (couponId: string) =>
  adapt<CouponInstance[]>(
    () => [],
    () => request<CouponInstance[]>('/api/coupons/instances', { query: { couponId } }),
  );

/** 取消核銷（還原成未使用）；尚未核銷過後端回 409 */
export const unredeemCouponInstance = (instanceId: string) =>
  adapt<void>(
    () => undefined,
    () => request<void>(`/api/coupons/instances/${instanceId}/unredeem`, { method: 'POST' }),
  );

/* -------------------------------------------------------------- 會員等級 */

/** POST /api/membership-levels、PUT :id 接受的欄位（description/active/isDefault 後端尚無） */
export type MembershipLevelPayload = {
  name: string;
  color?: string;
  thresholdSpent?: number;
  discountPercent?: number;
  pointRateMultiplier?: number;
  sortOrder?: number;
};

/**
 * 等級 CRUD 儲存後，後端會全店重算顧客等級（customerCount 會變動），
 * 因此 real 分支寫入成功後重拉整份列表回傳給頁面更新 state；
 * mock 分支回 undefined，頁面照舊只動本地 state。
 */
const refetchLevels = () => request<MembershipLevel[]>('/api/membership-levels');

export const createMembershipLevel = (payload: MembershipLevelPayload) =>
  adapt<MembershipLevel[] | undefined>(
    () => undefined,
    async () => {
      await request<{ id: string }>('/api/membership-levels', {
        method: 'POST', body: JSON.stringify(payload),
      });
      return refetchLevels();
    },
  );

export const updateMembershipLevel = (id: string, payload: Partial<MembershipLevelPayload>) =>
  adapt<MembershipLevel[] | undefined>(
    () => undefined,
    async () => {
      await request<void>(`/api/membership-levels/${id}`, {
        method: 'PUT', body: JSON.stringify(payload),
      });
      return refetchLevels();
    },
  );

export const deleteMembershipLevel = (id: string) =>
  adapt<MembershipLevel[] | undefined>(
    () => undefined,
    async () => {
      await request<void>(`/api/membership-levels/${id}`, { method: 'DELETE' });
      return refetchLevels();
    },
  );
