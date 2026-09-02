import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isValidCronBearer } from '@/server/cron-auth';

describe('tour-order-expiry cron authentication', () => {
  it('rejects Bearer undefined when CRON_SECRET is missing', () => {
    expect(isValidCronBearer('Bearer undefined', undefined)).toBe(false);
    expect(isValidCronBearer(null, undefined)).toBe(false);
  });

  it('requires an exact Bearer token for a configured secret', () => {
    expect(isValidCronBearer('Bearer test-cron-secret', 'test-cron-secret')).toBe(true);
    expect(isValidCronBearer('Bearer wrong', 'test-cron-secret')).toBe(false);
    expect(isValidCronBearer('test-cron-secret', 'test-cron-secret')).toBe(false);
    expect(isValidCronBearer('Bearer test-cron-secret', '')).toBe(false);
  });

  it('wires the tour expiry route through the fail-closed guard', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/app/api/cron/tour-order-expiry/route.ts'),
      'utf8',
    );
    expect(source).toContain('isValidCronBearer');
    expect(source).not.toContain('`Bearer ${process.env.CRON_SECRET}`');
  });
});
