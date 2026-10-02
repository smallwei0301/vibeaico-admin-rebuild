import { permanentRedirect } from 'next/navigation';

type Params = {
  params: Promise<{ shopCode: string; slug: string }>;
};

/**
 * 相容路由：已送出的 LINE 行程輪播 CTA 帶的是單數 `/s/{shopCode}/trip/{slug}`，
 * 公開詳情頁則在複數 `/trips/{slug}`。此處只做永久轉址，不讀資料。
 */
export const dynamic = 'force-dynamic';

export default async function LegacyTripRedirectPage({ params }: Params) {
  const { shopCode, slug } = await params;
  permanentRedirect(`/s/${encodeURIComponent(shopCode)}/trips/${encodeURIComponent(slug)}`);
}
