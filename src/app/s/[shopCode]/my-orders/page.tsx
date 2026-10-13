/**
 * `/s/{shopCode}/my-orders` — 旅客「我的訂單」查詢頁（issue #46 第三片）。
 *
 * issue #650 起匿名聯絡方式查詢已停用，這一頁只顯示「需要旅客身分驗證」的
 * 空狀態，不呼叫任何查詢 API；正式批次查單由 #12 的旅客身分接手。
 * 路由刻意保留（可能被旅客加入書籤），但站內不再有連結指向這裡。
 */
import type { Metadata } from 'next';
import { publicTourRequestPage as t } from '@/i18n/zh-TW/pages/public-tour-request';
import { MyOrdersSearch } from './MyOrdersSearch';

type Params = {
  params: Promise<{ shopCode: string }>;
};

export const metadata: Metadata = { title: t.myOrders.metaTitle };

export default async function MyOrdersPage({ params }: Params) {
  const { shopCode } = await params;
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6">
      <MyOrdersSearch shopCode={shopCode} />
    </main>
  );
}
