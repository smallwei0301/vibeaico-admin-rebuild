'use client';
import * as React from 'react';
import Link from 'next/link';
import {
  Ban, Check, CheckCheck, Coins, Download, Eye, Pencil, Plus,
  RotateCcw, Ticket, Trash2, Wallet, X,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
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
import {
  adjustBookingPrice, applyBookingCoupon, applyBookingPoints, cancelBooking,
  completeBooking, confirmBooking, createBooking, listBookings,
  markBookingPaidOffline, markNoShow, revertBookingComplete, updateBooking,
} from '@/services/bookings';
import { createCustomer, listCustomers } from '@/services/customers';
import { listServices, listStaff } from '@/services/catalog';
import { exportBookingsCsv } from '@/services/reports';
import { byMode } from '@/mock';
import { common } from '@/i18n/zh-TW/common';
import { nav } from '@/i18n/zh-TW/nav';
import { bookingsPage as t } from '@/i18n/zh-TW/pages/bookings';
import { formatCurrency, formatDate, formatTime } from '@/lib/utils';
import type { Booking, BookingStatus, Customer, PaymentStatus, Service, Staff } from '@/lib/types';

/* -------------------------------------------------------------------------- */
/* 本頁專用假資料（不寫進 src/mock，避免與其他頁面衝突）                          */
/* -------------------------------------------------------------------------- */

/** 原站 Booking 另有付款/折抵欄位，骨架階段以 module 常數補齊 */
type BookingExtras = {
  paidAmount: number;
  couponDiscount: number;
  pointsRedeemed: number;
  /** 顧客可用點數 */
  customerPoints: number;
};

const DEFAULT_EXTRAS: BookingExtras = {
  paidAmount: 0, couponDiscount: 0, pointsRedeemed: 0, customerPoints: 0,
};

const BOOKING_EXTRAS_LOCAL_SHOP: Record<string, BookingExtras> = {
  b_1: { paidAmount: 0, couponDiscount: 0, pointsRedeemed: 0, customerPoints: 386 },
  b_2: { paidAmount: 1000, couponDiscount: 280, pointsRedeemed: 0, customerPoints: 92 },
  b_3: { paidAmount: 1080, couponDiscount: 120, pointsRedeemed: 0, customerPoints: 964 },
  b_4: { paidAmount: 0, couponDiscount: 0, pointsRedeemed: 0, customerPoints: 18 },
};

const BOOKING_EXTRAS_GUIDE: Record<string, BookingExtras> = {
  b_g1: { paidAmount: 0, couponDiscount: 0, pointsRedeemed: 0, customerPoints: 1320 },
};

const BOOKING_EXTRAS_CLINIC: Record<string, BookingExtras> = {
  b_1: { paidAmount: 300, couponDiscount: 0, pointsRedeemed: 0, customerPoints: 412 },
  b_2: { paidAmount: 6800, couponDiscount: 0, pointsRedeemed: 0, customerPoints: 984 },
  b_3: { paidAmount: 0, couponDiscount: 0, pointsRedeemed: 0, customerPoints: 126 },
  b_4: { paidAmount: 0, couponDiscount: 0, pointsRedeemed: 0, customerPoints: 13 },
};

type AddonItem = {
  id: string;
  name: string;
  price: number;
  quantity: number;
  durationMinutes: number;
  staffName: string | null;
};

const ADDON_ITEMS_LOCAL_SHOP: Record<string, AddonItem[]> = {
  b_2: [
    { id: 'ad_1', name: '深層護髮', price: 800, quantity: 1, durationMinutes: 30, staffName: 'Amy' },
    { id: 'ad_2', name: '青草膏', price: 120, quantity: 2, durationMinutes: 0, staffName: null },
  ],
};

const ADDON_ITEMS_GUIDE: Record<string, AddonItem[]> = {};

const ADDON_ITEMS_CLINIC: Record<string, AddonItem[]> = {
  b_2: [
    { id: 'ad_1', name: '甲狀腺超音波', price: 1200, quantity: 1, durationMinutes: 20, staffName: '陳醫師' },
    { id: 'ad_2', name: '肺部 X 光', price: 600, quantity: 1, durationMinutes: 10, staffName: null },
  ],
};

/** 開始時間下拉：09:00 – 21:30，每 30 分鐘一檔 */
const TIME_OPTIONS: string[] = Array.from({ length: 26 }, (_, i) => {
  const total = 9 * 60 + i * 30;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
});

/** 編輯預約的服務時長：30–480 分鐘，每 30 分鐘一檔 */
const DURATION_OPTIONS: number[] = Array.from({ length: 16 }, (_, i) => (i + 1) * 30);

/** 原站 /api/settings 的「強制指定服務人員」；骨架階段固定 */
const REQUIRE_STAFF = false;

const PAGE_SIZE = 20;

const STATUS_TONE: Record<BookingStatus, 'primary' | 'success' | 'warning' | 'danger' | 'neutral'> = {
  PENDING: 'warning',
  CONFIRMED: 'primary',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
  NO_SHOW: 'danger',
};

const REAL_STATUSES: BookingStatus[] = ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'];

const extrasOf = (b: Booking): BookingExtras => byMode({
  LOCAL_SHOP: BOOKING_EXTRAS_LOCAL_SHOP, GUIDE: BOOKING_EXTRAS_GUIDE, CLINIC: BOOKING_EXTRAS_CLINIC,
})[b.id] ?? DEFAULT_EXTRAS;

const addonsOf = (b: Booking): AddonItem[] => byMode({
  LOCAL_SHOP: ADDON_ITEMS_LOCAL_SHOP, GUIDE: ADDON_ITEMS_GUIDE, CLINIC: ADDON_ITEMS_CLINIC,
})[b.id] ?? [];

/** 付款狀態顯示：已付清 / 已付訂金 / 待付款 */
const paymentLabel = (b: Booking) => {
  const { paidAmount } = extrasOf(b);
  if (b.paymentStatus === 'PAID_ONLINE' || b.paymentStatus === 'PAID_OFFLINE') return t.payment.paid;
  if (paidAmount > 0) return t.payment.deposit;
  return t.payment.pending;
};

/* -------------------------------------------------------------------------- */

export default function BookingsPage() {
  const toast = useToast();

  const [rows, setRows] = React.useState<Booking[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(0);
  const [loading, setLoading] = React.useState(true);

  const [keyword, setKeyword] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [paymentStatusFilter, setPaymentStatusFilter] = React.useState<PaymentStatus | ''>('');
  const [startDate, setStartDate] = React.useState('');
  const [endDate, setEndDate] = React.useState('');
  const [showCancelled, setShowCancelled] = React.useState(false);
  const [selected, setSelected] = React.useState<string[]>([]);
  /** 「未處理」= 時間已過但仍停在待確認/已確認；在載入時算好，render 期不碰 Date.now() */
  const [unprocessedIds, setUnprocessedIds] = React.useState<string[]>([]);

  /* modal 狀態（8 個 modal） */
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Booking | null>(null);
  const [cancelTarget, setCancelTarget] = React.useState<Booking | null>(null);
  const [batchCancelOpen, setBatchCancelOpen] = React.useState(false);
  const [addonTarget, setAddonTarget] = React.useState<Booking | null>(null);
  const [couponTarget, setCouponTarget] = React.useState<Booking | null>(null);
  const [adjustTarget, setAdjustTarget] = React.useState<Booking | null>(null);
  const [pointsTarget, setPointsTarget] = React.useState<Booking | null>(null);
  const [markPaidTarget, setMarkPaidTarget] = React.useState<Booking | null>(null);
  const [detailTarget, setDetailTarget] = React.useState<Booking | null>(null);

  /* 確認類彈窗 */
  const [confirmTarget, setConfirmTarget] = React.useState<Booking | null>(null);
  const [completeTarget, setCompleteTarget] = React.useState<Booking | null>(null);
  const [noShowTarget, setNoShowTarget] = React.useState<Booking | null>(null);
  const [revertTarget, setRevertTarget] = React.useState<Booking | null>(null);
  const [batchConfirmOpen, setBatchConfirmOpen] = React.useState(false);
  const [removeAddonTarget, setRemoveAddonTarget] = React.useState<AddonItem | null>(null);

  const [cancelReason, setCancelReason] = React.useState('');

  /** 原站以 ?status=PENDING / ?status=UNPROCESSED / ?action=create 進入本頁 */
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const s = params.get('status');
    if (s) setStatus(s);
    if (params.get('paymentStatus') === 'UNPAID') setPaymentStatusFilter('UNPAID');
    if (params.get('action') === 'create') setCreateOpen(true);
  }, []);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const isRealStatus = (REAL_STATUSES as string[]).includes(status);
      const res = await listBookings({
        page: 0,
        size: 100,
        status: isRealStatus ? (status as BookingStatus) : '',
        keyword,
        from: startDate || undefined,
        to: endDate || undefined,
      });

      let list = res.content;

      if (paymentStatusFilter) {
        list = list.filter((b) => b.paymentStatus === paymentStatusFilter);
      }
      /** 未處理＝時間已過、但仍停在「待確認 / 已確認」的預約 */
      if (status === 'UNPROCESSED') {
        const now = Date.now();
        list = list.filter(
          (b) => (b.status === 'PENDING' || b.status === 'CONFIRMED') && new Date(b.startAt).getTime() < now,
        );
      }
      if (startDate) list = list.filter((b) => b.startAt.slice(0, 10) >= startDate);
      if (endDate) list = list.filter((b) => b.startAt.slice(0, 10) <= endDate);
      if (!showCancelled && status !== 'CANCELLED') {
        list = list.filter((b) => b.status !== 'CANCELLED');
      }

      const now = Date.now();
      setUnprocessedIds(list
        .filter((b) => (b.status === 'PENDING' || b.status === 'CONFIRMED')
          && new Date(b.startAt).getTime() < now)
        .map((b) => b.id));

      setTotal(list.length);
      setRows(list.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE));
    } catch (e) {
      toast.show(`${t.messages.loadFailed}${e instanceof Error ? e.message : t.messages.unknownError}`, 'danger');
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, keyword, status, paymentStatusFilter, startDate, endDate, showCancelled, toast]);

  React.useEffect(() => { void load(); }, [load]);

  const isUnprocessed = (b: Booking) => unprocessedIds.includes(b.id);

  const toggleRow = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const allSelected = rows.length > 0 && rows.every((r) => selected.includes(r.id));

  const runAction = async (
    action: () => Promise<unknown>, successMessage: string, failPrefix: string,
  ) => {
    try {
      await action();
      toast.show(successMessage);
      setDetailTarget(null);
      void load();
    } catch (e) {
      toast.show(`${failPrefix}${e instanceof Error ? e.message : t.messages.unknownError}`, 'danger');
    }
  };

  const exportCsv = async () => {
    try {
      await exportBookingsCsv({
        from: startDate || undefined,
        to: endDate || undefined,
      });
      toast.show(t.messages.exported);
    } catch (e) {
      const message = e instanceof Error ? e.message : t.messages.exportFailed;
      toast.show(`${t.messages.exportFailedPrefix}${message}`, 'danger');
    }
  };

  /* --------------------------------------------------------------- 批次操作 */

  const selectedRows = rows.filter((r) => selected.includes(r.id));
  const batchPending = selectedRows.filter((r) => r.status === 'PENDING');
  const batchCancellable = selectedRows.filter((r) => r.status === 'PENDING' || r.status === 'CONFIRMED');
  const batchPaid = batchCancellable.filter((r) => extrasOf(r).paidAmount > 0);
  const batchPaidTotal = batchPaid.reduce((sum, r) => sum + extrasOf(r).paidAmount, 0);
  const batchUnpaid = batchPending.filter((r) => extrasOf(r).paidAmount === 0);

  const openBatchConfirm = () => {
    if (selected.length === 0) { toast.show(t.messages.selectConfirmFirst, 'warning'); return; }
    if (batchPending.length === 0) { toast.show(t.messages.noPendingSelected, 'warning'); return; }
    setBatchConfirmOpen(true);
  };

  const openBatchCancel = () => {
    if (selected.length === 0) { toast.show(t.messages.selectCancelFirst, 'warning'); return; }
    if (batchCancellable.length === 0) { toast.show(t.messages.noCancellableSelected, 'warning'); return; }
    setBatchCancelOpen(true);
  };

  /* ------------------------------------------------------------------ 欄位 */

  const columns: Column<Booking>[] = [
    {
      key: 'select', header: '', width: '40px',
      render: (b) => (
        <input
          type="checkbox"
          aria-label={b.bookingNo}
          checked={selected.includes(b.id)}
          onChange={() => toggleRow(b.id)}
        />
      ),
    },
    {
      key: 'no', header: t.columns.no, width: '150px',
      render: (b) => <span className="font-mono text-xs">{b.bookingNo}</span>,
    },
    {
      key: 'datetime', header: t.columns.datetime, width: '160px',
      render: (b) => (
        <div className="min-w-0">
          <div>{formatDate(b.startAt)}</div>
          <div className="text-xs text-secondary">
            {formatTime(b.startAt)} - {formatTime(b.endAt)}
          </div>
        </div>
      ),
    },
    {
      key: 'customer', header: t.columns.customer,
      render: (b) => (
        <div className="min-w-0">
          <div className="font-semibold text-dark">{b.customerName}</div>
          <div className="text-xs text-secondary">{b.customerPhone}</div>
        </div>
      ),
    },
    {
      key: 'service', header: t.columns.service,
      render: (b) => b.serviceName || <span className="text-muted">{t.labels.deletedService}</span>,
    },
    {
      key: 'staff', header: t.columns.staff, width: '90px',
      render: (b) => b.staffName ?? <span className="text-muted">{t.labels.unassigned}</span>,
    },
    {
      key: 'amount', header: t.columns.amount, numeric: true, width: '140px',
      render: (b) => {
        const { paidAmount } = extrasOf(b);
        return (
          <div className="min-w-0">
            <div>{formatCurrency(b.finalPrice)}</div>
            {b.finalPrice !== b.price ? (
              <div className="text-2xs text-secondary">{t.labels.memberPrice}</div>
            ) : null}
            {paidAmount > 0 ? (
              <div className="text-2xs text-secondary">
                {t.labels.received(formatCurrency(paidAmount))}
              </div>
            ) : null}
          </div>
        );
      },
    },
    {
      key: 'status', header: t.columns.status, width: '110px',
      render: (b) => (
        <div className="flex flex-col items-start gap-1">
          <Badge tone={STATUS_TONE[b.status]}>{common.bookingStatus[b.status]}</Badge>
          {isUnprocessed(b) ? <Badge tone="danger">{t.labels.unprocessed}</Badge> : null}
        </div>
      ),
    },
    {
      key: 'actions', header: t.columns.actions, width: '210px',
      render: (b) => (
        <div className="btn-group">
          <Button variant="outline" size="sm" aria-label={t.rowActions.detail} onClick={() => setDetailTarget(b)}>
            <Eye size={13} />
          </Button>
          {b.status === 'PENDING' ? (
            <Button variant="primary" size="sm" aria-label={t.rowActions.confirm} onClick={() => setConfirmTarget(b)}>
              <Check size={13} />
            </Button>
          ) : null}
          {b.status === 'CONFIRMED' ? (
            <>
              <Button variant="success" size="sm" aria-label={t.rowActions.markComplete} onClick={() => setCompleteTarget(b)}>
                <CheckCheck size={13} />
              </Button>
              <Button variant="warning" size="sm" aria-label={t.rowActions.markNoShow} onClick={() => setNoShowTarget(b)}>
                <Ban size={13} />
              </Button>
            </>
          ) : null}
          {b.status === 'PENDING' || b.status === 'CONFIRMED' ? (
            <>
              <Button variant="outline" size="sm" aria-label={t.rowActions.edit} onClick={() => setEditing(b)}>
                <Pencil size={13} />
              </Button>
              <Button
                variant="outlineDanger" size="sm" aria-label={t.rowActions.cancel}
                onClick={() => { setCancelReason(''); setCancelTarget(b); }}
              >
                <X size={13} />
              </Button>
            </>
          ) : null}
          {b.status === 'COMPLETED' ? (
            <Button variant="outline" size="sm" aria-label={t.rowActions.revert} onClick={() => setRevertTarget(b)}>
              <RotateCcw size={13} />
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow={nav.navBooking}
        title={t.title}
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              loading={loading}
              onClick={() => void exportCsv()}
            >
              <Download size={15} />{common.exportCsv}
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus size={15} />{t.actions.create}
            </Button>
          </>
        }
      />

      {selected.length > 0 ? (
        <Alert tone="primary" className="mb-4"
               action={
                 <div className="btn-group">
                   <Button size="sm" onClick={openBatchConfirm}>
                     <Check size={13} />{t.actions.batchConfirm}
                   </Button>
                   <Button size="sm" variant="danger" onClick={openBatchCancel}>
                     <X size={13} />{t.actions.batchCancel}
                   </Button>
                   <Button size="sm" variant="outline" aria-label={t.actions.clearSelection} onClick={() => setSelected([])}>
                     <X size={13} />
                   </Button>
                 </div>
               }
        >
          {t.filters.selectedCount(selected.length)}
        </Alert>
      ) : null}

      <DataTableContainer>
        <DataTableHeader
          title={t.tableTitle}
          actions={
            <>
              <label className="flex items-center gap-1.5 text-xs text-secondary">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) => setSelected(e.target.checked ? rows.map((r) => r.id) : [])}
                />
                {t.filters.selectedCount(selected.length)}
              </label>
              <Input
                type="date" className="form-control-sm w-auto" value={startDate}
                onChange={(e) => { setStartDate(e.target.value); setPage(0); }}
              />
              <span className="text-xs text-secondary">{t.filters.dateSeparator}</span>
              <Input
                type="date" className="form-control-sm w-auto" value={endDate}
                onChange={(e) => { setEndDate(e.target.value); setPage(0); }}
              />
              <Select
                className="form-select-sm w-auto" value={status}
                onChange={(e) => { setStatus(e.target.value); setPage(0); }}
              >
                <option value="">{t.filters.statusAll}</option>
                {Object.entries(t.filters.status).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </Select>
              <label className="flex items-center gap-1.5 text-xs text-secondary">
                <input
                  type="checkbox" checked={showCancelled}
                  onChange={(e) => { setShowCancelled(e.target.checked); setPage(0); }}
                />
                {t.filters.showCancelled}
              </label>
              <div className="input-group">
                <Input
                  className="form-control-sm w-52"
                  placeholder={t.filters.searchPlaceholder}
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && setPage(0)}
                />
                <Button
                  variant="outline" size="sm" aria-label={common.clearSearch}
                  onClick={() => { setKeyword(''); setPage(0); }}
                >
                  <X size={13} />
                </Button>
              </div>
            </>
          }
        />

        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          rowKey={(b) => b.id}
          scroll
          empty={
            <EmptyState
              title={t.empty.title}
              description={t.empty.description}
              action={
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus size={15} />{t.actions.create}
                </Button>
              }
            />
          }
        />

        <DataTableFooter>
          <Pagination page={page} size={PAGE_SIZE} total={total} onChange={setPage} />
        </DataTableFooter>
      </DataTableContainer>

      {/* ------------------------------------------------------ 1. 新增預約 */}
      <BookingFormModal
        open={createOpen}
        booking={null}
        onClose={() => setCreateOpen(false)}
        onSaved={() => { setCreateOpen(false); toast.show(t.messages.created); void load(); }}
      />

      {/* ------------------------------------------------------ 2. 編輯預約 */}
      <BookingFormModal
        open={!!editing}
        booking={editing}
        onClose={() => setEditing(null)}
        onSaved={(result) => {
          setEditing(null);
          toast.show(result?.notifyTriggered ? t.messages.updated : t.messages.updatedWithoutNotification);
          void load();
        }}
      />

      {/* ------------------------------------------------------ 3. 取消預約 */}
      <Modal
        open={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        title={t.cancelModal.title}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelTarget(null)}>{t.cancelModal.back}</Button>
            <Button
              variant="danger"
              onClick={() => {
                const target = cancelTarget;
                setCancelTarget(null);
                if (target) {
                  void runAction(
                    () => cancelBooking(target.id, cancelReason),
                    t.messages.cancelled,
                    t.messages.cancelFailed,
                  );
                }
              }}
            >
              {t.cancelModal.confirm}
            </Button>
          </>
        }
      >
        <p className="mb-3 text-base">{t.cancelModal.intro}</p>
        {cancelTarget && extrasOf(cancelTarget).paidAmount > 0 ? (
          <Alert tone="warning" className="mb-3">
            <span className="whitespace-pre-line">
              {t.confirmMessages.cancelPaidWarning(formatCurrency(extrasOf(cancelTarget).paidAmount))}
            </span>
          </Alert>
        ) : null}
        <FormGroup>
          <Label htmlFor="cancelReason">{t.cancelModal.label}</Label>
          <Textarea
            id="cancelReason" rows={3} value={cancelReason} maxLength={t.cancelModal.max}
            placeholder={t.cancelModal.placeholder}
            onChange={(e) => setCancelReason(e.target.value)}
          />
          <div className="flex justify-end">
            <CharCounter value={cancelReason} max={t.cancelModal.max} />
          </div>
        </FormGroup>
      </Modal>

      {/* ------------------------------------------------------ 4. 加購項目 */}
      <AddonModal
        booking={addonTarget}
        onClose={() => setAddonTarget(null)}
        onAdded={(notify, hasLine) => {
          setAddonTarget(null);
          toast.show(
            !notify ? t.messages.addonAddedSilent
              : hasLine ? t.messages.addonAdded
                : t.messages.addonAddedNoLine,
          );
          void load();
        }}
      />

      {/* ------------------------------------------------------ 5. 套用票券 */}
      <ApplyCouponModal
        booking={couponTarget}
        onClose={() => setCouponTarget(null)}
        onApplied={(discount, net) => {
          setCouponTarget(null);
          toast.show(t.messages.couponApplied(formatCurrency(discount), formatCurrency(net)));
          void load();
        }}
      />

      {/* ------------------------------------------------------ 6. 調整金額 */}
      <AdjustPriceModal
        booking={adjustTarget}
        onClose={() => setAdjustTarget(null)}
        onAdjusted={(amount) => {
          setAdjustTarget(null);
          toast.show(t.messages.priceAdjusted(formatCurrency(amount)));
          void load();
        }}
      />

      {/* ------------------------------------------------------ 7. 使用點數 */}
      <ApplyPointsModal
        booking={pointsTarget}
        onClose={() => setPointsTarget(null)}
        onApplied={(points) => {
          setPointsTarget(null);
          toast.show(t.messages.pointsApplied(points));
          void load();
        }}
      />

      {/* ------------------------------------------------------ 8. 標記付款 */}
      <ConfirmModal
        open={!!markPaidTarget}
        title={markPaidTarget && extrasOf(markPaidTarget).paidAmount > 0
          ? t.markPaidModal.titleBalance
          : t.markPaidModal.titleOffline}
        message={
          <span className="whitespace-pre-line">
            {t.markPaidModal.confirmOffline}
            {markPaidTarget && extrasOf(markPaidTarget).paidAmount > 0
              ? `\n${t.markPaidModal.depositHint}`
              : ''}
          </span>
        }
        onClose={() => setMarkPaidTarget(null)}
        onConfirm={() => {
          const target = markPaidTarget;
          setMarkPaidTarget(null);
          if (target) {
            void runAction(
              () => markBookingPaidOffline(target.id), t.messages.markedPaid, t.messages.markFailed,
            );
          }
        }}
      />

      {/* -------------------------------------------------------- 預約詳情 */}
      <BookingDetailModal
        booking={detailTarget}
        onClose={() => setDetailTarget(null)}
        onAddon={() => setAddonTarget(detailTarget)}
        onCoupon={() => setCouponTarget(detailTarget)}
        onPoints={() => setPointsTarget(detailTarget)}
        onAdjust={() => setAdjustTarget(detailTarget)}
        onMarkPaid={() => setMarkPaidTarget(detailTarget)}
        onComplete={() => setCompleteTarget(detailTarget)}
        onCancel={() => { setCancelReason(''); setCancelTarget(detailTarget); }}
        onRevert={() => setRevertTarget(detailTarget)}
        onRemoveAddon={(item) => setRemoveAddonTarget(item)}
      />

      {/* ---------------------------------------------------------- 確認類 */}
      <ConfirmModal
        open={!!confirmTarget}
        title={t.rowActions.confirm}
        message={
          <span className="whitespace-pre-line">
            {confirmTarget && extrasOf(confirmTarget).paidAmount === 0 && confirmTarget.paymentStatus === 'UNPAID'
              ? `${t.confirmMessages.confirmBooking}\n\n${t.confirmMessages.manualConfirm}`
              : t.confirmMessages.confirmBooking}
          </span>
        }
        onClose={() => setConfirmTarget(null)}
        onConfirm={() => {
          const target = confirmTarget;
          setConfirmTarget(null);
          if (target) {
            void runAction(() => confirmBooking(target.id), t.messages.confirmed, t.messages.confirmFailed);
          }
        }}
      />

      <ConfirmModal
        open={!!completeTarget}
        title={t.rowActions.complete}
        message={
          <span className="whitespace-pre-line">
            {completeTarget && extrasOf(completeTarget).paidAmount === 0
              ? t.markPaidModal.balanceHint
              : t.markPaidModal.paidHint}
          </span>
        }
        onClose={() => setCompleteTarget(null)}
        onConfirm={() => {
          const target = completeTarget;
          setCompleteTarget(null);
          if (target) {
            void runAction(() => completeBooking(target.id), t.messages.completed, t.messages.actionFailed);
          }
        }}
      />

      <ConfirmModal
        open={!!noShowTarget}
        danger
        title={t.rowActions.markNoShow}
        message={t.confirmMessages.noShow}
        onClose={() => setNoShowTarget(null)}
        onConfirm={() => {
          const target = noShowTarget;
          setNoShowTarget(null);
          if (target) {
            void runAction(() => markNoShow(target.id), t.messages.markedNoShow, t.messages.noShowFailed);
          }
        }}
      />

      <ConfirmModal
        open={!!revertTarget}
        title={t.rowActions.revert}
        message={<span className="whitespace-pre-line">{t.confirmMessages.revert}</span>}
        onClose={() => setRevertTarget(null)}
        onConfirm={() => {
          const target = revertTarget;
          setRevertTarget(null);
          if (target) {
            void runAction(
              () => revertBookingComplete(target.id), t.messages.reverted, t.messages.revertFailed,
            );
          }
        }}
      />

      <ConfirmModal
        open={!!removeAddonTarget}
        danger
        title={t.rowActions.addon}
        confirmText={common.delete}
        message={t.confirmMessages.removeAddon}
        onClose={() => setRemoveAddonTarget(null)}
        onConfirm={() => {
          setRemoveAddonTarget(null);
          toast.show(t.messages.addonRemoved);
          void load();
        }}
      />

      {/* ---------------------------------------------------------- 批次類 */}
      <ConfirmModal
        open={batchConfirmOpen}
        title={t.actions.batchConfirm}
        message={
          <span className="whitespace-pre-line">
            {batchUnpaid.length > 0
              ? t.confirmMessages.batchUnpaidWarning(batchPending.length, batchUnpaid.length)
                + batchUnpaid.slice(0, 3).map((b) => `・${b.customerName}`).join('\n')
                + (batchUnpaid.length > 3 ? `\n${t.confirmMessages.batchUnpaidMore(batchUnpaid.length)}` : '')
                + '\n\n'
              : ''}
            {t.confirmMessages.batchConfirm(batchPending.length)}
          </span>
        }
        onClose={() => setBatchConfirmOpen(false)}
        onConfirm={async () => {
          const ids = batchPending.map((b) => b.id);
          setBatchConfirmOpen(false);
          try {
            await Promise.all(ids.map((id) => confirmBooking(id)));
            toast.show(t.messages.batchConfirmed(ids.length));
            setSelected([]);
            void load();
          } catch {
            toast.show(t.messages.batchConfirmFailed, 'danger');
          }
        }}
      />

      <ConfirmModal
        open={batchCancelOpen}
        danger
        title={t.cancelModal.batchTitle(batchCancellable.length)}
        confirmText={t.cancelModal.confirm}
        message={
          <span className="whitespace-pre-line">
            {t.confirmMessages.batchCancel(
              batchCancellable.length,
              batchPaid.length > 0
                ? t.confirmMessages.batchRefundWarning(batchPaid.length, formatCurrency(batchPaidTotal))
                : '',
            )}
          </span>
        }
        onClose={() => setBatchCancelOpen(false)}
        onConfirm={async () => {
          const ids = batchCancellable.map((b) => b.id);
          setBatchCancelOpen(false);
          try {
            await Promise.all(ids.map((id) => cancelBooking(id)));
            toast.show(t.messages.batchCancelled(ids.length));
            setSelected([]);
            void load();
          } catch {
            toast.show(t.messages.batchCancelFailed, 'danger');
          }
        }}
      />
    </>
  );
}

/* ========================================================================== */
/* 新增 / 編輯預約                                                             */
/* ========================================================================== */

function BookingFormModal({
  open, booking, onClose, onSaved,
}: {
  open: boolean;
  booking: Booking | null;
  onClose: () => void;
  onSaved: (result?: { notifyTriggered: boolean }) => void;
}) {
  const toast = useToast();
  const isEdit = !!booking;
  const c = t.createModal;
  const e = t.editModal;

  const [customers, setCustomers] = React.useState<Customer[]>([]);
  const [services, setServices] = React.useState<Service[]>([]);
  const [staff, setStaff] = React.useState<Staff[]>([]);

  const [newCustomer, setNewCustomer] = React.useState(false);
  const [customerId, setCustomerId] = React.useState('');
  const [newName, setNewName] = React.useState('');
  const [newPhone, setNewPhone] = React.useState('');
  const [serviceId, setServiceId] = React.useState('');
  const [staffId, setStaffId] = React.useState('');
  const [date, setDate] = React.useState('');
  const [checkoutDate, setCheckoutDate] = React.useState('');
  const [time, setTime] = React.useState('');
  const [duration, setDuration] = React.useState(60);
  const [note, setNote] = React.useState('');
  const [showAllSlots, setShowAllSlots] = React.useState(false);
  const [error, setError] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setError('');
    setShowAllSlots(false);
    if (booking) {
      setCustomerId(booking.customerId);
      setServiceId(booking.serviceId);
      setStaffId(booking.staffId ?? '');
      setDate(booking.startAt.slice(0, 10));
      setTime(formatTime(booking.startAt));
      setDuration(booking.durationMinutes);
      setNote(booking.note);
    } else {
      setNewCustomer(false);
      setCustomerId(''); setNewName(''); setNewPhone('');
      setServiceId(''); setStaffId(''); setDate(''); setCheckoutDate('');
      setTime(''); setDuration(60); setNote('');
    }
  }, [open, booking]);

  React.useEffect(() => {
    if (!open) return;
    void (async () => {
      try { setCustomers((await listCustomers({ size: 200 })).content); }
      catch { toast.show(`${t.messages.loadCustomersFailed}${t.messages.unknownError}`, 'danger'); }
    })();
    void (async () => {
      try { setServices(await listServices()); }
      catch { toast.show(`${t.messages.loadServicesFailed}${t.messages.unknownError}`, 'danger'); }
    })();
    void (async () => {
      try { setStaff(await listStaff()); }
      catch { toast.show(`${t.messages.loadStaffFailed}${t.messages.unknownError}`, 'danger'); }
    })();
  }, [open, toast]);

  const selectedService = services.find((s) => s.id === serviceId) ?? null;

  React.useEffect(() => {
    if (!isEdit && selectedService) setDuration(selectedService.durationMinutes);
  }, [isEdit, selectedService]);

  const slots = showAllSlots ? TIME_OPTIONS : TIME_OPTIONS.filter((_, i) => i % 2 === 0);

  const validate = (): string => {
    if (!isEdit) {
      if (newCustomer) {
        if (!newName.trim() || !newPhone.trim()) return c.newCustomerInvalid;
      } else if (!customerId) {
        return c.customerInvalid;
      }
    }
    if (!serviceId) return c.serviceInvalid;
    if (REQUIRE_STAFF && !staffId) return `${c.staffRequired}${c.staffRequiredSuffix}`;
    if (!date) return c.dateInvalid;
    if (!isEdit && checkoutDate && checkoutDate <= date) return c.checkoutInvalid;
    if (!time) return c.timeInvalid;
    if (!isEdit && date < new Date().toISOString().slice(0, 10)) return t.messages.pastDate;
    if (isEdit && !duration) return t.messages.requiredFields;
    return '';
  };

  /**
   * 新顧客流程：API 建立預約只吃 customerId，先查手機（沿用既有顧客，不覆蓋姓名）、
   * 查無再建檔。createCustomer 在 services/customers.ts 被宣告成 Promise<void>
   * （該檔不在本次分工可動清單），但 POST /api/customers 實際回 { id }，此處以
   * 斷言取回；mock 分支回 undefined → 落到空字串，mock 建立預約不看 payload，行為不變。
   */
  const resolveCustomerId = async (): Promise<string> => {
    if (isEdit || !newCustomer) return customerId;
    const phone = newPhone.trim();
    const existing = (await listCustomers({ keyword: phone, size: 5 })).content
      .find((x) => x.phone === phone);
    if (existing) return existing.id;
    const created = (await createCustomer({ name: newName.trim(), phone })) as
      unknown as { id?: string } | undefined;
    return created?.id ?? '';
  };

  const submit = async () => {
    const err = validate();
    setError(err);
    if (err) return;
    setSaving(true);
    try {
      const startAt = new Date(`${date}T${time}:00`).toISOString();
      if (isEdit && booking) {
        // duration 下拉僅供畫面試算：PUT /api/bookings/:id 以既有 duration_minutes 重算 end_at
        const result = await updateBooking(booking.id, { startAt, staffId: staffId || null, note });
        onSaved(result);
      } else {
        await createBooking({
          customerId: await resolveCustomerId(),
          serviceId,
          staffId: staffId || undefined,
          startAt,
          note: note || undefined,
        });
        onSaved();
      }
    } catch (err2) {
      toast.show(
        `${isEdit ? t.messages.updateFailed : t.messages.createFailed}${err2 instanceof Error ? err2.message : t.messages.unknownError}`,
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
      size="lg"
      title={isEdit ? e.title : c.title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{common.cancel}</Button>
          <Button
            loading={saving}
            loadingText={isEdit ? e.submitting : c.submitting}
            onClick={() => void submit()}
          >
            {isEdit ? e.submit : c.submit}
          </Button>
        </>
      }
    >
      <p className="mb-4 text-base text-neutral-700">{isEdit ? e.intro : c.intro}</p>

      {isEdit ? (
        <FormGroup>
          <Label htmlFor="editBookingCustomer">{e.customer}</Label>
          <Input id="editBookingCustomer" readOnly value={`${booking?.customerName ?? ''} ${booking?.customerPhone ?? ''}`} />
          <FormText>{e.customerHelp}</FormText>
        </FormGroup>
      ) : (
        <FormGroup>
          <Label required htmlFor="bookingCustomer">{c.customer}</Label>
          <label className="mb-2 flex items-center gap-1.5 text-base">
            <input
              type="checkbox" checked={newCustomer}
              onChange={(ev) => setNewCustomer(ev.target.checked)}
            />
            {c.newCustomerToggle}
          </label>
          {newCustomer ? (
            <>
              <Input
                className="mb-2" value={newName} placeholder={c.newCustomerName}
                onChange={(ev) => setNewName(ev.target.value)}
              />
              <Input
                type="tel" value={newPhone} placeholder={c.newCustomerPhone}
                onChange={(ev) => setNewPhone(ev.target.value)}
              />
            </>
          ) : (
            <Select id="bookingCustomer" value={customerId} onChange={(ev) => setCustomerId(ev.target.value)}>
              <option value="">{c.customerPlaceholder}</option>
              {customers.map((x) => (
                <option key={x.id} value={x.id}>{`${x.name}（${x.phone}）`}</option>
              ))}
            </Select>
          )}
          <FormText>{c.customerHelp}</FormText>
        </FormGroup>
      )}

      <div className="grid gap-x-4 md:grid-cols-2">
        <FormGroup>
          <Label required htmlFor="bookingService">{isEdit ? e.service : c.service}</Label>
          <Select id="bookingService" value={serviceId} onChange={(ev) => setServiceId(ev.target.value)}>
            <option value="">{c.servicePlaceholder}</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {c.serviceOption(s.name, s.durationMinutes, formatCurrency(s.price))}
              </option>
            ))}
          </Select>
          {!isEdit ? <FormText>{c.serviceHelp}</FormText> : null}
        </FormGroup>

        <FormGroup>
          <Label htmlFor="bookingStaff">{isEdit ? e.staff : c.staff}</Label>
          <Select id="bookingStaff" value={staffId} onChange={(ev) => setStaffId(ev.target.value)}>
            <option value="">{c.staffAuto}</option>
            {staff.filter((s) => s.bookable).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
          <FormText>{c.staffHelp}</FormText>
          {staffId ? <FormText>{c.staffNoShift}</FormText> : null}
        </FormGroup>

        <FormGroup>
          <Label required htmlFor="bookingDate">{isEdit ? e.date : c.date}</Label>
          <Input id="bookingDate" type="date" value={date} onChange={(ev) => setDate(ev.target.value)} />
        </FormGroup>

        {!isEdit ? (
          <FormGroup>
            <Label required htmlFor="checkoutDate">{c.checkoutDate}</Label>
            <Input
              id="checkoutDate" type="date" value={checkoutDate}
              onChange={(ev) => setCheckoutDate(ev.target.value)}
            />
            <FormText>{c.stayHelp}</FormText>
          </FormGroup>
        ) : null}

        <FormGroup>
          <Label required htmlFor="bookingTime">{isEdit ? e.time : c.time}</Label>
          <Select id="bookingTime" value={time} onChange={(ev) => setTime(ev.target.value)}>
            <option value="">{c.timeInvalid}</option>
            {slots.map((v) => <option key={v} value={v}>{v}</option>)}
          </Select>
          <div className="flex items-center justify-between">
            <FormText>
              {showAllSlots ? c.allSlotsShown : c.slotsOnly(slots.length)}
            </FormText>
            {!showAllSlots ? (
              <button type="button" className="form-text underline" onClick={() => setShowAllSlots(true)}>
                {c.showAllSlots}
              </button>
            ) : null}
          </div>
        </FormGroup>

        <FormGroup>
          <Label required={isEdit} htmlFor="bookingDuration">{isEdit ? e.duration : c.duration}</Label>
          {isEdit ? (
            <Select
              id="bookingDuration" value={String(duration)}
              onChange={(ev) => setDuration(Number(ev.target.value))}
            >
              {DURATION_OPTIONS.map((d) => (
                <option key={d} value={d}>{`${d} ${e.durationUnit}`}</option>
              ))}
            </Select>
          ) : (
            <Input
              id="bookingDuration" readOnly placeholder={c.durationPlaceholder}
              value={selectedService ? c.durationValue(selectedService.durationMinutes) : ''}
            />
          )}
          <FormText>{isEdit ? e.durationHelp : c.durationHelp}</FormText>
        </FormGroup>
      </div>

      <FormGroup>
        <Label htmlFor="bookingNote">{isEdit ? e.noteToCustomer : c.note}</Label>
        <Textarea
          id="bookingNote" rows={2} value={note} maxLength={isEdit ? e.noteMax : c.noteMax}
          placeholder={isEdit ? e.noteToCustomerPlaceholder : c.notePlaceholder}
          onChange={(ev) => setNote(ev.target.value)}
        />
        <div className="flex justify-end">
          <CharCounter value={note} max={isEdit ? e.noteMax : c.noteMax} />
        </div>
      </FormGroup>

      <FormText>{common.requiredHint}</FormText>
      {error ? <FormError>{error}</FormError> : null}
    </Modal>
  );
}

/* ========================================================================== */
/* 加購項目                                                                    */
/* ========================================================================== */

function AddonModal({
  booking, onClose, onAdded,
}: {
  booking: Booking | null;
  onClose: () => void;
  onAdded: (notify: boolean, hasLine: boolean) => void;
}) {
  const toast = useToast();
  const a = t.addonModal;
  const [services, setServices] = React.useState<Service[]>([]);
  const [staff, setStaff] = React.useState<Staff[]>([]);
  const [serviceId, setServiceId] = React.useState('');
  const [name, setName] = React.useState('');
  const [price, setPrice] = React.useState('');
  const [duration, setDuration] = React.useState('0');
  const [quantity, setQuantity] = React.useState('1');
  const [staffId, setStaffId] = React.useState('');
  const [notify, setNotify] = React.useState(true);
  const [error, setError] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!booking) return;
    setServiceId(''); setName(''); setPrice(''); setDuration('0');
    setQuantity('1'); setStaffId(''); setNotify(true); setError('');
    void (async () => {
      try { setServices(await listServices()); }
      catch { toast.show(`${t.messages.loadAddonOptionsFailed}${t.messages.unknownError}`, 'danger'); }
    })();
    void (async () => {
      try { setStaff(await listStaff()); }
      catch { toast.show(`${t.messages.loadStaffFailed}${t.messages.unknownError}`, 'danger'); }
    })();
  }, [booking, toast]);

  const pickService = (id: string) => {
    setServiceId(id);
    const s = services.find((x) => x.id === id);
    if (s) {
      setName(s.name);
      setPrice(String(s.price));
      setDuration(String(s.durationMinutes));
    }
  };

  const submit = async () => {
    if (!name.trim()) { setError(t.messages.itemNameRequired); return; }
    if (!price || Number(price) < 0 || Number.isNaN(Number(price))) {
      setError(t.messages.invalidAmount);
      return;
    }
    setError('');
    setSaving(true);
    try {
      await new Promise((r) => setTimeout(r, 400));
      onAdded(notify, !!booking && booking.source === 'LINE');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={!!booking}
      onClose={onClose}
      title={a.title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{common.cancel}</Button>
          <Button loading={saving} loadingText={a.submitting} onClick={() => void submit()}>
            {a.submit}
          </Button>
        </>
      }
    >
      <FormGroup>
        <Label htmlFor="addonServiceSelect">{a.fromServiceLabel}</Label>
        <Select
          id="addonServiceSelect" className="form-select-sm" value={serviceId}
          onChange={(ev) => pickService(ev.target.value)}
        >
          <option value="">{a.freeInputOption}</option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {t.createModal.serviceOption(s.name, s.durationMinutes, formatCurrency(s.price))}
            </option>
          ))}
        </Select>
      </FormGroup>

      <FormGroup>
        <Label required htmlFor="addonItemName">{a.itemName}</Label>
        <Input
          id="addonItemName" className="form-control-sm" value={name}
          placeholder={a.itemNamePlaceholder}
          onChange={(ev) => setName(ev.target.value)}
        />
      </FormGroup>

      <div className="grid gap-x-4 md:grid-cols-3">
        <FormGroup>
          <Label required htmlFor="addonPrice">{a.price}</Label>
          <Input
            id="addonPrice" type="number" className="form-control-sm" value={price}
            placeholder={a.pricePlaceholder}
            onChange={(ev) => setPrice(ev.target.value)}
          />
        </FormGroup>
        <FormGroup>
          <Label htmlFor="addonDuration">{a.duration}</Label>
          <Select
            id="addonDuration" className="form-select-sm" value={duration}
            onChange={(ev) => setDuration(ev.target.value)}
            options={a.durationOptions.map((o) => ({ ...o }))}
          />
        </FormGroup>
        <FormGroup>
          <Label htmlFor="addonQty">{a.quantity}</Label>
          <Input
            id="addonQty" type="number" min={1} className="form-control-sm" value={quantity}
            onChange={(ev) => setQuantity(ev.target.value)}
          />
        </FormGroup>
      </div>

      <FormGroup>
        <Label htmlFor="addonStaffSelect">{a.staffLabel}</Label>
        <Select
          id="addonStaffSelect" className="form-select-sm" value={staffId}
          onChange={(ev) => setStaffId(ev.target.value)}
        >
          <option value="">{a.staffSame}</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      </FormGroup>

      <FormGroup>
        <label className="flex items-start gap-1.5 text-base">
          <input
            type="checkbox" checked={notify} className="mt-1"
            onChange={(ev) => setNotify(ev.target.checked)}
          />
          {a.notify}
        </label>
      </FormGroup>

      <FormText>{a.footnote}</FormText>
      {error ? <FormError>{error}</FormError> : null}
    </Modal>
  );
}

/* ========================================================================== */
/* 套用票券折抵                                                                */
/* ========================================================================== */

function ApplyCouponModal({
  booking, onClose, onApplied,
}: {
  booking: Booking | null;
  onClose: () => void;
  onApplied: (discount: number, net: number) => void;
}) {
  const toast = useToast();
  const cp = t.couponModal;
  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => { setCode(''); setError(''); }, [booking]);

  const submit = async () => {
    if (!booking) return;
    if (!code.trim()) { setError(t.messages.couponRequired); return; }
    setError('');
    setSaving(true);
    try {
      // API 回折抵後金額；折抵數 = 折抵前 − 折抵後（mock 分支合成同現行假邏輯的數字）
      const price = booking.finalPrice;
      const res = await applyBookingCoupon(booking.id, code.trim());
      onApplied(price - res.finalPrice, res.finalPrice);
    } catch (e) {
      // 404 找不到票券／409 已核銷、不屬此顧客 → 把 server message 顯示出來
      toast.show(e instanceof Error ? e.message : t.messages.couponFailed, 'danger');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={!!booking}
      onClose={onClose}
      title={cp.title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{common.cancel}</Button>
          <Button variant="success" loading={saving} loadingText={common.processing} onClick={() => void submit()}>
            <Ticket size={15} />{cp.submit}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-base">{cp.intro}</p>
      <FormGroup>
        <Label>{cp.amountLabel}</Label>
        <div className="text-lg font-bold text-dark">{formatCurrency(booking?.finalPrice ?? 0)}</div>
      </FormGroup>
      <FormGroup>
        <Label required htmlFor="applyCouponCode">{cp.code}</Label>
        <Input
          id="applyCouponCode" className="uppercase" value={code}
          placeholder={cp.codePlaceholder}
          onChange={(ev) => setCode(ev.target.value.toUpperCase())}
        />
        <FormText>{cp.codeHelp}</FormText>
      </FormGroup>
      {error ? <FormError>{error}</FormError> : null}
    </Modal>
  );
}

/* ========================================================================== */
/* 調整金額                                                                    */
/* ========================================================================== */

function AdjustPriceModal({
  booking, onClose, onAdjusted,
}: {
  booking: Booking | null;
  onClose: () => void;
  onAdjusted: (amount: number) => void;
}) {
  const ap = t.adjustPriceModal;
  const [amount, setAmount] = React.useState('');
  const [error, setError] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const addonCount = booking ? addonsOf(booking).length : 0;

  React.useEffect(() => {
    setAmount(booking ? String(booking.finalPrice) : '');
    setError('');
  }, [booking]);

  const submit = async () => {
    const value = Number(amount);
    if (amount === '' || Number.isNaN(value) || value < 0) {
      setError(t.messages.invalidAmount);
      return;
    }
    if (!booking) return;
    setError('');
    setSaving(true);
    try {
      await adjustBookingPrice(booking.id, value);
      onAdjusted(value);
    } catch (e) {
      setError(`${t.messages.adjustFailed}${e instanceof Error ? e.message : t.messages.unknownError}`);
    } finally {
      setSaving(false);
    }
  };

  const paid = booking ? extrasOf(booking).paidAmount : 0;
  const overpaid = paid - Number(amount || 0);

  return (
    <Modal
      open={!!booking}
      onClose={onClose}
      title={ap.title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{common.cancel}</Button>
          <Button loading={saving} loadingText={common.processing} onClick={() => void submit()}>
            {ap.submit}
          </Button>
        </>
      }
    >
      <p className="mb-2 whitespace-pre-line text-base">{ap.intro}</p>
      <ul className="mb-3 text-base text-neutral-700">
        {ap.bullets.map((b) => <li key={b}>{b}</li>)}
      </ul>

      {addonCount > 0 ? (
        <Alert tone="warning" className="mb-3">{ap.withAddonsWarning(addonCount)}</Alert>
      ) : null}

      <FormGroup>
        <Label required htmlFor="adjustAmount">{ap.label}</Label>
        <Input
          id="adjustAmount" type="number" min={0} value={amount}
          onChange={(ev) => setAmount(ev.target.value)}
        />
      </FormGroup>

      {paid > 0 && overpaid > 0 ? (
        <Alert tone="warning">
          {t.messages.paidOverNet(formatCurrency(paid), formatCurrency(Number(amount || 0)))}
        </Alert>
      ) : null}
      {error ? <FormError>{error}</FormError> : null}
    </Modal>
  );
}

/* ========================================================================== */
/* 使用點數                                                                    */
/* ========================================================================== */

function ApplyPointsModal({
  booking, onClose, onApplied,
}: {
  booking: Booking | null;
  onClose: () => void;
  onApplied: (points: number) => void;
}) {
  const toast = useToast();
  const pm = t.pointsModal;
  const [points, setPoints] = React.useState('');
  const [error, setError] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const balance = booking ? extrasOf(booking).customerPoints : 0;

  React.useEffect(() => { setPoints(''); setError(''); }, [booking]);

  const submit = async () => {
    const value = Number(points);
    if (points === '' || Number.isNaN(value) || value < 0) {
      setError(t.messages.invalidAmount);
      return;
    }
    if (!booking) return;
    setError('');
    setSaving(true);
    try {
      // 實際折抵數 = 折抵前 − API 回的折抵後金額；balance 只餵 mock 分支
      // （合成「夾在餘額／金額內」的現行假結果），真模式由後端驗證並回 409 訊息。
      const price = booking.finalPrice;
      const res = await applyBookingPoints(booking.id, value, balance);
      onApplied(price - res.finalPrice);
    } catch (e) {
      // 409 顧客點數不足（POINTS_001）等 → 把 server message 顯示出來
      toast.show(e instanceof Error ? e.message : t.messages.unknownError, 'danger');
    } finally {
      setSaving(false);
    }
  };

  const net = (booking?.finalPrice ?? 0) - Number(points || 0);

  return (
    <Modal
      open={!!booking}
      onClose={onClose}
      title={pm.title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{common.cancel}</Button>
          <Button loading={saving} loadingText={common.processing} onClick={() => void submit()}>
            <Coins size={15} />{pm.submit}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-base">{pm.intro}</p>
      <FormGroup>
        <Label>{pm.balanceLabel}</Label>
        <div className="text-lg font-bold text-dark">{balance}</div>
      </FormGroup>
      <FormGroup>
        <Label required htmlFor="applyPoints">{pm.label}</Label>
        <Input
          id="applyPoints" type="number" min={0} value={points}
          placeholder={pm.placeholder}
          onChange={(ev) => setPoints(ev.target.value)}
        />
        <FormText>{pm.help}</FormText>
      </FormGroup>
      {net < 0 ? (
        <Alert tone="warning">{t.messages.overpaidWarning(formatCurrency(-net))}</Alert>
      ) : null}
      <FormText>{t.detailModal.afterCoupon}</FormText>
      {error ? <FormError>{error}</FormError> : null}
    </Modal>
  );
}

/* ========================================================================== */
/* 預約詳情                                                                    */
/* ========================================================================== */

function BookingDetailModal({
  booking, onClose, onAddon, onCoupon, onPoints, onAdjust, onMarkPaid,
  onComplete, onCancel, onRevert, onRemoveAddon,
}: {
  booking: Booking | null;
  onClose: () => void;
  onAddon: () => void;
  onCoupon: () => void;
  onPoints: () => void;
  onAdjust: () => void;
  onMarkPaid: () => void;
  onComplete: () => void;
  onCancel: () => void;
  onRevert: () => void;
  onRemoveAddon: (item: AddonItem) => void;
}) {
  const d = t.detailModal;
  const addons = booking ? addonsOf(booking) : [];
  const extras = booking ? extrasOf(booking) : DEFAULT_EXTRAS;
  const net = (booking?.finalPrice ?? 0) - extras.couponDiscount - extras.pointsRedeemed;

  return (
    <Modal
      open={!!booking}
      onClose={onClose}
      size="lg"
      title={d.title}
      footer={
        booking ? (
          <>
            <Button variant="secondary" onClick={onClose}>{t.rowActions.close}</Button>
            {booking.status === 'COMPLETED' ? (
              <Button variant="outline" onClick={onRevert}>
                <RotateCcw size={15} />{t.rowActions.revert}
              </Button>
            ) : null}
            {booking.status === 'PENDING' || booking.status === 'CONFIRMED' ? (
              <>
                <Button variant="outline" onClick={onAddon}>
                  <Plus size={15} />{t.rowActions.addon}
                </Button>
                <Button variant="outline" onClick={onCoupon}>
                  <Ticket size={15} />{t.rowActions.applyCoupon}
                </Button>
                <Button variant="outline" onClick={onPoints}>
                  <Coins size={15} />{t.rowActions.applyPoints}
                </Button>
                <Button variant="outline" onClick={onAdjust}>
                  <Wallet size={15} />{t.rowActions.adjustPrice}
                </Button>
                <Button variant="success" onClick={onComplete}>{t.rowActions.complete}</Button>
                <Button variant="danger" onClick={onCancel}>{t.rowActions.cancel}</Button>
              </>
            ) : null}
          </>
        ) : null
      }
    >
      {!booking ? (
        <div className="py-10 text-center text-secondary">{d.loading}</div>
      ) : (
        <div className="flex flex-col gap-3 text-base">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-secondary">{booking.bookingNo}</span>
            <Badge tone={STATUS_TONE[booking.status]}>{common.bookingStatus[booking.status]}</Badge>
            <Badge tone={paymentLabel(booking) === t.payment.paid ? 'success' : 'warning'}>
              {paymentLabel(booking)}
            </Badge>
            <Badge tone="info">{common.bookingSource[booking.source]}</Badge>
          </div>

          <div className="grid gap-2 md:grid-cols-2">
            <div>
              <strong>{booking.customerName}</strong>
              <div className="text-xs text-secondary">{booking.customerPhone}</div>
            </div>
            <div>
              {formatDate(booking.startAt)} {formatTime(booking.startAt)} - {formatTime(booking.endAt)}
              <div className="text-xs text-secondary">
                {t.createModal.durationValue(booking.durationMinutes)}
              </div>
            </div>
            <div>{booking.serviceName || t.labels.deletedService}</div>
            <div>{booking.staffName ?? t.labels.unassigned}</div>
          </div>

          {booking.note ? (
            <div className="rounded-lg bg-neutral-50 p-3">
              <h6 className="mb-1 text-base font-bold">{t.labels.customerNote}</h6>
              <p className="text-base text-neutral-700">{booking.note}</p>
            </div>
          ) : null}

          {/* 加購明細 */}
          <div>
            <h6 className="mb-2 text-base font-bold">{d.addonSection}</h6>
            {addons.length === 0 ? (
              <p className="form-text">{t.labels.noData}</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {addons.map((item) => (
                  <li key={item.id} className="flex items-center gap-2 rounded-lg bg-neutral-50 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate">{item.name} × {item.quantity}</span>
                    <span className="text-xs text-secondary">
                      {item.staffName ?? t.labels.sameStaff}
                    </span>
                    <span className="tabular-nums">{formatCurrency(item.price * item.quantity)}</span>
                    <Button
                      size="sm" variant="outlineDanger" aria-label={common.delete}
                      onClick={() => onRemoveAddon(item)}
                    >
                      <Trash2 size={13} />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 金額 */}
          <div className="rounded-lg bg-neutral-50 p-3">
            <div className="flex items-center justify-between">
              <span>{d.amountLabel}</span>
              <strong className="tabular-nums">{formatCurrency(net)}</strong>
            </div>
            {extras.couponDiscount > 0 ? (
              <div className="form-text">{d.couponDiscount(formatCurrency(extras.couponDiscount))}</div>
            ) : null}
            {extras.pointsRedeemed > 0 ? (
              <div className="form-text">{d.pointsDiscount(extras.pointsRedeemed)}</div>
            ) : null}
            {extras.paidAmount > 0 ? (
              <div className="form-text">
                {d.paidLabel}
                {formatCurrency(extras.paidAmount)}
              </div>
            ) : null}
          </div>

          {booking.status === 'PENDING' ? (
            <span className="text-xs text-warning">{d.notConfirmed}</span>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" disabled title={t.detailModal.payLinkUnavailable}>
              {t.rowActions.payLinkUnavailable}
            </Button>
            <Button variant="outline" size="sm" onClick={onMarkPaid}>
              <Wallet size={13} />
              {extras.paidAmount > 0 ? t.rowActions.markBalancePaid : t.rowActions.markPaidOffline}
            </Button>
            {booking.source === 'LINE' ? (
              <Link href="/tenant/chat" className="btn btn-line btn-sm">{t.rowActions.chat}</Link>
            ) : null}
          </div>
          <FormText>{t.detailModal.payLinkUnavailable}</FormText>
        </div>
      )}
    </Modal>
  );
}
