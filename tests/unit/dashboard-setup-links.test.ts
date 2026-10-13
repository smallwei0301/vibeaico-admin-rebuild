// 儀表板「設定進度」未完成項可點進對應設定頁：每個 step key 在每個模式的目標
// 必須是真實存在的 src/app/tenant/** 頁面（或明確為 null 的隱藏頁）。
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BUSINESS_TYPES, MODE_PRESETS, type SetupStepKey } from '@/config/modes';
import { getSetupStepHref } from '@/lib/setup-step-routes';

const loadPublicShopMock = vi.hoisted(() => vi.fn());
// 用普通函式包一層：vi.fn 對丟錯／reject 的呼叫會留下未處理的追蹤錯誤，使「錯誤往上傳」的測試誤判失敗。
vi.mock('@/server/public-shop', () => ({
  loadPublicShop: (code: string) => {
    const r = loadPublicShopMock(code);
    return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
  },
}));

const root = (rel: string) => fileURLToPath(new URL(`../../${rel}`, import.meta.url));
const STEP_KEYS: SetupStepKey[] = ['SHOP_INFO', 'STAFF', 'SERVICE', 'BUSINESS_HOURS', 'LINE_BOT'];

describe('setup step routes', () => {
  for (const mode of BUSINESS_TYPES) {
    for (const key of STEP_KEYS) {
      it(`${mode}/${key} maps to an existing tenant page`, () => {
        const href = getSetupStepHref(key, mode);
        expect(href).not.toBeNull();
        if (href === null) throw new Error('unexpected null href');
        const path = href.split('#')[0];
        expect(path.startsWith('/tenant/')).toBe(true);
        expect(existsSync(root(`src/app${path}/page.tsx`))).toBe(true);
      });
    }
  }

  it('settings hashes are tabs the settings page already understands', () => {
    const settings = readFileSync(root('src/app/tenant/settings/page.tsx'), 'utf8');
    expect(settings).toContain("'#basic': 'basic'");
    expect(settings).toContain("'#business': 'business'");
    expect(getSetupStepHref('BUSINESS_HOURS', 'LOCAL_SHOP')).toBe('/tenant/settings#business');
  });

  it('dashboard renders Link for undone steps with accessible name', () => {
    const page = readFileSync(root('src/app/tenant/dashboard/page.tsx'), 'utf8');
    expect(page).toContain('getSetupStepHref(s.key, businessType)');
    expect(page).toMatch(/<Link\s+href=\{href\}\s+aria-label=\{t\.setup\.goSetupLabel\(stepLabel\)\}/);
    expect(page).toContain('min-h-11');
  });

  it('GUIDE SERVICE uses public bookable plans and links to a page visible in GUIDE nav', () => {
    expect(MODE_PRESETS.GUIDE.setupInventory).toEqual({ kind: 'publicBookablePlans' });
    const services = { kind: 'table', table: 'services', filter: { column: 'active', value: true } };
    expect(MODE_PRESETS.LOCAL_SHOP.setupInventory).toEqual(services);
    expect(MODE_PRESETS.CLINIC.setupInventory).toEqual(services);
    expect(getSetupStepHref('SERVICE', 'GUIDE')).toBe('/tenant/trips');
    expect(MODE_PRESETS.GUIDE.hiddenNavKeys).not.toContain('trips');
  });

  it('setup-status route reads the inventory table from the preset', () => {
    const route = readFileSync(root('src/app/api/settings/setup-status/route.ts'), 'utf8');
    expect(route).toContain('countSetupInventory(t.supabase, t.tenantId, t.businessType, t.shopCode)');
    expect(route).not.toContain("'GUIDE'");
    const helper = readFileSync(root('src/server/setup-inventory.ts'), 'utf8');
    expect(helper).toContain('MODE_PRESETS[businessType].setupInventory');
  });

  it('preset filters match what the public shop lists (draft trips never count)', () => {
    const shop = readFileSync(root('src/server/public-shop.ts'), 'utf8');
    expect(shop).toContain(".eq('status', 'PUBLISHED')");
    expect(shop).toContain(".eq('active', true)");
    expect(getSetupStepHref('SERVICE', 'GUIDE')).toBe('/tenant/trips');
  });
});

describe('onboarding focus card uses the same SERVICE mapping', () => {
  it('step 1 link and title are mode-aware, not hard-coded to services', () => {
    const page = readFileSync(root('src/app/tenant/dashboard/page.tsx'), 'utf8');
    expect(page).toContain("getSetupStepHref('SERVICE', businessType)");
    expect(page).not.toContain('href="/tenant/services"');
    expect(page).toContain('t.focus.step1TitleByMode[businessType]');
  });
});

// 以假的 supabase builder 驗證 services 路徑；GUIDE 以 mock 的 loadPublicShop 驗證。
type Row = Record<string, unknown>;
function fakeSupabase(db: Record<string, Row[]>, calls: string[]) {
  return {
    from(table: string) {
      const eqs: Array<[string, unknown]> = [];
      let head = false;
      const q: Record<string, unknown> = {
        select: (_c: string, o?: { head?: boolean }) => { head = Boolean(o?.head); return q; },
        eq: (c: string, v: unknown) => { eqs.push([c, v]); calls.push(`${table}.eq(${c},${String(v)})`); return q; },
        then: (res: (v: unknown) => void) => {
          const rows = (db[table] ?? []).filter((r) => eqs.every(([c, v]) => r[c] === v));
          res(head ? { count: rows.length, data: null, error: null } : { data: rows, error: null });
        },
      };
      return q;
    },
  };
}

describe('countSetupInventory behaviour', () => {
  const count = async (mode: 'GUIDE' | 'LOCAL_SHOP' | 'CLINIC', db: Record<string, Row[]>) => {
    const { countSetupInventory } = await import('@/server/setup-inventory');
    const calls: string[] = [];
    const n = await countSetupInventory(fakeSupabase(db, calls) as never, 't1', mode, 'shop1');
    return { n, calls };
  };
  const shopWith = (...ctas: Array<string | undefined>) => ({
    trips: [{ plans: ctas.map((bookingCta) => ({ bookingCta })) }],
  });

  beforeEach(() => loadPublicShopMock.mockReset());

  it('GUIDE: fixed / request plans count', async () => {
    loadPublicShopMock.mockResolvedValue(shopWith('fixed', 'request', 'none'));
    const { n, calls } = await count('GUIDE', {});
    expect(n).toBe(2);
    expect(loadPublicShopMock).toHaveBeenCalledWith('shop1');
    expect(calls).toEqual([]);
  });
  it('GUIDE: unavailable / none / dates-not-loaded / price-not-loaded / undefined -> 0', async () => {
    loadPublicShopMock.mockResolvedValue(
      shopWith('fixed-unavailable', 'request-unavailable', 'none', 'dates-not-loaded', 'price-not-loaded', undefined),
    );
    expect((await count('GUIDE', {})).n).toBe(0);
  });
  it('GUIDE: null shop -> 0', async () => {
    loadPublicShopMock.mockResolvedValue(null);
    expect((await count('GUIDE', {})).n).toBe(0);
  });
  it('GUIDE: loader errors propagate', async () => {
    loadPublicShopMock.mockReturnValue(new Error('boom'));
    await expect(count('GUIDE', {})).rejects.toThrow('boom');
  });
  for (const mode of ['LOCAL_SHOP', 'CLINIC'] as const) {
    it(`${mode}: counts active services of this tenant only`, async () => {
      const { n, calls } = await count(mode, {
        services: [
          { id: 's1', tenant_id: 't1', active: true },
          { id: 's2', tenant_id: 't1', active: false },
          { id: 's3', tenant_id: 't2', active: true },
        ],
      });
      expect(n).toBe(1);
      expect(calls).toContain('services.eq(tenant_id,t1)');
      expect(calls).toContain('services.eq(active,true)');
      expect(loadPublicShopMock).not.toHaveBeenCalled();
    });
  }
});
