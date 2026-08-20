'use client';
import * as React from 'react';
import Link from 'next/link';
import { ArrowLeftRight, Clock, Coins, CreditCard, Plus, Wallet } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { StatCard } from '@/components/ui/StatCard';
import {
  DataTable, DataTableContainer, DataTableFooter, DataTableHeader, type Column,
} from '@/components/ui/DataTable';
import { Pagination } from '@/components/ui/Pagination';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmModal, Modal } from '@/components/ui/Modal';
import {
  CharCounter, FormError, FormGroup, FormText, Input, Label, Select, Textarea,
} from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { MOCK_POINT_BALANCE, MOCK_POINT_TRANSACTIONS, MOCK_TENANTS } from '@/mock';
import { common } from '@/i18n/zh-TW/common';
import { nav } from '@/i18n/zh-TW/nav';
import { pointsPage as t } from '@/i18n/zh-TW/pages/points';
import { formatDateTime, formatNumber } from '@/lib/utils';
import type { PointTransaction } from '@/lib/types';

/* -------------------------------------------------------------------------- */
/* 本頁專用假資料（不寫進 src/mock，避免與其他頁面衝突）                          */
/* -------------------------------------------------------------------------- */

/**
 * 原站的異動類型比 lib/types.ts 的 PointTransaction 多幾種（功能訂閱、推薦獎勵、
 * 贈送、過期、處理中、駁回、取消）。契約型別不在本頁修改，這裡以本地聯集擴充。
 */
type PointTxnType = keyof typeof t.types;
type PointTxn = Omit<PointTransaction, 'type'> & { type: PointTxnType };

/** 由 src/mock 的共用資料延伸，補上原站才有的其他異動類型 */
const EXTRA_TRANSACTIONS: PointTxn[] = [
  {
    id: 'pt_x1', type: 'SUBSCRIPTION', amount: -49, balanceAfter: 4771,
    description: '訂閱「進階顧客管理」1 個月', createdAt: '2026-08-14T10:05:00+08:00',
  },
  {
    id: 'pt_x2', type: 'REFERRAL', amount: 500, balanceAfter: 4820,
    description: '推薦「晴天美甲工作室」完成首次儲值', createdAt: '2026-07-05T14:22:00+08:00',
  },
  {
    id: 'pt_x3', type: 'BONUS', amount: 250, balanceAfter: 4320,
    description: '儲值贈送 5%', createdAt: '2026-06-28T09:12:00+08:00',
  },
  {
    id: 'pt_x4', type: 'TRANSFER_OUT', amount: -800, balanceAfter: 4070,
    description: '轉出至「示範診所」', createdAt: '2026-06-20T17:44:00+08:00',
  },
  {
    id: 'pt_x5', type: 'PROCESSING', amount: 1000, balanceAfter: 4870,
    description: '線上儲值（付款處理中）', createdAt: '2026-06-18T21:30:00+08:00',
  },
  {
    id: 'pt_x6', type: 'REJECTED', amount: 0, balanceAfter: 3870,
    description: '儲值申請未通過', createdAt: '2026-06-15T13:08:00+08:00',
  },
  {
    id: 'pt_x7', type: 'EXPIRED', amount: -120, balanceAfter: 3870,
    description: '活動贈點到期', createdAt: '2026-06-12T00:05:00+08:00',
  },
];

const ALL_TRANSACTIONS: PointTxn[] = [
  ...(MOCK_POINT_TRANSACTIONS as PointTxn[]),
  ...EXTRA_TRANSACTIONS,
];

const TYPE_TONE: Record<PointTxnType, 'success' | 'danger' | 'info' | 'warning' | 'purple' | 'neutral' | 'primary'> = {
  TOPUP: 'success',
  CONSUME: 'info',
  SUBSCRIPTION: 'primary',
  TRANSFER_IN: 'purple',
  TRANSFER_OUT: 'purple',
  REFERRAL: 'success',
  BONUS: 'success',
  REFUND: 'info',
  EXPIRED: 'neutral',
  PROCESSING: 'warning',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
};

/** 目前訂閱功能的月費合計；正式站由 /api/points/balance 一併回傳 */
const MOCK_MONTHLY_COST = 196;
/** 付款處理中的儲值點數 */
const MOCK_PENDING_TOPUP = 1000;

const TXN_PAGE_SIZE = 20;

/* 原站以 ?payment=success|failed 從藍新金流導回本頁 */
type PaymentResult = 'success' | 'failed' | null;

/* -------------------------------------------------------------------------- */

export default function PointsPage() {
  const toast = useToast();

  const [rows, setRows] = React.useState<PointTxn[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [page, setPage] = React.useState(0);
  const [balance, setBalance] = React.useState<number | null>(null);
  const [paymentResult, setPaymentResult] = React.useState<PaymentResult>(null);

  const [topupOpen, setTopupOpen] = React.useState(false);
  const [transferOpen, setTransferOpen] = React.useState(false);

  /** 只有帳號旗下有第二家店時才能轉點（原站預設隱藏此按鈕） */
  const branches = MOCK_TENANTS.filter((x) => !x.current);
  const canTransfer = branches.length > 0;

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const value = params.get('payment');
    if (value === 'success' || value === 'failed') setPaymentResult(value);
  }, []);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      await new Promise((r) => setTimeout(r, 320));
      setRows(ALL_TRANSACTIONS);
      setBalance(MOCK_POINT_BALANCE);
    } catch (e) {
      toast.show(
        `${t.messages.loadTransactionsFailed}${e instanceof Error ? e.message : t.messages.unknownError}`,
        'danger',
      );
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  React.useEffect(() => { void load(); }, [load]);

  const visible = rows.slice(page * TXN_PAGE_SIZE, (page + 1) * TXN_PAGE_SIZE);

  const columns: Column<PointTxn>[] = [
    {
      key: 'time', header: t.columns.time, width: '160px',
      render: (x) => formatDateTime(x.createdAt),
    },
    {
      key: 'type', header: t.columns.type, width: '110px',
      render: (x) => <Badge tone={TYPE_TONE[x.type]}>{t.types[x.type]}</Badge>,
    },
    {
      key: 'amount', header: t.columns.amount, numeric: true, width: '120px',
      render: (x) => (
        <span className={x.amount < 0 ? 'text-danger' : x.amount > 0 ? 'text-success' : undefined}>
          {x.amount > 0 ? `+${formatNumber(x.amount)}` : formatNumber(x.amount)}
        </span>
      ),
    },
    {
      key: 'balance', header: t.columns.balance, numeric: true, width: '120px',
      render: (x) => formatNumber(x.balanceAfter),
    },
    {
      key: 'description', header: t.columns.description,
      render: (x) => x.description || <span className="text-muted">{common.none}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow={nav.navSystem}
        title={t.title}
        actions={
          <>
            {canTransfer ? (
              <Button variant="outline" onClick={() => setTransferOpen(true)}>
                <ArrowLeftRight size={15} />{t.actions.transfer}
              </Button>
            ) : null}
            <Button onClick={() => setTopupOpen(true)}>
              <Plus size={15} />{t.actions.topup}
            </Button>
          </>
        }
      />

      {paymentResult === 'success' ? (
        <Alert
          tone="info"
          className="mb-3"
          title={t.payment.successTitle}
          action={
            <Link className="btn btn-primary btn-sm" href="/tenant/feature-store">
              {t.payment.successCta}
            </Link>
          }
        >
          {t.payment.successBody}
        </Alert>
      ) : null}

      {paymentResult === 'failed' ? (
        <Alert tone="danger" className="mb-3">
          <strong>{t.payment.failedTitle}</strong>
          {t.payment.failedBody}
          <a className="underline" href={`mailto:${t.payment.contactEmail}`}>
            {t.payment.contactEmail}
          </a>
        </Alert>
      ) : null}

      <Alert tone="neutral" icon={false} className="mb-4">
        <span className="font-semibold">{t.usage.label}</span>
        {t.usage.text}
      </Alert>

      <div className="card-grid mb-4">
        <StatCard
          label={t.stats.balance}
          value={balance === null ? t.labels.dash : t.labels.points(balance)}
          hint={t.stats.balanceHint}
          icon={Wallet}
          tone="primary"
        />
        <StatCard
          label={t.stats.monthlyCost}
          value={loading ? t.labels.dash : t.labels.points(MOCK_MONTHLY_COST)}
          hint={t.stats.monthlyCostHint}
          icon={CreditCard}
          tone="success"
        />
        <StatCard
          label={t.stats.pendingTopup}
          value={loading ? t.labels.dash : t.labels.points(MOCK_PENDING_TOPUP)}
          hint={t.stats.pendingTopupHint}
          icon={Clock}
          tone="warning"
        />
      </div>

      <DataTableContainer>
        <DataTableHeader
          title={t.tableTitle}
          actions={
            <span className="data-table-info">
              {loading ? t.labels.dash : t.labels.totalCount(rows.length)}
            </span>
          }
        />
        <DataTable
          columns={columns}
          rows={visible}
          loading={loading}
          rowKey={(x) => x.id}
          scroll
          empty={
            <EmptyState
              icon={Coins}
              title={t.empty.title}
              description={t.empty.description}
              action={
                <Button onClick={() => setTopupOpen(true)}>
                  <Plus size={15} />{t.actions.topup}
                </Button>
              }
            />
          }
        />
        <DataTableFooter>
          <Pagination page={page} size={TXN_PAGE_SIZE} total={rows.length} onChange={setPage} />
        </DataTableFooter>
      </DataTableContainer>

      <p className="form-text mt-2">{t.tableFootnote}</p>

      <TopupModal open={topupOpen} onClose={() => setTopupOpen(false)} />

      <TransferModal
        open={transferOpen}
        balance={balance ?? 0}
        branches={branches.map((b) => ({ id: b.id, name: b.name }))}
        onClose={() => setTransferOpen(false)}
        onTransferred={() => { setTransferOpen(false); void load(); }}
      />
    </>
  );
}

/* ========================================================================== */
/* 申請儲值                                                                    */
/* ========================================================================== */

function TopupModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();

  const [amount, setAmount] = React.useState('');
  const [ubn, setUbn] = React.useState('');
  const [invoiceTitle, setInvoiceTitle] = React.useState('');
  const [remark, setRemark] = React.useState('');
  const [error, setError] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setError('');
    setAmount('');
    setUbn('');
    setInvoiceTitle('');
    setRemark('');
  }, [open]);

  const validate = (): string => {
    if (!amount) return t.topup.amountRequired;
    if (ubn.trim() && !/^\d{8}$/.test(ubn.trim())) return t.topup.invoiceUbnInvalid;
    if (remark.length > t.topup.remarkMax) return common.validation.maxLength(t.topup.remarkMax);
    return '';
  };

  const submit = async () => {
    const err = validate();
    setError(err);
    if (err) { toast.show(err, 'warning'); return; }
    setSaving(true);
    try {
      await new Promise((r) => setTimeout(r, 420));
      onClose();
    } catch (e) {
      toast.show(
        `${t.messages.payCreateFailedFull}${e instanceof Error ? e.message : t.messages.unknownError}`,
        'danger',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t.topup.title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{common.cancel}</Button>
          <Button loading={saving} loadingText={t.topup.submitting} onClick={() => void submit()}>
            {t.topup.submit}
          </Button>
        </>
      }
    >
      <FormGroup>
        <Label required htmlFor="topupAmount">{t.topup.amount}</Label>
        <Select id="topupAmount" value={amount} onChange={(e) => setAmount(e.target.value)}>
          <option value="">{t.topup.amountPlaceholder}</option>
          {t.topup.amountOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>
        <FormText>{t.topup.amountHelp}</FormText>
        <FormText>{t.topup.payMethods}</FormText>
        <FormText>{t.topup.payRedirectHint}</FormText>
      </FormGroup>

      <FormGroup>
        <Label htmlFor="topupInvoiceUbn">
          {t.topup.invoiceUbn}
          <span className="text-secondary">{t.topup.invoiceOptional}</span>
        </Label>
        <Input
          id="topupInvoiceUbn" value={ubn} placeholder={t.topup.invoiceUbnPlaceholder}
          onChange={(e) => setUbn(e.target.value)}
        />
        <FormText>{t.topup.invoiceUbnHelp}</FormText>
      </FormGroup>

      <FormGroup>
        <Label htmlFor="topupInvoiceTitle">
          {t.topup.invoiceTitle}
          <span className="text-secondary">{t.topup.invoiceOptional}</span>
        </Label>
        <Input
          id="topupInvoiceTitle" value={invoiceTitle} placeholder={t.topup.invoiceTitlePlaceholder}
          onChange={(e) => setInvoiceTitle(e.target.value)}
        />
      </FormGroup>

      <FormGroup>
        <Label htmlFor="topupRemark">{t.topup.remark}</Label>
        <Textarea
          id="topupRemark" rows={2} value={remark} maxLength={t.topup.remarkMax}
          placeholder={t.topup.remarkPlaceholder}
          onChange={(e) => setRemark(e.target.value)}
        />
        <div className="flex justify-end">
          <CharCounter value={remark} max={t.topup.remarkMax} />
        </div>
      </FormGroup>

      {error ? <FormError>{error}</FormError> : null}
    </Modal>
  );
}

/* ========================================================================== */
/* 轉點到其他分店                                                              */
/* ========================================================================== */

function TransferModal({
  open, balance, branches, onClose, onTransferred,
}: {
  open: boolean;
  balance: number;
  branches: { id: string; name: string }[];
  onClose: () => void;
  onTransferred: () => void;
}) {
  const toast = useToast();

  const [target, setTarget] = React.useState('');
  const [points, setPoints] = React.useState('');
  const [error, setError] = React.useState('');
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setError('');
    setTarget('');
    setPoints('');
  }, [open]);

  const targetName = branches.find((b) => b.id === target)?.name ?? '';
  const amount = Number(points);

  const validate = (): string => {
    if (!target) return t.transfer.targetRequired;
    if (!Number.isInteger(amount) || amount <= 0) return t.transfer.pointsInvalid;
    if (amount > balance) return common.validation.max(balance);
    return '';
  };

  const ask = () => {
    const err = validate();
    setError(err);
    if (err) { toast.show(err, 'warning'); return; }
    setConfirmOpen(true);
  };

  const submit = async () => {
    setSaving(true);
    try {
      await new Promise((r) => setTimeout(r, 420));
      setConfirmOpen(false);
      toast.show(t.messages.transferred(formatNumber(amount), targetName));
      onTransferred();
    } catch (e) {
      toast.show(
        `${t.messages.transferFailed}${e instanceof Error ? e.message : t.messages.unknownError}`,
        'danger',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={t.transfer.title}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>{common.cancel}</Button>
            <Button onClick={ask}>{t.transfer.submit}</Button>
          </>
        }
      >
        <Alert tone="info" className="mb-4">
          {t.transfer.introLead}
          <strong>{t.transfer.introStrong}</strong>
          {t.transfer.introTail}
        </Alert>

        <FormGroup>
          <Label required htmlFor="transferTarget">{t.transfer.target}</Label>
          <Select id="transferTarget" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">{t.transfer.targetPlaceholder}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </Select>
        </FormGroup>

        <FormGroup>
          <Label required htmlFor="transferPoints">{t.transfer.points}</Label>
          <Input
            id="transferPoints" type="number" value={points}
            placeholder={t.transfer.pointsPlaceholder}
            onChange={(e) => setPoints(e.target.value)}
          />
          <FormText>{t.transfer.pointsHelp(formatNumber(balance))}</FormText>
        </FormGroup>

        {error ? <FormError>{error}</FormError> : null}
      </Modal>

      <ConfirmModal
        open={confirmOpen}
        loading={saving}
        title={t.transfer.confirmTitle}
        confirmText={t.transfer.submit}
        message={t.transfer.confirmMessage(formatNumber(amount || 0), targetName)}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => void submit()}
      />
    </>
  );
}
