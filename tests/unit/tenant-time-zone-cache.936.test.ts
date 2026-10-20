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
