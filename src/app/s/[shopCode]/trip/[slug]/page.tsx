import { notFound, permanentRedirect } from 'next/navigation';
import { decodePublicRouteParam } from '@/lib/public-route-params';
import { SHOP_CODE_PATTERN } from '@/lib/shop-code';

type Params = {
  params: Promise<{ shopCode: string; slug: string }>;
};

/**
 * 相容路由：已送出的 LINE 行程輪播 CTA 帶的是單數 `/s/{shopCode}/trip/{slug}`，
 * 公開詳情頁則在複數 `/trips/{slug}`。此處只做永久轉址，不讀資料。
 */
export const dynamic = 'force-dynamic';

export default async function LegacyTripRedirectPage({ params }: Params) {
  const raw = await params;
  // page params 未經 URL 解碼：先解碼，再只編碼一次，避免 %25 雙重編碼。
  const shopCode = decodePublicRouteParam(raw.shopCode);
  const slug = decodePublicRouteParam(raw.slug);
  if (!shopCode || !slug || !SHOP_CODE_PATTERN.test(shopCode)) notFound();
  permanentRedirect(`/s/${encodeURIComponent(shopCode)}/trips/${encodeURIComponent(slug)}`);
}
