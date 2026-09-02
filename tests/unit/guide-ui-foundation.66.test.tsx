import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  GuideActionCard,
  GuideBottomNav,
  GuideDepartureCard,
  GuideEmptyState,
  GuideHeader,
  GuideMonthSummary,
  GuidePersonRow,
  GuideSectionCard,
  GuideSettingsGroup,
  GuideStatusPill,
  GuideWeekStrip,
} from '@/components/guide';
import { GUIDE_STATUS_CLASSES, GUIDE_UI_CLASSES, GUIDE_UI_TOKENS } from '@/config/guide-ui';

describe('GUIDE UI foundation (#66 Phase A)', () => {
  it('keeps mobile typography inside the canonical size bands', () => {
    expect(GUIDE_UI_TOKENS.typography.pageTitlePx).toBeGreaterThanOrEqual(28);
    expect(GUIDE_UI_TOKENS.typography.pageTitlePx).toBeLessThanOrEqual(32);
    expect(GUIDE_UI_TOKENS.typography.sectionTitlePx).toBeGreaterThanOrEqual(20);
    expect(GUIDE_UI_TOKENS.typography.sectionTitlePx).toBeLessThanOrEqual(24);
    expect(GUIDE_UI_TOKENS.typography.cardTextPx).toBeGreaterThanOrEqual(17);
    expect(GUIDE_UI_TOKENS.typography.cardTextPx).toBeLessThanOrEqual(20);
    expect(GUIDE_UI_TOKENS.typography.bodyPx).toBeGreaterThanOrEqual(16);
    expect(GUIDE_UI_TOKENS.typography.secondaryPx).toBeGreaterThanOrEqual(14);
  });

  it('keeps page/card spacing, card radius and touch targets inside the baseline', () => {
    expect(GUIDE_UI_TOKENS.spacing.mobilePagePaddingPx).toBeGreaterThanOrEqual(16);
    expect(GUIDE_UI_TOKENS.spacing.mobilePagePaddingWidePx).toBeLessThanOrEqual(20);
    expect(GUIDE_UI_TOKENS.spacing.cardPaddingPx).toBeGreaterThanOrEqual(16);
    expect(GUIDE_UI_TOKENS.spacing.cardPaddingWidePx).toBeLessThanOrEqual(20);
    expect(GUIDE_UI_TOKENS.radius.cardPx).toBeGreaterThanOrEqual(16);
    expect(GUIDE_UI_TOKENS.radius.cardPx).toBeLessThanOrEqual(20);
    expect(GUIDE_UI_TOKENS.touch.minTargetPx).toBeGreaterThanOrEqual(44);
    expect(GUIDE_UI_TOKENS.touch.bottomNavMinPx).toBeGreaterThanOrEqual(64);
    expect(GUIDE_UI_TOKENS.touch.bottomNavMaxPx).toBeLessThanOrEqual(72);
  });

  it('renders the GUIDE page header with one h1 and readable subtitle', () => {
    const html = renderToStaticMarkup(
      <GuideHeader title="今天要做什麼" subtitle="先處理會影響旅客的事情" eyebrow="祕島 MIDAO" />,
    );
    expect(html).toContain('<header');
    expect(html).toContain('<h1');
    expect(html).toContain('text-[30px]');
    expect(html).toContain('text-[16px]');
    expect(html).toContain('今天要做什麼');
  });

  it('renders a section with semantic heading and readable description', () => {
    const html = renderToStaticMarkup(
      <GuideSectionCard title="今天重點" description="先處理會影響旅客或出團的事情">
        <p>內容</p>
      </GuideSectionCard>,
    );
    expect(html).toContain('<section');
    expect(html).toContain('<h2');
    expect(html).toContain('text-[22px]');
    expect(html).toContain('text-[14px]');
    expect(html).toContain('今天重點');
  });

  it('renders action cards as real buttons with the 44px touch target contract', () => {
    const html = renderToStaticMarkup(
      <GuideActionCard title="查看申請" description="1 筆等待你確認" />,
    );
    expect(html).toContain('<button');
    expect(html).toContain('type="button"');
    expect(html).toContain('min-h-[44px]');
    expect(html).toContain('min-w-[44px]');
    expect(html).toContain('text-[18px]');
    expect(html).toContain('text-[14px]');
    expect(html).toContain('focus-visible:ring-2');
  });

  it('centralizes status colors and keeps text as the state signal', () => {
    expect(Object.keys(GUIDE_STATUS_CLASSES).sort()).toEqual([
      'attention', 'danger', 'info', 'neutral', 'positive',
    ]);
    const html = renderToStaticMarkup(
      <GuideStatusPill tone="attention">尾款今天到期</GuideStatusPill>,
    );
    expect(html).toContain('尾款今天到期');
    expect(html).toContain(GUIDE_STATUS_CLASSES.attention.split(' ')[0]);
  });

  it('renders the canonical five-entry mobile bottom navigation as real links', () => {
    const html = renderToStaticMarkup(
      <GuideBottomNav
        items={[
          { key: 'home', label: '首頁', href: '/tenant/dashboard', active: true },
          { key: 'departures', label: '團次', href: '/tenant/calendar' },
          { key: 'travelers', label: '旅客', href: '/tenant/customers' },
          { key: 'messages', label: '訊息', href: '/tenant/chat' },
          { key: 'more', label: '更多', href: '/tenant/more' },
        ]}
      />,
    );
    expect(html).toContain('<nav');
    expect((html.match(/<a /g) ?? []).length).toBe(5);
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('min-h-[64px]');
    expect(html).toContain('text-[14px]');
  });

  it('renders week and month summaries without inventing missing data', () => {
    const weekDays = Array.from({ length: 7 }, (_, index) => ({
      key: String(index),
      weekdayLabel: `週${index + 1}`,
      dateLabel: String(index + 1),
      selected: index === 0,
    }));
    const weekHtml = renderToStaticMarkup(
      <GuideWeekStrip days={weekDays} onSelect={() => {}} />,
    );
    expect((weekHtml.match(/<button/g) ?? []).length).toBe(7);
    expect(weekHtml).not.toContain('text-[11px]');
    expect(weekHtml).not.toContain('text-[12px]');

    const displayHtml = renderToStaticMarkup(<GuideWeekStrip days={weekDays} />);
    expect((displayHtml.match(/<button/g) ?? []).length).toBe(0);
    expect(displayHtml).toContain('aria-current="date"');

    const monthHtml = renderToStaticMarkup(
      <GuideMonthSummary monthLabel="九月" items={[]} />,
    );
    expect(monthHtml).toContain('九月');
    expect(monthHtml).not.toContain('<dd');
  });

  it('renders departure and person rows only from caller-provided facts', () => {
    const departureHtml = renderToStaticMarkup(
      <GuideDepartureCard
        title="阿里山晨光"
        dateLabel="9/23"
        capacityLabel="3 / 8 人"
        statusLabel="募集中"
        statusTone="info"
      />,
    );
    expect(departureHtml).toContain('阿里山晨光');
    expect(departureHtml).toContain('3 / 8 人');
    expect(departureHtml).not.toContain('undefined');

    const personHtml = renderToStaticMarkup(
      <GuidePersonRow name="王小明" subtitle="9/23 出發" />,
    );
    expect(personHtml).toContain('王小明');
    expect(personHtml).toContain('size-11');
    expect(personHtml).toContain('truncate');
  });

  it('renders truthful empty states and grouped secondary settings', () => {
    const emptyHtml = renderToStaticMarkup(
      <GuideEmptyState title="目前沒有待處理事項" description="有新申請或付款待辦時會出現在這裡" />,
    );
    expect(emptyHtml).toContain('目前沒有待處理事項');
    expect(emptyHtml).not.toMatch(/>\s*0\s*</);

    const settingsHtml = renderToStaticMarkup(
      <GuideSettingsGroup title="LINE 與自動化">
        <div>圖文選單</div>
      </GuideSettingsGroup>,
    );
    expect(settingsHtml).toContain('LINE 與自動化');
    expect(settingsHtml).toContain(GUIDE_UI_CLASSES.divider.split(' ')[0]);
    expect(settingsHtml).toContain('<details');
    expect(settingsHtml).toContain('<summary');
    expect(settingsHtml).toContain('aria-level="2"');
    expect(settingsHtml).toContain('focus-visible:ring-2');
  });
});
