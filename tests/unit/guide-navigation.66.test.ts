import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  GUIDE_MORE_GROUPS,
  GUIDE_PRIMARY_NAV,
  GUIDE_ROUTE_PARENT,
  guideParentForPath,
} from '@/config/guide-navigation';
import { MODE_PRESETS } from '@/config/modes';
import { getNav, isGroup } from '@/config/nav';
import { guideNavigation } from '@/i18n/zh-TW/pages/guide-navigation';
import { resolveGuideMoreHref } from '@/lib/guide-more';

function guideVisibleHrefs() {
  return getNav('GUIDE')
    .flatMap((entry) => isGroup(entry) ? entry.children : [entry])
    .map((leaf) => leaf.href)
    .filter((href) => href !== '#');
}

describe('GUIDE five-parent information architecture (#66 Phase B)', () => {
  it('routes GUIDE through GUIDE_FIVE while preserving legacy navigation for other modes', () => {
    expect(MODE_PRESETS.GUIDE.navigationProfile).toBe('GUIDE_FIVE');
    expect(MODE_PRESETS.LOCAL_SHOP.navigationProfile).toBe('LEGACY_FULL');
    expect(MODE_PRESETS.CLINIC.navigationProfile).toBe('LEGACY_FULL');
  });

  it('has exactly the five canonical first-level GUIDE destinations', () => {
    expect(GUIDE_PRIMARY_NAV.map((item) => [item.key, item.href])).toEqual([
      ['home', '/tenant/dashboard'],
      ['departures', '/tenant/calendar'],
      ['travelers', '/tenant/customers'],
      ['messages', '/tenant/chat'],
      ['more', '/tenant/more'],
    ]);
    expect(Object.keys(guideNavigation.parentLabels)).toEqual([
      'home', 'departures', 'travelers', 'messages', 'more',
    ]);
  });

  it('assigns every currently GUIDE-visible real nav route to a canonical parent', () => {
    const visible = guideVisibleHrefs();
    const missing = visible.filter((href) => !(href in GUIDE_ROUTE_PARENT));
    expect(missing).toEqual([]);
  });

  it('keeps nested deep links under the same parent without rewriting existing routes', () => {
    expect(guideParentForPath('/tenant/tour-orders/TO-123')).toBe('departures');
    expect(guideParentForPath('/tenant/trips/TRIP-1')).toBe('departures');
    expect(guideParentForPath('/tenant/customers/C-1')).toBe('travelers');
    expect(guideParentForPath('/tenant/chat/conversations/1')).toBe('messages');
    expect(guideParentForPath('/tenant/settings/profile')).toBe('more');
    expect(guideParentForPath('/tenant/not-a-real-route')).toBeNull();
  });

  it('keeps More links unique and points only to existing tenant route shapes', () => {
    const links = GUIDE_MORE_GROUPS.flatMap((group) => group.links);
    const hrefs = links.map((link) => link.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs.every((href) => href.startsWith('/tenant/'))).toBe(true);
    expect(hrefs.every((href) => href in GUIDE_ROUTE_PARENT)).toBe(true);
  });

  it('preserves existing feature-gate metadata instead of inventing page-local GUIDE gates', () => {
    const byHref = new Map(
      GUIDE_MORE_GROUPS.flatMap((group) => group.links).map((link) => [link.href, link.feature]),
    );
    expect(byHref.get('/tenant/trips')).toBe('TOUR_MODULE');
    expect(byHref.get('/tenant/products')).toBe('PRODUCT_SALES');
    expect(byHref.get('/tenant/product-orders')).toBe('PRODUCT_SALES');
    expect(byHref.get('/tenant/inventory')).toBe('INVENTORY');
    expect(byHref.get('/tenant/rich-menu-design')).toBe('CUSTOM_RICH_MENU');
    expect(byHref.get('/tenant/keyword-replies')).toBe('KEYWORD_REPLY');
    expect(byHref.get('/tenant/ai-settings')).toBe('AI_ASSISTANT');
  });

  it('keeps gated More links truthful when a feature is inactive or still loading', () => {
    const source = readFileSync('src/app/tenant/more/page.tsx', 'utf8');
    expect(source).toContain('listFeatures()');
    expect(source).toContain('feature-store?feature=');
    expect(source).toContain('guideNavigation.more.gating.locked');
    expect(source).toContain('guideNavigation.more.gating.loading');
    expect(source).toContain('featureLoadFailed');
  });

  it('More page reads the mode preset and does not scatter a GUIDE businessType conditional', () => {
    const source = readFileSync('src/app/tenant/more/page.tsx', 'utf8');
    expect(source).toContain('MODE_PRESETS[businessType].navigationProfile');
    expect(source).not.toMatch(/businessType\s*===\s*['"]GUIDE['"]/);
    expect(source).not.toMatch(/businessType\s*!==\s*['"]GUIDE['"]/);
  });
  it('keeps More feature links fail-closed while loading and after a failed lookup', () => {
    expect(resolveGuideMoreHref('/tenant/reports', 'BASIC_REPORT', null)).toBeNull();
    expect(resolveGuideMoreHref('/tenant/reports', 'BASIC_REPORT', new Set(['BASIC_REPORT']))).toBe('/tenant/reports');
    expect(resolveGuideMoreHref('/tenant/reports', 'BASIC_REPORT', new Set())).toBe(
      '/tenant/feature-store?feature=BASIC_REPORT',
    );
    expect(resolveGuideMoreHref('/tenant/settings', undefined, null)).toBe('/tenant/settings');

    const source = readFileSync('src/app/tenant/more/page.tsx', 'utf8');
    expect(source).toContain('href={href ?? \'#\'}');
    expect(source).toContain('aria-disabled={!featureReady}');
    expect(source).toContain('event.preventDefault()');
    expect(source).toContain('setActiveFeatures(new Set())');
    expect(source).toContain('GUIDE_STATUS_CLASSES[featureTone]');
    expect(source).not.toContain('border-[#CDE8DA]');
  });

});
