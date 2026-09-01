'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';

import { GuideEmptyState, GuideHeader, GuideSettingsGroup } from '@/components/guide';
import { useBusinessType } from '@/components/layout/BusinessTypeContext';
import { GUIDE_MORE_GROUPS } from '@/config/guide-navigation';
import { GUIDE_STATUS_CLASSES, GUIDE_UI_CLASSES } from '@/config/guide-ui';
import { MODE_PRESETS } from '@/config/modes';
import { guideNavigation } from '@/i18n/zh-TW/pages/guide-navigation';
import { navLabel } from '@/i18n/zh-TW/nav';
import { listFeatures } from '@/services/settings';
import { resolveGuideMoreHref } from '@/lib/guide-more';
import { cn } from '@/lib/utils';

export default function GuideMorePage() {
  const businessType = useBusinessType();
  const profile = MODE_PRESETS[businessType].navigationProfile;
  const [activeFeatures, setActiveFeatures] = React.useState<Set<string> | null>(null);
  const [featureLoadFailed, setFeatureLoadFailed] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    setActiveFeatures(null);
    setFeatureLoadFailed(false);

    if (profile !== 'GUIDE_FIVE') {
      return () => {
        cancelled = true;
      };
    }

    void listFeatures()
      .then((features) => {
        if (!cancelled) {
          setActiveFeatures(new Set(features.filter((f) => f.active).map((f) => f.code)));
        }
      })
      .catch(() => {
        if (!cancelled) {
          // An unavailable feature list must fail closed: gated links go to the
          // feature store instead of pretending the destination is active.
          setActiveFeatures(new Set());
          setFeatureLoadFailed(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [profile]);

  if (profile !== 'GUIDE_FIVE') {
    return (
      <div className={GUIDE_UI_CLASSES.page}>
        <GuideEmptyState
          title={guideNavigation.more.legacyUnavailableTitle}
          description={guideNavigation.more.legacyUnavailableDescription}
        />
      </div>
    );
  }

  return (
    <div className={cn(GUIDE_UI_CLASSES.page, GUIDE_UI_CLASSES.sectionGap)}>
      <GuideHeader title={guideNavigation.more.title} subtitle={guideNavigation.more.subtitle} />

      {GUIDE_MORE_GROUPS.map((group) => {
        const copy = guideNavigation.more.groups[group.key];
        return (
          <GuideSettingsGroup key={group.key} title={copy.title} description={copy.description}>
            {group.links.map((link) => {
              const Icon = link.icon;
              const requiresFeature = !!link.feature;
              const featureReady = !requiresFeature || activeFeatures !== null;
              const featureActive = !requiresFeature || !!activeFeatures?.has(link.feature!);
              const href = resolveGuideMoreHref(link.href, link.feature, activeFeatures);
              const featureTone = !featureReady
                ? 'neutral'
                : featureActive
                  ? 'positive'
                  : 'attention';
              return (
                <Link
                  key={link.href}
                  href={href ?? '#'}
                  aria-disabled={!featureReady}
                  tabIndex={featureReady ? undefined : -1}
                  onClick={(event) => {
                    if (!featureReady) event.preventDefault();
                  }}
                  className={cn(
                    GUIDE_UI_CLASSES.touchTarget,
                    GUIDE_UI_CLASSES.settingsLink,
                    'flex items-center gap-3 px-4 py-3 sm:px-5',
                  )}
                >
                  <span className={cn(GUIDE_UI_CLASSES.avatarSurface, 'flex size-10 shrink-0 items-center justify-center rounded-xl')} aria-hidden>
                    <Icon size={20} />
                  </span>
                  <span className={cn(GUIDE_UI_CLASSES.body, 'min-w-0 flex-1 font-semibold')}>
                    {navLabel(link.navKey, businessType)}
                  </span>
                  {requiresFeature ? (
                    <span
                      className={cn(
                        'shrink-0 rounded-full border px-2 py-1 text-[14px] font-semibold',
                        GUIDE_STATUS_CLASSES[featureTone],
                      )}
                    >
                      {!featureReady
                        ? guideNavigation.more.gating.loading
                        : featureActive
                          ? guideNavigation.more.gating.active
                          : guideNavigation.more.gating.locked}
                    </span>
                  ) : null}
                  <ArrowUpRight size={18} className={cn('shrink-0', GUIDE_UI_CLASSES.mutedIcon)} aria-hidden />
                </Link>
              );
            })}
          </GuideSettingsGroup>
        );
      })}
      {featureLoadFailed ? (
        <p className={GUIDE_UI_CLASSES.secondary} role="status">
          {guideNavigation.more.gating.error}
        </p>
      ) : null}
    </div>
  );
}
