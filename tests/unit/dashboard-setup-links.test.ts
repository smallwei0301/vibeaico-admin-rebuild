// 儀表板「設定進度」未完成項可點進對應設定頁：每個 step key 在每個模式的目標
// 必須是真實存在的 src/app/tenant/** 頁面（或明確為 null 的隱藏頁）。
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { BUSINESS_TYPES, MODE_PRESETS, type SetupStepKey } from '@/config/modes';
import { getSetupStepHref } from '@/lib/setup-step-routes';

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

  it('GUIDE SERVICE counts trips and links to a page visible in GUIDE nav', () => {
    expect(MODE_PRESETS.GUIDE.setupInventory).toEqual({
      table: 'trips',
      filter: { column: 'status', value: 'PUBLISHED' },
      requireActiveChild: { table: 'trip_plans', fk: 'trip_id', filter: { column: 'active', value: true } },
    });
    expect(MODE_PRESETS.LOCAL_SHOP.setupInventory).toEqual({ table: 'services', filter: { column: 'active', value: true } });
    expect(MODE_PRESETS.CLINIC.setupInventory).toEqual({ table: 'services', filter: { column: 'active', value: true } });
    expect(getSetupStepHref('SERVICE', 'GUIDE')).toBe('/tenant/trips');
    expect(MODE_PRESETS.GUIDE.hiddenNavKeys).not.toContain('trips');
  });

  it('setup-status route reads the inventory table from the preset', () => {
    const route = readFileSync(root('src/app/api/settings/setup-status/route.ts'), 'utf8');
    expect(route).toContain('countSetupInventory(t.supabase, t.tenantId, t.businessType)');
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

// 以假的 supabase builder 驗證 helper 的查詢與結果（GUIDE 需有「已發布行程底下的啟用方案」）。
type Row = Record<string, unknown>;
function fakeSupabase(db: Record<string, Row[]>, calls: string[]) {
  return {
    from(table: string) {
      const eqs: Array<[string, unknown]> = [];
      let inCol: [string, unknown[]] | null = null;
      let head = false;
      let range: [number, number] | null = null;
      const q: Record<string, unknown> = {
        select: (_c: string, o?: { head?: boolean }) => { head = Boolean(o?.head); return q; },
        eq: (c: string, v: unknown) => { eqs.push([c, v]); calls.push(`${table}.eq(${c},${String(v)})`); return q; },
        in: (c: string, v: unknown[]) => { inCol = [c, v]; calls.push(`${table}.in(${c})`); return q; },
        order: () => q,
        range: (a: number, b: number) => { range = [a, b]; return q; },
        then: (res: (v: unknown) => void) => {
          let rows = (db[table] ?? []).filter((r) => eqs.every(([c, v]) => r[c] === v));
          if (inCol) { const [c, vs] = inCol; rows = rows.filter((r) => vs.includes(r[c])); }
          if (range) rows = rows.slice(range[0], range[1] + 1);
          res(head ? { count: rows.length, data: null, error: null } : { data: rows, error: null });
        },
      };
      return q;
    },
  };
}

describe('countSetupInventory behaviour', () => {
  const count = async (mode: 'GUIDE' | 'LOCAL_SHOP', db: Record<string, Row[]>) => {
    vi.resetModules();
    const { countSetupInventory } = await import('@/server/setup-inventory');
    const calls: string[] = [];
    const n = await countSetupInventory(fakeSupabase(db, calls) as never, 't1', mode);
    return { n, calls };
  };
  const trip = (id: string, status: string, tenant_id = 't1') => ({ id, status, tenant_id });
  const plan = (id: string, trip_id: string, active: boolean, tenant_id = 't1') => ({ id, trip_id, active, tenant_id });

  it('GUIDE: no trips -> 0', async () => {
    expect((await count('GUIDE', {})).n).toBe(0);
  });
  it('GUIDE: published trip without any active plan -> 0 (no fake success)', async () => {
    const { n } = await count('GUIDE', {
      trips: [trip('a', 'PUBLISHED')],
      trip_plans: [plan('p1', 'a', false)],
    });
    expect(n).toBe(0);
  });
  it('GUIDE: active plan only under a draft trip -> 0', async () => {
    const { n } = await count('GUIDE', { trips: [trip('a', 'DRAFT')], trip_plans: [plan('p1', 'a', true)] });
    expect(n).toBe(0);
  });
  it('GUIDE: published trip with active plan -> 1, tenant scoped', async () => {
    const { n, calls } = await count('GUIDE', {
      trips: [trip('a', 'PUBLISHED'), trip('x', 'PUBLISHED', 't2')],
      trip_plans: [plan('p1', 'a', true), plan('p2', 'x', true, 't2')],
    });
    expect(n).toBe(1);
    expect(calls).toContain('trips.eq(tenant_id,t1)');
    expect(calls).toContain('trips.eq(status,PUBLISHED)');
    expect(calls).toContain('trip_plans.eq(tenant_id,t1)');
    expect(calls).toContain('trip_plans.eq(active,true)');
  });
  it('LOCAL_SHOP: unchanged, counts active services only', async () => {
    const { n, calls } = await count('LOCAL_SHOP', {
      services: [{ id: 's1', tenant_id: 't1', active: true }, { id: 's2', tenant_id: 't1', active: false }],
    });
    expect(n).toBe(1);
    expect(calls.some((c) => c.startsWith('trip_plans'))).toBe(false);
  });
});
