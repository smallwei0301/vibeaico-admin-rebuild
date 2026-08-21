'use client';
import * as React from 'react';
import {
  BadgeDollarSign, CalendarClock, CheckCircle2, ClipboardList, Eye,
  MessageSquareText, Plus, Wallet, XCircle,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { StatCard } from '@/components/ui/StatCard';
import {
  DataTable, DataTableContainer, DataTableFooter, DataTableHeader, type Column,
} from '@/components/ui/DataTable';
import { Pagination } from '@/components/ui/Pagination';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmModal, Modal } from '@/components/ui/Modal';
import { FormGroup, FormText, Input, Label, Select, Textarea } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { listTourOrders } from '@/services/tours';
import { MOCK_TRIPS, MOCK_TRIP_DEPARTURES, MOCK_TRIP_PLANS } from '@/mock/tours';
import { common } from '@/i18n/zh-TW/common';
import { navLabel } from '@/i18n/zh-TW/nav';
import { useBusinessType } from '@/components/layout/BusinessTypeContext';
import { tourOrdersPage as t } from '@/i18n/zh-TW/pages/tour-orders';
import { formatCurrency, formatDateTime, formatNumber } from '@/lib/utils';
import type {
  TourOrder, TourOrderSource, TourOrderStatus, TourPaymentStatus, TripPlan,
} from '@/lib/types';

const PAGE_SIZE = 20;

/**
 * 應收定金（10 分冊 §1）：每人計價 → 定金×人數；每團計價 → 收一筆。
 * FULL = 全額線上收（定金欄位記 0）；NONE = 不線上收。
 */
function depositOf(plan: TripPlan, total: number, partySize = 1): number {
  if (plan.depositMode === 'DEPOSIT_FIXED') {
    return plan.priceType === 'PER_PERSON' ? plan.depositValue * partySize : plan.depositValue;
  }
  if (plan.depositMode === 'DEPOSIT_PERCENT') {
    return Math.round((total * plan.depositValue) / 100);
  }
  return 0;
}

const STATUS_TONE: Record<TourOrderStatus, 'warning' | 'success' | 'primary' | 'neutral'> = {
  PENDING: 'warning', CONFIRMED: 'success', COMPLETED: 'primary', CANCELLED: 'neutral',
};
const PAYMENT_TONE: Record<TourPaymentStatus, 'danger' | 'success' | 'neutral'> = {
  UNPAID: 'danger', PAID: 'success', REFUNDED: 'neutral',
};
const SOURCE_TONE: Record<TourOrderSource, 'primary' | 'info' | 'success' | 'neutral'> = {
  MIDAO: 'primary', VIBEAI_SHOP: 'info', LINE: 'success', MANUAL: 'neutral',
};

/** 骨架用：收款方式取自 /tenant/payment-methods 設定 */
const MOCK_PAYMENT_METHODS = [
  { id: 'pm_2', label: '國泰世華銀行轉帳' },
  { id: 'pm_3', label: '線上刷卡付款' },
  { id: 'pm_1', label: 'LINE Pay' },
];

export default function TourOrdersPage() {
  const toast = useToast();
  const businessType = useBusinessType();

  const [rows, setRows] = React.useState<TourOrder[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(0);
  const [loading, setLoading] = React.useState(true);

  const [keyword, setKeyword] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('');
  const [sourceFilter, setSourceFilter] = React.useState('');
  const [paymentFilter, setPaymentFilter] = React.useState('');

  const [detail, setDetail] = React.useState<TourOrder | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [action, setAction] = React.useState<
    { kind: 'confirmPayment' | 'complete' | 'cancel'; order: TourOrder } | null
  >(null);

  const [draft, setDraft] = React.useState({
    tripId: '', planId: '', departureId: '', customerName: '',
    customerPhone: '', partySize: 2, paymentMethodId: MOCK_PAYMENT_METHODS[0].id, note: '',
  });

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await listTourOrders({
        page, size: PAGE_SIZE, keyword,
        status: statusFilter, source: sourceFilter, paymentStatus: paymentFilter,
      });
      setRows(res.content);
      setTotal(res.totalElements);
    } catch {
      toast.show(t.messages.loadFailed, 'danger');
    } finally {
      setLoading(false);
    }
  }, [page, keyword, statusFilter, sourceFilter, paymentFilter, toast]);

  React.useEffect(() => { void load(); }, [load]);

  /* --------------------------------------------------------------- 統計 */
  const stats = React.useMemo(() => {
    const now = new Date();
    const in7 = new Date(now.getTime() + 7 * 86_400_000);
    return {
      pending: rows.filter((o) => o.status === 'PENDING').length,
      unpaid: rows.filter((o) => o.paymentStatus === 'UNPAID' && o.status !== 'CANCELLED').length,
      upcoming: rows.filter((o) => {
        const d = new Date(o.departsOn);
        return o.status === 'CONFIRMED' && d >= now && d <= in7;
      }).length,
      revenue: rows
        .filter((o) => o.paymentStatus === 'PAID'
          && o.createdAt.slice(0, 7) === now.toISOString().slice(0, 7))
        .reduce((sum, o) => sum + o.totalAmount, 0),
    };
  }, [rows]);

  /* ----------------------------------------------------------- 狀態動作 */
  const runAction = () => {
    if (!action) return;
    const { kind, order } = action;
    setRows((prev) => prev.map((o) => {
      if (o.id !== order.id) return o;
      if (kind === 'confirmPayment') return { ...o, paymentStatus: 'PAID', status: 'CONFIRMED', holdExpiresAt: null };
      if (kind === 'complete') return { ...o, status: 'COMPLETED' };
      return { ...o, status: 'CANCELLED' };
    }));
    toast.show(
      kind === 'confirmPayment' ? t.messages.paymentConfirmed
        : kind === 'complete' ? t.messages.completed
          : t.messages.cancelled,
    );
    setAction(null);
  };

  /* ------------------------------------------------------- 手動建立訂單 */
  const draftPlans = MOCK_TRIP_PLANS.filter((p) => p.tripId === draft.tripId);
  const draftDepartures = MOCK_TRIP_DEPARTURES.filter(
    (d) => d.planId === draft.planId && d.status === 'OPEN' && d.capacity > d.seatsBooked,
  );
  const draftPlan = draftPlans.find((p) => p.id === draft.planId);
  const draftTotal = draftPlan
    ? draftPlan.priceType === 'PER_PERSON' ? draftPlan.basePrice * draft.partySize : draftPlan.basePrice
    : 0;
  const draftDeposit = draftPlan ? depositOf(draftPlan, draftTotal, draft.partySize) : 0;

  const submitDraft = () => {
    const trip = MOCK_TRIPS.find((x) => x.id === draft.tripId);
    const departure = draftDepartures.find((d) => d.id === draft.departureId);
    if (!trip || !draftPlan || !departure) return;
    const order: TourOrder = {
      id: `to_new_${rows.length + 1}`,
      orderNo: `T${new Date().toISOString().slice(2, 10).replace(/-/g, '')}${String(rows.length + 1).padStart(4, '0')}`,
      tripId: trip.id, tripTitle: trip.title, planName: draftPlan.name,
      departsOn: departure.departsOn, startTime: departure.startTime,
      customerName: draft.customerName, customerPhone: draft.customerPhone,
      partySize: draft.partySize,
      unitPrice: draftPlan.basePrice, totalAmount: draftTotal,
      depositAmount: draftDeposit,
      status: 'PENDING', paymentStatus: 'UNPAID',
      paymentMethodLabel: MOCK_PAYMENT_METHODS.find((m) => m.id === draft.paymentMethodId)?.label ?? '',
      paymentRef: '', source: 'MANUAL', holdExpiresAt: null,
      note: draft.note, createdAt: new Date().toISOString(),
    };
    setRows((prev) => [order, ...prev]);
    setTotal((n) => n + 1);
    setCreateOpen(false);
    setDraft({
      tripId: '', planId: '', departureId: '', customerName: '',
      customerPhone: '', partySize: 2, paymentMethodId: MOCK_PAYMENT_METHODS[0].id, note: '',
    });
    toast.show(t.messages.created);
  };

  const columns: Column<TourOrder>[] = [
    {
      key: 'orderNo', header: t.columns.orderNo, width: '150px',
      render: (o) => (
        <div>
          <button
            type="button"
            className="font-semibold text-dark hover:text-primary"
            onClick={() => setDetail(o)}
          >
            {o.orderNo}
          </button>
          <div className="text-2xs text-muted">{formatDateTime(o.createdAt)}</div>
        </div>
      ),
    },
    {
      key: 'trip', header: t.columns.trip,
      render: (o) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-dark">{o.tripTitle}</div>
          <div className="truncate text-2xs text-secondary">{o.planName}</div>
        </div>
      ),
    },
    {
      key: 'departsOn', header: t.columns.departsOn, width: '130px',
      render: (o) => (
        <div>
          <div>{o.departsOn}</div>
          {o.startTime ? <div className="text-2xs text-secondary">{o.startTime}</div> : null}
        </div>
      ),
    },
    {
      key: 'customer', header: t.columns.customer, width: '140px',
      render: (o) => (
        <div>
          <div className="font-medium text-dark">{o.customerName}</div>
          <div className="text-2xs text-secondary">{o.customerPhone}</div>
        </div>
      ),
    },
    {
      key: 'party', header: t.columns.party, numeric: true, width: '70px',
      render: (o) => formatNumber(o.partySize),
    },
    {
      key: 'amount', header: t.columns.amount, numeric: true, width: '120px',
      render: (o) => formatCurrency(o.totalAmount),
    },
    {
      key: 'payment', header: t.columns.payment, width: '150px',
      render: (o) => (
        <div>
          <Badge tone={PAYMENT_TONE[o.paymentStatus]}>{t.paymentStatus[o.paymentStatus]}</Badge>
          {o.depositAmount > 0 ? (
            <div className="text-2xs text-warning">
              {t.depositBadge} {formatCurrency(o.depositAmount)}
            </div>
          ) : null}
          <div className="mt-0.5 truncate text-2xs text-secondary">{o.paymentMethodLabel}</div>
          {o.holdExpiresAt ? (
            <div className="text-2xs text-warning">
              {t.hold.expiring(formatDateTime(o.holdExpiresAt))}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      key: 'status', header: t.columns.status, width: '90px',
      render: (o) => <Badge tone={STATUS_TONE[o.status]}>{t.status[o.status]}</Badge>,
    },
    {
      key: 'source', header: t.columns.source, width: '100px',
      render: (o) => <Badge tone={SOURCE_TONE[o.source]}>{t.source[o.source]}</Badge>,
    },
    {
      key: 'actions', header: t.columns.actions, width: '150px',
      render: (o) => (
        <div className="btn-group">
          <Button
            variant="outline" size="sm" title={t.actions.detail} aria-label={t.actions.detail}
            onClick={() => setDetail(o)}
          >
            <Eye size={13} />
          </Button>
          {o.paymentStatus === 'UNPAID' && o.status !== 'CANCELLED' ? (
            <Button
              variant="outline" size="sm"
              title={t.actions.confirmPayment} aria-label={t.actions.confirmPayment}
              onClick={() => setAction({ kind: 'confirmPayment', order: o })}
            >
              <CheckCircle2 size={13} className="text-success" />
            </Button>
          ) : null}
          {o.status === 'CONFIRMED' ? (
            <Button
              variant="outline" size="sm"
              title={t.actions.complete} aria-label={t.actions.complete}
              onClick={() => setAction({ kind: 'complete', order: o })}
            >
              <BadgeDollarSign size={13} />
            </Button>
          ) : null}
          {o.status === 'PENDING' || o.status === 'CONFIRMED' ? (
            <Button
              variant="outlineDanger" size="sm"
              title={t.actions.cancel} aria-label={t.actions.cancel}
              onClick={() => setAction({ kind: 'cancel', order: o })}
            >
              <XCircle size={13} />
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow={navLabel('navBooking', businessType)}
        title={t.title}
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus size={15} />{t.actions.create}
          </Button>
        }
      />

      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t.stats.pending} value={formatNumber(stats.pending)} icon={ClipboardList} tone="warning" />
        <StatCard label={t.stats.unpaid} value={formatNumber(stats.unpaid)} icon={Wallet} tone="danger" />
        <StatCard label={t.stats.upcoming} value={formatNumber(stats.upcoming)} icon={CalendarClock} tone="info" />
        <StatCard label={t.stats.monthRevenue} value={formatCurrency(stats.revenue)} icon={BadgeDollarSign} tone="success" />
      </div>

      <DataTableContainer>
        <DataTableHeader
          title={t.tableTitle}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={keyword}
                onChange={(e) => { setKeyword(e.target.value); setPage(0); }}
                placeholder={t.filters.keywordPlaceholder}
                className="w-full sm:w-56"
              />
              <Select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}>
                <option value="">{t.filters.statusAll}</option>
                {(Object.keys(t.status) as TourOrderStatus[]).map((k) => (
                  <option key={k} value={k}>{t.status[k]}</option>
                ))}
              </Select>
              <Select value={paymentFilter} onChange={(e) => { setPaymentFilter(e.target.value); setPage(0); }}>
                <option value="">{t.filters.paymentAll}</option>
                {(Object.keys(t.paymentStatus) as TourPaymentStatus[]).map((k) => (
                  <option key={k} value={k}>{t.paymentStatus[k]}</option>
                ))}
              </Select>
              <Select value={sourceFilter} onChange={(e) => { setSourceFilter(e.target.value); setPage(0); }}>
                <option value="">{t.filters.sourceAll}</option>
                {(Object.keys(t.source) as TourOrderSource[]).map((k) => (
                  <option key={k} value={k}>{t.source[k]}</option>
                ))}
              </Select>
            </div>
          }
        />
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          rowKey={(o) => o.id}
          scroll
          empty={<EmptyState icon={ClipboardList} title={t.empty.title} description={t.empty.description} />}
        />
        <DataTableFooter>
          <Pagination page={page} size={PAGE_SIZE} total={total} onChange={setPage} />
        </DataTableFooter>
      </DataTableContainer>

      {/* ==================================================== 訂單詳情 */}
      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        size="lg"
        title={detail ? t.detail.title(detail.orderNo) : ''}
        footer={
          <>
            <Button variant="outline">
              <MessageSquareText size={14} />{t.actions.contactLine}
            </Button>
            <Button variant="secondary" onClick={() => setDetail(null)}>{common.close}</Button>
          </>
        }
      >
        {detail ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone={STATUS_TONE[detail.status]}>{t.status[detail.status]}</Badge>
              <Badge tone={PAYMENT_TONE[detail.paymentStatus]}>{t.paymentStatus[detail.paymentStatus]}</Badge>
              <Badge tone={SOURCE_TONE[detail.source]}>{t.source[detail.source]}</Badge>
            </div>

            <section>
              <h4 className="mb-1 text-sm font-bold text-dark">{t.detail.sections.trip}</h4>
              <dl className="grid grid-cols-[8.5rem_1fr] gap-y-1 text-sm">
                <dt className="text-secondary">{t.detail.fields.trip}</dt><dd>{detail.tripTitle}</dd>
                <dt className="text-secondary">{t.detail.fields.plan}</dt><dd>{detail.planName}</dd>
                <dt className="text-secondary">{t.detail.fields.departsOn}</dt><dd>{detail.departsOn}</dd>
                <dt className="text-secondary">{t.detail.fields.startTime}</dt><dd>{detail.startTime || '—'}</dd>
              </dl>
            </section>

            <section>
              <h4 className="mb-1 text-sm font-bold text-dark">{t.detail.sections.customer}</h4>
              <dl className="grid grid-cols-[8.5rem_1fr] gap-y-1 text-sm">
                <dt className="text-secondary">{t.detail.fields.name}</dt><dd>{detail.customerName}</dd>
                <dt className="text-secondary">{t.detail.fields.phone}</dt><dd>{detail.customerPhone}</dd>
                <dt className="text-secondary">{t.detail.fields.party}</dt>
                <dd>{t.detail.partyUnit(detail.partySize)}</dd>
              </dl>
            </section>

            <section>
              <h4 className="mb-1 text-sm font-bold text-dark">{t.detail.sections.payment}</h4>
              <dl className="grid grid-cols-[8.5rem_1fr] gap-y-1 text-sm">
                <dt className="text-secondary">{t.detail.fields.unitPrice}</dt>
                <dd>{formatCurrency(detail.unitPrice)}</dd>
                <dt className="text-secondary">{t.detail.fields.total}</dt>
                <dd className="font-bold text-dark">{formatCurrency(detail.totalAmount)}</dd>
                {detail.depositAmount > 0 ? (
                  <>
                    <dt className="text-secondary">{t.detail.fields.deposit}</dt>
                    <dd>{formatCurrency(detail.depositAmount)}</dd>
                    <dt className="text-secondary">{t.detail.fields.balance}</dt>
                    <dd className="text-warning">
                      {formatCurrency(detail.totalAmount - detail.depositAmount)}
                    </dd>
                  </>
                ) : null}
                <dt className="text-secondary">{t.detail.fields.method}</dt><dd>{detail.paymentMethodLabel}</dd>
                <dt className="text-secondary">{t.detail.fields.ref}</dt>
                <dd>{detail.paymentRef || <span className="text-muted">{t.detail.noRef}</span>}</dd>
                <dt className="text-secondary">{t.detail.fields.createdAt}</dt>
                <dd>{formatDateTime(detail.createdAt)}</dd>
              </dl>
            </section>

            <section>
              <h4 className="mb-1 text-sm font-bold text-dark">{t.detail.sections.note}</h4>
              <p className="text-sm text-secondary">
                {detail.note || t.detail.noNote}
              </p>
            </section>
          </div>
        ) : null}
      </Modal>

      {/* ================================================ 手動建立訂單 */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={t.create.title}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>{common.cancel}</Button>
            <Button
              onClick={submitDraft}
              disabled={!draft.departureId || !draft.customerName || !draft.customerPhone}
            >
              {t.create.submit}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <FormText>{t.create.hint}</FormText>

          <FormGroup>
            <Label required>{t.create.tripLabel}</Label>
            <Select
              value={draft.tripId}
              onChange={(e) => setDraft({ ...draft, tripId: e.target.value, planId: '', departureId: '' })}
            >
              <option value="">{t.create.tripLabel}</option>
              {MOCK_TRIPS.map((tr) => <option key={tr.id} value={tr.id}>{tr.title}</option>)}
            </Select>
          </FormGroup>

          <FormGroup>
            <Label required>{t.create.planLabel}</Label>
            <Select
              value={draft.planId}
              disabled={!draft.tripId}
              onChange={(e) => setDraft({ ...draft, planId: e.target.value, departureId: '' })}
            >
              <option value="">{t.create.planLabel}</option>
              {draftPlans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </FormGroup>

          <FormGroup>
            <Label required>{t.create.departureLabel}</Label>
            <Select
              value={draft.departureId}
              disabled={!draft.planId}
              onChange={(e) => setDraft({ ...draft, departureId: e.target.value })}
            >
              <option value="">{t.create.departurePlaceholder}</option>
              {draftDepartures.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.departsOn} {d.startTime}
                  {t.create.seatsLeft(d.capacity - d.seatsBooked)}
                </option>
              ))}
            </Select>
          </FormGroup>

          <div className="grid gap-3 sm:grid-cols-2">
            <FormGroup>
              <Label required>{t.create.customerLabel}</Label>
              <Input
                value={draft.customerName}
                onChange={(e) => setDraft({ ...draft, customerName: e.target.value })}
              />
            </FormGroup>
            <FormGroup>
              <Label required>{t.create.phoneLabel}</Label>
              <Input
                value={draft.customerPhone}
                onChange={(e) => setDraft({ ...draft, customerPhone: e.target.value })}
              />
            </FormGroup>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <FormGroup>
              <Label required>{t.create.partyLabel}</Label>
              <Input
                type="number" min={1} value={draft.partySize}
                onChange={(e) => setDraft({ ...draft, partySize: Number(e.target.value) })}
              />
            </FormGroup>
            <FormGroup>
              <Label required>{t.create.paymentLabel}</Label>
              <Select
                value={draft.paymentMethodId}
                onChange={(e) => setDraft({ ...draft, paymentMethodId: e.target.value })}
              >
                {MOCK_PAYMENT_METHODS.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </Select>
            </FormGroup>
          </div>

          <FormGroup>
            <Label>{t.create.noteLabel}</Label>
            <Textarea
              rows={2}
              value={draft.note}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            />
          </FormGroup>

          {draftPlan ? (
            <div className="rounded-md bg-neutral-50 px-3 py-2 text-sm font-semibold text-dark">
              {t.create.totalPreview(formatCurrency(draftTotal))}
              {draftDeposit > 0 ? (
                <div className="mt-0.5 text-2xs font-normal text-warning">
                  {t.detail.fields.deposit} {formatCurrency(draftDeposit)}
                  {' · '}
                  {t.detail.fields.balance} {formatCurrency(draftTotal - draftDeposit)}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </Modal>

      <ConfirmModal
        open={!!action}
        onClose={() => setAction(null)}
        onConfirm={runAction}
        title={
          action?.kind === 'confirmPayment' ? t.confirm.confirmPaymentTitle
            : action?.kind === 'complete' ? t.confirm.completeTitle
              : t.confirm.cancelTitle
        }
        message={
          action
            ? action.kind === 'confirmPayment' ? t.confirm.confirmPayment(action.order.orderNo)
              : action.kind === 'complete' ? t.confirm.complete(action.order.orderNo)
                : t.confirm.cancel(action.order.orderNo)
            : ''
        }
        confirmText={
          action?.kind === 'confirmPayment' ? t.actions.confirmPayment
            : action?.kind === 'complete' ? t.actions.complete
              : t.actions.cancel
        }
        danger={action?.kind === 'cancel'}
      />
    </>
  );
}
