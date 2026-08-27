'use client';
import * as React from 'react';
import type { BusinessType } from '@/config/modes';
import type { TenantSummary } from '@/lib/types';

/**
 * 目前店家的業態模式（見 docs/integration/13-BUSINESS-MODES.md）。
 * 由 AppShell 提供；頁面用 useBusinessType() 取得，只用於**名詞與顯示**，
 * 不得用它分支資料存取邏輯（那屬 modes.ts 的 preset 與後端閘門）。
 */
const BusinessTypeContext = React.createContext<BusinessType>('LOCAL_SHOP');

export const BusinessTypeProvider = BusinessTypeContext.Provider;

export const useBusinessType = () => React.useContext(BusinessTypeContext);

/**
 * 目前操作的店家（真實後端對應 GET /api/auth/me）。
 *
 * ⚠️ context 的預設值刻意是**空店家**，不是 `MOCK_TENANTS[0]`（issue #34）：
 * 預設值只有在「沒有 Provider」時才會被讀到，那種情況下畫面該顯示的是空白，
 * 而不是一家叫「小威美髮沙龍」的假店——real 模式下那會是一個看起來完全正常、
 * 卻與登入者無關的店名。實際值一律由 `AppShell` 的 `CurrentTenantProvider` 提供。
 */
const EMPTY_TENANT: TenantSummary = {
  id: '', shopCode: '', name: '', role: 'STAFF', current: true, businessType: 'LOCAL_SHOP',
};

const CurrentTenantContext = React.createContext<TenantSummary>(EMPTY_TENANT);

export const CurrentTenantProvider = CurrentTenantContext.Provider;

export const useCurrentTenant = () => React.useContext(CurrentTenantContext);
