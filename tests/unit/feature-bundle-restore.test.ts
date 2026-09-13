import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  hasRestoreSideEffect,
  runRestoreSideEffects,
  RESTORE_SIDE_EFFECT_CODES,
} from '../../src/server/feature-restore';
import { FEATURE_BUNDLES } from '../../src/config/features';

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8');

const bundleApply = read('src/app/api/feature-store/bundle/[key]/apply/route.ts');
const singleApply = read('src/app/api/feature-store/[code]/apply/route.ts');
const restore = read('src/app/api/feature-store/[code]/restore/route.ts');

/** 最小 supabase admin 樁：記錄呼叫並回傳指定的列數。 */
function fakeAdmin(rowsByTable: Record<string, { id: string }[]>) {
  const calls: { table: string; payload: unknown; filters: [string, unknown][] }[] = [];
  return {
    calls,
    from(table: string) {
      const filters: [string, unknown][] = [];
      const chain: any = {
        update(payload: unknown) { calls.push({ table, payload, filters }); return chain; },
        eq(col: string, val: unknown) { filters.push([col, val]); return chain; },
        select() { return Promise.resolve({ data: rowsByTable[table] ?? [], error: null }); },
      };
      return chain;
    },
  };
}

describe('還原副作用的觸發碼', () => {
  it('只有 COUPON_SYSTEM 與 PRODUCT_SALES 有副作用', () => {
    expect([...RESTORE_SIDE_EFFECT_CODES]).toEqual(['COUPON_SYSTEM', 'PRODUCT_SALES']);
    expect(hasRestoreSideEffect('COUPON_SYSTEM')).toBe(true);
    expect(hasRestoreSideEffect('PRODUCT_SALES')).toBe(true);
    expect(hasRestoreSideEffect('BASIC_REPORT')).toBe(false);
  });
});

describe('runRestoreSideEffects 對單一碼與整組碼走同一條路徑', () => {
  it('單一 COUPON_SYSTEM → 只還原票券', async () => {
    const admin = fakeAdmin({ coupons: [{ id: 'c1' }, { id: 'c2' }] });
    const r = await runRestoreSideEffects(admin as any, 't1', ['COUPON_SYSTEM']);
    expect(r).toEqual({ restoredCoupons: 2, restoredProducts: 0 });
    expect(admin.calls.map((c) => c.table)).toEqual(['coupons']);
  });

  it('整組 PRO codes → 票券與商品都還原', async () => {
    const admin = fakeAdmin({ coupons: [{ id: 'c1' }], products: [{ id: 'p1' }, { id: 'p2' }] });
    const r = await runRestoreSideEffects(admin as any, 't1', FEATURE_BUNDLES.PRO.codes);
    expect(r).toEqual({ restoredCoupons: 1, restoredProducts: 2 });
  });

  it('LITE codes 不含這兩碼 → 一列都不動', async () => {
    const admin = fakeAdmin({ coupons: [{ id: 'c1' }], products: [{ id: 'p1' }] });
    const r = await runRestoreSideEffects(admin as any, 't1', FEATURE_BUNDLES.LITE.codes);
    expect(r).toEqual({ restoredCoupons: 0, restoredProducts: 0 });
    expect(admin.calls).toHaveLength(0);
  });

  it('只還原被功能自動暫停的列，且限本租戶', async () => {
    const admin = fakeAdmin({ coupons: [{ id: 'c1' }] });
    await runRestoreSideEffects(admin as any, 'tenant-42', ['COUPON_SYSTEM']);
    expect(admin.calls[0].filters).toContainEqual(['tenant_id', 'tenant-42']);
    expect(admin.calls[0].filters).toContainEqual(['auto_paused_by_feature', true]);
  });

  it('還原時把旗標歸零，否則下次到期不會再被暫停', async () => {
    const admin = fakeAdmin({ coupons: [{ id: 'c1' }] });
    await runRestoreSideEffects(admin as any, 't1', ['COUPON_SYSTEM']);
    expect(admin.calls[0].payload).toEqual({ status: 'PUBLISHED', auto_paused_by_feature: false });
  });
});

/**
 * 本輪的真正缺陷：單項 apply 與 restore 各有一份拷貝，**套裝 apply 根本沒有**。
 * 店家取消 COUPON_SYSTEM（票券被自動暫停）後改訂 PRO，方案含 COUPON_SYSTEM、
 * 功能確實變成已訂閱，但票券還是停用的，而且沒有任何錯誤訊息。
 */
describe('三支 route 都接到同一份實作', () => {
  it('套裝 apply 會執行還原副作用（本輪修的就是這一條）', () => {
    expect(bundleApply).toContain("from '@/server/feature-restore'");
    expect(bundleApply).toContain('runRestoreSideEffects(admin, t.tenantId, bundle.codes)');
  });

  it('單項 apply 與 restore 改用共用實作，不再各自複製一份', () => {
    for (const src of [singleApply, restore]) {
      expect(src).toContain("from '@/server/feature-restore'");
      expect(src).not.toContain('async function runRestoreSideEffects');
    }
  });

  it('還原邏輯全站只有一份', () => {
    for (const src of [bundleApply, singleApply, restore]) {
      expect(src).not.toContain("auto_paused_by_feature: false");
    }
  });

  it('套裝的還原失敗不會讓已扣點的訂閱變成失敗', () => {
    expect(bundleApply).toContain('restoreSideEffectFailed: true');
    // 用「呼叫點」而不是第一個出現位置——第一個是 import 那一行，
    // 拿它來比會讓這條斷言恆為假（本測試第一次就是這樣紅的）。
    const callIdx = bundleApply.indexOf('runRestoreSideEffects(admin');
    expect(callIdx).toBeGreaterThan(-1);
    const tryIdx = bundleApply.lastIndexOf('try {', callIdx);
    expect(tryIdx).toBeGreaterThan(-1);
    expect(bundleApply.slice(callIdx)).toContain('catch');
  });
});
