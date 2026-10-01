import type { Metadata } from 'next';
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
  const { shopCode, slug } = await params;
  return <PublicTripDetailsClient shopCode={shopCode} slug={slug} />;
}
