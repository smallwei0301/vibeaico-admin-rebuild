import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const bookingPage = readFileSync(
  resolve(process.cwd(), 'src/app/tenant/bookings/page.tsx'),
  'utf8',
);
const bookingCopy = readFileSync(
  resolve(process.cwd(), 'src/i18n/zh-TW/pages/bookings.ts'),
  'utf8',
);

describe('#35-A truthful booking payment display', () => {
  it('removes fabricated paid amount from the booking page', () => {
    expect(bookingPage).not.toContain('paidAmount');
    expect(bookingPage).not.toContain('t.labels.received');
    expect(bookingPage).toContain('const isPaid = (b: Booking)');
    expect(bookingPage).toContain("b.paymentStatus === 'PAID_ONLINE'");
    expect(bookingPage).toContain("b.paymentStatus === 'PAID_OFFLINE'");
  });

  it('uses persisted payment status for warnings', () => {
    expect(bookingPage).toContain('cancelTarget && isPaid(cancelTarget)');
    expect(bookingPage).toContain("confirmTarget?.paymentStatus === 'UNPAID'");
    expect(bookingPage).toContain("completeTarget?.paymentStatus === 'UNPAID'");
    expect(bookingPage).not.toContain('batchPaidTotal');
  });

  it('does not claim a numeric refund amount the system cannot prove', () => {
    expect(bookingCopy).toContain('cancelPaidWarning:');
    expect(bookingCopy).not.toContain('cancelPaidWarning: (');
    expect(bookingCopy).toContain('實際金額請以金流後台為準');
  });
});
