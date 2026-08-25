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

/*
 * ⚠️ 這裡曾有 MOCK_DONORS（5 家店的贊助記錄）、MOCK_TOTAL_DONATED = 48650、
 * MOCK_MY_DONATED = 500。贊助後端不存在，那些是憑空捏造的財務陳述與公開記錄，
 * 店家可能據此判斷要不要贊助。依 CLAUDE.md「未知就顯示未知」，一律改為 `--`
 * 與空名單，版面保留給之後接上真後端時填回。禁止再放示範數字或示範名單。
 */

const MIN_AMOUNT = 10;
const MAX_AMOUNT = 100000;

/* 原站以 ?payment=success|failed 從藍新金流導回本頁 */
type PaymentResult = 'success' | 'failed' | null;

/* -------------------------------------------------------------------------- */

export default function DonatePage() {
  const toast = useToast();

  const [paymentResult, setPaymentResult] = React.useState<PaymentResult>(null);

  const [amount, setAmount] = React.useState('');
  const [displayName, setDisplayName] = React.useState('');
  const [error, setError] = React.useState('');
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const value = params.get('payment');
    if (value === 'success' || value === 'failed') setPaymentResult(value);
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

  const submit = () => {
    /*
     * ⚠️ 贊助金流後端尚未建置：這裡沒有任何付款可以建立。
     * 舊實作是假延遲後靜默關窗，看起來像付款已送出 —— 禁止復原。
     */
    setConfirmOpen(false);
    toast.show(t.notBuilt.submitNotEffective, 'warning');
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

      <Alert tone="warning" title={t.notBuilt.title} className="mb-3">
        {t.notBuilt.body}
      </Alert>

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
            <div className="stat-value mb-4">{t.notBuilt.unknownValue}</div>
            <p className="form-text mb-3">{t.notBuilt.totalUnknownHint}</p>

            <p className="form-text mb-3">{t.notBuilt.myDonationUnknown}</p>

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

            <Button variant="danger" block onClick={ask}>
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
            rows={[] as Donor[]}
            rowKey={(d) => d.id}
            empty={
              <EmptyState
                icon={Heart}
                title={t.notBuilt.donorsEmptyTitle}
                description={t.notBuilt.donorsEmptyDescription}
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
        title={t.form.confirmTitle}
        confirmText={t.form.submit}
        message={t.notBuilt.confirmMessage(formatCurrency(numericAmount || 0))}
        onClose={() => setConfirmOpen(false)}
        onConfirm={submit}
      />
    </>
  );
}
