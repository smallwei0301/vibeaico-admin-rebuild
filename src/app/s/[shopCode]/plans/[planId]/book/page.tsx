/**
 * `/s/{shopCode}/plans/{planId}/book` — FIXED_DEPARTURE 方案的旅客預約頁（issue #46）。
 *
 * 與 `/s/{shopCode}/plans/{planId}/request` 同一個道理：Server Component，服務端
 * 用 service role 直接讀（`loadPublicBookingPlan`，見該檔檔頭三條白名單規則），
 * 把整理好的資料交給 client 表單元件負責互動與送出。
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { loadPublicBookingPlan } from '@/server/public-tour-booking';
import { publicTourBookingPage as t } from '@/i18n/zh-TW/pages/public-tour-booking';
import { BookingForm } from './BookingForm';

type Params = {
  params: Promise<{ shopCode: string; planId: string }>;
};

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { shopCode, planId } = await params;
  try {
    const plan = await loadPublicBookingPlan(shopCode, planId);
    if (!plan) return { title: t.errors.notFound };
    return { title: t.form.metaTitle(plan.planName) };
  } catch (error) {
    // 同 `/s/{shopCode}/plans/{planId}/request` 的既有理由：generateMetadata 的
    // 錯誤會逐字序列化進公開 HTML，這裡也要把真正原因留在伺服器日誌、不外流。
    console.error('[public-tour-booking] generateMetadata 失敗', {
      shopCode, planId,
      message: error instanceof Error ? error.message : String(error),
      cause: error instanceof Error ? error.cause : undefined,
    });
    return { title: t.errors.notFound };
  }
}

export default async function PublicTourBookingPage({ params }: Params) {
  const { shopCode, planId } = await params;
  const plan = await loadPublicBookingPlan(shopCode, planId);
  if (!plan) notFound();

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6">
      <BookingForm shopCode={shopCode} plan={plan} />
    </main>
  );
}
