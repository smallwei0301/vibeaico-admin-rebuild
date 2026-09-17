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
  completeBooking, confirmBooking, createBooking, createBookingAddon, deleteBookingAddon,
  listBookingAddons, listBookings, markBookingPaidOffline, markNoShow, revertBookingComplete,
  updateBooking,
} from '@/services/bookings';
import { createCustomer, listCustomers } from '@/services/customers';
import { listServices, listStaff } from '@/services/catalog';
import { exportBookingsCsv, exportBookingsXlsx } from '@/services/reports';
import { common } from '@/i18n/zh-TW/common';
import { nav } from '@/i18n/zh-TW/nav';
import { bookingsPage as t } from '@/i18n/zh-TW/pages/bookings';
import { formatCurrency, formatDate, formatTime } from '@/lib/utils';
import type {
  Booking, BookingAddon, BookingAddonPerformanceMode, BookingStatus, Customer, PaymentStatus,
  Service, Staff,
} from '@/lib/types';

/* -------------------------------------------------------------------------- */

/** 預約金額只顯示 API 回傳的 Booking.finalPrice；票券／點數折抵明細待真實欄位接線。 */

/** 加購「業績歸戶」單一 select 的三個特殊值；其餘 value 是真實 staff.id（SPECIFIC_STAFF）。 */
const ADDON_PERFORMANCE_INHERIT_VALUE = '';
const ADDON_PERFORMANCE_NONE_VALUE = '__NONE__';

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

/** 加購明細「業績歸戶」欄位的顯示文字：INHERIT 顯示同本預約人員，NONE 明確標示不計業績。 */
const addonPerformanceLabel = (item: BookingAddon): string => {
  if (item.performanceMode === 'NONE') return t.addonModal.performanceNone;
  if (item.performanceMode === 'SPECIFIC_STAFF') return item.performanceStaffName ?? t.labels.unassigned;
  return item.staffName ?? t.labels.sameStaff;
};

/** 付款狀態顯示：只使用 bookings 的真實 paymentStatus。 */
const isPaid = (b: Booking) =>
  b.paymentStatus === 'PAID_ONLINE' || b.paymentStatus === 'PAID_OFFLINE';

const paymentLabel = (b: Booking) => (
  isPaid(b) ? t.payment.paid : t.payment.pending
);

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
  const [requestedBookingId, setRequestedBookingId] = React.useState('');
  const openedDeepLinkId = React.useRef('');

  /* 確認類彈窗 */
  const [confirmTarget, setConfirmTarget] = React.useState<Booking | null>(null);
  const [completeTarget, setCompleteTarget] = React.useState<Booking | null>(null);
  const [noShowTarget, setNoShowTarget] = React.useState<Booking | null>(null);
  const [revertTarget, setRevertTarget] = React.useState<Booking | null>(null);
  const [batchConfirmOpen, setBatchConfirmOpen] = React.useState(false);
  const [removeAddonTarget, setRemoveAddonTarget] = React.useState<BookingAddon | null>(null);

  /* 詳情彈窗的加購明細——真實資料，開啟時載入，有 loading/error/empty 三態 */
  const [detailAddons, setDetailAddons] = React.useState<BookingAddon[]>([]);
  const [addonsLoading, setAddonsLoading] = React.useState(false);
  const [addonsError, setAddonsError] = React.useState('');

  const [cancelReason, setCancelReason] = React.useState('');

  /** 原站以 ?status=PENDING / ?status=UNPROCESSED / ?action=create 進入本頁；
   * action inbox 另帶 bookingId，載入後直接打開該筆詳情。 */
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const s = params.get('status');
    if (s) setStatus(s);
    if (params.get('paymentStatus') === 'UNPAID') setPaymentStatusFilter('UNPAID');
    const bookingId = params.get('bookingId');
    if (bookingId) setRequestedBookingId(bookingId);
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
        paymentStatus: paymentStatusFilter || undefined,
        keyword,
        from: startDate || undefined,
        to: endDate || undefined,
      });

      const applyClientFilters = (items: Booking[]) => {
        let filtered = items;
        if (paymentStatusFilter) {
          filtered = filtered.filter((b) => b.paymentStatus === paymentStatusFilter);
        }
        /** 未處理＝時間已過、但仍停在「待確認 / 已確認」的預約 */
        if (status === 'UNPROCESSED') {
          const now = Date.now();
          filtered = filtered.filter(
            (b) => (b.status === 'PENDING' || b.status === 'CONFIRMED') && new Date(b.startAt).getTime() < now,
          );
        }
        if (startDate) filtered = filtered.filter((b) => b.startAt.slice(0, 10) >= startDate);
        if (endDate) filtered = filtered.filter((b) => b.startAt.slice(0, 10) <= endDate);
        if (!showCancelled && status !== 'CANCELLED') {
          filtered = filtered.filter((b) => b.status !== 'CANCELLED');
        }
        return filtered;
      };

      let list = applyClientFilters(res.content);

      if (requestedBookingId && openedDeepLinkId.current !== requestedBookingId) {
        let requested = list.find((b) => b.id === requestedBookingId);
        if (!requested) {
          /*
           * The table intentionally loads at most 100 rows before doing its
           * client-side pagination. A GUIDE action may point at a later row,
           * so resolve that one booking through the existing tenant-scoped
           * list API instead of silently failing to open the detail modal.
           */
          const exact = await listBookings({
            page: 0,
            size: 1,
            bookingId: requestedBookingId,
            status: isRealStatus ? (status as BookingStatus) : '',
            paymentStatus: paymentStatusFilter || undefined,
            keyword,
            from: startDate || undefined,
            to: endDate || undefined,
          });
          requested = applyClientFilters(exact.content).find((b) => b.id === requestedBookingId);
        }
        if (requested) {
          setDetailTarget(requested);
          openedDeepLinkId.current = requestedBookingId;
        }
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
  }, [page, keyword, status, paymentStatusFilter, startDate, endDate, showCancelled, requestedBookingId, toast]);

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

  /**
   * 加購明細唯一資料源（issue #17）：detailTarget 一開啟就打 GET，取代舊版
   * 「畫面永遠顯示同一份寫死 mock」的假成功。每次呼叫都覆蓋整份清單，
   * create/delete 成功後也呼叫這支重新拉一次，讓明細永遠是 DB 目前狀態。
   */
  const loadAddons = React.useCallback(async (bookingId: string) => {
    setAddonsLoading(true);
    setAddonsError('');
    try {
      setDetailAddons(await listBookingAddons(bookingId));
    } catch (e) {
      setDetailAddons([]);
      setAddonsError(
        `${t.messages.loadAddonsFailed}${e instanceof Error ? e.message : t.messages.unknownError}`,
      );
    } finally {
      setAddonsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (detailTarget) void loadAddons(detailTarget.id);
    else { setDetailAddons([]); setAddonsError(''); }
  }, [detailTarget, loadAddons]);

  /** 加購或移除成功後：局部更新 detailTarget 的金額/時長（免關窗即可看到最新值）＋重新拉明細＋重新整理列表。 */
  const refreshAfterAddonChange = (
    bookingId: string, patch: { finalPrice: number; durationMinutes: number; endAt: string },
  ) => {
    setDetailTarget((prev) => (prev && prev.id === bookingId ? { ...prev, ...patch } : prev));
    void loadAddons(bookingId);
    void load();
  };

  /**
   * issue #33：原本只有 CSV 一種。後端的 `/api/export/bookings/:format` 早就存在，
   * 但這裡打的是不帶格式段的舊路徑，所以那支路由**全站沒有呼叫端**；xlsx 分支則
   * 是這一輪才補上的。原站的「匯出」本來就是一個 dropdown（見 bookings.json 的
   * buttons），兩種格式都給才是把功能復原，而不是只留一半。
   */
  const runExport = async (format: 'csv' | 'xlsx') => {
    try {
      const download = format === 'xlsx' ? exportBookingsXlsx : exportBookingsCsv;
      const result = await download({
        from: startDate || undefined,
        to: endDate || undefined,
      });
      // 檔名一律取自後端的 Content-Disposition（見 services/download.ts），
      // 前端不自組——自組檔名正是 #246 修掉的缺陷之一。
      toast.show(result.fileName ? t.messages.exportedAs(result.fileName) : t.messages.exported);
    } catch (e) {
      const message = e instanceof Error ? e.message : t.messages.exportFailed;
      toast.show(`${t.messages.exportFailedPrefix}${message}`, 'danger');
    }
  };

  /* --------------------------------------------------------------- 批次操作 */

  const selectedRows = rows.filter((r) => selected.includes(r.id));
  const batchPending = selectedRows.filter((r) => r.status === 'PENDING');
  const batchCancellable = selectedRows.filter((r) => r.status === 'PENDING' || r.status === 'CONFIRMED');
  const batchPaid = batchCancellable.filter(isPaid);
  const batchUnpaid = batchPending.filter((r) => r.paymentStatus === 'UNPAID');

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
      render: (b) => (
        <div className="min-w-0">
          <div>{formatCurrency(b.finalPrice)}</div>
          {b.finalPrice !== b.price ? (
            <div className="text-2xs text-secondary">{t.labels.memberPrice}</div>
          ) : null}
        </div>
      ),
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
              onClick={() => void runExport('csv')}
            >
              <Download size={15} />{common.exportCsv}
            </Button>
            <Button
              type="button"
              variant="outline"
              loading={loading}
              onClick={() => void runExport('xlsx')}
            >
              <Download size={15} />{common.exportExcel}
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
        {cancelTarget && isPaid(cancelTarget) ? (
          <Alert tone="warning" className="mb-3">
            <span className="whitespace-pre-line">{t.confirmMessages.cancelPaidWarning}</span>
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
        onAdded={(result) => {
          setAddonTarget(null);
          toast.show(
            !result.notified || result.notified === 'NONE' ? t.messages.addonAddedSilent
              : result.notified === 'LINE' ? t.messages.addonAdded
                : t.messages.addonAddedNoLine,
          );
          refreshAfterAddonChange(addonTarget!.id, {
            finalPrice: result.finalPrice, durationMinutes: result.durationMinutes, endAt: result.endAt,
          });
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
        addonCount={detailAddons.length}
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
        title={t.markPaidModal.titleOffline}
        message={t.markPaidModal.confirmOffline}
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
        addons={detailAddons}
        addonsLoading={addonsLoading}
        addonsError={addonsError}
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
            {confirmTarget?.paymentStatus === 'UNPAID'
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
            {completeTarget?.paymentStatus === 'UNPAID'
              ? t.markPaidModal.unpaidHint
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
          const item = removeAddonTarget;
          const bookingId = detailTarget?.id;
          setRemoveAddonTarget(null);
          if (!item || !bookingId) return;
          void (async () => {
            try {
              const result = await deleteBookingAddon(bookingId, item.id);
              toast.show(t.messages.addonRemoved);
              refreshAfterAddonChange(bookingId, {
                finalPrice: result.finalPrice, durationMinutes: result.durationMinutes, endAt: result.endAt,
              });
            } catch (e) {
              toast.show(
                `${t.messages.removeAddonFailed}${e instanceof Error ? e.message : t.messages.unknownError}`,
                'danger',
              );
            }
          })();
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
                ? t.confirmMessages.batchRefundWarning(batchPaid.length)
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
  onAdded: (result: Awaited<ReturnType<typeof createBookingAddon>>) => void;
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
  /** 單一 select：''＝INHERIT、__NONE__＝NONE、其餘為 staff.id＝SPECIFIC_STAFF（見檔頭常數）。 */
  const [performanceSelect, setPerformanceSelect] = React.useState(ADDON_PERFORMANCE_INHERIT_VALUE);
  const [notify, setNotify] = React.useState(true);
  const [error, setError] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  /**
   * 每次開啟視窗才產生一次，整個送出（含失敗後重試）沿用同一把 key——
   * 這樣重試不會被伺服器當成第二筆全新加購（0121 migration 的 rpc 冪等收據）。
   */
  const idempotencyKeyRef = React.useRef('');

  React.useEffect(() => {
    if (!booking) return;
    setServiceId(''); setName(''); setPrice(''); setDuration('0');
    setQuantity('1'); setPerformanceSelect(ADDON_PERFORMANCE_INHERIT_VALUE); setNotify(true); setError('');
    idempotencyKeyRef.current = crypto.randomUUID();
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

  const performanceMode: BookingAddonPerformanceMode =
    performanceSelect === ADDON_PERFORMANCE_NONE_VALUE ? 'NONE'
      : performanceSelect === ADDON_PERFORMANCE_INHERIT_VALUE ? 'INHERIT'
        : 'SPECIFIC_STAFF';
  const performanceStaffId = performanceMode === 'SPECIFIC_STAFF' ? performanceSelect : null;

  const submit = async () => {
    if (!booking) return;
    if (!name.trim()) { setError(t.messages.itemNameRequired); return; }
    if (!price || Number(price) < 0 || Number.isNaN(Number(price))) {
      setError(t.messages.invalidAmount);
      return;
    }
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) { setError(t.messages.invalidQuantity); return; }
    setError('');
    setSaving(true);
    try {
      const result = await createBookingAddon(booking.id, {
        serviceId: serviceId || null,
        name: name.trim(),
        price: Number(price),
        quantity: qty,
        durationMinutes: Number(duration),
        staffId: performanceStaffId,
        performanceMode,
        performanceStaffId,
        notify,
        idempotencyKey: idempotencyKeyRef.current,
      });
      onAdded(result);
    } catch (e) {
      toast.show(
        e instanceof Error ? e.message : `${t.messages.actionFailed}`,
        'danger',
      );
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
          id="addonStaffSelect" className="form-select-sm" value={performanceSelect}
          onChange={(ev) => setPerformanceSelect(ev.target.value)}
        >
          <option value={ADDON_PERFORMANCE_INHERIT_VALUE}>{a.staffSame}</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          <option value={ADDON_PERFORMANCE_NONE_VALUE}>{a.performanceNone}</option>
        </Select>
        <FormText>{a.performanceHelp}</FormText>
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
  booking, addonCount, onClose, onAdjusted,
}: {
  booking: Booking | null;
  /** 詳情彈窗目前載入到的真實加購筆數（issue #17：不再讀寫死 mock）。 */
  addonCount: number;
  onClose: () => void;
  onAdjusted: (amount: number) => void;
}) {
  const ap = t.adjustPriceModal;
  const [amount, setAmount] = React.useState('');
  const [error, setError] = React.useState('');
  const [saving, setSaving] = React.useState(false);

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
      // API 會驗證顧客實際可用點數與應付金額；折抵數以 API 回傳的最終金額計算。
      const price = booking.finalPrice;
      const res = await applyBookingPoints(booking.id, value);
      onApplied(price - res.finalPrice);
    } catch (e) {
      // 409 顧客點數不足（POINTS_001）等 → 把 server message 顯示出來
      toast.show(e instanceof Error ? e.message : t.messages.unknownError, 'danger');
    } finally {
      setSaving(false);
    }
  };

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
        <Label required htmlFor="applyPoints">{pm.label}</Label>
        <Input
          id="applyPoints" type="number" min={0} value={points}
          placeholder={pm.placeholder}
          onChange={(ev) => setPoints(ev.target.value)}
        />
        <FormText>{pm.help}</FormText>
      </FormGroup>
      {error ? <FormError>{error}</FormError> : null}
    </Modal>
  );
}

/* ========================================================================== */
/* 預約詳情                                                                    */
/* ========================================================================== */

function BookingDetailModal({
  booking, addons, addonsLoading, addonsError, onClose, onAddon, onCoupon, onPoints, onAdjust,
  onMarkPaid, onComplete, onCancel, onRevert, onRemoveAddon,
}: {
  booking: Booking | null;
  addons: BookingAddon[];
  addonsLoading: boolean;
  addonsError: string;
  onClose: () => void;
  onAddon: () => void;
  onCoupon: () => void;
  onPoints: () => void;
  onAdjust: () => void;
  onMarkPaid: () => void;
  onComplete: () => void;
  onCancel: () => void;
  onRevert: () => void;
  onRemoveAddon: (item: BookingAddon) => void;
}) {
  const d = t.detailModal;
  const amount = booking?.finalPrice ?? 0;

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

          {/* 加購明細（issue #17：真實載入，loading/error/empty 三態） */}
          <div>
            <h6 className="mb-2 text-base font-bold">{d.addonSection}</h6>
            {addonsLoading ? (
              <p className="form-text">{d.loading}</p>
            ) : addonsError ? (
              <Alert tone="danger" className="mb-0">{addonsError}</Alert>
            ) : addons.length === 0 ? (
              <p className="form-text">{t.labels.noData}</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {addons.map((item) => (
                  <li key={item.id} className="flex items-center gap-2 rounded-lg bg-neutral-50 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate">{item.name} × {item.quantity}</span>
                    <span className="text-xs text-secondary">{addonPerformanceLabel(item)}</span>
                    <span className="tabular-nums">{formatCurrency(item.appliedAmount)}</span>
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
              <strong className="tabular-nums">{formatCurrency(amount)}</strong>
            </div>
            <FormText>{d.discountBreakdownUnavailable}</FormText>
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
              {t.rowActions.markPaidOffline}
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
