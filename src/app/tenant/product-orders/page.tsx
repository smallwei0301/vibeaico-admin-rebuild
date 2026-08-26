'use client';
import * as React from 'react';
import Link from 'next/link';
import {
  Ban, CheckCircle2, Copy, Eye, MessageCircle, PackageCheck, Plus, ShoppingBag, Wallet,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge, CountBadge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { Card, CardBody } from '@/components/ui/Card';
import {
  DataTable, DataTableContainer, DataTableFooter, DataTableHeader, type Column,
} from '@/components/ui/DataTable';
import { Pagination } from '@/components/ui/Pagination';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmModal, Modal } from '@/components/ui/Modal';
import { FormError, FormGroup, FormText, Input, Label, Select } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { listProductOrders, listProducts, listStaff } from '@/services/catalog';
import {
  applyProductOrderCoupon,
  cancelProductOrder, completeProductOrder, confirmProductOrder,
  createManualProductOrder, markProductOrderPaidOffline,
  type ProductOrderNotifyOutcome,
} from '@/services/products';
import { listCustomers } from '@/services/customers';
import { listBookings } from '@/services/bookings';
import { common } from '@/i18n/zh-TW/common';
import { navLabel, resolveNavTerms } from '@/i18n/zh-TW/nav';
import { useBusinessType } from '@/components/layout/BusinessTypeContext';
import { MODE_PRESETS } from '@/config/modes';
import { productOrdersPage as t } from '@/i18n/zh-TW/pages/product-orders';
import { formatCurrency, formatDateTime, formatNumber } from '@/lib/utils';
import type { Booking, Customer, Product, ProductOrder, ProductOrderStatus, Staff } from '@/lib/types';

/* -------------------------------------------------------------------------- */
/* 本頁專用假資料（不寫進 src/mock，避免與其他頁面衝突）                          */
/* -------------------------------------------------------------------------- */

/** 原站 /api/payment-methods（本頁只需要下拉選單用的最小欄位） */
type PaymentMethodOption = { id: string; name: string };

const MOCK_PAYMENT_METHODS: PaymentMethodOption[] = [
  { id: 'pm_1', name: '現金' },
  { id: 'pm_2', name: '信用卡' },
  { id: 'pm_3', name: 'LINE Pay' },
  { id: 'pm_4', name: '銀行轉帳' },
];

/**
 * 原站 ProductOrder 另有出貨方式、統編、票券折抵、取消原因、付款連結等欄位，
 * 尚未收錄進 lib/types.ts，骨架階段以本頁常數補齊。
 */
type OrderExtras = {
  lineUserId: string | null;
  staffName: string | null;
  paymentMethodName: string | null;
  bookingId: string | null;
  note: string;
  taxId: string;
  deliveryType: 'PICKUP' | 'SHIPPING';
  shippingAddress: string;
  couponDiscount: number;
  paidAmount: number;
  payLink: string;
  payDueAt: string | null;
  completedAt: string | null;
  cancelReason: string;
  cancelledAt: string | null;
  fromBooking: boolean;
};

/**
 * 手動建單勾選「LINE 通知顧客消費明細」後，後端回報的實際結果 → 要顯示的 toast
 * （issue #27 ③）。'NONE' 不在表內：沒勾選就沒有任何事發生，也就沒有話要說。
 */
const NOTIFY_TOAST: Partial<Record<ProductOrderNotifyOutcome, {
  message: string; tone: 'info' | 'warning' | 'danger';
}>> = {
  LINE: { message: t.messages.notifyResult.line, tone: 'info' },
  EMAIL: { message: t.messages.notifyResult.email, tone: 'info' },
  NO_CONTACT: { message: t.messages.notifyResult.noContact, tone: 'warning' },
  QUOTA_EXCEEDED: { message: t.messages.notifyResult.quotaExceeded, tone: 'warning' },
  FAILED: { message: t.messages.notifyResult.failed, tone: 'danger' },
};

const DEFAULT_EXTRAS: OrderExtras = {
  lineUserId: null, staffName: null, paymentMethodName: null, bookingId: null,
  note: '', taxId: '', deliveryType: 'PICKUP', shippingAddress: '',
  couponDiscount: 0, paidAmount: 0, payLink: '', payDueAt: null,
  completedAt: null, cancelReason: '', cancelledAt: null, fromBooking: false,
};

/**
 * 商品訂單線上刷卡付款在原站是真實功能（`docs/specs/settings.json` 的
 * `productOnlinePaymentEnabled`、`docs/specs/product-orders.json:486-535`），
 * 但查過 `docs/integration/00`–`13` 分冊與現有 GitHub issue（#9 導遊自訂金流僅
 * 涵蓋「收款方式」設定頁本身，不含商品訂單 checkout；#12 旅客 checkout 明確
 * 限定行程／團次訂單，不含商品訂單）——**沒有任何一冊或一個 issue 規劃它**。
 * 不同於 bookings 頁的同型缺陷（issue #28 ②可以指向 #12），這裡沒有可以誠實
 * 指向的追蹤項目，所以不虛構一個。
 *
 * 因此示範資料不放一個看起來像真的網址：這個值只當「這張示範訂單原本會需要
 * 線上付款」的旗標，複製鈕改為停用並如實標示「線上付款尚未建置」
 * （見下方 `payLinkNotBuilt` 按鈕），不再讓店家複製到一個打開是 404 的網址、
 * 還被告知「可傳給顧客用手機刷卡」。
 */
const PAY_LINK_NOT_BUILT = '__ONLINE_PAYMENT_NOT_BUILT__';

const MOCK_ORDER_EXTRAS: Record<string, Partial<OrderExtras>> = {
  po_1: {
    lineUserId: 'U123',
    staffName: 'Amy',
    note: '顧客指定週五取貨',
    payLink: PAY_LINK_NOT_BUILT,
    payDueAt: '2026-08-21T18:00:00+08:00',
  },
  po_2: {
    lineUserId: 'U789',
    staffName: 'Ben',
    paymentMethodName: 'LINE Pay',
    paidAmount: 2400,
    couponDiscount: 200,
    taxId: '54321098',
    deliveryType: 'SHIPPING',
    shippingAddress: '台北市大安區忠孝東路四段 100 號 5 樓',
    completedAt: '2026-08-19T16:40:00+08:00',
    fromBooking: true,
    bookingId: 'b_3',
  },
};

const PAGE_SIZE = 20;

/* -------------------------------------------------------------------------- */

type OrderRow = ProductOrder & OrderExtras;

const toRow = (o: ProductOrder): OrderRow => ({
  ...o,
  ...DEFAULT_EXTRAS,
  ...(MOCK_ORDER_EXTRAS[o.id] ?? {}),
  /*
   * 票券折抵**優先取後端回的值**（issue #33 ①：product_orders.coupon_discount，
   * migration 0027）。mock 模式沒有這個欄位（undefined），才退回頁內示範值；
   * 兩者都沒有就是 0，畫面顯示「無」。
   */
  couponDiscount: o.couponDiscount
    ?? MOCK_ORDER_EXTRAS[o.id]?.couponDiscount
    ?? DEFAULT_EXTRAS.couponDiscount,
});

const STATUS_TONE: Record<ProductOrderStatus, 'warning' | 'info' | 'success' | 'neutral'> = {
  PENDING: 'warning',
  CONFIRMED: 'info',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
};

const totalQuantity = (o: OrderRow) => o.items.reduce((sum, i) => sum + i.quantity, 0);

const mainItemName = (o: OrderRow) => o.items[0]?.productName ?? t.labels.unnamed;

type CartItem = { productId: string; productName: string; quantity: number; price: number };

type PendingAction =
  | { kind: 'CONFIRM'; order: OrderRow }
  | { kind: 'MARK_PAID'; order: OrderRow }
  | { kind: 'CANCEL'; order: OrderRow };

export default function ProductOrdersPage() {
  const businessType = useBusinessType();
  const toast = useToast();

  const [rows, setRows] = React.useState<OrderRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [statusFilter, setStatusFilter] = React.useState('');
  const [page, setPage] = React.useState(0);

  /* modal 狀態 */
  const [detailTarget, setDetailTarget] = React.useState<OrderRow | null>(null);
  const [completeTarget, setCompleteTarget] = React.useState<OrderRow | null>(null);
  const [manualOpen, setManualOpen] = React.useState(false);
  const [pendingAction, setPendingAction] = React.useState<PendingAction | null>(null);
  const [cancelReason, setCancelReason] = React.useState('');
  const [acting, setActing] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const list = await listProductOrders();
      setRows(list.map(toRow));
    } catch (e) {
      toast.show(
        `${t.messages.loadOrdersFailed}${e instanceof Error ? e.message : t.messages.unknownError}`,
        'danger',
      );
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  React.useEffect(() => { void load(); }, [load]);

  const filtered = React.useMemo(
    () => (statusFilter ? rows.filter((o) => o.status === statusFilter) : rows),
    [rows, statusFilter],
  );

  const visible = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const pendingCount = rows.filter((o) => o.status === 'PENDING').length;

  const patchOrder = (id: string, patch: Partial<OrderRow>) =>
    setRows((list) => list.map((o) => (o.id === id ? { ...o, ...patch } : o)));

  /*
   * 商品訂單線上付款尚未建置（見 PAY_LINK_NOT_BUILT 旁的說明）。原本這裡是
   * `copyPayLink`：把 o.payLink 寫進剪貼簿並宣稱「可傳給顧客用手機刷卡」——
   * 但沒有任何後端會產生真的付款連結，那句話是假的已知。故意不留一個
   * 「複製了什麼但不說是幹嘛用的」半吊子按鈕：下方按鈕直接停用＋誠實標示。
   */

  const runPendingAction = async () => {
    if (!pendingAction) return;
    const { kind, order } = pendingAction;
    setActing(true);
    try {
      if (kind === 'CONFIRM') {
        await confirmProductOrder(order.id);
        patchOrder(order.id, { status: 'CONFIRMED' });
        toast.show(t.messages.confirmed);
      } else if (kind === 'MARK_PAID') {
        await markProductOrderPaidOffline(order.id);
        patchOrder(order.id, { paymentStatus: 'PAID_OFFLINE', paidAmount: order.totalAmount, payDueAt: null });
        toast.show(t.messages.markedPaid);
      } else {
        await cancelProductOrder(order.id, cancelReason.trim() || undefined);
        patchOrder(order.id, {
          status: 'CANCELLED',
          cancelReason: cancelReason.trim(),
          cancelledAt: new Date().toISOString(),
        });
        toast.show(order.paidAmount > 0 ? t.messages.cancelledRefundReminder : t.messages.cancelled);
      }
      setPendingAction(null);
      setCancelReason('');
    } catch (e) {
      /* 409 等後端訊息（例：「此訂單狀態已變更，請重新整理」）原樣顯示 */
      toast.show(e instanceof Error ? e.message : t.messages.actionFailed, 'danger');
    } finally {
      setActing(false);
    }
  };

  /* ------------------------------------------------------------------ 欄位 */

  const columns: Column<OrderRow>[] = [
    {
      key: 'orderNo', header: t.columns.orderNo, width: '160px',
      render: (o) => (
        <div className="min-w-0">
          <div className="font-semibold text-dark">{o.orderNo}</div>
          {o.fromBooking ? (
            <div className="text-2xs text-secondary">{resolveNavTerms(t.labels.fromBooking, businessType)}</div>
          ) : null}
          {o.payDueAt ? (
            <div className="text-2xs text-danger">{t.labels.payDue(formatDateTime(o.payDueAt))}</div>
          ) : null}
        </div>
      ),
    },
    {
      key: 'customer', header: t.columns.customer, width: '150px',
      render: (o) => (
        <div className="min-w-0">
          <div>{o.customerName || t.labels.unnamed}</div>
          {o.lineUserId ? (
            <div className="text-2xs text-secondary">{t.labels.lineCustomer}</div>
          ) : null}
        </div>
      ),
    },
    {
      key: 'product', header: t.columns.product,
      render: (o) => (
        <div className="min-w-0">
          <div>{mainItemName(o)}</div>
          <div className="text-2xs text-secondary">
            {o.deliveryType === 'SHIPPING' ? t.labels.shipping : t.labels.pickup}
            {o.taxId ? ` ${t.labels.taxId(o.taxId)}` : ''}
          </div>
        </div>
      ),
    },
    {
      key: 'quantity', header: t.columns.quantity, numeric: true, width: '80px',
      render: (o) => formatNumber(totalQuantity(o)),
    },
    {
      key: 'amount', header: t.columns.amount, numeric: true, width: '140px',
      render: (o) => (
        <div>
          <div>{formatCurrency(o.totalAmount)}</div>
          <div className="text-2xs text-secondary">
            {o.paymentStatus === 'UNPAID'
              ? (o.payLink ? t.payBadge.unpaid : t.payBadge.notOnline)
              : o.paidAmount > 0 && o.paidAmount < o.totalAmount
                ? t.payBadge.partial
                : t.payBadge.paid}
          </div>
        </div>
      ),
    },
    {
      key: 'status', header: t.columns.status, width: '100px',
      render: (o) => <Badge tone={STATUS_TONE[o.status]}>{t.status[o.status]}</Badge>,
    },
    {
      key: 'createdAt', header: t.columns.createdAt, width: '150px',
      render: (o) => formatDateTime(o.createdAt),
    },
    {
      key: 'actions', header: t.columns.actions, width: '210px',
      render: (o) => (
        <div className="btn-group">
          <Button
            variant="outline" size="sm" title={t.actions.view} aria-label={t.actions.view}
            onClick={() => setDetailTarget(o)}
          >
            <Eye size={13} />
          </Button>
          {o.status === 'PENDING' ? (
            <Button
              variant="outline" size="sm" title={t.actions.confirm} aria-label={t.actions.confirm}
              onClick={() => setPendingAction({ kind: 'CONFIRM', order: o })}
            >
              <CheckCircle2 size={13} />
            </Button>
          ) : null}
          {o.status === 'CONFIRMED' ? (
            <Button
              variant="outline" size="sm" title={t.actions.complete} aria-label={t.actions.complete}
              onClick={() => setCompleteTarget(o)}
            >
              <PackageCheck size={13} />
            </Button>
          ) : null}
          {o.paymentStatus === 'UNPAID' && o.status !== 'CANCELLED' ? (
            <Button
              variant="outline" size="sm"
              title={t.actions.markPaidOffline} aria-label={t.actions.markPaidOffline}
              onClick={() => setPendingAction({ kind: 'MARK_PAID', order: o })}
            >
              <Wallet size={13} />
            </Button>
          ) : null}
          {o.payLink ? (
            <Button
              variant="outline" size="sm" disabled
              title={t.actions.payLinkNotBuilt} aria-label={t.actions.payLinkNotBuilt}
            >
              <Copy size={13} />
            </Button>
          ) : null}
          {o.status !== 'CANCELLED' && o.status !== 'COMPLETED' ? (
            <Button
              variant="outlineDanger" size="sm" title={t.actions.cancel} aria-label={t.actions.cancel}
              onClick={() => { setCancelReason(''); setPendingAction({ kind: 'CANCEL', order: o }); }}
            >
              <Ban size={13} />
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  const pendingOrder = pendingAction?.order ?? null;

  const pendingTitle = pendingAction?.kind === 'CONFIRM'
    ? t.confirm.confirmOrderTitle
    : pendingAction?.kind === 'MARK_PAID'
      ? t.confirm.markPaidTitle
      : t.confirm.cancelTitle;

  const pendingMessage = (() => {
    if (!pendingAction || !pendingOrder) return common.confirm.message;
    if (pendingAction.kind === 'CONFIRM') {
      return pendingOrder.paymentStatus === 'UNPAID' && pendingOrder.payLink
        ? t.confirm.confirmOrderUnpaid
        : t.confirm.confirmOrder;
    }
    if (pendingAction.kind === 'MARK_PAID') return t.confirm.markPaid;
    return pendingOrder.paidAmount > 0
      ? t.confirm.cancelPaid(formatCurrency(pendingOrder.paidAmount))
      : common.confirm.message;
  })();

  return (
    <>
      <PageHeader
        eyebrow={navLabel('navOperation', businessType)}
        title={t.title}
        actions={
          <Button onClick={() => setManualOpen(true)}>
            <Plus size={15} />{t.actions.create}
          </Button>
        }
      />

      <Card className="mb-3">
        <CardBody>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-neutral-700">{t.filter.statusLabel}</span>
            <Select
              className="form-select-sm w-auto"
              aria-label={t.filter.statusLabel}
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
            >
              {t.filter.statusOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </Select>
            <span className="flex items-center gap-1 text-xs text-secondary">
              {t.filter.pendingCount(pendingCount)}
              <CountBadge count={pendingCount} />
            </span>
          </div>
        </CardBody>
      </Card>

      <DataTableContainer>
        <DataTableHeader title={t.tableTitle} />

        <DataTable
          columns={columns}
          rows={visible}
          loading={loading}
          rowKey={(o) => o.id}
          scroll
          empty={
            <EmptyState
              icon={ShoppingBag}
              title={t.empty.title}
              description={t.empty.description}
              action={
                <Button onClick={() => setManualOpen(true)}>
                  <Plus size={15} />{t.actions.create}
                </Button>
              }
            />
          }
        />

        <DataTableFooter>
          <Pagination page={page} size={PAGE_SIZE} total={filtered.length} onChange={setPage} />
        </DataTableFooter>
      </DataTableContainer>

      {/* ------------------------------------------------ modal 1：訂單詳情 */}
      <OrderDetailModal order={detailTarget} onClose={() => setDetailTarget(null)} />

      {/* -------------------------------------- modal 2：完成取貨 / 套用票券 */}
      <CompleteOrderModal
        order={completeTarget}
        onClose={() => setCompleteTarget(null)}
        onCompleted={(order, appliedDiscount) => {
          /*
           * issue #33 ①：折抵金額來自 POST /api/product-orders/:id/apply-coupon
           * 的回應（後端算的），沒有套券時是 null——此時只更新狀態，
           * 不動 couponDiscount，也不做 "+ 0" 這種沒有意義的運算。
           */
          patchOrder(order.id, {
            status: 'COMPLETED',
            completedAt: new Date().toISOString(),
            ...(appliedDiscount === null ? {} : {
              couponDiscount: order.couponDiscount + appliedDiscount,
              totalAmount: order.totalAmount - appliedDiscount,
            }),
          });
          setCompleteTarget(null);
        }}
      />

      {/* -------------------------------------------- modal 3：手動建立訂單 */}
      <ManualOrderModal
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        onCreated={(order) => {
          setRows((list) => [order, ...list]);
          setManualOpen(false);
        }}
      />

      {/* --------------------------- modal 4：確認訂單 / 標記收款 / 取消訂單 */}
      <ConfirmModal
        open={!!pendingAction}
        danger={pendingAction?.kind === 'CANCEL'}
        loading={acting}
        title={pendingTitle}
        confirmText={
          pendingAction?.kind === 'CONFIRM'
            ? t.actions.confirm
            : pendingAction?.kind === 'MARK_PAID'
              ? t.actions.markPaidOffline
              : t.actions.cancel
        }
        message={
          <span className="block">
            <span className="block whitespace-pre-line">{pendingMessage}</span>
            {pendingAction?.kind === 'CANCEL' ? (
              <span className="mt-3 block">
                <Label htmlFor="cancelReason">{t.confirm.cancelReasonLabel}</Label>
                <Input
                  id="cancelReason" value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                />
              </span>
            ) : null}
          </span>
        }
        onClose={() => { setPendingAction(null); setCancelReason(''); }}
        onConfirm={() => void runPendingAction()}
      />
    </>
  );
}

/* ========================================================================== */
/* modal 1：訂單詳情                                                           */
/* ========================================================================== */

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-secondary">{label}</dt>
      <dd className="col-span-2 min-w-0 break-words">{children}</dd>
    </>
  );
}

function OrderDetailModal({ order, onClose }: { order: OrderRow | null; onClose: () => void }) {
  /**
   * 「來源預約」連到父層級的訂單頁（14 分冊 §8.13）——嚮導的 /tenant/bookings
   * 在他的 hiddenNavKeys 裡，寫死會把他導去自己選單中不存在的頁面。
   */
  const detailBusinessType = useBusinessType();
  const ordersHref = MODE_PRESETS[detailBusinessType].ordersHref;
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!order) return;
    setLoading(true);
    let cancelled = false;
    const timer = setTimeout(() => { if (!cancelled) setLoading(false); }, 280);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [order]);

  const f = t.detail.fields;

  return (
    <Modal
      open={!!order}
      onClose={onClose}
      title={t.detail.title}
      footer={<Button variant="secondary" onClick={onClose}>{common.close}</Button>}
    >
      {loading || !order ? (
        <div className="py-8 text-center text-muted">{t.detail.loading}</div>
      ) : (
        <>
          {order.fromBooking ? (
            <Alert tone="info" className="mb-3">
              <Link className="underline" href={ordersHref}>{resolveNavTerms(t.labels.fromBooking, detailBusinessType)}</Link>
            </Alert>
          ) : null}

          <dl className="grid grid-cols-3 gap-y-2 text-base">
            <DetailRow label={t.columns.orderNo}>{order.orderNo}</DetailRow>
            <DetailRow label={t.columns.customer}>
              <span className="flex flex-wrap items-center gap-2">
                {order.customerName || t.labels.unnamed}
                {order.lineUserId ? (
                  <>
                    <code className="rounded-sm bg-neutral-100 px-1 text-xs">{order.lineUserId}</code>
                    <Link className="underline" href="/tenant/chat">
                      <MessageCircle size={12} className="inline" />{t.actions.chat}
                    </Link>
                  </>
                ) : (
                  <span className="text-muted">{t.labels.noPhone}</span>
                )}
              </span>
            </DetailRow>
            <DetailRow label={f.product}>{mainItemName(order)}</DetailRow>
            <DetailRow label={f.quantityUnitPrice}>
              {t.labels.quantityUnitPrice(
                order.items[0]?.quantity ?? 0,
                formatCurrency(order.items[0]?.price ?? 0),
              )}
            </DetailRow>
            <DetailRow label={t.columns.amount}>{formatCurrency(order.totalAmount)}</DetailRow>
            <DetailRow label={t.columns.status}>
              <Badge tone={STATUS_TONE[order.status]}>{t.status[order.status]}</Badge>
            </DetailRow>
            <DetailRow label={f.paymentMethod}>
              {order.paymentMethodName ?? (
                <span className="text-muted">{t.labels.unassignedPayment}</span>
              )}
            </DetailRow>
            <DetailRow label={f.onlinePayment}>
              {order.paymentStatus === 'UNPAID'
                ? (order.payLink ? t.payBadge.unpaid : t.payBadge.notOnline)
                : order.paidAmount > 0 && order.paidAmount < order.totalAmount
                  ? t.payBadge.partial
                  : t.payBadge.paid}
            </DetailRow>
            <DetailRow label={f.couponDiscount}>
              {order.couponDiscount > 0
                ? formatCurrency(order.couponDiscount)
                : <span className="text-muted">{t.labels.none}</span>}
            </DetailRow>
            <DetailRow label={f.staff}>
              {order.staffName ?? <span className="text-muted">{t.labels.notProvided}</span>}
            </DetailRow>
            <DetailRow label={resolveNavTerms(f.relatedBooking, detailBusinessType)}>
              {order.bookingId
                ? <Link className="underline" href={ordersHref}>{order.bookingId}</Link>
                : <span className="text-muted">{t.labels.none}</span>}
            </DetailRow>
            <DetailRow label={f.taxId}>
              {order.taxId || <span className="text-muted">{t.labels.none}</span>}
            </DetailRow>
            <DetailRow label={order.deliveryType === 'SHIPPING' ? f.shippingAddress : t.labels.pickup}>
              {order.deliveryType === 'SHIPPING'
                ? (order.shippingAddress || <span className="text-muted">{t.labels.notProvided}</span>)
                : t.labels.pickup}
            </DetailRow>
            <DetailRow label={f.note}>
              {order.note || <span className="text-muted">{t.labels.none}</span>}
            </DetailRow>
            <DetailRow label={t.columns.createdAt}>{formatDateTime(order.createdAt)}</DetailRow>
            {order.completedAt ? (
              <DetailRow label={f.completedPickup}>{formatDateTime(order.completedAt)}</DetailRow>
            ) : null}
            {order.cancelledAt ? (
              <>
                <DetailRow label={f.cancelReason}>
                  {order.cancelReason || <span className="text-muted">{t.labels.none}</span>}
                </DetailRow>
                <DetailRow label={f.cancelledAt}>{formatDateTime(order.cancelledAt)}</DetailRow>
              </>
            ) : null}
          </dl>
        </>
      )}
    </Modal>
  );
}

/* ========================================================================== */
/* modal 2：完成取貨（可套用票券）                                              */
/* ========================================================================== */

function CompleteOrderModal({
  order, onClose, onCompleted,
}: {
  order: OrderRow | null;
  onClose: () => void;
  /** appliedDiscount：後端回的折抵金額；null = 這次沒有套券（或示範模式） */
  onCompleted: (order: OrderRow, appliedDiscount: number | null) => void;
}) {
  const toast = useToast();
  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!order) return;
    setCode('');
    setError('');
  }, [order]);

  const finish = async (withCoupon: boolean) => {
    if (!order) return;
    if (withCoupon && !code.trim()) {
      setError(t.complete.couponCodeRequired);
      return;
    }
    setError('');
    setBusy(true);
    /*
     * 原站是**兩段獨立的請求**：先 apply-coupon、再 complete，第二段可以單獨
     * 失敗而第一段已經生效（jsStrings[77]「票券已套用，但「完成訂單」失敗：」）。
     * 這裡照同一個語意——所以兩段各有自己的 try，不能包成一個。
     */
    let applied: number | null = null;
    if (withCoupon) {
      try {
        const res = await applyProductOrderCoupon(order.id, code.trim());
        // res === null 只發生在示範模式（services/products.ts 的 mock 分支）：
        // 沒有票券資料可查，就不宣稱套用了什麼。
        if (res === null) {
          toast.show(t.complete.couponMockOnly, 'warning');
        } else {
          applied = res.couponDiscount;
          // 金額來自後端回應的 couponDiscount，前端只負責格式化。
          toast.show(t.complete.couponApplied(formatCurrency(applied)));
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : t.messages.actionFailed);
        setBusy(false);
        return; // 套券失敗就不往下完成訂單（原站的兩顆鈕本來就分得開）
      }
    }
    try {
      await completeProductOrder(order.id);
      toast.show(t.messages.completed);
      onCompleted(order, applied);
    } catch (e) {
      const msg = e instanceof Error ? e.message : t.messages.actionFailed;
      // 票券已經核銷掉了，這一句必須說出來，否則店家會以為票券還在。
      toast.show(applied === null ? msg : `${t.complete.couponAppliedButFailed}${msg}`, 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!order}
      onClose={onClose}
      title={t.complete.title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{common.cancel}</Button>
          <Button
            variant="outline" loading={busy} loadingText={common.processing}
            onClick={() => void finish(false)}
          >
            {t.actions.completeWithoutCoupon}
          </Button>
          <Button loading={busy} loadingText={common.processing} onClick={() => void finish(true)}>
            {t.actions.applyCouponAndComplete}
          </Button>
        </>
      }
    >
      <p className="mb-4 text-base">{t.complete.confirmText}</p>

      <FormGroup>
        <Label htmlFor="orderCouponCode">{t.complete.couponCodeLabel}</Label>
        <Input
          id="orderCouponCode" value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <FormText>{t.complete.couponHelp}</FormText>
      </FormGroup>

      {error ? <FormError>{error}</FormError> : null}
    </Modal>
  );
}

/* ========================================================================== */
/* modal 3：新增訂單（現場加購記帳）                                            */
/* ========================================================================== */

function ManualOrderModal({
  open, onClose, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (order: OrderRow) => void;
}) {
  const toast = useToast();

  const [mode, setMode] = React.useState<'EXISTING' | 'NEW'>('EXISTING');
  const [keyword, setKeyword] = React.useState('');
  const [searching, setSearching] = React.useState(false);
  const [searched, setSearched] = React.useState(false);
  const [candidates, setCandidates] = React.useState<Customer[]>([]);
  const [customerId, setCustomerId] = React.useState('');
  const [newName, setNewName] = React.useState('');
  const [newPhone, setNewPhone] = React.useState('');

  const [products, setProducts] = React.useState<Product[]>([]);
  const [staff, setStaff] = React.useState<Staff[]>([]);
  const [bookings, setBookings] = React.useState<Booking[]>([]);
  const [productId, setProductId] = React.useState('');
  const [qty, setQty] = React.useState('1');
  const [items, setItems] = React.useState<CartItem[]>([]);

  const [staffId, setStaffId] = React.useState('');
  const [paymentMethodId, setPaymentMethodId] = React.useState('');
  const [bookingId, setBookingId] = React.useState('');
  const [note, setNote] = React.useState('');
  const [paidCompleted, setPaidCompleted] = React.useState(false);
  const [notify, setNotify] = React.useState(false);

  const [error, setError] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [phoneConflict, setPhoneConflict] = React.useState<Customer | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setMode('EXISTING');
    setKeyword(''); setSearched(false); setCandidates([]); setCustomerId('');
    setNewName(''); setNewPhone('');
    setProductId(''); setQty('1'); setItems([]);
    setStaffId(''); setPaymentMethodId(''); setBookingId(''); setNote('');
    setPaidCompleted(false); setNotify(false);
    setError(''); setPhoneConflict(null);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        const [p, s, b] = await Promise.all([
          listProducts(),
          listStaff(),
          listBookings({ size: 50 }),
        ]);
        setProducts(p.filter((x) => x.active));
        setStaff(s);
        setBookings(b.content);
      } catch (e) {
        toast.show(
          `${t.messages.loadManualDataFailed}${e instanceof Error ? e.message : t.messages.unknownError}`,
          'danger',
        );
      }
    })();
  }, [open, toast]);

  const search = async () => {
    setSearching(true);
    try {
      const res = await listCustomers({ size: 50, keyword });
      setCandidates(res.content);
      setCustomerId(res.content[0]?.id ?? '');
    } catch {
      setCandidates([]);
      toast.show(t.manual.searchFailed, 'danger');
    } finally {
      setSearching(false);
      setSearched(true);
    }
  };

  const addItem = () => {
    const product = products.find((p) => p.id === productId);
    if (!product) { setError(t.manual.selectProduct); return; }
    const quantity = Number(qty);
    if (!Number.isFinite(quantity) || quantity < 1) { setError(t.manual.quantityMin); return; }
    setError('');
    setItems((list) => [
      ...list,
      { productId: product.id, productName: product.name, quantity, price: product.price },
    ]);
    setProductId('');
    setQty('1');
  };

  const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);

  const validate = (): string => {
    if (mode === 'EXISTING' && !customerId) return t.manual.selectCustomerFirst;
    if (mode === 'NEW' && (!newName.trim() || !newPhone.trim())) return t.manual.newCustomerRequired;
    if (items.length === 0) return t.manual.atLeastOneItem;
    return '';
  };

  const build = (customerName: string, id: string): OrderRow => ({
    id: '',
    orderNo: `PO${Date.now()}`,
    customerId: id,
    customerName,
    items,
    totalAmount: total,
    status: paidCompleted ? 'COMPLETED' : 'PENDING',
    paymentStatus: paidCompleted ? 'PAID_OFFLINE' : 'UNPAID',
    createdAt: new Date().toISOString(),
    ...DEFAULT_EXTRAS,
    staffName: staff.find((s) => s.id === staffId)?.name ?? null,
    paymentMethodName: MOCK_PAYMENT_METHODS.find((p) => p.id === paymentMethodId)?.name ?? null,
    bookingId: bookingId || null,
    note: note.trim(),
    paidAmount: paidCompleted ? total : 0,
    completedAt: paidCompleted ? new Date().toISOString() : null,
  });

  const doSubmit = async (customerName: string, id: string) => {
    setSaving(true);
    try {
      /* 409（例：「『X』庫存不足，無法建立訂單」）由 catch 原樣顯示 */
      const created = await createManualProductOrder({
        customerId: id,
        items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
        notifyCustomer: notify,
      });
      /* 勾選「已收款並完成」→ 後端建單固定 PENDING/UNPAID，補打狀態端點對齊 */
      if (paidCompleted) {
        await completeProductOrder(created.id);
        await markProductOrderPaidOffline(created.id);
      }
      onCreated({ ...build(customerName, id), id: created.id, orderNo: created.orderNo });
      toast.show(paidCompleted ? t.messages.created : t.messages.createdNotCompleted);
      // 通知結果照後端**實際做了什麼**顯示（issue #27 ③）。以前這裡是把勾選框的
      // 標籤原句再 toast 一次，讀起來像「已通知」，但後端根本沒接任何通知。
      if (notify) {
        const r = NOTIFY_TOAST[created.notify];
        if (r) toast.show(r.message, r.tone);
      }
    } catch (e) {
      toast.show(
        `${t.messages.createOrderFailed}${e instanceof Error ? e.message : t.messages.unknownError}`,
        'danger',
      );
    } finally {
      setSaving(false);
    }
  };

  const submit = async () => {
    const err = validate();
    setError(err);
    if (err) return;

    if (mode === 'NEW') {
      const hit = candidates.find((c) => c.phone.replace(/\D/g, '') === newPhone.replace(/\D/g, ''));
      if (hit) { setPhoneConflict(hit); return; }
      await doSubmit(newName.trim(), `c_new_${newPhone.replace(/\D/g, '')}`);
      return;
    }
    const customer = candidates.find((c) => c.id === customerId);
    await doSubmit(customer?.name ?? t.labels.unnamed, customerId);
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        size="lg"
        title={t.manual.title}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>{common.cancel}</Button>
            <Button loading={saving} loadingText={t.manual.submitting} onClick={() => void submit()}>
              {t.manual.submit}
            </Button>
          </>
        }
      >
        {/* ------------------------------------------------------------ 顧客 */}
        <h6 className="mb-3 text-base font-bold text-dark">{t.manual.customerSection}</h6>

        <div className="btn-group mb-3">
          <Button
            size="sm" variant={mode === 'EXISTING' ? 'primary' : 'outline'}
            onClick={() => setMode('EXISTING')}
          >
            {t.manual.modeExisting}
          </Button>
          <Button
            size="sm" variant={mode === 'NEW' ? 'primary' : 'outline'}
            onClick={() => setMode('NEW')}
          >
            {t.manual.modeNew}
          </Button>
        </div>

        {mode === 'EXISTING' ? (
          <>
            <div className="input-group mb-2">
              <Input
                type="search" value={keyword} placeholder={t.manual.searchPlaceholder}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void search(); }}
              />
              <Button variant="outline" onClick={() => void search()}>{t.manual.search}</Button>
            </div>
            <FormGroup>
              <Select
                className="form-select-sm"
                aria-label={t.manual.customerPlaceholder}
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
              >
                {searching ? (
                  <option value="">{t.manual.searching}</option>
                ) : !searched ? (
                  <option value="">{t.manual.customerPlaceholder}</option>
                ) : candidates.length === 0 ? (
                  <option value="">{t.manual.customerNotFound}</option>
                ) : (
                  candidates.map((c) => (
                    <option key={c.id} value={c.id}>{`${c.name}${c.phone ? ` / ${c.phone}` : ''}`}</option>
                  ))
                )}
              </Select>
            </FormGroup>
          </>
        ) : (
          <div className="grid gap-x-4 md:grid-cols-2">
            <FormGroup>
              <Input
                className="form-control-sm" value={newName} placeholder={t.manual.newNamePlaceholder}
                onChange={(e) => setNewName(e.target.value)}
              />
            </FormGroup>
            <FormGroup>
              <Input
                type="tel" className="form-control-sm" value={newPhone}
                placeholder={t.manual.newPhonePlaceholder}
                onChange={(e) => setNewPhone(e.target.value)}
              />
            </FormGroup>
          </div>
        )}

        {/* ------------------------------------------------------------ 商品 */}
        <h6 className="mb-3 mt-2 text-base font-bold text-dark">{t.manual.productSection}</h6>

        <div className="mb-3 flex flex-wrap items-end gap-2">
          <div className="min-w-[12rem] flex-1">
            <Select
              aria-label={t.manual.productPlaceholder}
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
            >
              {products.length === 0 ? (
                <option value="">{t.manual.noProducts}</option>
              ) : (
                <>
                  <option value="">{t.manual.productPlaceholder}</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{`${p.name} / ${formatCurrency(p.price)}`}</option>
                  ))}
                </>
              )}
            </Select>
          </div>
          <div className="w-20">
            <Input
              type="number" min={1} value={qty} aria-label={t.columns.quantity}
              onChange={(e) => setQty(e.target.value)}
            />
          </div>
          <Button size="sm" onClick={addItem}>
            <Plus size={13} />{t.manual.add}
          </Button>
        </div>

        {items.length === 0 ? (
          <p className="form-text mb-3">{t.manual.itemsEmpty}</p>
        ) : (
          <ul className="mb-3 flex flex-col gap-1">
            {items.map((item, i) => (
              <li
                key={`${item.productId}-${i}`}
                className="flex items-center justify-between gap-2 rounded-md border border-neutral-250 px-3 py-2 text-base"
              >
                <span className="min-w-0 flex-1 truncate">{item.productName}</span>
                <span className="tabular-nums">
                  {t.labels.quantityUnitPrice(item.quantity, formatCurrency(item.price))}
                </span>
                <Button
                  variant="outlineDanger" size="sm"
                  onClick={() => setItems((list) => list.filter((_, x) => x !== i))}
                >
                  {t.manual.remove}
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="mb-4 flex items-center justify-end gap-2 text-md font-bold text-dark">
          <span>{t.manual.totalLabel}</span>
          <span className="tabular-nums">{formatCurrency(total)}</span>
        </div>

        {/* ------------------------------------------------------------ 選項 */}
        <h6 className="mb-3 text-base font-bold text-dark">{t.manual.optionSection}</h6>

        <FormGroup>
          <Label htmlFor="moStaffId">{t.manual.staffLabel}</Label>
          <Select
            id="moStaffId" className="form-select-sm" value={staffId}
            onChange={(e) => setStaffId(e.target.value)}
          >
            <option value="">{t.manual.staffPlaceholder}</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </FormGroup>

        <FormGroup>
          <Label htmlFor="moPaymentMethodId">{t.manual.paymentLabel}</Label>
          <Select
            id="moPaymentMethodId" className="form-select-sm" value={paymentMethodId}
            onChange={(e) => setPaymentMethodId(e.target.value)}
          >
            <option value="">{t.manual.paymentPlaceholder}</option>
            {MOCK_PAYMENT_METHODS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </FormGroup>

        <FormGroup>
          <Label htmlFor="moBookingId">{t.manual.bookingLabel}</Label>
          <Select
            id="moBookingId" className="form-select-sm" value={bookingId}
            onChange={(e) => setBookingId(e.target.value)}
          >
            <option value="">{t.manual.bookingPlaceholder}</option>
            {bookings.map((b) => (
              <option key={b.id} value={b.id}>{`${b.bookingNo} / ${b.customerName}`}</option>
            ))}
          </Select>
        </FormGroup>

        <FormGroup>
          <Label htmlFor="moNote">{t.manual.noteLabel}</Label>
          <Input
            id="moNote" className="form-control-sm" value={note} placeholder={t.manual.notePlaceholder}
            onChange={(e) => setNote(e.target.value)}
          />
        </FormGroup>

        <label className="mb-2 flex items-start gap-2 text-base text-neutral-700">
          <input
            type="checkbox" className="mt-1" checked={paidCompleted}
            onChange={(e) => setPaidCompleted(e.target.checked)}
          />
          <span>{t.manual.paidCompleted}</span>
        </label>

        <label className="flex items-start gap-2 text-base text-neutral-700">
          <input
            type="checkbox" className="mt-1" checked={notify}
            onChange={(e) => setNotify(e.target.checked)}
          />
          <span>{t.manual.notify}</span>
        </label>

        {error ? <FormError>{error}</FormError> : null}
      </Modal>

      <ConfirmModal
        open={!!phoneConflict}
        title={t.manual.phoneExistsTitle}
        message={phoneConflict ? t.manual.phoneExists(phoneConflict.name, newName.trim()) : common.confirm.message}
        onClose={() => setPhoneConflict(null)}
        onConfirm={() => {
          const hit = phoneConflict;
          setPhoneConflict(null);
          if (hit) void doSubmit(hit.name, hit.id);
        }}
      />
    </>
  );
}
