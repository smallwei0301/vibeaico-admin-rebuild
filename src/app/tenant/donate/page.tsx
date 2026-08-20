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

/* -------------------------------------------------------------------------- */
/* 本頁專用假資料（不寫進 src/mock，避免與其他頁面衝突）                          */
/* -------------------------------------------------------------------------- */

/** 原站 /api/donations/summary 的名單列（displayName 為店家自填的顯示名稱） */
type Donor = { id: string; displayName: string; donatedAt: string };

const MOCK_DONORS: Donor[] = [
  { id: 'dn_1', displayName: '晴天美甲工作室', donatedAt: '2026-08-18T21:04:00+08:00' },
  { id: 'dn_2', displayName: '木子按摩會館', donatedAt: '2026-08-15T13:27:00+08:00' },
  { id: 'dn_3', displayName: '匿名好心人', donatedAt: '2026-08-09T10:12:00+08:00' },
  { id: 'dn_4', displayName: '光影攝影棚', donatedAt: '2026-07-30T19:48:00+08:00' },
  { id: 'dn_5', displayName: '示範美髮沙龍', donatedAt: '2026-07-21T08:35:00+08:00' },
];

/** 全平台累積贊助金額（原站 /api/donations/summary.totalAmount） */
const MOCK_TOTAL_DONATED = 48650;

/** 本店已贊助金額；0 代表尚未贊助過 */
const MOCK_MY_DONATED = 500;

const MIN_AMOUNT = 10;
const MAX_AMOUNT = 100000;

/* 原站以 ?payment=success|failed 從藍新金流導回本頁 */
type PaymentResult = 'success' | 'failed' | null;

/* -------------------------------------------------------------------------- */

export default function DonatePage() {
  const toast = useToast();

  const [donors, setDonors] = React.useState<Donor[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [total, setTotal] = React.useState<number | null>(null);
  const [paymentResult, setPaymentResult] = React.useState<PaymentResult>(null);

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

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      if (cancelled) return;
      setDonors(MOCK_DONORS);
      setTotal(MOCK_TOTAL_DONATED);
      setLoading(false);
    }, 320);
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

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
    setConfirmOpen(true);
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      await new Promise((r) => setTimeout(r, 420));
      setConfirmOpen(false);
    } catch (e) {
      toast.show(
        `${t.messages.payCreateFailedFull}${e instanceof Error ? e.message : t.messages.unknownError}`,
        'danger',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const donorColumns: Column<Donor>[] = [
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

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        {/* ---------------------------------------------------- 贊助表單卡 */}
        <Card>
          <CardBody>
            <div className="stat-label">{t.form.totalLabel}</div>
            <div className="stat-value mb-4">
              {total === null ? common.loading : formatCurrency(total)}
            </div>

            {MOCK_MY_DONATED > 0 ? (
              <p className="form-text mb-3">
                {t.labels.myDonationPrefix}
                {MOCK_MY_DONATED.toLocaleString('zh-TW')}
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
