import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf8');

describe('#936 getTenantTimeZone 以店家 id 為快取鍵', () => {
  beforeEach(() => { vi.resetModules(); });

  it('不同店家各自取得時區，同店家重複呼叫共用快取', async () => {
    const mod = await import('@/services/settings');
    const a1 = await mod.getTenantTimeZone('tenant-a');
    const a2 = await mod.getTenantTimeZone('tenant-a');
    const b = await mod.getTenantTimeZone('tenant-b');
    expect(a1).toBe(a2);
    expect(typeof b).toBe('string');
  });

  it('hook 以 useCurrentTenant().id 呼叫、並暴露 ready', () => {
    const hook = src('src/lib/use-tenant-time-zone.ts');
    expect(hook).toContain('getTenantTimeZone(tenantId)');
    expect(hook).toContain('ready');
  });
});

describe('#936 預約表單：時區未就緒不可送出、時區晚到不洗掉輸入', () => {
  const page = src('src/app/tenant/bookings/page.tsx');
  it('送出鈕在 tz 未就緒時 disabled，submit 也擋', () => {
    expect(page).toContain('disabled={!tzReady}');
    expect(page).toContain('if (err || !tzReady) return;');
  });
  it('重設 effect 不再依賴 tz；日期時間未改時沿用原 startAt', () => {
    expect(page).toContain('}, [open, booking]);');
    expect(page).not.toContain('}, [open, booking, tz]);');
    expect(page).toContain('booking.startAt : zonedLocalToIso(');
  });
});

describe('#936 載入失敗不可視為 ready（Codex P1）', () => {
  beforeEach(() => { vi.resetModules(); vi.doUnmock('@/lib/api'); });

  const loadWithRequest = async (req: ReturnType<typeof vi.fn>) => {
    vi.doMock('@/lib/api', async (orig) => {
      const actual = await orig<typeof import('@/lib/api')>();
      return { ...actual, adapt: (_m: unknown, real: () => Promise<unknown>) => real(), request: req };
    });
    return import('@/services/settings');
  };

  it('失敗時 reject、不快取；重試成功取得店家時區；成功後共用快取', async () => {
    const req = vi.fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue({ basic: { timezone: 'Asia/Tokyo' } });
    const mod = await loadWithRequest(req);
    await expect(mod.getTenantTimeZone('t1')).rejects.toThrow('network');
    await expect(mod.getTenantTimeZone('t1')).resolves.toBe('Asia/Tokyo');
    await expect(mod.getTenantTimeZone('t1')).resolves.toBe('Asia/Tokyo');
    expect(req).toHaveBeenCalledTimes(2);
  });

  it('成功但缺值回退 Asia/Taipei（仍視為成功載入）', async () => {
    const mod = await loadWithRequest(vi.fn().mockResolvedValue({ basic: {} }));
    await expect(mod.getTenantTimeZone('t2')).resolves.toBe('Asia/Taipei');
  });

  it('hook 暴露 error／retry，失敗時 ready 不為 true；顯示仍回退台北', () => {
    const hook = src('src/lib/use-tenant-time-zone.ts');
    expect(hook).toContain('error:');
    expect(hook).toContain('retry');
    expect(hook).toContain('const ready = current?.zone != null;');
    expect(hook).toContain('current?.zone ?? PUBLIC_DEFAULT_TIME_ZONE');
  });

  it('預約表單：error 時顯示 i18n 訊息與重試鈕，且送出仍被 !tzReady 擋住', () => {
    const page = src('src/app/tenant/bookings/page.tsx');
    expect(page).toContain('tzError ?');
    expect(page).toContain('t.messages.timeZoneLoadFailed');
    expect(page).toContain('onClick={tzRetry}');
    expect(page).toContain('disabled={!tzReady}');
    expect(page).toContain('if (err || !tzReady) return;');
  });

  it('顯示專用呼叫端（tour-orders）仍只用 useTenantTimeZone', () => {
    expect(src('src/app/tenant/tour-orders/page.tsx')).toContain('useTenantTimeZone()');
  });
});
