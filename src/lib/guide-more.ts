export type GuideMoreFeatureState = ReadonlySet<string> | null;

/**
 * Resolve a More-page destination from the authoritative feature lookup.
 *
 * A null set means the lookup is still unresolved, so callers must not
 * navigate to either the gated route or the feature store yet. An empty set
 * is a resolved fail-closed lookup and therefore sends gated links to the
 * feature store.
 */
export function resolveGuideMoreHref(
  href: string,
  feature: string | undefined,
  activeFeatures: GuideMoreFeatureState,
): string | null {
  if (!feature) return href;
  if (activeFeatures === null) return null;
  return activeFeatures.has(feature)
    ? href
    : `/tenant/feature-store?feature=${encodeURIComponent(feature)}`;
}
