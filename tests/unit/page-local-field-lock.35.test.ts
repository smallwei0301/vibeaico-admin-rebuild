import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mapCoupon, mapMembershipLevel } from '@/server/mappers';

const couponPage = readFileSync(
  resolve(process.cwd(), 'src/app/tenant/coupons/page.tsx'),
  'utf8',
);
const membershipPage = readFileSync(
  resolve(process.cwd(), 'src/app/tenant/membership-levels/page.tsx'),
  'utf8',
);
const migration = resolve(process.cwd(), 'supabase/migrations/0015_page_local_display_fields.sql');
const customersRoute = readFileSync(
  resolve(process.cwd(), 'src/app/api/customers/route.ts'),
  'utf8',
);
const membershipRoute = readFileSync(
  resolve(process.cwd(), 'src/app/api/membership-levels/route.ts'),
  'utf8',
);
const membershipIdRoute = readFileSync(
  resolve(process.cwd(), 'src/app/api/membership-levels/[id]/route.ts'),
  'utf8',
);

describe('Issue #35：coupons 的頁內欄位必須來自真實契約', () => {
  it('mapper 傳回 API 的五個持久欄位與最近核銷代碼', () => {
    expect(mapCoupon({
      id: 'cp-35', name: '測試券', description: '', discount_type: 'PERCENT', discount_value: 10,
      total_quantity: 0, issued_quantity: 2, redeemed_quantity: 1,
      start_at: null, end_at: null, status: 'PUBLISHED',
      min_order_amount: 1200, max_discount_amount: 300, gift_item: '手沖咖啡',
      limit_per_customer: 2, private_mode: true, last_redeemed_code: 'ABC12345',
    })).toMatchObject({
      minOrderAmount: 1200,
      maxDiscountAmount: 300,
      giftItem: '手沖咖啡',
      limitPerCustomer: 2,
      privateMode: true,
      lastRedeemedCode: 'ABC12345',
    });
  });

  it('缺少或為 null 的新欄位使用誠實的空值，不生成展示資料', () => {
    expect(mapCoupon({
      id: 'cp-35-empty', name: '空白券', description: '', discount_type: 'AMOUNT', discount_value: 0,
      total_quantity: 0, issued_quantity: 0, redeemed_quantity: 0,
      start_at: null, end_at: null, status: 'DRAFT',
    })).toMatchObject({
      minOrderAmount: null,
      maxDiscountAmount: null,
      giftItem: '',
      limitPerCustomer: null,
      privateMode: false,
      lastRedeemedCode: null,
    });
  });

  it('頁面移除 mode 常數、票券層級 code 與無設定入口的適用服務，並送出五個持久欄位', () => {
    expect(couponPage).not.toContain('COUPON_EXTRAS_');
    expect(couponPage).not.toContain("from '@/mock'");
    expect(couponPage).not.toMatch(/\bc\.code\b/);
    expect(couponPage).not.toContain('applicableServices');
    for (const field of [
      'minOrderAmount', 'maxDiscountAmount', 'giftItem', 'limitPerCustomer', 'privateMode',
    ]) {
      expect(couponPage).toContain(`${field}: draft.${field}`);
    }
  });
});

describe('Issue #35：membership-levels 的頁內欄位必須來自真實契約', () => {
  it('mapper 傳回說明、啟用與預設旗標', () => {
    expect(mapMembershipLevel({
      id: 'ml-35', name: '金卡', color: '#C9A961', threshold_spent: 20000,
      discount_percent: 5, point_rate_multiplier: 1.5, customer_count: 3, sort_order: 1,
      description: '滿額禮遇', active: false, is_default: true,
    })).toMatchObject({
      description: '滿額禮遇',
      active: false,
      isDefault: true,
    });
  });

  it('缺少新欄位時使用既有資料模型的安全預設值', () => {
    expect(mapMembershipLevel({
      id: 'ml-35-empty', name: '一般', color: '#86868b', threshold_spent: 0,
      discount_percent: 0, point_rate_multiplier: 1, customer_count: 0, sort_order: 1,
    })).toMatchObject({ description: '', active: true, isDefault: false });
  });

  it('頁面移除 mode 常數並送出三個持久欄位', () => {
    expect(membershipPage).not.toContain('LEVEL_EXTRAS_');
    expect(membershipPage).not.toContain("from '@/mock'");
    for (const field of ['description', 'active', 'isDefault']) {
      expect(membershipPage).toContain(`${field}: draft.${field}`);
    }
  });

  it('Y.5：新顧客查詢同租戶 active default，重算兩條 route 都使用 fallback helper', () => {
    expect(customersRoute).toMatch(/\.eq\('tenant_id', t\.tenantId\)[\s\S]*\.eq\('active', true\)[\s\S]*\.eq\('is_default', true\)/);
    expect(membershipRoute).toContain('resolveMembershipLevelId');
    expect(membershipIdRoute).toContain('resolveMembershipLevelId');
  });
});

describe('Issue #35：coupon undo 必須重載 authoritative API state', () => {
  it('反核銷成功後重拉 coupons，不把 lastRedeemedCode 硬清成 null', () => {
    expect(couponPage).toContain('await load();');
    expect(couponPage).not.toMatch(/onUndone=\{\(coupon\) => \{[\s\S]*?lastRedeemedCode:\s*null[\s\S]*?\}\}/);
  });
});

describe('Issue #35：migration 只涵蓋本 bounded slice', () => {
  it('補 coupons / membership_levels 欄位與租戶級唯一預設，不碰 bookings', () => {
    const source = readFileSync(migration, 'utf8');
    expect(source).toContain('alter table coupons');
    expect(source).toContain('min_order_amount');
    expect(source).toContain('max_discount_amount');
    expect(source).toContain('gift_item');
    expect(source).toContain('limit_per_customer');
    expect(source).toContain('private_mode');
    expect(source).toContain('alter table membership_levels');
    expect(source).toContain('description');
    expect(source).toContain('active');
    expect(source).toContain('is_default');
    expect(source).toContain('u_membership_levels_default');
    expect(source).toContain('set_membership_level_default');
    expect(source).toMatch(/revoke\s+execute\s+on\s+function\s+public\.set_membership_level_default\(\)\s+from\s+anon,\s*authenticated/i);
    expect(source).not.toContain('bookings');
  });
});
