import { adapt, request } from '@/lib/api';
import type { Paged } from '@/lib/types';
import { byMode } from '@/mock';

/**
 * 商品 / 庫存 / 商品訂單 — 寫入操作與頁內讀取的 service 層（04 分冊 §B-3）。
 * 讀取清單（listProducts / listProductOrders）維持在 catalog.ts，不在此重複。
 *
 * mock 分支一律模擬成功；需要伺服器計算結果的端點（toggle-line-featured、
 * adjust-stock）由呼叫端把「預期結果」帶進來，mock 直接回傳，讓頁面在兩種
 * 模式下走同一條「回傳值 → 更新 state」的路。
 */

/* ------------------------------------------------------------ 商品分類 */

/**
 * 原站 /api/product-categories。
 * `active` 曾經是「DB 沒這欄、後端一律回 true」的假值，migration 0018 補上
 * description / active 兩欄後改為照實回傳（issue #28 第 ⑨ 筆）。
 */
export type ProductCategory = {
  id: string;
  name: string;
  description?: string;
  active: boolean;
  sortOrder: number;
};

const PRODUCT_CATEGORIES_LOCAL_SHOP: ProductCategory[] = [
  { id: 'pc_1', name: '洗護', active: true, sortOrder: 1 },
  { id: 'pc_2', name: '造型', active: true, sortOrder: 2 },
  { id: 'pc_3', name: '護髮產品', active: true, sortOrder: 3 },
  { id: 'pc_4', name: '護膚產品', active: true, sortOrder: 4 },
  { id: 'pc_5', name: '美甲產品', active: false, sortOrder: 5 },
  { id: 'pc_6', name: '配件', active: true, sortOrder: 6 },
  { id: 'pc_7', name: '禮品卡', active: true, sortOrder: 7 },
];

const PRODUCT_CATEGORIES_GUIDE: ProductCategory[] = [
  { id: 'pc_1', name: '裝備', active: true, sortOrder: 1 },
  { id: 'pc_2', name: '紀念品', active: true, sortOrder: 2 },
  { id: 'pc_3', name: '戶外服飾', active: true, sortOrder: 3 },
  { id: 'pc_4', name: '露營用品', active: false, sortOrder: 4 },
  { id: 'pc_5', name: '票券／禮品卡', active: true, sortOrder: 5 },
];

const PRODUCT_CATEGORIES_CLINIC: ProductCategory[] = [
  { id: 'pc_1', name: '保健品', active: true, sortOrder: 1 },
  { id: 'pc_2', name: '衛材', active: true, sortOrder: 2 },
  { id: 'pc_3', name: '居家醫療器材', active: true, sortOrder: 3 },
  { id: 'pc_4', name: '藥妝保養', active: false, sortOrder: 4 },
  { id: 'pc_5', name: '禮品卡', active: true, sortOrder: 5 },
];

export const listProductCategories = () =>
  adapt<ProductCategory[]>(
    () => byMode({
      LOCAL_SHOP: PRODUCT_CATEGORIES_LOCAL_SHOP,
      GUIDE: PRODUCT_CATEGORIES_GUIDE,
      CLINIC: PRODUCT_CATEGORIES_CLINIC,
    }),
    () => request<ProductCategory[]>('/api/product-categories'),
  );

let nextMockCategoryId = 1;

/** POST /api/product-categories 收的欄位（sortOrder 未帶時後端取最大值+1）。 */
export type ProductCategoryInput = {
  name: string;
  description?: string;
  active?: boolean;
  sortOrder?: number;
};

/**
 * POST /api/product-categories。
 * 修改前只送 name，modal 上的「排序」與「啟用」兩個輸入純粹留在瀏覽器裡
 * （issue #28 第 ⑨ 筆）；0018 補欄位後三者都真的送出去。
 * 回傳 sortOrder＝後端實際寫入的排序值，頁面不再自己猜一個顯示。
 */
export const createProductCategory = (input: ProductCategoryInput) =>
  adapt<{ id: string; sortOrder: number }>(
    () => ({ id: `pc_new_${nextMockCategoryId++}`, sortOrder: input.sortOrder ?? 0 }),
    () => request<{ id: string; sortOrder: number }>('/api/product-categories', {
      method: 'POST', body: JSON.stringify(input),
    }),
  );

/** PUT /api/product-categories/:id — 只支援改名 */
export const updateProductCategory = (id: string, input: Partial<ProductCategoryInput>) =>
  adapt(() => undefined, () =>
    request<void>('/api/product-categories/' + id, {
      method: 'PUT', body: JSON.stringify(input),
    }));
/* ---------------------------------------------------------------- 商品 */

/** POST/PUT /api/products 收的欄位（categoryId 空字串＝未分類） */
export type ProductPayload = {
  name?: string;
  categoryId?: string;
  description?: string;
  price?: number;
  stock?: number;
  safetyStock?: number;
  imageUrl?: string;
  active?: boolean;
  lineFeatured?: boolean;
};

let nextMockProductId = 1;

export const createProduct = (payload: ProductPayload) =>
  adapt<{ id: string }>(
    () => ({ id: `p_new_${nextMockProductId++}` }),
    () => request<{ id: string }>('/api/products', {
      method: 'POST', body: JSON.stringify(payload),
    }),
  );

export const updateProduct = (id: string, payload: ProductPayload) =>
  adapt(() => undefined, () =>
    request<void>(`/api/products/${id}`, {
      method: 'PUT', body: JSON.stringify(payload),
    }));

/**
 * DELETE /api/products/:id — 商品有訂單紀錄時後端軟刪（active=false）。
 * 回應 data 可能是 { deactivated: true }（改停用）或 { deleted: true }／空
 * （真刪）；頁面依 deactivated 決定「改停用」或「從清單移除」。
 */
export const deleteProduct = (id: string) =>
  adapt<{ deactivated?: boolean; deleted?: boolean } | undefined>(
    () => undefined,
    () => request<{ deactivated?: boolean; deleted?: boolean } | undefined>(
      `/api/products/${id}`, { method: 'DELETE' },
    ),
  );

/** POST /api/products/reorder — 依 ids 順序寫 sort_order（LINE 精選排序） */
export const reorderProducts = (ids: string[]) =>
  adapt(() => undefined, () =>
    request<void>('/api/products/reorder', {
      method: 'POST', body: JSON.stringify({ ids }),
    }));

/**
 * POST /api/products/:id/toggle-line-featured — 後端取反並回傳最新值。
 * mock 分支回傳呼叫端算好的 next（頁面已知目前值，取反即是）。
 */
export const toggleProductLineFeatured = (id: string, next: boolean) =>
  adapt<{ lineFeatured: boolean }>(
    () => ({ lineFeatured: next }),
    () => request<{ lineFeatured: boolean }>(
      `/api/products/${id}/toggle-line-featured`, { method: 'POST' },
    ),
  );

/**
 * POST /api/products/:id/adjust-stock — `{delta, reason}` 回 `{stock}`。
 * 調整後 < 0 時後端回 409（message 例：「庫存不足，調整後庫存不可小於 0」）。
 * mock 分支回傳呼叫端算好的 mockStockAfter。
 */
export const adjustProductStock = (
  id: string,
  payload: { delta: number; reason: string },
  mockStockAfter: number,
) =>
  adapt<{ stock: number }>(
    () => ({ stock: mockStockAfter }),
    () => request<{ stock: number }>(`/api/products/${id}/adjust-stock`, {
      method: 'POST', body: JSON.stringify(payload),
    }),
  );

/* ------------------------------------------------------------ 庫存異動 */

export type InventoryLogType =
  | 'PURCHASE_IN' | 'SALE_OUT' | 'STOCKTAKE' | 'MANUAL'
  | 'DAMAGE' | 'RETURN_IN' | 'ORDER_CANCELLED';

/** 原站 /api/inventory/logs（operator DB 未落地，後端一律回 null） */
export type InventoryLog = {
  id: string;
  createdAt: string;
  productId: string;
  productName: string;
  type: InventoryLogType;
  /** 正數＝入庫，負數＝出庫 */
  quantity: number;
  stockBefore: number;
  stockAfter: number;
  reason: string;
  operator: string | null;
};

const INVENTORY_LOGS_LOCAL_SHOP: InventoryLog[] = [
  {
    id: 'il_1', createdAt: '2026-08-20T09:12:00+08:00',
    productId: 'p_1', productName: '修護洗髮精 500ml',
    type: 'SALE_OUT', quantity: -1, stockBefore: 25, stockAfter: 24,
    reason: '訂單 PO20260820001', operator: null,
  },
  {
    id: 'il_2', createdAt: '2026-08-19T16:40:00+08:00',
    productId: 'p_2', productName: '護髮油 100ml',
    type: 'SALE_OUT', quantity: -2, stockBefore: 6, stockAfter: 4,
    reason: '訂單 PO20260819004', operator: null,
  },
  {
    id: 'il_3', createdAt: '2026-08-18T11:05:00+08:00',
    productId: 'p_1', productName: '修護洗髮精 500ml',
    type: 'PURCHASE_IN', quantity: 12, stockBefore: 13, stockAfter: 25,
    reason: '進貨補充', operator: '小威',
  },
  {
    id: 'il_4', createdAt: '2026-08-17T18:22:00+08:00',
    productId: 'p_3', productName: '定型噴霧',
    type: 'STOCKTAKE', quantity: -3, stockBefore: 43, stockAfter: 40,
    reason: '盤點調整', operator: 'Amy',
  },
  {
    id: 'il_5', createdAt: '2026-08-16T10:30:00+08:00',
    productId: 'p_2', productName: '護髮油 100ml',
    type: 'DAMAGE', quantity: -1, stockBefore: 7, stockAfter: 6,
    reason: '損耗報廢', operator: 'Ben',
  },
  {
    id: 'il_6', createdAt: '2026-08-15T14:02:00+08:00',
    productId: 'p_1', productName: '修護洗髮精 500ml',
    type: 'RETURN_IN', quantity: 1, stockBefore: 12, stockAfter: 13,
    reason: '退貨入庫', operator: 'Amy',
  },
  {
    id: 'il_7', createdAt: '2026-08-14T20:15:00+08:00',
    productId: 'p_3', productName: '定型噴霧',
    type: 'ORDER_CANCELLED', quantity: 2, stockBefore: 41, stockAfter: 43,
    reason: '訂單取消', operator: null,
  },
  {
    id: 'il_8', createdAt: '2026-08-13T09:48:00+08:00',
    productId: 'p_2', productName: '護髮油 100ml',
    type: 'MANUAL', quantity: -2, stockBefore: 9, stockAfter: 7,
    reason: '手動調整', operator: '小威',
  },
];

const INVENTORY_LOGS_GUIDE: InventoryLog[] = [
  {
    id: 'il_1', createdAt: '2026-08-20T09:12:00+08:00',
    productId: 'p_1', productName: '防水袋 20L',
    type: 'SALE_OUT', quantity: -2, stockBefore: 20, stockAfter: 18,
    reason: '訂單 PO20260820011', operator: null,
  },
  {
    id: 'il_2', createdAt: '2026-08-19T16:40:00+08:00',
    productId: 'p_3', productName: '祕島明信片組（6 入）',
    type: 'SALE_OUT', quantity: -12, stockBefore: 72, stockAfter: 60,
    reason: '訂單 PO20260819008', operator: null,
  },
  {
    id: 'il_3', createdAt: '2026-08-18T11:05:00+08:00',
    productId: 'p_2', productName: '寬簷防曬帽',
    type: 'PURCHASE_IN', quantity: 3, stockBefore: 0, stockAfter: 3,
    reason: '進貨補充', operator: '小威',
  },
  {
    id: 'il_4', createdAt: '2026-08-17T18:22:00+08:00',
    productId: 'p_4', productName: '手繪路線地圖',
    type: 'STOCKTAKE', quantity: -5, stockBefore: 5, stockAfter: 0,
    reason: '盤點調整', operator: '阿海',
  },
  {
    id: 'il_5', createdAt: '2026-08-16T10:30:00+08:00',
    productId: 'p_1', productName: '防水袋 20L',
    type: 'DAMAGE', quantity: -1, stockBefore: 19, stockAfter: 18,
    reason: '出團途中破損', operator: '小雨',
  },
  {
    id: 'il_6', createdAt: '2026-08-15T14:02:00+08:00',
    productId: 'p_3', productName: '祕島明信片組（6 入）',
    type: 'RETURN_IN', quantity: 6, stockBefore: 54, stockAfter: 60,
    reason: '退貨入庫', operator: '阿海',
  },
  {
    id: 'il_7', createdAt: '2026-08-14T20:15:00+08:00',
    productId: 'p_2', productName: '寬簷防曬帽',
    type: 'ORDER_CANCELLED', quantity: 1, stockBefore: 2, stockAfter: 3,
    reason: '訂單取消', operator: null,
  },
  {
    id: 'il_8', createdAt: '2026-08-13T09:48:00+08:00',
    productId: 'p_1', productName: '防水袋 20L',
    type: 'MANUAL', quantity: -1, stockBefore: 19, stockAfter: 18,
    reason: '手動調整', operator: '小威',
  },
];

const INVENTORY_LOGS_CLINIC: InventoryLog[] = [
  {
    id: 'il_1', createdAt: '2026-08-20T09:12:00+08:00',
    productId: 'p_1', productName: '綜合維他命（90 錠）',
    type: 'SALE_OUT', quantity: -2, stockBefore: 34, stockAfter: 32,
    reason: '訂單 PO20260820021', operator: null,
  },
  {
    id: 'il_2', createdAt: '2026-08-19T16:40:00+08:00',
    productId: 'p_2', productName: '益生菌沖劑（30 包）',
    type: 'SALE_OUT', quantity: -1, stockBefore: 7, stockAfter: 6,
    reason: '訂單 PO20260819018', operator: null,
  },
  {
    id: 'il_3', createdAt: '2026-08-18T11:05:00+08:00',
    productId: 'p_1', productName: '綜合維他命（90 錠）',
    type: 'PURCHASE_IN', quantity: 24, stockBefore: 10, stockAfter: 34,
    reason: '進貨補充', operator: '小威',
  },
  {
    id: 'il_4', createdAt: '2026-08-17T18:22:00+08:00',
    productId: 'p_3', productName: '醫用口罩（50 入）',
    type: 'STOCKTAKE', quantity: -3, stockBefore: 7, stockAfter: 4,
    reason: '盤點調整', operator: '護理師 小美',
  },
  {
    id: 'il_5', createdAt: '2026-08-16T10:30:00+08:00',
    productId: 'p_2', productName: '益生菌沖劑（30 包）',
    type: 'DAMAGE', quantity: -1, stockBefore: 8, stockAfter: 7,
    reason: '包裝破損報廢', operator: '護理師 小美',
  },
  {
    id: 'il_6', createdAt: '2026-08-15T14:02:00+08:00',
    productId: 'p_1', productName: '綜合維他命（90 錠）',
    type: 'RETURN_IN', quantity: 2, stockBefore: 8, stockAfter: 10,
    reason: '退貨入庫', operator: '護理師 小美',
  },
  {
    id: 'il_7', createdAt: '2026-08-14T20:15:00+08:00',
    productId: 'p_3', productName: '醫用口罩（50 入）',
    type: 'ORDER_CANCELLED', quantity: 2, stockBefore: 5, stockAfter: 7,
    reason: '訂單取消', operator: null,
  },
  {
    id: 'il_8', createdAt: '2026-08-13T09:48:00+08:00',
    productId: 'p_2', productName: '益生菌沖劑（30 包）',
    type: 'MANUAL', quantity: -1, stockBefore: 9, stockAfter: 8,
    reason: '手動調整', operator: '小威',
  },
];

export type InventoryLogQuery = { productId?: string; page?: number; size?: number };

/** GET /api/inventory/logs — `?productId?&page&size`，Paged 信封，created_at desc */
export function listInventoryLogs(q: InventoryLogQuery = {}): Promise<Paged<InventoryLog>> {
  return adapt(
    () => {
      const page = q.page ?? 0, size = q.size ?? 20;
      let rows = byMode({
        LOCAL_SHOP: INVENTORY_LOGS_LOCAL_SHOP,
        GUIDE: INVENTORY_LOGS_GUIDE,
        CLINIC: INVENTORY_LOGS_CLINIC,
      });
      if (q.productId) rows = rows.filter((l) => l.productId === q.productId);
      return {
        content: rows.slice(page * size, (page + 1) * size),
        totalElements: rows.length,
        totalPages: Math.ceil(rows.length / size),
        number: page,
        size,
      };
    },
    () => request<Paged<InventoryLog>>('/api/inventory/logs', {
      query: q as Record<string, string | number | undefined>,
    }),
  );
}

/* ------------------------------------------------------------ 商品訂單 */

let nextMockOrderId = 1;

/**
 * POST /api/product-orders/manual — `{customerId, items:[{productId, quantity}]}`
 * 回 `{id, orderNo}`。庫存不足時後端回 409（message 例：「『X』庫存不足，
 * 無法建立訂單」），頁面原樣顯示。
 */
export const createManualProductOrder = (payload: {
  customerId: string;
  items: { productId: string; quantity: number }[];
}) =>
  adapt<{ id: string; orderNo: string }>(
    () => ({ id: `po_new_${nextMockOrderId++}`, orderNo: `PO${Date.now()}` }),
    () => request<{ id: string; orderNo: string }>('/api/product-orders/manual', {
      method: 'POST', body: JSON.stringify(payload),
    }),
  );

/** 狀態機（同 bookings 模式）：條件不符時後端回 409「此訂單狀態已變更」 */
export const confirmProductOrder = (id: string) =>
  adapt(() => undefined, () =>
    request<void>(`/api/product-orders/${id}/confirm`, { method: 'POST' }));

export const completeProductOrder = (id: string) =>
  adapt(() => undefined, () =>
    request<void>(`/api/product-orders/${id}/complete`, { method: 'POST' }));

/** 取消並回補庫存（reason 目前後端未落地儲存，仍隨 body 送出以備擴充） */
export const cancelProductOrder = (id: string, reason?: string) =>
  adapt(() => undefined, () =>
    request<void>(`/api/product-orders/${id}/cancel`, {
      method: 'POST', body: JSON.stringify({ reason }),
    }));

export const markProductOrderPaidOffline = (id: string) =>
  adapt(() => undefined, () =>
    request<void>(`/api/product-orders/${id}/mark-paid-offline`, { method: 'POST' }));
