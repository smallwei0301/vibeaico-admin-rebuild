import { describe, expect, it } from 'vitest';
import { buildAiSystemPrompt } from '@/server/ai-reply';

const shop = (over: Record<string, unknown>) => ({
  name: '店', description: 'd', businessHours: 'h', services: [], trips: ['t'], departures: ['2026-10-16 x　剩 3 位'],
  shopUrl: 'https://x.test/s', ai: {}, catalogUnavailable: false, hasInstantPlan: true,
  departureWindow: { today: '2026-10-15', from: '2026-10-15', to: '2026-10-29' }, ...over,
}) as any;

describe('INSTANT 規則範圍描述', () => {
  it('截斷：聯絡店家範圍止於截斷日前一天，截斷日起 UNSURE，不重疊', () => {
    const p = buildAiSystemPrompt(shop({ departuresTruncatedAfter: '2026-10-20' }));
    expect(p).toContain('2026-10-15～2026-10-19 之間、上面沒列出的日期，請顧客聯絡店家');
    expect(p).toContain('2026-10-20（含）之後的日期、時段、名額只回覆「UNSURE」');
    expect(p).not.toContain('沒有開團」讓');
    expect(p).toContain('不得說任何日期「沒有開團」');
  });

  it('空窗：聯絡店家範圍為整個日期窗，窗後 UNSURE', () => {
    const p = buildAiSystemPrompt(shop({ departures: [] }));
    expect(p).toContain('2026-10-15～2026-10-29 之間、上面沒列出的日期，請顧客聯絡店家');
    expect(p).toContain('2026-10-29 之後（或今天之前）的日期、時段、名額只回覆「UNSURE」');
    expect(p).not.toContain('那天目前沒有開團');
  });
});
