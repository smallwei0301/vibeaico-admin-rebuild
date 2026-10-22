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
import { loadPublicShopTimeZone, loadPublicTourRequestStatus } from '@/server/public-tour-request';
import { loadPublicShopContact } from '@/server/public-shop';
import { PublicContactActions } from '@/components/public/PublicContactActions';
import { loadPublicPaymentMethods } from '@/server/public-payment-methods';
import { shouldShowPaymentMethods } from '@/lib/public-payment-methods';
import { PaymentMethodsSection } from '@/components/public/PaymentMethodsSection';
import { SaveStatusLink } from '@/components/public/SaveStatusLink';
import { publicTourRequestPage as t } from '@/i18n/zh-TW/pages/public-tour-request';
import { formatCurrency } from '@/lib/utils';
import { cancelledPaidAmount, partialPaymentBreakdown } from '@/lib/public-partial-payment';
import { common } from '@/i18n/zh-TW/common';
import {
  cancelledCopyKind,
  formatInstantInTimeZone,
  formatPlainDateWithWeekday,
  isLockedBooking,
  travelerVisibleRejectReason,
} from '@/lib/public-order-format';
import { travelerDepositDue } from '@/lib/tour-order-payment-display';
import type { TourOrder } from '@/lib/types';

// 時間點以店家時區（loadPublicShopTimeZone，無效回退 Asia/Taipei）顯示；無法解析時退回原值，不顯示 Invalid Date。
function showInstant(iso: string, timeZone: string): string {
  return formatInstantInTimeZone(iso, timeZone) ?? iso;
}

function paymentDescriptionFor(order: TourOrder): string {
  const refunded = order.refundedAmount ?? 0;
  if (order.paymentStatus === 'REFUNDED' && refunded > 0) {
    return t.status.paymentRefundedWithAmount(formatCurrency(refunded));
  }
  if (order.paymentStatus === 'REFUND_PENDING' && refunded > 0) {
    return t.status.paymentRefundPendingWithAmount(formatCurrency(refunded));
  }
  const depositDue = travelerDepositDue(order);
  if (depositDue != null) {
    return t.status.paymentDepositDueDescription(formatCurrency(depositDue));
  }
  if (order.status === 'CANCELLED' && order.paymentStatus === 'PARTIAL') {
    return t.status.paymentPartialCancelledDescription;
  }
  if (partialPaymentBreakdown(order)) {
    return t.status.paymentPartialWithBreakdownDescription;
  }
  return t.status.paymentDescription[order.paymentStatus];
}

type Params = {
  params: Promise<{ shopCode: string; orderId: string }>;
  searchParams: Promise<{ contact?: string; created?: string }>;
};

export const metadata: Metadata = { title: t.status.metaTitle };

function confirmedUnpaidDescription(order: TourOrder, timeZone: string): string {
  // #1017：應付訂金與店家後台同源（travelerDepositDue）；非訂金情境維持原文案。
  const depositDue = travelerDepositDue(order);
  if (depositDue != null) {
    const amount = formatCurrency(depositDue);
    return order.holdExpiresAt
      ? t.status.confirmedDepositDescription(showInstant(order.holdExpiresAt, timeZone), amount)
      : t.status.confirmedDepositNoDeadlineDescription(amount);
  }
  return order.holdExpiresAt
    ? t.status.confirmedDescription(showInstant(order.holdExpiresAt, timeZone))
    : t.status.confirmedNoDeadlineDescription;
}

function StatusBody({ order, timeZone }: { order: TourOrder; timeZone: string }) {
  if (order.status === 'PENDING') {
    // #46：REQUEST 送出當下不鎖位，其餘 sales_mode（FIXED_DEPARTURE／INSTANT）
    // 建單當下就已經真的鎖位（0111 的 reserve_seats 分流）。PENDING 對兩者是
    // 完全不同的現況，文案不能共用——見 i18n 檔 `pendingLockedTitle` 的檔頭。
    const locked = isLockedBooking(order);
    return (
      <section className="card">
        <div className="card-body flex flex-col gap-2">
          <h1 className="text-xl font-semibold text-warning">
            {locked ? t.status.pendingLockedTitle : t.status.pendingTitle}
          </h1>
          <p className="text-sm text-secondary">
            {locked
              ? order.paymentStatus === 'UNPAID'
                ? t.status.pendingLockedDescription
                : t.status.pendingLockedPaymentDescription
              : t.status.pendingDescription}
          </p>
        </div>
      </section>
    );
  }
  // CONFIRMED／CANCELLED 不依 salesMode 分流：order.salesMode 讀自方案「目前」的 sales_mode，
  // 店家改過方案後會與下單當時不同，tour_orders 又沒有快照欄位，所以用兩種模式都成立的中性文案。
  if (order.status === 'CONFIRMED') {
    return (
      <section className="card">
        <div className="card-body flex flex-col gap-2">
          <h1 className="text-xl font-semibold text-success">{t.status.confirmedTitle}</h1>
          <p className="text-sm text-secondary">
            {order.paymentStatus === 'UNPAID'
              ? confirmedUnpaidDescription(order, timeZone)
              : t.status.confirmedPaymentDescription}
          </p>
        </div>
      </section>
    );
  }
  if (order.status === 'CANCELLED') {
    const shopMessage = travelerVisibleRejectReason(order);
    return (
      <>
      <section className="card">
        <div className="card-body flex flex-col gap-2">
          <h1 className="text-xl font-semibold text-danger">{t.status.cancelledTitle}</h1>
          <p className="text-sm text-secondary">
            {{
              UNPAID: t.status.cancelledDescription,
              PAID: t.status.cancelledPaidDescription,
              REFUNDED: t.status.cancelledRefundedDescription,
            }[cancelledCopyKind(order.paymentStatus)]}
          </p>
        </div>
      </section>
      {shopMessage ? (
        <section className="card">
          <div className="card-body flex flex-col gap-1">
            <h2 className="text-base font-medium">{t.status.shopMessageTitle}</h2>
            <p className="whitespace-pre-line text-sm text-secondary">{shopMessage}</p>
          </div>
        </section>
      ) : null}
      </>
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
  const { contact, created } = await searchParams;

  if (!contact) notFound();
  const [order, timeZone] = await Promise.all([
    loadPublicTourRequestStatus(shopCode, orderId, contact),
    loadPublicShopTimeZone(shopCode),
  ]);
  if (!order) notFound();
  // #938：存取驗證（contact 比對）已通過才會走到這裡；只在未付款且未取消時才查收款方式。
  const paymentMethods = shouldShowPaymentMethods(order) ? await loadPublicPaymentMethods(shopCode, { preferredId: order.paymentMethodId }) : null;

  // #965：存取驗證已通過；店家頁同一套公開規則取得聯絡方式。完全沒填就不渲染（不出現死按鈕）。
  const contactShop = await loadPublicShopContact(shopCode);
  const hasShopContact = contactShop != null
    && Boolean(contactShop.lineBasicId || contactShop.phone || contactShop.email);

  // #988：PARTIAL 且已收金額可靠時才算已付／尾款；否則 null，保留「請向店家確認」說明。
  const partial = partialPaymentBreakdown(order);
  // #917：已取消但曾付款，仍顯示已付金額（不含待付尾款）。
  const cancelledPaid = cancelledPaidAmount(order);
  // #1017：與店家後台「應收定金」同源（isDepositDue）。
  const depositDue = travelerDepositDue(order);

  const justCreatedBanner = created === '1' && order.status === 'PENDING';
  const justCreated = created === '1';

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6">
      {justCreatedBanner ? (
        <section className="card border border-success" role="status">
          <div className="card-body flex flex-col gap-1">
            <h2 className="text-base font-semibold text-success">
              {order.salesMode === 'REQUEST' ? t.status.createdRequestTitle : t.status.createdBookingTitle}
            </h2>
            <p className="text-sm text-secondary">
              {order.salesMode === 'REQUEST' ? t.status.createdRequestDescription : t.status.createdBookingDescription}
            </p>
          </div>
        </section>
      ) : null}
      <StatusBody order={order} timeZone={timeZone} />
      {justCreated ? <SaveStatusLink prominent /> : null}

      <section className="card">
        <div className="card-body flex flex-col gap-2">
          <h2 className="text-base font-medium">{t.status.paymentTitle}</h2>
          <p className="text-sm font-medium">{t.status.paymentState[order.paymentStatus]}</p>
          <p className="text-sm text-secondary">{paymentDescriptionFor(order)}</p>
        </div>
      </section>

      {paymentMethods ? <PaymentMethodsSection methods={paymentMethods} /> : null}

      <section className="card">
        <div className="card-body flex flex-col gap-1">
          <h2 className="text-base font-medium">{t.status.detailsTitle}</h2>
          <dl className="grid grid-cols-[7rem_1fr] gap-y-1 text-sm">
            <dt className="text-secondary">{t.status.fields.orderNo}</dt><dd>{order.orderNo}</dd>
            <dt className="text-secondary">{t.status.fields.trip}</dt><dd>{order.tripTitle}</dd>
            <dt className="text-secondary">{t.status.fields.plan}</dt><dd>{order.planName}</dd>
            <dt className="text-secondary">{t.status.fields.departsOn}</dt>
            <dd>{formatPlainDateWithWeekday(order.departsOn, common.weekdays) ?? order.departsOn}{order.startTime ? ` ${order.startTime}` : ''}</dd>
            <dt className="text-secondary">{t.status.fields.party}</dt>
            <dd>{t.status.partyUnit(order.partySize)}</dd>
            {order.meetingPoint ? (
              <>
                <dt className="text-secondary">{t.status.fields.meetingPoint}</dt>
                <dd className="flex flex-col gap-1">
                  <span className="whitespace-pre-line">{order.meetingPoint}</span>
                  {order.meetingPointMapUrl ? (
                    <a
                      className="w-fit text-primary underline"
                      href={order.meetingPointMapUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {t.status.openMap}
                    </a>
                  ) : null}
                </dd>
              </>
            ) : null}
            <dt className="text-secondary">{t.status.fields.submittedAt}</dt>
            <dd>{showInstant(order.createdAt, timeZone)}</dd>
          </dl>
          <dl className="grid grid-cols-[7rem_1fr] gap-y-1 text-sm">
            <dt className="text-secondary">{t.status.fields.totalAmount}</dt>
            <dd className="font-medium text-dark">{formatCurrency(order.totalAmount)}</dd>
            {depositDue != null ? (
              <>
                <dt className="text-secondary">{t.status.fields.depositDue}</dt>
                <dd>{formatCurrency(depositDue)}</dd>
              </>
            ) : null}
            {partial ? (
              <>
                <dt className="text-secondary">{t.status.fields.paidAmount}</dt>
                <dd>{formatCurrency(partial.paidAmount)}</dd>
                <dt className="text-secondary">{t.status.fields.balanceDue}</dt>
                <dd>{formatCurrency(partial.balanceDue)}</dd>
              </>
            ) : cancelledPaid != null ? (
              <>
                <dt className="text-secondary">{t.status.fields.paidAmount}</dt>
                <dd>{formatCurrency(cancelledPaid)}</dd>
              </>
            ) : null}
          </dl>
          {(order.refundedAmount ?? 0) > 0 ? (
            <dl className="grid grid-cols-[7rem_1fr] gap-y-1 text-sm">
              <dt className="text-secondary">{t.status.fields.refunded}</dt>
              <dd>{formatCurrency(order.refundedAmount ?? 0)}</dd>
            </dl>
          ) : null}
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

      {contactShop && hasShopContact ? (
        <section className="card">
          <div className="card-body flex flex-col gap-3">
            <h2 className="text-base font-medium">{t.status.contact.title}</h2>
            <PublicContactActions shop={contactShop} labels={t.status.contact} />
          </div>
        </section>
      ) : null}

      {justCreated ? null : <SaveStatusLink prominent={false} />}

      <Link href={`/s/${shopCode}`} className="text-sm text-secondary underline">
        {t.status.backToShop}
      </Link>
    </main>
  );
}
