/**
 * `/s/{shopCode}/trips/{slug}` 的 Server 端資料／metadata 組裝（issue #11）。
 * 只使用公開 allowlist loader（`loadPublicTripDetails`，已以 React cache 包裝，
 * 同一請求內 page 與 generateMetadata 共用同一次查詢）；不可公開一律 notFound()，
 * 讓 HTTP 回 404，不再由 client 端顯示空狀態（soft-404）。
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { loadPublicTripDetails } from '@/server/public-shop';
import { decodePublicRouteParam, resolvePublicTripDetailsParams } from '@/lib/public-route-params';
import { publicTripDetailsPage as t } from '@/i18n/zh-TW/pages/public-trip-details';

type RouteParams = Promise<{ shopCode: string; slug: string }>;

/** 傳給 client 的 props：精確 allowlist（即時名額由 client no-store 重取）。 */
export type PublicTripPageClientProps = { shopCode: string; slug: string };

function truncate(text: string, max: number): string {
  const chars = Array.from(text.trim());
  return chars.length <= max ? chars.join('') : chars.slice(0, max - 1).join('') + '…';
}

export async function loadPublicTripPage(params: RouteParams): Promise<PublicTripPageClientProps> {
  const { shopCode, slug } = await resolvePublicTripDetailsParams(params);
  const data = await loadPublicTripDetails(shopCode, slug);
  if (!data || data.trip.plans.length === 0) notFound();
  return { shopCode, slug };
}

export async function buildPublicTripMetadata(params: RouteParams): Promise<Metadata> {
  const fallback: Metadata = { title: t.metadata.title, description: t.metadata.pageDescription };
  const raw = await params;
  const shopCode = decodePublicRouteParam(raw.shopCode);
  const slug = decodePublicRouteParam(raw.slug);
  if (!shopCode || !slug) return fallback;
  try {
    const data = await loadPublicTripDetails(shopCode, slug);
    if (!data || data.trip.plans.length === 0) return fallback;
    const { trip, shop } = data;
    const title = t.metadata.tripTitle(trip.title, shop.name);
    const description = truncate(
      trip.summary || trip.tagline || t.metadata.description(trip.title),
      t.metadata.descriptionMaxLength,
    );
    const images = trip.coverImageUrl ? [trip.coverImageUrl] : undefined;
    return {
      title,
      description,
      openGraph: { title, description, ...(images ? { images } : {}) },
    };
  } catch (error) {
    console.error('[public-trip-details] generateMetadata 失敗', {
      shopCode,
      message: error instanceof Error ? error.message : String(error),
      cause: error instanceof Error ? error.cause : undefined,
    });
    return fallback;
  }
}
