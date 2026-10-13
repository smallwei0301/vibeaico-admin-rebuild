import Link from 'next/link';
import { publicTourRequestPage as t } from '@/i18n/zh-TW/pages/public-tour-request';
import { publicShopPage as shop } from '@/i18n/zh-TW/pages/public-shop';

/** #894：申請狀態頁查無資料或聯絡方式不符時顯示（驗證邏輯不變，仍由 page.tsx 呼叫 notFound()）。 */
export default function PublicTourRequestStatusNotFound() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6">
      <section className="card">
        <div className="card-body flex flex-col gap-3">
          <h1 className="text-xl font-semibold">{t.status.notFoundTitle}</h1>
          <p className="text-sm text-secondary">{t.status.notFoundDescription}</p>
          <Link href="/" className="btn btn-primary btn-sm w-fit">
            {shop.notFound.backHome}
          </Link>
        </div>
      </section>
    </main>
  );
}
