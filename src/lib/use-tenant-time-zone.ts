'use client';
import * as React from 'react';
import { useCurrentTenant } from '@/components/layout/BusinessTypeContext';
import { PUBLIC_DEFAULT_TIME_ZONE } from '@/lib/public-time-zone';
import { getTenantTimeZone } from '@/services/settings';

export interface TenantTimeZoneState {
  timeZone: string;
  /** 成功取得店家時區才為 true；載入失敗時維持 false，寫入路徑不得送出。 */
  ready: boolean;
  /** 載入失敗（可 retry）。此時 timeZone 僅供顯示，暫為 Asia/Taipei。 */
  error: boolean;
  retry: () => void;
}

/**
 * 目前店家的 IANA 時區（#936）。快取以店家 id 為鍵（見 getTenantTimeZone），切換店家不會沿用舊時區。
 * `ready` 為 false 時 timeZone 暫為 Asia/Taipei（與既有預設一致，台北店家不閃動，僅供顯示）。
 * 設定載入失敗時 `ready` 維持 false、`error` 為 true，並可 `retry()`；
 * 會把時間字串轉成瞬間的表單送出前必須等 ready，避免非台北店家以錯誤時區儲存。
 */
export function useTenantTimeZoneState(): TenantTimeZoneState {
  const tenantId = useCurrentTenant()?.id ?? '';
  const [state, setState] = React.useState<{ id: string; zone: string | null } | null>(null);
  const [attempt, setAttempt] = React.useState(0);
  React.useEffect(() => {
    let alive = true;
    getTenantTimeZone(tenantId).then(
      (zone) => { if (alive) setState({ id: tenantId, zone }); },
      () => { if (alive) setState({ id: tenantId, zone: null }); },
    );
    return () => { alive = false; };
  }, [tenantId, attempt]);
  const retry = React.useCallback(() => {
    setState(null);
    setAttempt((n) => n + 1);
  }, []);
  const current = state !== null && state.id === tenantId ? state : null;
  const ready = current?.zone != null;
  return {
    timeZone: current?.zone ?? PUBLIC_DEFAULT_TIME_ZONE,
    ready,
    error: current !== null && current.zone === null,
    retry,
  };
}

/** 只需要時區字串的顯示用呼叫端使用（失敗時回退 Asia/Taipei 渲染）。 */
export function useTenantTimeZone(): string {
  return useTenantTimeZoneState().timeZone;
}
