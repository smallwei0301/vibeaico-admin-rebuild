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
import { common } from '@/i18n/zh-TW/common';
import { nav } from '@/i18n/zh-TW/nav';
import { pointsPage as t } from '@/i18n/zh-TW/pages/points';
import { formatDateTime, formatNumber } from '@/lib/utils';
import type { PointTransaction, TenantSummary } from '@/lib/types';
import { getPointBalance, listPointTransactions, requestPointTopup, transferPoints } from '@/services/points';
import { myTenants } from '@/services/auth';

/* -------------------------------------------------------------------------- */
/* 本頁專用假資料（不寫進 src/mock，避免與其他頁面衝突）                          */
/* -------------------------------------------------------------------------- */

/**
 * 原站的異動類型比 lib/types.ts 的 PointTransaction 多幾種（功能訂閱、推薦獎勵、
 * 贈送、過期、處理中、駁回、取消）。契約型別不在本頁修改，這裡以本地聯集擴充。
 */
type PointTxnType = keyof typeof t.types;
type PointTxn = Omit<PointTransaction, 'type'> & { type: PointTxnType };
// 擴充類型的 mock 展示列（原 EXTRA_TRANSACTIONS）已移入 src/services/points.ts
// 的 mock 分支——頁面接線後兩模式共用同一條「service → rows」路徑。

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
/*
 * 「月費合計」與「處理中儲值」目前**沒有對應端點**（前者要彙總
 * feature_subscriptions 的月費，後者要接上儲值金流）。
 *
 * 這裡刻意不給假數字：這兩張卡就排在「點數餘額」（真實資料）旁邊，
 * 填 196 / 1000 會讓店家把捏造值當成自己的帳務數字，而畫面上完全沒有任何
 * 線索能分辨哪個是真的。沒有資料就顯示 --，並在 hint 說明尚未提供。
 * 見 CLAUDE.md「不要製造假的已知」。
 */

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

  /** 只有帳號旗下有第二家店時才能轉點（原站預設隱藏此按鈕）；
   *  清單走 myTenants()（mock 分支即原 MOCK_TENANTS，行為不變）。 */
  const [tenants, setTenants] = React.useState<TenantSummary[]>([]);
  const branches = tenants.filter((x) => !x.current);
  const canTransfer = branches.length > 0;

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const value = params.get('payment');
    if (value === 'success' || value === 'failed') setPaymentResult(value);
  }, []);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      // 交易紀錄一次取 200 筆、前端切頁（沿用原本的本地分頁 UI；店家錢包
      // 交易量小，等真的超過 200 筆再改成伺服器分頁）。real 模式後端只回
      // 契約 enum 的 5 種 type（PointTxn 聯集的子集，斷言必然成立）。
      const [{ balance: bal }, paged, mine] = await Promise.all([
        getPointBalance(),
        listPointTransactions({ page: 0, size: 200 }),
        myTenants(),
      ]);
      setRows(paged.content as PointTxn[]);
      setBalance(bal);
      setTenants(mine);
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
          value={t.labels.dash}
          hint={t.stats.monthlyCostHint}
          icon={CreditCard}
          tone="success"
        />
        <StatCard
          label={t.stats.pendingTopup}
          value={t.labels.dash}
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
        branches={branches.map((b) => ({ id: b.id, name: b.name, shopCode: b.shopCode }))}
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
  /** 後端對這次申請的回覆（501 的客服文案）；null = 還沒送出過 */
  const [outcome, setOutcome] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setError('');
    setAmount('');
    setUbn('');
    setInvoiceTitle('');
    setRemark('');
    setOutcome(null);
  }, [open]);

  const validate = (): string => {
    if (!amount) return t.topup.amountRequired;
    if (ubn.trim() && !/^\d{8}$/.test(ubn.trim())) return t.topup.invoiceUbnInvalid;
    if (remark.length > t.topup.remarkMax) return common.validation.maxLength(t.topup.remarkMax);
    return '';
  };

  /**
   * POST /api/points/topup/pay（services/points.ts 的 requestPointTopup）。
   *
   * ⚠️ 這一支端點**依規格一律回 501**「請聯絡平台客服儲值」（09 分冊 §4：MVP
   * 不接金流）。那不是錯誤，是誠實的回覆，所以這裡：
   *   - 不顯示成功、也不關閉 modal（接線前的寫法是 setTimeout 之後直接 onClose()，
   *     店家會以為申請送出去了）
   *   - 不歸進紅色的「付款建立失敗」，而是把後端說的那句話原樣顯示在表單裡
   *   - 只有真的成功（將來接上金流後 accepted=true）才會關閉並報成功
   */
  const submit = async () => {
    const err = validate();
    setError(err);
    if (err) { toast.show(err, 'warning'); return; }
    setSaving(true);
    setOutcome(null);
    try {
      const res = await requestPointTopup({
        amount: Number(amount),
        invoiceUbn: ubn.trim() || undefined,
        invoiceTitle: invoiceTitle.trim() || undefined,
        remark: remark.trim() || undefined,
      });
      if (res.accepted) { onClose(); return; }
      setOutcome(res.message ?? t.topup.unavailableMock);
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

      {outcome ? (
        <Alert tone="warning" title={t.topup.unavailableTitle}>{outcome}</Alert>
      ) : null}
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
  branches: { id: string; name: string; shopCode: string }[];
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
      // POST /api/points/transfer（⚙OWNER；rpc 內兩筆交易同 DB 交易完成）。
      // 後端以 shopCode 定位目標店；409「點數餘額不足」等訊息原樣 toast。
      const toShopCode = branches.find((b) => b.id === target)?.shopCode ?? '';
      await transferPoints({ toShopCode, amount });
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
