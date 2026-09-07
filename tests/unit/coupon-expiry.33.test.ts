import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { redeemCoupon } from '../../src/server/coupons';

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8');

const redeemByCode = read('src/app/api/coupons/redeem-by-code/route.ts');

const DAY = 24 * 60 * 60 * 1000;

/**
 * coupons.start_at / end_at 自 0004 migration 就存在，但整條核銷路徑從來沒有
 * 檢查過。過期票券照樣可以核銷、照樣折抵金額——店家等於在兌現自己已經結束的
 * 活動，而畫面顯示「核銷成功」。這是真的錢。
 */
function fakeSupabase(coupon: Record<string, unknown>, opts: { redeemedAt?: string | null } = {}) {
  const updates: unknown[] = [];
  return {
    updates,
    from(table: string) {
      const chain: any = {
        _isUpdate: false,
        select() { return chain; },
        eq() { return chain; },
        is() { return chain; },
        update(payload: unknown) { updates.push(payload); chain._isUpdate = true; return chain; },
        maybeSingle() {
          if (chain._isUpdate) return Promise.resolve({ data: { id: 'inst_1' }, error: null });
          return Promise.resolve({
            data: {
              id: 'inst_1',
              customer_id: 'cust_1',
              redeemed_at: opts.redeemedAt ?? null,
              coupons: coupon,
            },
            error: null,
          });
        },
      };
      void table;
      return chain;
    },
  };
}

const validCoupon = (over: Record<string, unknown> = {}) => ({
  discount_type: 'AMOUNT', discount_value: 100, start_at: null, end_at: null, ...over,
});

describe('#33①: 票券有效期', () => {
  it('沒有設定起訖 → 可核銷（null = 不限）', async () => {
    const sb = fakeSupabase(validCoupon());
    const r = await redeemCoupon(sb as any, 't1', 'CODE', 'cust_1', 500);
    expect(r.newAmount).toBe(400);
    expect(r.discount).toBe(100);
  });

  it('已過期 → 409「此票券已過期」，且**沒有任何核銷寫入**', async () => {
    const sb = fakeSupabase(validCoupon({ end_at: new Date(Date.now() - DAY).toISOString() }));
    await expect(redeemCoupon(sb as any, 't1', 'CODE', 'cust_1', 500)).rejects.toMatchObject({
      status: 409,
    });
    // 最重要的一點：拒絕之後票券不能被標成已核銷
    expect(sb.updates).toHaveLength(0);
  });

  it('尚未開始 → 409，且沒有核銷寫入', async () => {
    const sb = fakeSupabase(validCoupon({ start_at: new Date(Date.now() + DAY).toISOString() }));
    await expect(redeemCoupon(sb as any, 't1', 'CODE', 'cust_1', 500)).rejects.toMatchObject({
      status: 409,
    });
    expect(sb.updates).toHaveLength(0);
  });

  it('活動期間內 → 可核銷', async () => {
    const sb = fakeSupabase(validCoupon({
      start_at: new Date(Date.now() - DAY).toISOString(),
      end_at: new Date(Date.now() + DAY).toISOString(),
    }));
    const r = await redeemCoupon(sb as any, 't1', 'CODE', 'cust_1', 500);
    expect(r.newAmount).toBe(400);
  });

  it('剛好等於 end_at → 已過期（半開區間 [start_at, end_at)）', async () => {
    const sb = fakeSupabase(validCoupon({ end_at: new Date(Date.now()).toISOString() }));
    await expect(redeemCoupon(sb as any, 't1', 'CODE', 'cust_1', 500)).rejects.toMatchObject({
      status: 409,
    });
  });

  it('過期檢查排在顧客歸屬檢查之後，不會洩漏「這張券存在且有效」以外的資訊', async () => {
    const sb = fakeSupabase(validCoupon({ end_at: new Date(Date.now() - DAY).toISOString() }));
    // 別人的票券 → 仍然是 409（不是把過期訊息回給非持有人）
    await expect(redeemCoupon(sb as any, 't1', 'CODE', 'someone_else', 500)).rejects.toMatchObject({
      status: 409,
    });
    expect(sb.updates).toHaveLength(0);
  });
});

describe('#33①: 櫃檯核銷（redeem-by-code）用同一組規則', () => {
  it('也檢查 start_at / end_at', () => {
    expect(redeemByCode).toContain('start_at');
    expect(redeemByCode).toContain('end_at');
    expect(redeemByCode).toContain('此票券已過期');
    expect(redeemByCode).toContain('此票券尚未開始');
  });

  it('有效期檢查排在核銷寫入之前', () => {
    const expiryIdx = redeemByCode.indexOf('此票券已過期');
    const updateIdx = redeemByCode.indexOf('redeemed_at: new Date()');
    expect(expiryIdx).toBeGreaterThan(-1);
    expect(updateIdx).toBeGreaterThan(-1);
    expect(expiryIdx).toBeLessThan(updateIdx);
  });

  it('select 有把有效期欄位帶回來（否則檢查恆為 undefined 而形同不存在）', () => {
    expect(redeemByCode).toContain('discount_value, start_at, end_at');
  });
});
