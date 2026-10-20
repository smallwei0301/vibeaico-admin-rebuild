'use client';
import * as React from 'react';
import { PUBLIC_DEFAULT_TIME_ZONE } from '@/lib/public-time-zone';
import { getTenantTimeZone } from '@/services/settings';

/**
 * 目前店家的 IANA 時區（#936）。載入前與失敗時為 Asia/Taipei，與既有預設一致，
 * 因此台北店家不會看到閃動；資料經 src/services 取得，頁面不自行 fetch。
 */
export function useTenantTimeZone(): string {
  const [zone, setZone] = React.useState<string>(PUBLIC_DEFAULT_TIME_ZONE);
  React.useEffect(() => {
    let alive = true;
    getTenantTimeZone().then((z) => { if (alive) setZone(z); });
    return () => { alive = false; };
  }, []);
  return zone;
}
