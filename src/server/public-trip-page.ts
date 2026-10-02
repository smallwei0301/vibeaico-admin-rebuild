/**
 * `/s/{shopCode}/trips/{slug}` 的 Server 端資料／metadata 組裝（issue #11）。
 * 只使用公開 allowlist loader（`loadPublicTripDetails`，已以 React cache 包裝，
 * 同一請求內 page 與 generateMetadata 共用同一次查詢）；不可公開一律 notFound()，
 * 讓 HTTP 回 404，不再由 client 端顯示空狀態（soft-404）。
 */
import type { Metadata } from 'next';
import { cache } from 'react';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { checkRateLimit, clientIpFromHeaders } from '@/server/rate-limit';
import type { PublicTripInitialData } from '@/lib/public-trip-client-state';
import { loadPublicTripDetails } from '@/server/public-shop';
import { decodePublicRouteParam, resolvePublicTripDetailsParams } from '@/lib/public-route-params';
import { publicTripDetailsPage as t } from '@/i18n/zh-TW/pages/public-trip-details';

type RouteParams = Promise<{ shopCode: string; slug: string }>;

/** 傳給 client 的 props：精確 allowlist（即時名額由 client no-store 重取）。 */
export type PublicTripPageClientProps = {
  shopCode: string;
  slug: string;
  /** 與公開 API 回應同一 allowlist 形狀（loader 輸出），不是 raw row。 */
  initialData: PublicTripInitialData;
};

const PAGE_RATE_LIMIT_MAX = 60;
const PAGE_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

/**
 * 頁面路徑的節流：使用獨立前綴 `public-trip-page:`（client 有 initialData 後不再於載入時打 API，
 * 兩條路徑各自計數，互不吃對方額度）。以 React cache 讓同一請求的 page 與 generateMetadata
 * 只計一次且共用結果，且超限時兩者都不再查 DB。
 * RSC 無法設定 HTTP 狀態碼，所以超限時 page 丟出錯誤（Next 回 500 錯誤頁，不是 200 空殼）。
 */
const consumePageRateLimit = cache(async (shopCode: string): Promise<boolean> => {
  const ip = clientIpFromHeaders(await headers());
  return checkRateLimit(`public-trip-page:${ip}:${shopCode}`, {
    max: PAGE_RATE_LIMIT_MAX, windowMs: PAGE_RATE_LIMIT_WINDOW_MS,
  });
});

function truncate(text: string, max: number): string {
  const chars = Array.from(text.trim());
  return chars.length <= max ? chars.join('') : chars.slice(0, max - 1).join('') + '…';
}

/**
 * 刻意的非對稱（M2）：頁面在「沒有任何有效方案」時回 404——不可公開即不可索引，
 * 搜尋引擎不應收錄一個無法預約的行程頁；公開 API 是給 client 取即時資料用，
 * 對同一行程回 200 並帶空的 plans 陣列，由 client 顯示「目前沒有開放的方案」。
 */
export async function loadPublicTripPage(params: RouteParams): Promise<PublicTripPageClientProps> {
  const { shopCode, slug } = await resolvePublicTripDetailsParams(params);
  if (!(await consumePageRateLimit(shopCode))) throw new Error('PUBLIC_TRIP_PAGE_RATE_LIMITED');
  const data = await loadPublicTripDetails(shopCode, slug);
  if (!data || data.trip.plans.length === 0) notFound();
  return { shopCode, slug, initialData: data };
}

export async function buildPublicTripMetadata(params: RouteParams): Promise<Metadata> {
  const fallback: Metadata = { title: t.metadata.title, description: t.metadata.pageDescription };
  const raw = await params;
  const shopCode = decodePublicRouteParam(raw.shopCode);
  const slug = decodePublicRouteParam(raw.slug);
  if (!shopCode || !slug) return fallback;
  try {
    if (!(await consumePageRateLimit(shopCode))) return fallback;
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
    console.error('[public-trip-details] generateMetadata failed', {
      message: error instanceof Error ? error.message : String(error),
      cause: error instanceof Error ? error.cause : undefined,
    });
    return fallback;
  }
}
