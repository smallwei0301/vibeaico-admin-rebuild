/**
 * issue #1015：預約／申請送出成功後須保持按鈕停用直到導頁，且同一 tick 連點只能送一次。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { shouldBlockSubmit } from '@/lib/public-booking-price';

const FILES = [
  'src/app/s/[shopCode]/plans/[planId]/book/BookingForm.tsx',
  'src/app/s/[shopCode]/plans/[planId]/request/RequestForm.tsx',
];

describe('shouldBlockSubmit', () => {
  it('可送出且無進行中請求才放行', () => {
    expect(shouldBlockSubmit({ canSubmit: true, inFlight: false })).toBe(false);
    expect(shouldBlockSubmit({ canSubmit: true, inFlight: true })).toBe(true);
    expect(shouldBlockSubmit({ canSubmit: false, inFlight: false })).toBe(true);
  });
});

describe.each(FILES)('%s', (file) => {
  const src = readFileSync(file, 'utf8');
  const submit = src.slice(src.indexOf('const submit'), src.indexOf('return (', src.indexOf('const submit')));

  it('不再於 finally 重置 submitting', () => {
    expect(submit).not.toMatch(/finally/);
  });
  it('使用 in-flight ref 守門，失敗時才重置', () => {
    expect(src).toContain('React.useRef(false)');
    expect(submit).toContain('shouldBlockSubmit');
    expect(submit).toMatch(/inFlight\.current = true;[\s\S]*router\.replace[\s\S]*catch \(err\) \{\s*inFlight\.current = false;\s*setSubmitting\(false\);/);
  });
  it('成功路徑（router.replace 與 catch 之間）不重置', () => {
    const okPath = submit.slice(submit.indexOf('router.replace'), submit.indexOf('catch (err)'));
    expect(okPath).not.toContain('setSubmitting(false)');
    expect(okPath).not.toContain('inFlight.current = false');
  });
});
