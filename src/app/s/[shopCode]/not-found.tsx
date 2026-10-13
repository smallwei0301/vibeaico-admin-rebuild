import { NotFoundBackLink } from '@/app/s/[shopCode]/NotFoundBackLink';
import { publicShopPage as t } from '@/i18n/zh-TW/pages/public-shop';

/** #894：/s/** 找不到資料（店家、行程、方案）時的中文說明；返回連結由 client 元件依路徑決定。 */
export default function PublicShopNotFound() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">
      <section className="card">
        <div className="card-body flex flex-col gap-3">
          <h1 className="text-xl font-semibold">{t.notFound.genericTitle}</h1>
          <p className="text-sm text-secondary">{t.notFound.genericDescription}</p>
          <NotFoundBackLink />
        </div>
      </section>
    </main>
  );
}
