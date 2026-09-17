/**
 * `/s/{shopCode}/requests/{orderId}` — 旅客的申請狀態頁（issue #46）。
 *
 * ⚠️ 這一頁最重要的規則：PENDING 絕對不能顯示成「預約成功」。送出 REQUEST 申請
 * 的當下完全沒有鎖任何名額（`0111`），只有導遊按下「接受」才會原子重查並鎖位、
 * 開始跑付款保留期。文案來源固定在 `src/i18n/zh-TW/pages/public-tour-request.ts`
 * 的 `status.pendingTitle`，不得在這個檔另外硬編一句更樂觀的說法。
 *
 * ## 身分驗證
 *
 * 這條路徑還沒有旅客登入（#11／#12，DEPENDENCY，見 PR 說明），所以用「申請時填的
 * 聯絡方式其中一項」當最小可行的核對機制：網址帶 `?contact=`，與訂單 `contact`
 * jsonb 裡任一欄位（phone／line／email）不分大小寫比對得上才顯示，比對不上一律
 * 視為找不到（`loadPublicTourRequestStatus` 內部已經做這件事，這裡不重複判斷、
 * 也不能因為「使用者體驗」而放寬）。
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { loadPublicTourRequestStatus } from '@/server/public-tour-request';
import { publicTourRequestPage as t } from '@/i18n/zh-TW/pages/public-tour-request';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import type { TourOrder } from '@/lib/types';

type Params = {
  params: Promise<{ shopCode: string; orderId: string }>;
  searchParams: Promise<{ contact?: string }>;
};

export const metadata: Metadata = { title: t.status.metaTitle };

function StatusBody({ order }: { order: TourOrder }) {
  if (order.status === 'PENDING') {
    return (
      <section className="card">
        <div className="card-body flex flex-col gap-2">
          <h1 className="text-xl font-semibold text-warning">{t.status.pendingTitle}</h1>
          <p className="text-sm text-secondary">{t.status.pendingDescription}</p>
        </div>
      </section>
    );
  }
  if (order.status === 'CONFIRMED') {
    return (
      <section className="card">
        <div className="card-body flex flex-col gap-2">
          <h1 className="text-xl font-semibold text-success">{t.status.confirmedTitle}</h1>
          <p className="text-sm text-secondary">
            {order.holdExpiresAt
              ? t.status.confirmedDescription(formatDateTime(order.holdExpiresAt))
              : t.status.confirmedNoDeadlineDescription}
          </p>
        </div>
      </section>
    );
  }
  if (order.status === 'CANCELLED') {
    return (
      <section className="card">
        <div className="card-body flex flex-col gap-2">
          <h1 className="text-xl font-semibold text-danger">{t.status.cancelledTitle}</h1>
          <p className="text-sm text-secondary">{t.status.cancelledDescription}</p>
        </div>
      </section>
    );
  }
  return (
    <section className="card">
      <div className="card-body flex flex-col gap-2">
        <h1 className="text-xl font-semibold">{t.status.completedTitle}</h1>
        <p className="text-sm text-secondary">{t.status.completedDescription}</p>
      </div>
    </section>
  );
}

export default async function PublicTourRequestStatusPage({ params, searchParams }: Params) {
  const { shopCode, orderId } = await params;
  const { contact } = await searchParams;

  if (!contact) notFound();
  const order = await loadPublicTourRequestStatus(shopCode, orderId, contact);
  if (!order) notFound();

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6">
      <StatusBody order={order} />

      <section className="card">
        <div className="card-body flex flex-col gap-1">
          <h2 className="text-base font-medium">{t.status.fields.orderNo}</h2>
          <dl className="grid grid-cols-[7rem_1fr] gap-y-1 text-sm">
            <dt className="text-secondary">{t.status.fields.orderNo}</dt><dd>{order.orderNo}</dd>
            <dt className="text-secondary">{t.status.fields.trip}</dt><dd>{order.tripTitle}</dd>
            <dt className="text-secondary">{t.status.fields.plan}</dt><dd>{order.planName}</dd>
            <dt className="text-secondary">{t.status.fields.departsOn}</dt>
            <dd>{order.departsOn}{order.startTime ? ` ${order.startTime}` : ''}</dd>
            <dt className="text-secondary">{t.status.fields.party}</dt>
            <dd>{t.status.partyUnit(order.partySize)}</dd>
            <dt className="text-secondary">{t.status.fields.submittedAt}</dt>
            <dd>{formatDateTime(order.createdAt)}</dd>
          </dl>
          <div className="mt-1 text-sm font-medium text-dark">
            {formatCurrency(order.totalAmount)}
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-body flex flex-col gap-1">
          <h2 className="text-base font-medium">{t.status.cancellationPolicyTitle}</h2>
          <p className="text-sm text-secondary">
            {order.refundPolicySnapshot
              ? t.form.cancellationPolicy[order.refundPolicySnapshot]
              : t.status.cancellationPolicyMissing}
          </p>
        </div>
      </section>

      <Link href={`/s/${shopCode}`} className="text-sm text-secondary underline">
        {t.status.backToShop}
      </Link>
    </main>
  );
}
