import { getTenantTimeZone, onTenantTimeZoneCacheCleared } from '@/services/settings';

/**
 * 店家時區的共用狀態（#936，Codex P2）。以店家 id 為鍵、模組層級單例：
 * - 每店家同時只有一個進行中的載入；成功或失敗都會通知所有訂閱的 hook 實例（任何頁面）。
 * - 載入失敗時 zone 為 null（ready=false、error=true）；任一實例 retry() 會重新觸發共用載入。
 * - 純顯示的呼叫端（無法自行 retry）靠有界的自動重試恢復：2s、5s、15s 後停止；
 *   另外在瀏覽器 online／focus 時，對失敗中的店家再試一輪（重置計數）。
 * - saveTenantSettings 清快取後，已有訂閱者的店家會重新載入，沒有訂閱者的直接丟棄。
 * 本檔無 React 依賴，可在 node 環境直接測試；由 'use client' 的 hook 透過 useSyncExternalStore 消費。
 */

export interface TenantTimeZoneSnapshot {
  /** 成功取得才有值；載入中或失敗為 null。 */
  zone: string | null;
  loading: boolean;
  error: boolean;
}

/** 失敗後的自動重試間隔（毫秒）；用完即停，之後只靠 retry()／online／focus。 */
export const TIME_ZONE_RETRY_DELAYS_MS: readonly number[] = [2000, 5000, 15000];

interface Entry {
  snap: TenantTimeZoneSnapshot;
  listeners: Set<() => void>;
  inFlight: boolean;
  /** 每次重新載入遞增，讓過期的回應被忽略。 */
  generation: number;
  attempts: number;
  timer: ReturnType<typeof setTimeout> | null;
}

export const IDLE_SNAPSHOT: TenantTimeZoneSnapshot = Object.freeze({ zone: null, loading: true, error: false });

const entries = new Map<string, Entry>();
let windowHooked = false;

const getEntry = (tenantId: string): Entry => {
  let e = entries.get(tenantId);
  if (!e) {
    e = { snap: IDLE_SNAPSHOT, listeners: new Set(), inFlight: false, generation: 0, attempts: 0, timer: null };
    entries.set(tenantId, e);
  }
  return e;
};

const publish = (e: Entry, snap: TenantTimeZoneSnapshot) => {
  e.snap = snap;
  [...e.listeners].forEach((fn) => fn());
};

const clearTimer = (e: Entry) => {
  if (e.timer !== null) { clearTimeout(e.timer); e.timer = null; }
};

const load = (tenantId: string) => {
  const e = getEntry(tenantId);
  if (e.inFlight) return;
  clearTimer(e);
  e.inFlight = true;
  const gen = ++e.generation;
  if (e.snap.zone !== null || e.snap.error) publish(e, IDLE_SNAPSHOT);
  getTenantTimeZone(tenantId).then(
    (zone) => {
      if (gen !== e.generation) return;
      e.inFlight = false;
      e.attempts = 0;
      publish(e, { zone, loading: false, error: false });
    },
    () => {
      if (gen !== e.generation) return;
      e.inFlight = false;
      publish(e, { zone: null, loading: false, error: true });
      scheduleRetry(tenantId, e);
    },
  );
};

const scheduleRetry = (tenantId: string, e: Entry) => {
  if (e.listeners.size === 0 || e.attempts >= TIME_ZONE_RETRY_DELAYS_MS.length) return;
  const delay = TIME_ZONE_RETRY_DELAYS_MS[e.attempts];
  e.attempts += 1;
  clearTimer(e);
  e.timer = setTimeout(() => {
    e.timer = null;
    if (e.listeners.size > 0 && e.snap.error) load(tenantId);
  }, delay);
};

/** 對所有「失敗且有訂閱者」的店家重新開始一輪（計數歸零）。 */
const retryFailed = () => {
  entries.forEach((e, id) => {
    if (e.listeners.size > 0 && e.snap.error && !e.inFlight) { e.attempts = 0; load(id); }
  });
};

const hookWindow = () => {
  if (windowHooked || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  windowHooked = true;
  window.addEventListener('online', retryFailed);
  window.addEventListener('focus', retryFailed);
};

onTenantTimeZoneCacheCleared(() => {
  entries.forEach((e, id) => {
    if (e.listeners.size > 0) {
      e.generation += 1; // 丟棄進行中的舊回應
      e.inFlight = false;
      e.attempts = 0;
      load(id);
    } else {
      clearTimer(e);
      entries.delete(id);
    }
  });
});

export const getTenantTimeZoneSnapshot = (tenantId: string): TenantTimeZoneSnapshot =>
  entries.get(tenantId)?.snap ?? IDLE_SNAPSHOT;

export const subscribeTenantTimeZone = (tenantId: string, listener: () => void): (() => void) => {
  const e = getEntry(tenantId);
  e.listeners.add(listener);
  hookWindow();
  if (e.snap.zone === null && !e.inFlight) {
    if (e.snap.error) { if (e.timer === null) { e.attempts = 0; load(tenantId); } } else load(tenantId);
  }
  return () => {
    e.listeners.delete(listener);
    if (e.listeners.size === 0) clearTimer(e);
  };
};

/** 任一實例都可觸發；重置自動重試計數並重新載入共用狀態。 */
export const retryTenantTimeZone = (tenantId: string) => {
  const e = getEntry(tenantId);
  if (e.inFlight) return;
  e.attempts = 0;
  load(tenantId);
};

/** 僅供測試：清除全部狀態與計時器。 */
export const __resetTenantTimeZoneStoreForTest = () => {
  entries.forEach(clearTimer);
  entries.clear();
};
