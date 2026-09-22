/**
 * tests/unit/public-tour-booking-schema.46.test.ts
 * -----------------------------------------------------------------------------
 * `src/server/public-tour-booking.ts` 的 `submitPublicTourBookingSchema` 鎖住
 * FIXED_DEPARTURE 公開預約表單的輸入邊界——同 `public-tour-request-security.46
 * .test.ts` 的 F2（自由文字欄位一律有長度上限）與「至少一種聯絡方式」規則，
 * 這裡驗證同一組規則在新的 schema 上也成立，避免日後複製貼上時漏改。
 */
import { describe, expect, it } from 'vitest';
import { submitPublicTourBookingSchema } from '@/server/public-tour-booking';

const base = {
  shopCode: 'demo-shop',
  planId: '11111111-1111-1111-1111-111111111111',
  departureId: '22222222-2222-2222-2222-222222222222',
  partySize: 2,
  contactName: '王小明',
  contactPhone: '0912345678',
};

describe('submitPublicTourBookingSchema', () => {
  it('接受帶至少一種聯絡方式的最小合法輸入', () => {
    const result = submitPublicTourBookingSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it('三種聯絡方式全空時拒絕，且錯誤指向 contactPhone', () => {
    const { contactPhone: _phone, ...withoutPhone } = base;
    const result = submitPublicTourBookingSchema.safeParse(withoutPhone);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toContain('contactPhone');
    }
  });

  it('只填 LINE ID 或 Email 其中一種也算通過', () => {
    const { contactPhone: _phone, ...withoutPhone } = base;
    expect(submitPublicTourBookingSchema.safeParse({ ...withoutPhone, contactLine: 'demo_line' }).success)
      .toBe(true);
    expect(submitPublicTourBookingSchema.safeParse({ ...withoutPhone, contactEmail: 'a@example.com' }).success)
      .toBe(true);
  });

  it('姓名超過 100 字拒絕', () => {
    const result = submitPublicTourBookingSchema.safeParse({ ...base, contactName: 'x'.repeat(101) });
    expect(result.success).toBe(false);
  });

  it('電話超過 40 字拒絕', () => {
    const result = submitPublicTourBookingSchema.safeParse({ ...base, contactPhone: '0'.repeat(41) });
    expect(result.success).toBe(false);
  });

  it('LINE ID 超過 100 字拒絕', () => {
    const result = submitPublicTourBookingSchema.safeParse({ ...base, contactLine: 'x'.repeat(101) });
    expect(result.success).toBe(false);
  });

  it('Email 格式錯誤拒絕', () => {
    const result = submitPublicTourBookingSchema.safeParse({ ...base, contactEmail: 'not-an-email' });
    expect(result.success).toBe(false);
  });

  it('備註超過 500 字拒絕', () => {
    const result = submitPublicTourBookingSchema.safeParse({ ...base, note: 'x'.repeat(501) });
    expect(result.success).toBe(false);
  });

  it('partySize 會被 coerce 成數字（表單原生 input 傳字串）', () => {
    const result = submitPublicTourBookingSchema.safeParse({ ...base, partySize: '3' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.partySize).toBe(3);
  });

  it('planId／departureId 必須是 uuid', () => {
    expect(submitPublicTourBookingSchema.safeParse({ ...base, planId: 'not-a-uuid' }).success).toBe(false);
    expect(submitPublicTourBookingSchema.safeParse({ ...base, departureId: 'not-a-uuid' }).success).toBe(false);
  });
});
