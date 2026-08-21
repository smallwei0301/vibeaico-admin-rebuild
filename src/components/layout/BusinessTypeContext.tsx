'use client';
import * as React from 'react';
import type { BusinessType } from '@/config/modes';

/**
 * 目前店家的業態模式（見 docs/integration/13-BUSINESS-MODES.md）。
 * 由 AppShell 提供；頁面用 useBusinessType() 取得，只用於**名詞與顯示**，
 * 不得用它分支資料存取邏輯（那屬 modes.ts 的 preset 與後端閘門）。
 */
const BusinessTypeContext = React.createContext<BusinessType>('LOCAL_SHOP');

export const BusinessTypeProvider = BusinessTypeContext.Provider;

export const useBusinessType = () => React.useContext(BusinessTypeContext);
