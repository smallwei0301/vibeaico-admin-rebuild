/**
 * `/s/{shopCode}/my-orders` — 旅客「我的訂單」查詢頁（issue #46 第三片）。
 *
 * 這一頁不在伺服器端預先讀資料——「用什麼聯絡方式查詢」是使用者當下輸入的，
 * 不是路由參數，所以整頁只負責掛載 client 表單元件，實際查詢由它呼叫
 * `POST /api/public/tour-requests/mine`（同 `RequestForm` 呼叫送出 API 的模式）。
 */
import type { Metadata } from 'next';
import { publicTourRequestPage as t } from '@/i18n/zh-TW/pages/public-tour-request';
import { MyOrdersSearch } from './MyOrdersSearch';

type Params = {
  params: Promise<{ shopCode: string }>;
  searchParams: Promise<{ contact?: string }>;
};

export const metadata: Metadata = { title: t.myOrders.metaTitle };

export default async function MyOrdersPage({ params, searchParams }: Params) {
  const { shopCode } = await params;
  const { contact } = await searchParams;
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6">
      <MyOrdersSearch shopCode={shopCode} initialContact={contact ?? ''} />
    </main>
  );
}
