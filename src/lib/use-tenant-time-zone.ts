'use client';
import * as React from 'react';
import { useCurrentTenant } from '@/components/layout/BusinessTypeContext';
import { PUBLIC_DEFAULT_TIME_ZONE } from '@/lib/public-time-zone';
import {
  getTenantTimeZoneSnapshot,
  IDLE_SNAPSHOT,
  retryTenantTimeZone,
  subscribeTenantTimeZone,
} from '@/lib/tenant-time-zone-store';

export interface TenantTimeZoneState {
  timeZone: string;
  /** 成功取得店家時區才為 true；載入失敗時維持 false，寫入路徑不得送出。 */
  ready: boolean;
  /** 載入失敗（可 retry）。此時 timeZone 僅供顯示，暫為 Asia/Taipei。 */
  error: boolean;
  retry: () => void;
}

/**
 * 目前店家的 IANA 時區（#936）。狀態由 tenant-time-zone-store 以店家 id 為鍵共用：
 * 同店家只載入一次，所有 hook 實例（任何頁面）同步更新；失敗時自動有界重試，切換店家不會沿用舊時區。
 * `ready` 為 false 時 timeZone 暫為 Asia/Taipei（與既有預設一致，台北店家不閃動，僅供顯示）。
 * 設定載入失敗時 `ready` 維持 false、`error` 為 true，並可 `retry()`；
 * 會把時間字串轉成瞬間的表單送出前必須等 ready，避免非台北店家以錯誤時區儲存。
 */
export function useTenantTimeZoneState(): TenantTimeZoneState {
  const tenantId = useCurrentTenant()?.id ?? '';
  const subscribe = React.useCallback(
    (listener: () => void) => subscribeTenantTimeZone(tenantId, listener),
    [tenantId],
  );
  const snap = React.useSyncExternalStore(
    subscribe,
    () => getTenantTimeZoneSnapshot(tenantId),
    () => IDLE_SNAPSHOT,
  );
  const retry = React.useCallback(() => retryTenantTimeZone(tenantId), [tenantId]);
  const ready = snap.zone !== null;
  return {
    timeZone: snap.zone ?? PUBLIC_DEFAULT_TIME_ZONE,
    ready,
    error: snap.error,
    retry,
  };
}

/** 只需要時區字串的顯示用呼叫端使用（失敗時回退 Asia/Taipei 渲染）。 */
export function useTenantTimeZone(): string {
  return useTenantTimeZoneState().timeZone;
}
