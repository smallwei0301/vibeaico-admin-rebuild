/**
 * src/server/coupon-code.ts — 票券核銷代碼產生器（單一事實來源）
 * -----------------------------------------------------------------------------
 * 原本這段只存在於 `src/app/api/coupons/[id]/batch-issue/route.ts` 裡。issue #176
 * 的活動獎勵也要發券，抽出來共用而不是複製一份——兩份各自演化的話，同一家店會
 * 出現兩種長度或兩種字母表的核銷代碼，而 `coupon_instances` 的
 * `unique (tenant_id, code)` 是跨來源的，碰撞機率也會跟著兩邊的實作漂移。
 */
import { randomBytes } from 'crypto';

/**
 * 8 碼核銷代碼。字母表 32 字（去掉 O/0/I/1 易混淆字元），32 = 2^5，
 * 每 byte 取低 5 bit 即為均勻分布，無 modulo bias。
 */
export const COUPON_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const COUPON_CODE_LENGTH = 8;

export function genCouponCode(): string {
  const bytes = randomBytes(COUPON_CODE_LENGTH);
  let code = '';
  for (let i = 0; i < COUPON_CODE_LENGTH; i++) code += COUPON_CODE_ALPHABET[bytes[i] & 31];
  return code;
}
