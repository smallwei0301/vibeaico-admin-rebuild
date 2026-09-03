import { createAdminSupabase } from './supabase';

export const WELCOME_CARD_BUCKET = 'welcome-card-images';

/**
 * Extract a path only when the URL is one of this deployment's public
 * Supabase storage URLs and the first path segment is this tenant.
 * Invalid or external URLs are deliberately treated as a no-op for cleanup.
 */
export function tenantOwnedPublicStoragePath(
  url: string,
  bucket: string,
  tenantId: string,
): string | null {
  let parsed: URL;
  let supabaseOrigin: string;
  try {
    parsed = new URL(url);
    supabaseOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').origin;
  } catch {
    return null;
  }

  if (!supabaseOrigin || parsed.origin !== supabaseOrigin) return null;

  const marker = `/storage/v1/object/public/${bucket}/`;
  const markerIndex = parsed.pathname.indexOf(marker);
  if (markerIndex < 0) return null;

  let path: string;
  try {
    path = decodeURIComponent(parsed.pathname.slice(markerIndex + marker.length));
  } catch {
    return null;
  }

  const segments = path.split('/');
  if (
    !path.startsWith(`${tenantId}/`) ||
    segments.length < 2 ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    return null;
  }
  return path;
}

/** Best-effort cleanup for a tenant-owned welcome-card object. */
export async function removeWelcomeCardImage(url: string, tenantId: string): Promise<boolean> {
  const path = tenantOwnedPublicStoragePath(url, WELCOME_CARD_BUCKET, tenantId);
  if (!path) return false;

  const { error } = await createAdminSupabase()
    .storage
    .from(WELCOME_CARD_BUCKET)
    .remove([path]);
  if (error) throw error;
  return true;
}
