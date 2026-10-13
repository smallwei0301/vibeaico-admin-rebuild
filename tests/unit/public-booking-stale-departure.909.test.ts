import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { submitPublicTourBookingSchema } from '@/server/public-tour-booking';
import { submitPublicTourRequestSchema } from '@/server/public-tour-request';

const UUID = '11111111-1111-4111-8111-111111111111';
const base = { shopCode: 'demo', planId: UUID, departureId: UUID, partySize: 2, contactName: '王小明', contactPhone: '0912345678' };
const long = 'a'.repeat(501);

function firstMessage(r: { success: boolean; error?: { issues: { message: string }[] } }): string {
  return r.success ? '' : r.error!.issues[0].message;
}

describe('#909 備註長度上限的中文訊息', () => {
  it('booking note 501 字 → 中文訊息', () => {
    expect(firstMessage(submitPublicTourBookingSchema.safeParse({ ...base, note: long }))).toBe('備註長度超過上限（最多 500 字）');
  });
  it('booking note 500 字通過', () => {
    expect(submitPublicTourBookingSchema.safeParse({ ...base, note: 'a'.repeat(500) }).success).toBe(true);
  });
  it('request preferredNote / specialRequest 501 字 → 各自中文訊息', () => {
    expect(firstMessage(submitPublicTourRequestSchema.safeParse({ ...base, preferredNote: long }))).toContain('偏好日期');
    expect(firstMessage(submitPublicTourRequestSchema.safeParse({ ...base, specialRequest: long }))).toContain('特殊需求');
  });
});

const dir = 'src/app/s/[shopCode]/plans/[planId]';
describe.each([
  ['BookingForm', `${dir}/book/BookingForm.tsx`, 1],
  ['RequestForm', `${dir}/request/RequestForm.tsx`, 2],
])('#909 %s 原始碼', (_n, file, textareas) => {
  const src = readFileSync(file, 'utf8');
  it('TOUR_001 / REQ_003 清除團次並 router.refresh()', () => {
    expect(src).toMatch(/e\.code === 'TOUR_001' \|\| e\.code === 'REQ_003'/);
    expect(src).toMatch(/if \(isStaleDepartureError\(err\)\) \{[^}]*setDepartureId\(''\);[^}]*router\.refresh\(\);[^}]*\}/s);
  });
  it('價格變動流程仍在', () => {
    expect(src).toContain('priceChangedQuoteFromError(err)');
  });
  it('textarea 皆有 maxLength={NOTE_MAX_LENGTH}', () => {
    expect(src.match(/maxLength=\{NOTE_MAX_LENGTH\}/g)?.length).toBe(textareas);
    expect(src.match(/<textarea/g)?.length).toBe(textareas);
  });
});
