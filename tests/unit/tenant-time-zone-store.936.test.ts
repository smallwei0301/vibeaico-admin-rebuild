import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

describe('#936 共用店家時區 store（Codex P2）', () => {
  let req: ReturnType<typeof vi.fn>;
  let store: typeof import('@/lib/tenant-time-zone-store');
  let settings: typeof import('@/services/settings');

  const setup = async (r: ReturnType<typeof vi.fn>) => {
    req = r;
    vi.resetModules();
    vi.doMock('@/lib/api', async (orig) => {
      const actual = await orig<typeof import('@/lib/api')>();
      return { ...actual, adapt: (_m: unknown, real: () => Promise<unknown>) => real(), request: req };
    });
    store = await import('@/lib/tenant-time-zone-store');
    settings = await import('@/services/settings');
  };

  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { store?.__resetTenantTimeZoneStoreForTest(); vi.useRealTimers(); vi.doUnmock('@/lib/api'); });

  it('成功：多個訂閱者同步更新且只發一次請求', async () => {
    await setup(vi.fn().mockResolvedValue({ basic: { timezone: 'Asia/Tokyo' } }));
    const a = vi.fn(); const b = vi.fn();
    store.subscribeTenantTimeZone('t', a);
    store.subscribeTenantTimeZone('t', b);
    await flush();
    expect(store.getTenantTimeZoneSnapshot('t')).toMatchObject({ zone: 'Asia/Tokyo', error: false });
    expect(a).toHaveBeenCalled(); expect(b).toHaveBeenCalled();
    expect(req).toHaveBeenCalledTimes(1);
  });

  it('失敗：zone 為 null（不 ready）、error=true', async () => {
    await setup(vi.fn().mockRejectedValue(new Error('net')));
    store.subscribeTenantTimeZone('t', () => {});
    await flush();
    expect(store.getTenantTimeZoneSnapshot('t')).toMatchObject({ zone: null, error: true });
  });

  it('一個實例 retry 成功，另一個（顯示用）實例同步取得真實時區', async () => {
    await setup(vi.fn().mockRejectedValueOnce(new Error('net')).mockResolvedValue({ basic: { timezone: 'Asia/Tokyo' } }));
    const display = vi.fn();
    store.subscribeTenantTimeZone('t', () => {}); // modal 實例
    store.subscribeTenantTimeZone('t', display);   // 顯示用實例
    await flush();
    expect(store.getTenantTimeZoneSnapshot('t').error).toBe(true);
    store.retryTenantTimeZone('t');
    await flush();
    expect(store.getTenantTimeZoneSnapshot('t').zone).toBe('Asia/Tokyo');
    expect(display).toHaveBeenCalled();
  });

  it('自動重試：不需使用者操作即恢復', async () => {
    await setup(vi.fn().mockRejectedValueOnce(new Error('net')).mockResolvedValue({ basic: { timezone: 'Asia/Tokyo' } }));
    store.subscribeTenantTimeZone('t', () => {});
    await flush();
    expect(store.getTenantTimeZoneSnapshot('t').zone).toBeNull();
    await vi.advanceTimersByTimeAsync(2000);
    await flush();
    expect(store.getTenantTimeZoneSnapshot('t')).toMatchObject({ zone: 'Asia/Tokyo', error: false });
  });

  it('自動重試有界：2s／5s／15s 後停止，仍不 ready', async () => {
    await setup(vi.fn().mockRejectedValue(new Error('net')));
    store.subscribeTenantTimeZone('t', () => {});
    await flush();
    await vi.advanceTimersByTimeAsync(2000); await flush();
    await vi.advanceTimersByTimeAsync(5000); await flush();
    await vi.advanceTimersByTimeAsync(15000); await flush();
    expect(req).toHaveBeenCalledTimes(4); // 初次 + 3 次重試
    await vi.advanceTimersByTimeAsync(120000); await flush();
    expect(req).toHaveBeenCalledTimes(4);
    expect(store.getTenantTimeZoneSnapshot('t')).toMatchObject({ zone: null, error: true });
  });

  it('全部取消訂閱後不再排程重試', async () => {
    await setup(vi.fn().mockRejectedValue(new Error('net')));
    const off = store.subscribeTenantTimeZone('t', () => {});
    await flush();
    off();
    await vi.advanceTimersByTimeAsync(60000); await flush();
    expect(req).toHaveBeenCalledTimes(1);
  });

  it('店家之間互不影響', async () => {
    await setup(vi.fn().mockResolvedValue({ basic: { timezone: 'Asia/Tokyo' } }));
    store.subscribeTenantTimeZone('a', () => {});
    await flush();
    expect(store.getTenantTimeZoneSnapshot('a').zone).toBe('Asia/Tokyo');
    expect(store.getTenantTimeZoneSnapshot('b').zone).toBeNull();
  });

  it('saveTenantSettings 清快取後，有訂閱者的店家重新載入新時區', async () => {
    const r = vi.fn().mockResolvedValue({ basic: { timezone: 'Asia/Tokyo' } });
    await setup(r);
    store.subscribeTenantTimeZone('t', () => {});
    await flush();
    r.mockResolvedValue({ basic: { timezone: 'Europe/London' } });
    await settings.saveTenantSettings({ basic: { timezone: 'Europe/London' } } as never);
    await flush();
    expect(store.getTenantTimeZoneSnapshot('t').zone).toBe('Europe/London');
  });
});
