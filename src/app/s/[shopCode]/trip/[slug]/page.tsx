import { notFound, permanentRedirect } from 'next/navigation';
import { decodePublicRouteParam } from '@/lib/public-route-params';
import { SHOP_CODE_PATTERN } from '@/lib/shop-code';
import { LINE_SOURCE_PARAMS, isLineSourceSearch, withLineSource } from '@/lib/public-order-channel';

type Params = {
  params: Promise<{ shopCode: string; slug: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * 相容路由：已送出的 LINE 行程輪播 CTA 帶的是單數 `/s/{shopCode}/trip/{slug}`，
 * 公開詳情頁則在複數 `/trips/{slug}`。此處只做永久轉址，不讀資料。
 */
export const dynamic = 'force-dynamic';

export default async function LegacyTripRedirectPage({ params, searchParams }: Params) {
  const raw = await params;
  // page params 未經 URL 解碼：先解碼，再只編碼一次，避免 %25 雙重編碼。
  const shopCode = decodePublicRouteParam(raw.shopCode);
  const slug = decodePublicRouteParam(raw.slug);
  if (!shopCode || !slug || !SHOP_CODE_PATTERN.test(shopCode)) notFound();
  // 轉址不可丟掉 LINE 來源：src=line 或 utm_source=line 都要帶到 /trips/{slug}，旅客申請時才記 LINE（issue #1090）。
  // 只檢查這兩個鍵、值只認 line；一律正規化成 src=line，不轉送其他任意參數。
  const sp = (await searchParams) ?? {};
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const fromLine = LINE_SOURCE_PARAMS.some((k) => {
    const v = first(sp[k]);
    return !!v && isLineSourceSearch(`?${k}=${encodeURIComponent(v)}`);
  });
  const target = `/s/${encodeURIComponent(shopCode)}/trips/${encodeURIComponent(slug)}`;
  permanentRedirect(fromLine ? withLineSource(target) : target);
}
