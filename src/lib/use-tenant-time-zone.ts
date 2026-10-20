'use client';
import * as React from 'react';
import { useCurrentTenant } from '@/components/layout/BusinessTypeContext';
import { PUBLIC_DEFAULT_TIME_ZONE } from '@/lib/public-time-zone';
import { getTenantTimeZone } from '@/services/settings';

/**
 * 目前店家的 IANA 時區（#936）。快取以店家 id 為鍵（見 getTenantTimeZone），切換店家不會沿用舊時區。
 * `ready` 為 false 時 timeZone 暫為 Asia/Taipei（與既有預設一致，台北店家不閃動）；
 * 設定載入失敗時 service 會回退 Asia/Taipei，因此 `ready` 仍會變 true（不會永遠卡住）。
 * 會把時間字串轉成瞬間的表單送出前應等 ready，避免以錯誤時區儲存。
 */
export function useTenantTimeZoneState(): { timeZone: string; ready: boolean } {
  const tenantId = useCurrentTenant()?.id ?? '';
  const [state, setState] = React.useState<{ id: string; zone: string } | null>(null);
  React.useEffect(() => {
    let alive = true;
    getTenantTimeZone(tenantId).then((zone) => { if (alive) setState({ id: tenantId, zone }); });
    return () => { alive = false; };
  }, [tenantId]);
  const ready = state !== null && state.id === tenantId;
  return { timeZone: ready ? state.zone : PUBLIC_DEFAULT_TIME_ZONE, ready };
}

/** 只需要時區字串的顯示用呼叫端使用。 */
export function useTenantTimeZone(): string {
  return useTenantTimeZoneState().timeZone;
}
