'use client';

import { publicShopPage as t } from '@/i18n/zh-TW/pages/public-shop';

/** #894：不把 error.message 顯示給旅客，避免洩漏內部資訊。 */
export default function PublicShopError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">
      <section className="card" role="alert">
        <div className="card-body flex flex-col gap-3">
          <h1 className="text-xl font-semibold">{t.error.title}</h1>
          <p className="text-sm text-secondary">{t.error.description}</p>
          <button type="button" className="btn btn-primary btn-sm w-fit" onClick={() => reset()}>
            {t.error.retry}
          </button>
        </div>
      </section>
    </main>
  );
}
