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
import { SHOP_CODE_PATTERN } from '@/lib/shop-code';
import { publicTripDetailsPage as t } from '@/i18n/zh-TW/pages/public-trip-details';

type RouteParams = Promise<{ shopCode: string; slug: string }>;

/** 傳給 client 的 props：精確 allowlist（即時名額由 client no-store 重取）。 */
export type PublicTripPageClientProps = {
  shopCode: string;
  slug: string;
  /**
   * 與公開 API 回應同一 allowlist 形狀（loader 輸出），不是 raw row。
   * 頁面節流超限時省略：不查 DB，由 client 改打公開 API（API 有 429 與重試 UI）。
   */
  initialData?: PublicTripInitialData;
};

const PAGE_RATE_LIMIT_MAX = 60;
const PAGE_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

/**
 * 頁面路徑的節流：使用獨立前綴 `public-trip-page:`（client 有 initialData 後不再於載入時打 API，
 * 兩條路徑各自計數，互不吃對方額度）。以 React cache 讓同一請求的 page 與 generateMetadata
 * 只計一次且共用結果，且超限時兩者都不再查 DB。
 * RSC 無法設定 HTTP 狀態碼：超限時不查 DB、不丟錯、也不能 notFound（無法得知行程是否存在），
 * 照常輸出頁殼但不帶 initialData，由 client 呼叫公開 API 取得資料（API 本身回 429 並有重試 UI）。
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
 * 「沒有有效方案」的已發布行程：頁面回 200 並顯示行程資訊與無方案文案，與店家首頁（會列出該行程）
 * 以及公開 API（回 200＋空 plans）的行為一致；不再因此 404。
 */
export async function loadPublicTripPage(params: RouteParams): Promise<PublicTripPageClientProps> {
  const { shopCode, slug } = await resolvePublicTripDetailsParams(params);
  // 格式不合的 shopCode 在建立節流 bucket 之前就 404，避免任意字串灌出 bucket。
  if (!SHOP_CODE_PATTERN.test(shopCode)) notFound();
  // 超限分支：不丟錯、不 notFound、不查 DB。同一 IP 的實際上限＝頁面 60 次＋公開 API 60 次／10 分鐘
  // （兩者各自計數），超過頁面額度後 client 改打 API，API 再超限才會回 429。
  if (!(await consumePageRateLimit(shopCode))) return { shopCode, slug };
  const data = await loadPublicTripDetails(shopCode, slug);
  // 只有店家／行程不存在或非 PUBLISHED 才 404；已發布但沒有有效方案仍顯示行程（client 顯示無方案文案）。
  if (!data) notFound();
  return { shopCode, slug, initialData: data };
}

export async function buildPublicTripMetadata(params: RouteParams): Promise<Metadata> {
  const fallback: Metadata = { title: t.metadata.title, description: t.metadata.pageDescription };
  // 節流超限：不查 DB、不讓搜尋引擎收錄這個預設頁殼。
  const limited: Metadata = { ...fallback, robots: { index: false, follow: false } };
  const raw = await params;
  const shopCode = decodePublicRouteParam(raw.shopCode);
  const slug = decodePublicRouteParam(raw.slug);
  if (!shopCode || !slug) return fallback;
  try {
    if (!SHOP_CODE_PATTERN.test(shopCode)) return fallback;
    if (!(await consumePageRateLimit(shopCode))) return limited;
    const data = await loadPublicTripDetails(shopCode, slug);
    if (!data) return fallback;
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
