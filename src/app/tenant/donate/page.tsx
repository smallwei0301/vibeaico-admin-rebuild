'use client';
import * as React from 'react';
import Link from 'next/link';
import { Heart } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmModal } from '@/components/ui/Modal';
import { FormError, FormGroup, FormText, Input, Label } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { common } from '@/i18n/zh-TW/common';
import { donatePage as t } from '@/i18n/zh-TW/pages/donate';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { ApiError } from '@/lib/api';
import { USE_MOCK } from '@/config/env';
import type { DonationDonor } from '@/lib/types';
import {
  DONATION_CHECKOUT_BLOCKED_CODE,
  createDonationOrder,
  getDonationCheckout,
  getDonationSummary,
} from '@/services/donate';

const MIN_AMOUNT = 10;
const MAX_AMOUNT = 100000;

/* 綠界付款完成後從 ClientBackURL 導回本頁；真正的付款結果以 callback 寫入 DB 為準， */
/* 這裡的 query string 只用來決定要不要顯示「處理中」提示，不當成付款成功的證據。 */
type PaymentResult = 'success' | 'failed' | null;

/* -------------------------------------------------------------------------- */

export default function DonatePage() {
  const toast = useToast();

  const [donors, setDonors] = React.useState<DonationDonor[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [total, setTotal] = React.useState<number | null>(null);
  const [myDonated, setMyDonated] = React.useState(0);
  const [paymentResult, setPaymentResult] = React.useState<PaymentResult>(null);
  const [checkoutBlocked, setCheckoutBlocked] = React.useState(false);

  const [amount, setAmount] = React.useState('');
  const [displayName, setDisplayName] = React.useState('');
  const [error, setError] = React.useState('');
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const value = params.get('payment');
    if (value === 'success' || value === 'failed') setPaymentResult(value);
  }, []);

  const loadSummary = React.useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const summary = await getDonationSummary();
      setDonors(summary.donors);
      setTotal(summary.totalDonated);
      setMyDonated(summary.myDonated);
    } catch (e) {
      console.error(t.messages.loadSummaryFailed, e);
      setLoadFailed(true);
      toast.show(t.messages.loadFailed, 'danger');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const numericAmount = Number(amount);

  const validate = (): string => {
    if (amount.trim() === '' || !Number.isInteger(numericAmount)) return t.form.amountInvalidInteger;
    if (numericAmount < MIN_AMOUNT || numericAmount > MAX_AMOUNT) return t.form.amountOutOfRange;
    if (displayName.length > t.form.displayNameMax) {
      return common.validation.maxLength(t.form.displayNameMax);
    }
    return '';
  };

  const ask = () => {
    const err = validate();
    setError(err);
    if (err) { toast.show(err, 'warning'); return; }
    setCheckoutBlocked(false);
    setConfirmOpen(true);
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      const order = await createDonationOrder({ amount: numericAmount, displayName: displayName.trim() });
      const checkout = await getDonationCheckout(order.id);

      if (USE_MOCK) {
        // 骨架展示模式：沒有真的金流可以導向，直接模擬「已回到本頁、付款成功」，
        // 並重新整理總覽（見 src/services/donate.ts 的 mock 分支）。
        setConfirmOpen(false);
        setPaymentResult('success');
        await loadSummary();
        return;
      }

      if (!checkout.actionUrl) {
        // 理論上不會發生：非 mock 模式下 actionUrl 一定非空，否則 getDonationCheckout
        // 應該已經丟出錯誤。留一道防線，不讓使用者卡在「送出中」。
        throw new Error(t.messages.unknownError);
      }

      // 自動送出的隱藏表單，把瀏覽器導向 ECPay AIO Checkout 頁面。
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = checkout.actionUrl;
      for (const [key, value] of Object.entries(checkout.fields)) {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = key;
        input.value = value;
        form.appendChild(input);
      }
      document.body.appendChild(form);
      form.submit();
      // 頁面即將導離，不需要再收尾 setSubmitting/setConfirmOpen。
    } catch (e) {
      if (e instanceof ApiError && e.code === DONATION_CHECKOUT_BLOCKED_CODE) {
        setCheckoutBlocked(true);
        setConfirmOpen(false);
        toast.show(t.checkoutBlocked.title, 'warning');
        return;
      }
      toast.show(
        `${t.messages.payCreateFailedFull}${e instanceof Error ? e.message : t.messages.unknownError}`,
        'danger',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const donorColumns: Column<DonationDonor>[] = [
    {
      key: 'shop', header: t.donors.columns.shop,
      render: (d) => (
        <span className="font-semibold text-dark">{t.donors.thanksPrefix}{d.displayName}</span>
      ),
    },
    {
      key: 'donatedAt', header: t.donors.columns.donatedAt, width: '180px',
      render: (d) => formatDateTime(d.donatedAt),
    },
  ];

  return (
    <>
      <PageHeader title={t.title} />

      {paymentResult === 'success' ? (
        <Alert tone="success" className="mb-3">{t.payment.successText}</Alert>
      ) : null}

      {paymentResult === 'failed' ? (
        <Alert tone="danger" className="mb-3">
          <strong>{t.payment.failedStrong}</strong>
          {t.payment.failedBody}
          <a className="underline" href={`mailto:${t.payment.contactEmail}`}>
            {t.payment.contactEmail}
          </a>
        </Alert>
      ) : null}

      {checkoutBlocked ? (
        <Alert tone="warning" className="mb-3">
          <strong>{t.checkoutBlocked.title}</strong>
          {'　'}
          {t.checkoutBlocked.body}
          <a className="underline" href={`mailto:${t.payment.contactEmail}`}>
            {t.payment.contactEmail}
          </a>
        </Alert>
      ) : null}

      {loadFailed ? (
        <Alert tone="danger" className="mb-3">{t.donors.loadFailed}</Alert>
      ) : null}

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        {/* ---------------------------------------------------- 贊助表單卡 */}
        <Card>
          <CardBody>
            <div className="stat-label">{t.form.totalLabel}</div>
            <div className="stat-value mb-4">
              {loading ? common.loading : formatCurrency(total ?? 0)}
            </div>

            {!loading && myDonated > 0 ? (
              <p className="form-text mb-3">
                {t.labels.myDonationPrefix}
                {myDonated.toLocaleString('zh-TW')}
                {t.labels.myDonationSuffix}
              </p>
            ) : null}

            <FormGroup>
              <Label>{t.form.amountLabel}</Label>
              <div className="btn-group flex-wrap">
                {t.form.quickAmounts.map((q) => (
                  <Button
                    key={q.value}
                    variant={numericAmount === q.value ? 'primary' : 'secondary'}
                    onClick={() => { setAmount(String(q.value)); setError(''); }}
                  >
                    {q.label}
                  </Button>
                ))}
              </div>
            </FormGroup>

            <FormGroup>
              <Label htmlFor="donateAmount">{t.form.customAmount}</Label>
              <Input
                id="donateAmount" type="number" value={amount}
                placeholder={t.form.customAmountPlaceholder}
                onChange={(e) => setAmount(e.target.value)}
              />
              <FormText>{t.form.customAmountHelp}</FormText>
            </FormGroup>

            <FormGroup>
              <Label htmlFor="donateDisplayName">{t.form.displayName}</Label>
              <Input
                id="donateDisplayName" value={displayName} maxLength={t.form.displayNameMax}
                placeholder={t.form.displayNamePlaceholder}
                onChange={(e) => setDisplayName(e.target.value)}
              />
              <FormText>{t.form.displayNameHelp}</FormText>
            </FormGroup>

            {error ? <FormError>{error}</FormError> : null}

            <Button
              variant="danger" block
              loading={submitting} loadingText={t.form.submitting}
              onClick={ask}
            >
              <Heart size={15} />{t.form.submit}
            </Button>
            <p className="form-text mt-2">{t.form.payHint}</p>
          </CardBody>
        </Card>

        {/* ---------------------------------------------------- 贊助名單卡 */}
        <Card>
          <CardHeader>
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2">
                <Heart size={16} />{t.donors.heading}
              </CardTitle>
              <div className="form-text">{t.donors.subtitle}</div>
            </div>
          </CardHeader>
          <DataTable
            columns={donorColumns}
            rows={donors}
            loading={loading}
            rowKey={(d) => d.id}
            empty={
              <EmptyState
                icon={Heart}
                title={t.donors.emptyTitle}
                description={t.donors.emptyDescription}
                action={<span className="text-sm text-secondary">{t.donors.firstDonorCallout}</span>}
              />
            }
          />
        </Card>
      </div>

      <Alert tone="neutral" icon={false} className="mb-4">
        {t.notice.lead}
        <strong>{t.notice.strong}</strong>
        {t.notice.middle}
        {' '}
        <Link className="underline" href="/tenant/points">{t.notice.link}</Link>
        {t.notice.tail}
      </Alert>

      <ConfirmModal
        open={confirmOpen}
        loading={submitting}
        title={t.form.confirmTitle}
        confirmText={t.form.submit}
        message={t.form.confirmMessage(formatCurrency(numericAmount || 0))}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => void submit()}
      />
    </>
  );
}
