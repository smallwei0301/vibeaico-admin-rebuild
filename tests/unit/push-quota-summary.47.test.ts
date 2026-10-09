import { describe, it, expect } from 'vitest';
import { summarizePushQuota } from '@/lib/push-quota-summary';

describe('summarizePushQuota (Issue #47)', () => {
  it('total 0：不除以零，level unknown', () => {
    expect(summarizePushQuota(0, 0)).toMatchObject({ pct: 0, remaining: 0, level: 'unknown', tone: 'neutral' });
    expect(summarizePushQuota(5, 0)).toMatchObject({ pct: 0, level: 'unknown' });
  });
  it('used 0：ok', () => {
    expect(summarizePushQuota(0, 200)).toMatchObject({ pct: 0, remaining: 200, level: 'ok', tone: 'success' });
  });
  it('79% 仍是 ok，80% 起 warning', () => {
    expect(summarizePushQuota(79, 100)).toMatchObject({ pct: 79, level: 'ok' });
    expect(summarizePushQuota(80, 100)).toMatchObject({ pct: 80, level: 'warning', tone: 'warning' });
  });
  it('95% almostOut', () => {
    expect(summarizePushQuota(95, 100)).toMatchObject({ pct: 95, remaining: 5, level: 'almostOut', tone: 'danger' });
  });
  it('用完 exhausted', () => {
    expect(summarizePushQuota(100, 100)).toMatchObject({ remaining: 0, level: 'exhausted', tone: 'danger' });
  });
  it('超用：remaining 不為負，pct 可超過 100', () => {
    expect(summarizePushQuota(130, 100)).toMatchObject({ remaining: 0, pct: 130, level: 'exhausted' });
  });
  it('非法數值視為 0', () => {
    expect(summarizePushQuota(NaN, 100)).toMatchObject({ used: 0, level: 'ok' });
    expect(summarizePushQuota(-3, 100)).toMatchObject({ used: 0 });
  });
});
