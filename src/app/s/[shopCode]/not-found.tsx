import Link from 'next/link';
import { publicShopPage as t } from '@/i18n/zh-TW/pages/public-shop';

/** #894：/s/** 找不到資料（店家、行程、方案）時的中文說明；not-found 不收 params，故只導回平台首頁。 */
export default function PublicShopNotFound() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">
      <section className="card">
        <div className="card-body flex flex-col gap-3">
          <h1 className="text-xl font-semibold">{t.notFound.genericTitle}</h1>
          <p className="text-sm text-secondary">{t.notFound.genericDescription}</p>
          <Link href="/" className="btn btn-primary btn-sm w-fit">
            {t.notFound.backHome}
          </Link>
        </div>
      </section>
    </main>
  );
}
