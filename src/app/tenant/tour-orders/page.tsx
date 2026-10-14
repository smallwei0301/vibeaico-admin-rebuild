'use client';
import * as React from 'react';
import Link from 'next/link';
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
import {
  acceptTourOrder, cancelTourOrder, completeTourOrder, confirmTourOrderPayment,
  createManualTourOrder, getTourOrderSummary, listTourOrders, listTripDepartures, listTripPlans, listTrips,
  cleanedUrlForProceed, decideTourOrdersTenantAction, parseTourOrdersDeepLink, rejectTourOrder, stripTenantIdParam,
} from '@/services/tours';
import { REJECT_REASON_MAX_LENGTH } from '@/lib/tour-reject-reason';
import { listPaymentMethods, type PaymentMethodRow } from '@/services/payment-methods';
import { ApiError } from '@/lib/api';
import { AUTH_REAL } from '@/config/env';
import { performSwitchTenant } from '@/lib/auth-boundary';
import { switchTenant } from '@/services/auth';
import { createLatestGuard } from '@/lib/latest-request';
import { formatAsOf } from '@/lib/guide-report-range';
import { PUBLIC_DEFAULT_TIME_ZONE } from '@/lib/public-time-zone';
import { common } from '@/i18n/zh-TW/common';
import { navLabel } from '@/i18n/zh-TW/nav';
import { useBusinessType, useCurrentTenant } from '@/components/layout/BusinessTypeContext';
import { tourOrdersPage as t } from '@/i18n/zh-TW/pages/tour-orders';
import { publicTourRequestPage } from '@/i18n/zh-TW/pages/public-tour-request';
import { refundPolicyText } from '@/lib/tour-order-detail-labels';
import { isPendingTourRequest, tourPaymentActions } from '@/lib/tour-order-payment-actions';
import { formatCurrency, formatDateTime, formatNumber } from '@/lib/utils';
import type {
  TourOrder, TourOrderSource, TourOrderSummary, TourOrderStatus, TourPaymentStatus,
  Trip, TripDeparture, TripPlan,
  TripSalesMode,
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
const PAYMENT_TONE: Record<TourPaymentStatus, 'danger' | 'success' | 'neutral' | 'warning'> = {
  UNPAID: 'danger', PARTIAL: 'warning', PAID: 'success', REFUND_PENDING: 'warning', REFUNDED: 'neutral',
};
const SOURCE_TONE: Record<TourOrderSource, 'primary' | 'info' | 'success' | 'neutral'> = {
  MIDAO: 'primary', VIBEAI_SHOP: 'info', LINE: 'success', MANUAL: 'neutral',
};

export default function TourOrdersPage() {
  const toast = useToast();
  const copyLine = (lineId: string) => {
    try {
      navigator.clipboard.writeText(lineId).then(
        () => toast.show(t.messages.lineCopied),
        () => toast.show(t.messages.lineCopyFailed, 'danger'),
      );
    } catch {
      toast.show(t.messages.lineCopyFailed, 'danger');
    }
  };
  const businessType = useBusinessType();

  const [rows, setRows] = React.useState<TourOrder[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(0);
  const [loading, setLoading] = React.useState(true);

  const [keyword, setKeyword] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('');
  const [sourceFilter, setSourceFilter] = React.useState('');
  const [paymentFilter, setPaymentFilter] = React.useState('');
  /** #45 報表下鑽：行程與建立日期區間（深連結帶入，可一鍵清除） */
  const [tripFilter, setTripFilter] = React.useState('');
  const [createdFrom, setCreatedFrom] = React.useState('');
  const [createdTo, setCreatedTo] = React.useState('');
  const [planFilter, setPlanFilter] = React.useState('');
  const [activeOnly, setActiveOnly] = React.useState(false);
  const [salesModeFilter, setSalesModeFilter] = React.useState<TripSalesMode | ''>('');
  const [repeatOnly, setRepeatOnly] = React.useState(false);
  const [createdBefore, setCreatedBefore] = React.useState('');
  const [asOfZone, setAsOfZone] = React.useState('');
  /** 深連結帶入的篩選是否已套用完成：套用前不載入，避免先送一次未篩選請求 */
  const [ready, setReady] = React.useState(false);
  /** 這次的篩選是否來自報表／深連結（決定是否顯示「清除」提示列） */
  const [fromLink, setFromLink] = React.useState(false);
  const latest = React.useRef(createLatestGuard());
  /** #890：統計卡數字（整個店家，由 /api/tour-orders/summary 提供）；null＝載入中或失敗，顯示佔位。 */
  const [summary, setSummary] = React.useState<TourOrderSummary | null>(null);
  const summaryLatest = React.useRef(createLatestGuard());

  const [detail, setDetail] = React.useState<TourOrder | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [action, setAction] = React.useState<
    { kind: 'confirmPayment' | 'confirmDeposit' | 'confirmFull' | 'confirmBalance' | 'complete' | 'cancel' | 'reject'; order: TourOrder } | null
  >(null);
  /** #46：接受申請的付款保留時數覆寫——空字串＝不覆寫，用方案的預設值。 */
  const [acceptHoldHours, setAcceptHoldHours] = React.useState('');
  /** #944：拒絕申請的選填原因；空白＝不附原因。 */
  const [rejectReason, setRejectReason] = React.useState('');

  const [draft, setDraft] = React.useState({
    tripId: '', planId: '', departureId: '', customerName: '',
    customerPhone: '', partySize: 2, paymentMethodId: '', note: '',
  });

  /**
   * 手動建單視窗的行程／方案／團次三個下拉，以前讀的是頁內的 MOCK_TRIPS /
   * MOCK_TRIP_PLANS / MOCK_TRIP_DEPARTURES —— 也就是說，即使後端端點都在，
   * 店家選到的仍然是示範資料的 id，送出去必然 404。這比「端點不存在」更難察覺：
   * 下拉裡看得到選項、選得下去，只有送出那一刻才會失敗。
   */
  const [trips, setTrips] = React.useState<Trip[]>([]);
  const [plans, setPlans] = React.useState<TripPlan[]>([]);
  const [departures, setDepartures] = React.useState<TripDeparture[]>([]);
  const [busy, setBusy] = React.useState(false);

  /** GUIDE 收件匣 REFUND_PENDING 卡片帶 `?paymentStatus=REFUND_PENDING&orderId=<id>`
   * 進來（#43 類別 5）；比照 `/tenant/bookings` 既有的 `?status` / `?paymentStatus=UNPAID`
   * / `?bookingId` 作法，載入後套用篩選並開啟該筆詳情。 */
  const [requestedOrderId, setRequestedOrderId] = React.useState('');
  const openedDeepLinkId = React.useRef('');

  const currentTenantId = useCurrentTenant().id;
  const currentTenantRef = React.useRef(currentTenantId);
  currentTenantRef.current = currentTenantId;

  React.useEffect(() => {
    const dl = parseTourOrdersDeepLink(window.location.search);
    const { paymentStatus, orderId } = dl;
    // 通知連結帶 tenantId：多店帳號的 active-tenant cookie 可能指向別間店。
    // 不同店 → 先切店（server 驗證成員資格）再 reload（同 AppShell）；失敗 → 提示並移除參數、不開啟訂單。
    if (AUTH_REAL && decideTourOrdersTenantAction(dl.tenantId, currentTenantRef.current) === 'switch') {
      const clean = `${window.location.pathname}${stripTenantIdParam(window.location.search)}${window.location.hash}`;
      void performSwitchTenant({
        switchTenant: () => switchTenant(dl.tenantId),
        reload: () => window.location.replace(clean),
        showError: () => {
          toast.show(t.messages.deepLinkSwitchFailed, 'danger');
          window.history.replaceState(null, '', clean);
        },
        fallbackMessage: t.messages.deepLinkSwitchFailed,
      });
      setReady(true);
      return;
    }
    // proceed：同店（或無 tenantId）→ 移除 tenantId 但保留 orderId，避免日後重整／分享網址時誤觸切店。
    const proceedUrl = cleanedUrlForProceed(window.location.pathname, window.location.search, window.location.hash);
    if (proceedUrl !== null) window.history.replaceState(null, '', proceedUrl);
    if (dl.status) setStatusFilter(dl.status);
    if (dl.source) setSourceFilter(dl.source);
    if (dl.tripId) setTripFilter(dl.tripId);
    if (dl.createdFrom) setCreatedFrom(dl.createdFrom);
    if (dl.createdTo) setCreatedTo(dl.createdTo);
    if (dl.planId) setPlanFilter(dl.planId);
    if (dl.activeOnly) setActiveOnly(true);
    if (dl.salesMode) setSalesModeFilter(dl.salesMode);
    if (dl.repeatCustomers) setRepeatOnly(true);
    if (paymentStatus) setPaymentFilter(paymentStatus);
    if (orderId) setRequestedOrderId(orderId);
    if (dl.createdBefore) setCreatedBefore(dl.createdBefore);
    if (dl.tz) setAsOfZone(dl.tz);
    if (dl.status || dl.source || dl.tripId || dl.planId || dl.createdFrom || dl.createdTo || dl.createdBefore || dl.salesMode
      || dl.activeOnly || dl.repeatCustomers || paymentStatus) setFromLink(true);
    setReady(true);
    const guard = latest.current;
    const summaryGuard = summaryLatest.current;
    return () => { guard.invalidate(); summaryGuard.invalidate(); };
  }, []);

  const drillExtras = React.useMemo(() => ({
    ...(planFilter ? { planId: planFilter } : {}),
    ...(salesModeFilter ? { salesMode: salesModeFilter } : {}),
    ...(activeOnly ? { activeOnly: '1' as const } : {}),
    ...(repeatOnly ? { repeatCustomers: '1' as const } : {}),
    ...(createdBefore ? { createdBefore } : {}),
  }), [planFilter, salesModeFilter, activeOnly, repeatOnly, createdBefore]);

  const load = React.useCallback(async () => {
    // 只套用最新一次請求的回應：篩選連續變更時，較慢的舊回應不得覆蓋新結果
    const token = latest.current.next();
    setLoading(true);
    try {
      const res = await listTourOrders({
        page, size: PAGE_SIZE, keyword,
        status: statusFilter, source: sourceFilter, paymentStatus: paymentFilter,
        tripId: tripFilter, createdFrom, createdTo, ...drillExtras,
      });
      if (!latest.current.isLatest(token)) return;
      setRows(res.content);
      setTotal(res.totalElements);

      if (requestedOrderId && openedDeepLinkId.current !== requestedOrderId) {
        let requested = res.content.find((o) => o.id === requestedOrderId);
        if (!requested) {
          /*
           * 目標列可能不在目前這一頁（伺服器端分頁，每頁 PAGE_SIZE 筆）——比照
           * bookings 頁面的既有作法，用既有 tenant-scoped list API 以 orderId
           * 精準撈一筆，而不是放棄開啟詳情 modal。
           */
          const exact = await listTourOrders({
            page: 0, size: 1, orderId: requestedOrderId,
            status: statusFilter, source: sourceFilter, paymentStatus: paymentFilter,
            tripId: tripFilter, createdFrom, createdTo, ...drillExtras,
          });
          if (!latest.current.isLatest(token)) return;
          requested = exact.content.find((o) => o.id === requestedOrderId);
        }
        if (requested) {
          setDetail(requested);
          openedDeepLinkId.current = requestedOrderId;
        }
      }
    } catch (e) {
      if (!latest.current.isLatest(token)) return;
      toast.show(
        e instanceof ApiError && e.code === 'REPORT_001' ? t.messages.rangeTooLarge : t.messages.loadFailed,
        'danger',
      );
    } finally {
      if (latest.current.isLatest(token)) setLoading(false);
    }
  }, [page, keyword, statusFilter, sourceFilter, paymentFilter, tripFilter, createdFrom, createdTo, drillExtras, requestedOrderId, toast]);

  React.useEffect(() => { if (ready) void load(); }, [ready, load]);

  /* --------------------------------------------------------------- 統計 */
  /** 統計卡與列表分頁／篩選無關：載入失敗只回到佔位，不影響列表。 */
  const loadSummary = React.useCallback(async () => {
    const token = summaryLatest.current.next();
    try {
      const res = await getTourOrderSummary();
      if (!summaryLatest.current.isLatest(token)) return;
      setSummary(res);
    } catch {
      if (!summaryLatest.current.isLatest(token)) return;
      setSummary(null);
    }
  }, []);

  React.useEffect(() => { if (ready) void loadSummary(); }, [ready, loadSummary]);

  /* ----------------------------------------------------------- 狀態動作 */
  /**
   * issue #8-B：這三個動作原本只改頁面記憶體——
   *
   *     setRows((prev) => prev.map((o) => ... { ...o, status: 'CONFIRMED' }));
   *     toast.show(t.messages.paymentConfirmed);   // ← 就宣告成功
   *
   * 導遊按下「確認收款」、看到「已確認收款」，**重新整理訂單又變回未付款**。
   * 「完成」與「取消」是同一個形狀，而取消更糟：畫面顯示取消了，團次的名額
   * 卻從來沒被釋放，那個席次就這樣永遠卡著。
   *
   * 三條規則與列表頁（PR #266）、詳情頁（PR #267）一致：先呼叫端點、成功之後
   * 才 `await load()` 重讀、失敗顯示後端的真實訊息且不關閉對話框。
   */
  const runOrderAction = async (fn: () => Promise<unknown>, successMessage: string) => {
    setBusy(true);
    try {
      await fn();
      void loadSummary(); // 統計卡與列表並行重讀，失敗只回佔位、不阻擋列表
      await load();
      toast.show(successMessage);
      return true;
    } catch (e) {
      toast.show(
        `${t.messages.actionFailedPrefix}${e instanceof ApiError ? e.message : ''}`,
        'danger',
      );
      return false;
    } finally {
      setBusy(false);
    }
  };

  const runAction = async () => {
    if (!action) return;
    const { kind, order } = action;
    const [call, message] = kind === 'confirmPayment'
      ? [() => confirmTourOrderPayment(order.id), t.messages.paymentConfirmed] as const
      : kind === 'confirmDeposit'
        ? [() => confirmTourOrderPayment(order.id, 'DEPOSIT'), t.messages.depositConfirmed] as const
        : kind === 'confirmFull'
          ? [() => confirmTourOrderPayment(order.id, 'FULL'), t.messages.fullConfirmed] as const
          : kind === 'confirmBalance'
            ? [() => confirmTourOrderPayment(order.id, 'FULL'), t.messages.balanceConfirmed] as const
      : kind === 'complete'
        ? [() => completeTourOrder(order.id), t.messages.completed] as const
        : kind === 'reject'
          ? [() => rejectTourOrder(order.id, rejectReason.trim() || undefined), t.messages.rejected] as const
          : [() => cancelTourOrder(order.id), t.messages.cancelled] as const;
    const ok = await runOrderAction(call, message);
    if (ok) {
      setAction(null);
      setRejectReason('');
      // 詳情 Modal 內的訂單資料已過期（可能不在目前列表），收款成功後一併關閉
      if (detail?.id === order.id) setDetail(null);
    }
  };

  /**
   * #46：接受 REQUEST 申請。獨立於 `runAction`／`ConfirmModal` 之外，因為它多一個
   * 可選的「覆寫保留時數」輸入框——直接掛在詳情 modal 裡，成功後連詳情一起關掉
   * （旅客的申請狀態已經改變，留著舊的詳情畫面容易讓導遊誤以為還是 PENDING）。
   */
  const acceptRequest = async (order: TourOrder) => {
    const hours = acceptHoldHours.trim() ? Number(acceptHoldHours.trim()) : undefined;
    const ok = await runOrderAction(
      () => acceptTourOrder(order.id, hours),
      t.messages.accepted,
    );
    if (ok) { setDetail(null); setAcceptHoldHours(''); }
  };

  /* ------------------------------------------------------- 手動建立訂單 */
  /** 開啟建單視窗時才載入行程清單（列表頁本身不需要它） */
  React.useEffect(() => {
    if (!createOpen || trips.length) return;
    void (async () => {
      try { setTrips(await listTrips()); }
      catch { toast.show(t.messages.loadFailed, 'danger'); }
    })();
  }, [createOpen, trips.length, toast]);

  /** #873：開啟建單視窗時載入真實收款方式，只列啟用中的，預設選第一筆。 */
  const [payMethods, setPayMethods] = React.useState<PaymentMethodRow[]>([]);
  const [payState, setPayState] = React.useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  React.useEffect(() => {
    if (!createOpen) return;
    let cancelled = false;
    setPayState('loading');
    void (async () => {
      try {
        const rows = (await listPaymentMethods()).filter((m) => m.active)
          .sort((a, b) => a.sortOrder - b.sortOrder);
        if (cancelled) return;
        setPayMethods(rows);
        setPayState('ready');
        setDraft((d) => (rows.some((m) => m.id === d.paymentMethodId)
          ? d : { ...d, paymentMethodId: rows[0]?.id ?? '' }));
      } catch {
        if (cancelled) return;
        setPayMethods([]);
        setPayState('error');
        setDraft((d) => ({ ...d, paymentMethodId: '' }));
      }
    })();
    return () => { cancelled = true; };
  }, [createOpen]);

  /** 選了行程才載方案；選了方案才載團次——與下拉的 disabled 條件一致 */
  React.useEffect(() => {
    if (!draft.tripId) { setPlans([]); setDepartures([]); return; }
    void (async () => {
      try { setPlans(await listTripPlans(draft.tripId)); }
      catch { toast.show(t.messages.loadFailed, 'danger'); }
    })();
  }, [draft.tripId, toast]);

  React.useEffect(() => {
    if (!draft.tripId) return;
    void (async () => {
      try { setDepartures(await listTripDepartures(draft.tripId)); }
      catch { toast.show(t.messages.loadFailed, 'danger'); }
    })();
  }, [draft.tripId, toast]);

  const draftPlans = plans;
  const draftDepartures = departures.filter(
    (d) => d.planId === draft.planId && d.status === 'OPEN' && d.capacity > d.seatsBooked,
  );
  const draftPlan = draftPlans.find((p) => p.id === draft.planId);
  const draftTotal = draftPlan
    ? draftPlan.priceType === 'PER_PERSON' ? draftPlan.basePrice * draft.partySize : draftPlan.basePrice
    : 0;
  const draftDeposit = draftPlan ? depositOf(draftPlan, draftTotal, draft.partySize) : 0;

  /**
   * 建單原本完全不打端點：自己組一個 TourOrder 物件 `setRows` 進去、
   * 編一個 `to_new_1` 的 id 與 `T2609070001` 的訂單編號，然後報「訂單已建立」。
   * 重新整理就消失，團次的名額也從來沒被扣過。
   *
   * 現在走 `createManualTourOrder` → `POST /api/tour-orders/manual`，名額由
   * `create_tour_order` rpc 與建單在**同一交易**裡原子扣減（10 分冊 §2）。
   * 名額不足時後端回 409 TOUR_001，訊息原樣顯示給店家。
   */
  const submitDraft = async () => {
    if (!draft.tripId || !draft.planId || !draft.departureId) return;
    if (payState === 'loading') return;
    if (!draft.customerName.trim() || !draft.customerPhone.trim()) return;
    const ok = await runOrderAction(
      () => createManualTourOrder({
        departureId: draft.departureId,
        customerName: draft.customerName.trim(),
        customerPhone: draft.customerPhone.trim(),
        partySize: draft.partySize,
        paymentMethodId: draft.paymentMethodId || undefined,
        note: draft.note,
      }),
      t.messages.created,
    );
    if (!ok) return;
    setCreateOpen(false);
    setDraft({
      tripId: '', planId: '', departureId: '', customerName: '',
      customerPhone: '', partySize: 2, paymentMethodId: '', note: '',
    });
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
          <div className="text-2xs text-secondary">{o.customerPhone || o.customerLine || o.customerEmail || ''}</div>
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
          <div className="mt-0.5 truncate text-2xs text-secondary">{o.paymentMethodLabel || t.detail.noMethod}</div>
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
      key: 'actions', header: t.columns.actions, width: '150px', sticky: 'right',
      render: (o) => (
        <div className="btn-group btn-group-wrap">
          <Button
            variant="outline" size="sm" title={t.actions.detail} aria-label={t.actions.detail}
            onClick={() => setDetail(o)}
          >
            <Eye size={13} />
          </Button>
          {tourPaymentActions(o).map((kind) => (
            <Button
              key={kind} variant="outline" size="sm"
              title={t.actions[kind]} aria-label={t.actions[kind]}
              onClick={() => setAction({ kind, order: o })}
            >
              {kind === 'confirmDeposit'
                ? <Wallet size={13} className="text-warning" />
                : <CheckCircle2 size={13} className="text-success" />}
            </Button>
          ))}
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
        <StatCard label={t.stats.pending} value={summary ? formatNumber(summary.pending) : t.stats.placeholder} icon={ClipboardList} tone="warning" />
        <StatCard label={t.stats.unpaid} value={summary ? formatNumber(summary.awaitingPayment) : t.stats.placeholder} icon={Wallet} tone="danger" />
        <StatCard label={t.stats.upcoming} value={summary ? formatNumber(summary.upcoming7d) : t.stats.placeholder} icon={CalendarClock} tone="info" />
        <StatCard label={t.stats.monthRevenue} value={summary ? formatCurrency(summary.monthRevenue) : t.stats.placeholder} icon={BadgeDollarSign} tone="success" />
      </div>

      {fromLink || tripFilter || planFilter || salesModeFilter || activeOnly || repeatOnly || createdFrom || createdTo || createdBefore ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <span>
            {t.drilldown.current(
              [
                createdFrom || createdTo ? t.drilldown.range(createdFrom, createdTo) : '',
                tripFilter ? t.drilldown.trip : '',
                planFilter ? t.drilldown.plan : '',
                salesModeFilter ? t.drilldown.salesMode(t.salesMode[salesModeFilter]) : '',
                activeOnly ? t.drilldown.activeOnly : '',
                repeatOnly ? t.drilldown.repeatCustomers : '',
                createdBefore ? t.drilldown.asOf(formatAsOf(createdBefore, asOfZone || PUBLIC_DEFAULT_TIME_ZONE)) : '',
                fromLink && statusFilter ? t.drilldown.status(t.status[statusFilter as TourOrderStatus] ?? statusFilter) : '',
                fromLink && paymentFilter ? t.drilldown.payment(t.paymentStatus[paymentFilter as TourPaymentStatus] ?? paymentFilter) : '',
                fromLink && sourceFilter ? t.drilldown.source(t.source[sourceFilter as TourOrderSource] ?? sourceFilter) : '',
              ].filter(Boolean).join(t.drilldown.sep),
            )}
          </span>
          <Button
            variant="outline" size="sm"
            onClick={() => {
              // 清除所有由連結帶入的篩選（含狀態／付款／來源／行程／方案／旗標／日期／資料截至），並同步網址
              setStatusFilter(''); setPaymentFilter(''); setSourceFilter('');
              setTripFilter(''); setPlanFilter(''); setSalesModeFilter(''); setActiveOnly(false); setRepeatOnly(false);
              setCreatedFrom(''); setCreatedTo(''); setCreatedBefore(''); setAsOfZone('');
              setRequestedOrderId(''); setFromLink(false); setPage(0);
              window.history.replaceState(null, '', window.location.pathname);
            }}
          >
            {t.drilldown.clear}
          </Button>
        </div>
      ) : null}

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
              <Select value={statusFilter} onChange={(e) => {
                setStatusFilter(e.target.value);
                // 明確選「已取消」與「排除取消」矛盾：以使用者剛選的狀態為準，移除這兩個報表下鑽旗標
                if (e.target.value === 'CANCELLED') { setActiveOnly(false); setRepeatOnly(false); }
                setPage(0);
              }}>
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
            {detail ? tourPaymentActions(detail).map((kind) => (
              <Button
                key={kind} variant={kind === 'confirmDeposit' ? 'outline' : 'primary'}
                onClick={() => setAction({ kind, order: detail })}
              >
                {kind === 'confirmDeposit' ? <Wallet size={14} /> : <CheckCircle2 size={14} />}
                {t.actions[kind]}
              </Button>
            )) : null}
            {detail?.customerLine ? (
              <Button variant="outline" onClick={() => copyLine(detail.customerLine ?? '')}>
                <MessageSquareText size={14} />{t.actions.contactLine}
              </Button>
            ) : null}
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
                <dt className="text-secondary">{t.detail.fields.phone}</dt><dd>{detail.customerPhone || '—'}</dd>
                {detail.customerLine ? (<><dt className="text-secondary">{t.detail.fields.line}</dt><dd>{detail.customerLine}</dd></>) : null}
                {detail.customerEmail ? (<><dt className="text-secondary">{t.detail.fields.email}</dt><dd>{detail.customerEmail}</dd></>) : null}
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
                <dt className="text-secondary">{t.detail.fields.method}</dt><dd>{detail.paymentMethodLabel || <span className="text-muted">{t.detail.noMethod}</span>}</dd>
                <dt className="text-secondary">{t.detail.fields.ref}</dt>
                <dd>{detail.paymentRef || <span className="text-muted">{t.detail.noRef}</span>}</dd>
                {detail.refundedAmount != null && detail.refundedAmount > 0 ? (
                  <>
                    <dt className="text-secondary">{t.detail.fields.refunded}</dt>
                    <dd className="text-warning">{formatCurrency(detail.refundedAmount)}</dd>
                  </>
                ) : null}
                <dt className="text-secondary">{t.detail.fields.refundPolicy}</dt>
                <dd>
                  {refundPolicyText(detail.refundPolicySnapshot, publicTourRequestPage.form.cancellationPolicy)
                    ?? <span className="text-muted">{t.detail.noPolicy}</span>}
                </dd>
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

            {/* #46：只有「還在等待導遊決定的 REQUEST 申請」才顯示這一段。 */}
            {isPendingTourRequest(detail) ? (
              <section className="rounded-md border border-warning p-3">
                <h4 className="mb-1 text-sm font-bold text-warning">
                  {t.detail.sections.request}
                </h4>
                <p className="mb-2 text-sm text-secondary">{t.request.explain}</p>
                <FormGroup className="mb-2">
                  <Label>{t.request.holdHoursLabel}</Label>
                  <Input
                    type="number" min={1} step="any"
                    placeholder={t.request.holdHoursPlaceholder(12)}
                    value={acceptHoldHours}
                    onChange={(e) => setAcceptHoldHours(e.target.value)}
                  />
                </FormGroup>
                <div className="btn-group">
                  <Button
                    variant="primary" size="sm" loading={busy}
                    onClick={() => acceptRequest(detail)}
                  >
                    <CheckCircle2 size={13} />{t.actions.accept}
                  </Button>
                  <Button
                    variant="outlineDanger" size="sm"
                    onClick={() => { setRejectReason(''); setAction({ kind: 'reject', order: detail }); }}
                  >
                    <XCircle size={13} />{t.actions.reject}
                  </Button>
                </div>
              </section>
            ) : null}
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
              loading={busy}
              disabled={!draft.departureId || !draft.customerName || !draft.customerPhone || payState === 'loading'}
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
              {trips.map((tr) => <option key={tr.id} value={tr.id}>{tr.title}</option>)}
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
              <Label>{t.create.paymentLabel}</Label>
              <Select
                value={draft.paymentMethodId}
                disabled={payState === 'loading'}
                onChange={(e) => setDraft({ ...draft, paymentMethodId: e.target.value })}
              >
                {payState === 'loading' ? (
                  <option value="">{t.create.paymentLoading}</option>
                ) : (
                  <>
                    {payMethods.length === 0 && <option value="">{t.create.paymentNone}</option>}
                    {payMethods.map((m) => (
                      <option key={m.id} value={m.id}>{m.displayName}</option>
                    ))}
                  </>
                )}
              </Select>
              {payState === 'error' && (
                <FormText>{t.create.paymentLoadFailed}</FormText>
              )}
              {payState === 'ready' && payMethods.length === 0 && (
                <FormText>
                  {t.create.paymentEmptyHint}
                  <Link href="/tenant/payment-methods" className="text-primary underline">
                    {t.create.paymentEmptyLink}
                  </Link>
                </FormText>
              )}
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
        onClose={() => { setAction(null); setRejectReason(''); }}
        onConfirm={runAction}
        title={
          action?.kind === 'confirmPayment' ? t.confirm.confirmPaymentTitle
            : action?.kind === 'confirmDeposit' ? t.confirm.confirmDepositTitle
            : action?.kind === 'confirmFull' ? t.confirm.confirmFullTitle
            : action?.kind === 'confirmBalance' ? t.confirm.confirmBalanceTitle
            : action?.kind === 'complete' ? t.confirm.completeTitle
              : action?.kind === 'reject' ? t.confirm.rejectTitle
                : t.confirm.cancelTitle
        }
        message={
          action
            ? action.kind === 'confirmPayment' ? t.confirm.confirmPayment(action.order.orderNo)
              : action.kind === 'confirmDeposit'
                ? t.confirm.confirmDeposit(action.order.orderNo, formatCurrency(action.order.depositAmount))
              : action.kind === 'confirmFull' ? t.confirm.confirmFull(action.order.orderNo)
              : action.kind === 'confirmBalance' ? t.confirm.confirmBalance(action.order.orderNo)
              : action.kind === 'complete' ? t.confirm.complete(action.order.orderNo)
                : action.kind === 'reject' ? (
                  <>
                    <span className="block mb-2">{t.request.rejectConfirm(action.order.orderNo)}</span>
                    <Label>{t.request.rejectReasonLabel}</Label>
                    <Textarea
                      rows={3}
                      maxLength={REJECT_REASON_MAX_LENGTH}
                      placeholder={t.request.rejectReasonPlaceholder}
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                    />
                    <FormText>{t.request.rejectReasonCounter(rejectReason.length, REJECT_REASON_MAX_LENGTH)}</FormText>
                  </>
                )
                  : t.confirm.cancel(action.order.orderNo)
            : ''
        }
        confirmText={
          action?.kind === 'confirmPayment' ? t.actions.confirmPayment
            : action?.kind === 'confirmDeposit' ? t.actions.confirmDeposit
            : action?.kind === 'confirmFull' ? t.actions.confirmFull
            : action?.kind === 'confirmBalance' ? t.actions.confirmBalance
            : action?.kind === 'complete' ? t.actions.complete
              : action?.kind === 'reject' ? t.actions.reject
                : t.actions.cancel
        }
        danger={action?.kind === 'cancel' || action?.kind === 'reject'}
      />
    </>
  );
}
