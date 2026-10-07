import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { getGuideActionInbox } from '@/services/guide-action-inbox';

/*
 * #43 P2：mock 分支也要套用「尚未出發」規則。今天（Asia/Taipei）的 fixture 團次
 * 已過 startTime 就不出 DEPARTURE／成團卡；未到者仍出。
 */
const run = async (iso: string) => {
  vi.setSystemTime(new Date(iso));
  return getGuideActionInbox();
};
const todayCards = (items: Awaited<ReturnType<typeof getGuideActionInbox>>) =>
  items.filter((i) => (i.kind === 'DEPARTURE' || i.kind === 'REVIEW_REQUIRED' || i.kind === 'AT_RISK')
    && (i as { departureDate: string }).departureDate === '2026-10-07');

describe('mock 收件匣尚未出發過濾', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); });
  afterEach(() => { vi.useRealTimers(); });

  it('台北 08:00：今日團次與成團卡仍出', async () => {
    const items = await run('2026-10-07T00:00:00Z');
    expect(todayCards(items).length).toBeGreaterThan(0);
  });

  it('台北 23:00：今日已過 startTime，不出任何今日團次／成團卡', async () => {
    const items = await run('2026-10-07T15:00:00Z');
    expect(todayCards(items)).toHaveLength(0);
  });

  it('台北 09:30：09:00 的今日 DEPARTURE 卡消失', async () => {
    const items = await run('2026-10-07T01:30:00Z');
    expect(items.filter((i) => i.kind === 'DEPARTURE' && i.departureDate === '2026-10-07')).toHaveLength(0);
  });
});

describe('P2-A 原始碼', () => {
  it('定位列改設 --row-bg 而非 tr 背景', () => {
    const src = readFileSync('src/app/tenant/trips/[id]/page.tsx', 'utf8');
    expect(src).toContain('![--row-bg:var(--primary-a10)]');
    expect(src).not.toContain("'bg-[var(--primary-a10)]'");
  });
});
