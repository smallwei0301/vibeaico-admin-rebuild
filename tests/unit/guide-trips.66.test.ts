import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { filterGuideTrips, summarizeGuideTrips } from '@/lib/guide-trips';
import type { Trip } from '@/lib/types';

const trip = (overrides: Partial<Trip> = {}): Trip => ({
  id: 'trip-1',
  slug: 'coast',
  title: '海岸線半日遊',
  tagline: '跟著在地導遊看海',
  summary: '適合第一次來訪的海岸行程',
  description: '',
  region: '宜蘭 頭城',
  category: '自然探索',
  coverImageUrl: '',
  galleryUrls: [],
  meetingPoint: '烏石港',
  meetingPointMapUrl: '',
  inclusions: [],
  exclusions: [],
  notices: [],
  safetyNotice: '',
  refundPolicyType: 'STANDARD',
  status: 'PUBLISHED',
  midaoListing: 'NONE',
  midaoListingNote: '',
  planCount: 2,
  upcomingDepartureCount: 3,
  minPrice: 1800,
  updatedAt: '2026-09-01T09:00:00Z',
  ...overrides,
});

describe('GUIDE trips mobile surface selectors (#66 Phase H)', () => {
  it('filters by status and searchable itinerary facts, then sorts deterministically', () => {
    const rows = [
      trip({ id: 'draft', title: '山林包團', status: 'DRAFT', updatedAt: '2026-08-30T09:00:00Z' }),
      trip({ id: 'published', title: '東北角海岸線', region: '新北 貢寮' }),
      trip({ id: 'archived', title: '夏日溪谷', status: 'ARCHIVED', updatedAt: '2026-08-31T09:00:00Z' }),
    ];

    expect(filterGuideTrips(rows, 'PUBLISHED', '貢寮').map((row) => row.id)).toEqual(['published']);
    expect(filterGuideTrips(rows, 'ALL', '溪谷').map((row) => row.id)).toEqual(['archived']);
    expect(filterGuideTrips(rows).map((row) => row.id)).toEqual(['published', 'archived', 'draft']);
  });

  it('summarizes only returned trip facts without fallback demo values', () => {
    expect(summarizeGuideTrips([
      trip({ id: 'published' }),
      trip({ id: 'draft', status: 'DRAFT', upcomingDepartureCount: 0 }),
      trip({ id: 'archived', status: 'ARCHIVED', planCount: 0, upcomingDepartureCount: 1 }),
    ])).toEqual({
      total: 3,
      published: 1,
      draft: 1,
      archived: 1,
      upcomingDepartures: 4,
    });
  });

  it('keeps GUIDE trips cards responsive and links to existing detail routes', () => {
    const source = readFileSync('src/components/guide/GuideTripsView.tsx', 'utf8');
    expect(source).toContain('GUIDE_UI_CLASSES.card');
    expect(source).toContain('grid-cols-2');
    expect(source).toContain('/tenant/trips/${trip.id}');
    expect(source).toContain('?tab=departures');
    expect(source).not.toContain('<DataTable');
    expect(source).not.toContain('setTimeout');
  });

  it('selects the GUIDE surface from MODE_PRESETS and keeps legacy modes on the legacy page', () => {
    const source = readFileSync('src/app/tenant/trips/page.tsx', 'utf8');
    expect(source).toContain('MODE_PRESETS[businessType].navigationProfile');
    expect(source).toContain('<GuideTripsPage />');
    expect(source).toContain('<LegacyTripsPage />');
  });
  it('keeps Trips controls behind shared GUIDE visual and focus tokens', () => {
    const source = readFileSync('src/components/guide/GuideTripsView.tsx', 'utf8');
    expect(source).toContain('GUIDE_UI_CLASSES.secondaryButton');
    expect(source).toContain('GUIDE_UI_CLASSES.accentButton');
    expect(source).toContain('GUIDE_UI_CLASSES.searchInput');
    expect(source).toContain('GUIDE_UI_CLASSES.filterButton');
    expect(source).toContain('type="search"');
    expect(source).not.toMatch(/#[0-9A-Fa-f]{6}/);
    expect(source).not.toMatch(/text-\[[0-9]+px\]/);
  });


});
