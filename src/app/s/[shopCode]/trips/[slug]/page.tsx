import type { Metadata } from 'next';
import { resolvePublicTripDetailsParams } from '@/lib/public-route-params';
import { PublicTripDetailsClient } from '@/components/public/PublicTripDetailsClient';
import { publicTripDetailsPage as t } from '@/i18n/zh-TW/pages/public-trip-details';

type Params = {
  params: Promise<{ shopCode: string; slug: string }>;
};

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: t.metadata.title,
  description: t.metadata.pageDescription,
};

export default async function PublicTripDetailsPage({ params }: Params) {
  // page params 未經 URL 解碼；client 會再 encode 一次呼叫 API，所以這裡必須傳解碼值。
  const { shopCode, slug } = await resolvePublicTripDetailsParams(params);
  return <PublicTripDetailsClient shopCode={shopCode} slug={slug} />;
}
