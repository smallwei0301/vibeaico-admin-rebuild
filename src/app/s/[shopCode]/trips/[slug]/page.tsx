import type { Metadata } from 'next';
import { PublicTripDetailsClient } from '@/components/public/PublicTripDetailsClient';
import { buildPublicTripMetadata, loadPublicTripPage } from '@/server/public-trip-page';

type Params = {
  params: Promise<{ shopCode: string; slug: string }>;
};

export const dynamic = 'force-dynamic';

export function generateMetadata({ params }: Params): Promise<Metadata> {
  return buildPublicTripMetadata(params);
}

export default async function PublicTripDetailsPage({ params }: Params) {
  // 不可公開（店家／行程不存在、非 PUBLISHED、無有效方案）在此 notFound() → HTTP 404。
  // page params 未經 URL 解碼，解碼後只傳 allowlist props；即時名額仍由 client no-store 取得。
  const props = await loadPublicTripPage(params);
  return <PublicTripDetailsClient shopCode={props.shopCode} slug={props.slug} />;
}
