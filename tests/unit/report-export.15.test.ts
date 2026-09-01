import { describe, expect, it } from 'vitest';
import {
  csvCell,
  reportExportQuerySchema,
} from '@/server/report-export';

describe('Issue #15 report export contract', () => {
  it('keeps numeric negatives numeric while neutralizing formula strings', () => {
    expect(csvCell(-300)).toBe('-300');
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('  @formula')).toBe("'  @formula");
    expect(csvCell('a,b')).toBe('"a,b"');
  });

  it('requires a complete valid date range when dates are supplied', () => {
    expect(reportExportQuerySchema.safeParse({}).success).toBe(true);
    expect(reportExportQuerySchema.safeParse({ from: '2026-08-01' }).success).toBe(false);
    expect(reportExportQuerySchema.safeParse({ to: '2026-08-31' }).success).toBe(false);
    expect(reportExportQuerySchema.safeParse({ from: '2026-02-30', to: '2026-03-01' }).success)
      .toBe(false);
    expect(reportExportQuerySchema.safeParse({ from: '2026-08-01', to: '2026-08-31' }).success)
      .toBe(true);
  });
});
