'use client';
import * as React from 'react';
import Link from 'next/link';
import {
  Ban, Check, CheckCheck, ClipboardCopy, Coins, Download, Eye, Pencil, Plus,
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
  completeBooking, confirmBooking, createBooking, createBookingAddon,
  deleteBookingAddon, listBookingAddons, listBookings,
  markBookingPaidOffline, markNoShow, revertBookingComplete, updateBooking,
  type CreateBookingAddonResult,
} from '@/services/bookings';
import { createCustomer, listCustomers } from '@/services/customers';
import { listServices, listStaff } from '@/services/catalog';
import { exportBookingsCsv } from '@/services/reports';
import { byMode } from '@/mock';
import { ApiError } from '@/lib/api';
import { APP_URL } from '@/config/env';
import { common } from '@/i18n/zh-TW/common';
import { nav, resolveNavTerms } from '@/i18n/zh-TW/nav';
import { bookingsPage as t } from '@/i18n/zh-TW/pages/bookings';
import { formatCurrency, formatDate, formatTime } from '@/lib/utils';
import type {
  Booking, BookingAddon, BookingAddonNotifyOutcome, BookingStatus, Customer, Service, Staff,
} from '@/lib/types';
import { useBusinessType } from '@/components/layout/BusinessTypeContext';

/* -------------------------------------------------------------------------- */
/* 本頁專用假資料（不寫進 src/mock，避免與其他頁面衝突）                          */
/* -------------------------------------------------------------------------- */

/*
 * issue #35：本檔原本有 `BOOKING_EXTRAS_LOCAL_SHOP|GUIDE|CLINIC` 三份頁內常數，
 * 把「已收金額」「票券折抵」「點數折抵」「顧客可用點數」四個值寫死在頁面裡，
 * 與同一列的真實資料（顧客、時間、服務、金額）混著顯示。逐欄處置見
 * `docs/integration/14-GAP-AUDIT.md` §6.17：
 *
 *   · couponDiscount / pointsRedeemed → migration 0022 補 `bookings.coupon_discount`
 *     / `points_redeemed`，由 apply-coupon / apply-points 在折抵發生的當下寫入，
 *     GET /api/bookings 帶出來。**null = 沒有紀錄**，畫面就不顯示那一行（不是 0）。
 *   · customerPoints → `customers.points` 一直存在，只是沒被帶出來；0022 的
 *     `bookings_view.customer_points` 補上。
 *   · **paidAmount（已收金額）→ 本輪移除，不補**。原站的 `b.paidAmount`
 *     （docs/specs/bookings.json jsStrings[48]「（已收 ${formatMoney(b.paidAmount)}）」）
 *     來自線上金流交易，而顧客端線上付款整塊還沒建（issue #32），我方連一張金流
 *     交易表都沒有。要補這個欄位得先定訂金／尾款／退款怎麼連動——那是業務規則，
 *     不是接線，已列為 issue #35 的待裁決項。在裁決之前，畫面上凡是需要「收了多少
 *     錢」的地方一律改用真的知道的 `paymentStatus`（已付清／待付款），
 *     **不顯示一個編出來的金額**。
 */
/**
 * 頁面假資料用的最小加購形狀；`toMockAddon` 補齊成 API 契約的 `BookingAddon`
 * （mock 模式下服務層回 null，畫面沿用這份假資料——同 listRecurringBookings 的慣例）。
 */
type AddonItem = {
  id: string;
  name: string;
  price: number;
  quantity: number;
  durationMinutes: number;
  staffName: string | null;
};

/** 假資料 → BookingAddon：applied_* 在真實資料是「當初實際加上去的量」，
 *  假資料沒有那段歷史，就用 price×quantity 推得（mock 模式不會有回沖不一致的問題）。 */
const toMockAddon = (s: AddonItem): BookingAddon => ({
  id: s.id,
  serviceId: null,
  name: s.name,
  price: s.price,
  quantity: s.quantity,
  durationMinutes: s.durationMinutes,
  staffId: null,
  staffName: s.staffName,
  appliedAmount: s.price * s.quantity,
  appliedMinutes: s.durationMinutes * s.quantity,
  notified: 'NONE',
  createdAt: '',
});

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

/** 已收款＝我們真的知道的那一半：payment_status 說已付清（線上或線下）。 */
const isPaid = (b: Booking) =>
  b.paymentStatus === 'PAID_ONLINE' || b.paymentStatus === 'PAID_OFFLINE';

const addonsOf = (b: Booking): BookingAddon[] => (byMode({
  LOCAL_SHOP: ADDON_ITEMS_LOCAL_SHOP, GUIDE: ADDON_ITEMS_GUIDE, CLINIC: ADDON_ITEMS_CLINIC,
})[b.id] ?? []).map(toMockAddon);

/**
 * 付款頁（`/pay/:bookingNo`）尚未建置——歸屬於 issue #32（顧客端線上付款）
 * 的範圍，`src/app/` 底下目前只有 `api`、`tenant`、`layout.tsx`、`page.tsx`，
 * 顧客打開這個網址一定 404。
 *
 * 依擁有者裁決（issue #28 ②，補齊優先於刪除）：不建 `/pay` 頁，也不刪這段邏輯——
 * 詳情 modal 的「複製付款連結」鈕已停用（見下方 `copyPayLink` 呼叫處與 JSX），
 * 待 #32 把 `/pay` 頁真的建出來後，只需拿掉那顆鈕的 `disabled` 與旁邊的說明文字，
 * 這裡的組網址／複製邏輯不用重寫。
 */
const payLinkOf = (b: Booking) => `${APP_URL.replace(/\/$/, '')}/pay/${b.bookingNo}`;

/*
 * 付款狀態顯示：已付清 / 待付款。
 * 原站另有「已付訂金」，判定條件是 `paidAmount > 0 且未付清`——我方沒有金額型的
 * 付款欄位（見檔頭 issue #35 說明、14 分冊 §6.14），**判定不出來就不顯示**，
 * 不用一個編出來的金額把它撐出來。
 */
const paymentLabel = (b: Booking) => (isPaid(b) ? t.payment.paid : t.payment.pending);

/* -------------------------------------------------------------------------- */

export default function BookingsPage() {
  const toast = useToast();

  const [rows, setRows] = React.useState<Booking[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(0);
  const [loading, setLoading] = React.useState(true);

  const [keyword, setKeyword] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [startDate, setStartDate] = React.useState('');
  const [endDate, setEndDate] = React.useState('');
  const [showCancelled, setShowCancelled] = React.useState(false);
  const [selected, setSelected] = React.useState<string[]>([]);
  /** 「未處理」= 時間已過但仍停在待確認/已確認；在載入時算好，render 期不碰 Date.now() */
  const [unprocessedIds, setUnprocessedIds] = React.useState<string[]>([]);
  const [exportOpen, setExportOpen] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);

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
  const [removeAddonTarget, setRemoveAddonTarget] = React.useState<BookingAddon | null>(null);
  /** 加購新增／移除後 +1，讓詳情 modal 重新向 API 取一次明細（不靠本地拼湊） */
  const [addonsVersion, setAddonsVersion] = React.useState(0);

  const [cancelReason, setCancelReason] = React.useState('');

  /** 原站以 ?status=PENDING / ?status=UNPROCESSED / ?action=create 進入本頁 */
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const s = params.get('status');
    if (s) setStatus(s);
    if (params.get('action') === 'create') setCreateOpen(true);
  }, []);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const isRealStatus = (REAL_STATUSES as string[]).includes(status);
      const res = await listBookings({
        page: 0,
        size: 200,
        status: isRealStatus ? (status as BookingStatus) : '',
        keyword,
        from: startDate || undefined,
        to: endDate || undefined,
      });

      let list = res.content;

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
  }, [page, keyword, status, startDate, endDate, showCancelled, toast]);

  React.useEffect(() => { void load(); }, [load]);

  /**
   * 匯出預約列表（GET /api/export/bookings/:format，帶畫面上的日期區間）
   * —— issue #28 ③ 接線、issue #33 ③ 改打原站的 format 段。
   *
   * 修改前這顆鈕的 onClick 整個內容是
   * `{ setExportOpen(false); toast.show(t.messages.exported); }`：什麼都沒下載，
   * 畫面卻說匯出成功。現在成功訊息只在**檔案真的到了瀏覽器**時才顯示，而且
   * 顯示的是伺服器 Content-Disposition 給的檔名（前端不得自組，見
   * src/lib/download.ts）；示範資料模式沒有伺服器可打、不會產生任何檔案，
   * 顯示「未匯出」而不是成功。
   */
  const runExport = async (format: 'csv' | 'excel') => {
    setExportOpen(false);
    setExporting(true);
    try {
      const { downloaded, fileName } = await exportBookingsCsv(format, {
        from: startDate || undefined,
        to: endDate || undefined,
      });
      if (!downloaded) toast.show(t.messages.exportNotDownloaded, 'warning');
      else toast.show(fileName ? t.messages.exportedAs(fileName) : t.messages.exported);
    } catch (e) {
      toast.show(
        `${t.messages.exportFailedPrefix}${e instanceof Error ? e.message : t.messages.unknownError}`,
        'danger',
      );
    } finally {
      setExporting(false);
    }
  };

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

  /* ------------------------------------------------------------------ 加購
   * issue #17：加購後端（migration 0020 + /api/bookings/:id/addons）已建置，
   * 這裡是真實接線。三個要點：
   *  1. toast 只在 API 真的回成功之後才顯示，內容依 API 回來的 `notified`
   *     分支——不可寫死「顧客將收到消費明細」（00 鐵則 12）。
   *  2. 金額／時長用 API 回傳的值更新畫面上開著的那筆預約，不在前端自行加總。
   *  3. 明細清單不在本地拼湊，改 `addonsVersion` 讓詳情 modal 重新向 API 取。
   */

  /** 把 API 回來的金額／時段套到目前開著的詳情預約上 */
  const applyAddonResult = (r: { finalPrice: number; endAt: string; durationMinutes: number }) => {
    setDetailTarget((prev) => (prev
      ? { ...prev, finalPrice: r.finalPrice, endAt: r.endAt, durationMinutes: r.durationMinutes }
      : prev));
    setAddonsVersion((v) => v + 1);
    void load();
  };

  /** notified（API 實際結果）→ 對應的成功訊息；一種結果一句話 */
  const addonAddedMessage = (notified: BookingAddonNotifyOutcome, amount: string): string => {
    const m = t.messages;
    if (notified === 'LINE') return m.addonAddedNotified(amount);
    if (notified === 'NO_LINE') return m.addonAddedNoLine(amount);
    if (notified === 'NOT_CONFIGURED') return m.addonAddedLineNotConfigured(amount);
    if (notified === 'FAILED') return m.addonAddedNotifyFailed(amount);
    // 'NONE'：沒有要求通知（或 mock 模式，沒有任何推播管道）
    return m.addonAdded(amount);
  };

  /**
   * 目前唯一的呼叫入口（詳情 modal 的「複製付款連結」鈕）已 disabled，
   * 所以這支函式與底下剪貼簿失敗時把網址印進 toast 的退路都到不了——
   * 保留是為了 issue #32 完成、`/pay` 頁真的存在後可以直接拿掉鈕的
   * disabled 就恢復運作，不用重寫。見 payLinkOf 上方註解。
   */
  const copyPayLink = async (b: Booking) => {
    try {
      await navigator.clipboard.writeText(payLinkOf(b));
      toast.show(t.messages.payLinkCopied);
    } catch {
      toast.show(`${t.markPaidModal.payLinkIntro}${payLinkOf(b)}`, 'warning');
    }
  };

  /* --------------------------------------------------------------- 批次操作 */

  const selectedRows = rows.filter((r) => selected.includes(r.id));
  const batchPending = selectedRows.filter((r) => r.status === 'PENDING');
  const batchCancellable = selectedRows.filter((r) => r.status === 'PENDING' || r.status === 'CONFIRMED');
  const batchPaid = batchCancellable.filter(isPaid);
  const batchUnpaid = batchPending.filter((r) => !isPaid(r));

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
            <div className="relative">
              <Button
                variant="outline"
                disabled={exporting}
                onClick={() => setExportOpen((v) => !v)}
              >
                <Download size={15} />{exporting ? t.actions.exporting : t.actions.export}
              </Button>
              {exportOpen ? (
                <div className="absolute right-0 z-flyout mt-1 flex min-w-[14rem] flex-col rounded-lg bg-neutral-0 p-1 shadow-lg">
                  {/*
                    issue #33 ③：format 路徑段已補上（GET /api/export/bookings/:format），
                    兩個選項各自送出自己的 format。**但兩者拿到的仍是同一份 CSV**
                    ——專案沒有裝 xlsx 產生器（見 src/server/export-bookings.ts），
                    所以標籤照 reports 頁的作法寫明實際格式，不寫「匯出 Excel」
                    再送一個 .csv 出去。檔名一律取自後端 Content-Disposition。
                  */}
                  {([
                    ['excel', t.actions.exportExcelCsv],
                    ['csv', t.actions.exportCsv],
                  ] as const).map(([format, label]) => (
                    <button
                      key={format}
                      type="button"
                      className="rounded-sm px-3 py-2 text-left text-base hover:bg-neutral-100"
                      onClick={() => { void runExport(format); }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
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
        onSaved={(res) => {
          setEditing(null);
          // 如實描述實際發生的事：有觸發推播才說「已送出」（00 鐵則 12）
          toast.show(res?.notifyTriggered ? t.messages.updated : t.messages.updatedNoNotify);
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
            <span className="whitespace-pre-line">
              {t.confirmMessages.cancelPaidWarning}
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
      {/*
        * issue #3 曾把這裡改成「尚未建置」的誠實提示（舊實作 toast
        * 「加購已加入，顧客將收到 LINE 消費明細」，但資料沒寫、LINE 也沒送）。
        * issue #17 補齊了後端，這裡改為真實接線：成功訊息只在 API 回成功後顯示，
        * 且依 API 實際回來的 notified 決定要不要提到「已通知顧客」。
        */}
      <AddonModal
        booking={addonTarget}
        onClose={() => setAddonTarget(null)}
        onSubmitted={(result) => {
          setAddonTarget(null);
          applyAddonResult(result);
          toast.show(addonAddedMessage(result.notified, formatCurrency(result.finalPrice)));
        }}
        onFailed={(message) => {
          // 可能已經寫入（額度 409）→ 關掉詳情、重新載入，別讓店家看著過期畫面再按一次
          setAddonTarget(null);
          setDetailTarget(null);
          setAddonsVersion((v) => v + 1);
          void load();
          toast.show(message, 'danger');
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
        /* issue #35：原站用「已收金額 > 0」在「標記尾款已結清」與「標記已線下收款」
           之間切換；我方沒有金額型付款欄位，判定不出有沒有尾款 → 一律走「標記已線下
           收款」，不用假的金額把另一支撐出來。 */
        title={t.markPaidModal.titleOffline}
        message={
          <span className="whitespace-pre-line">{t.markPaidModal.confirmOffline}</span>
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
        addonsVersion={addonsVersion}
        onClose={() => setDetailTarget(null)}
        onAddon={() => setAddonTarget(detailTarget)}
        onCoupon={() => setCouponTarget(detailTarget)}
        onPoints={() => setPointsTarget(detailTarget)}
        onAdjust={() => setAdjustTarget(detailTarget)}
        onMarkPaid={() => setMarkPaidTarget(detailTarget)}
        onCopyPayLink={() => { if (detailTarget) void copyPayLink(detailTarget); }}
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
            {confirmTarget && confirmTarget.paymentStatus === 'UNPAID'
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
            {completeTarget && !isPaid(completeTarget)
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

      {/*
        * 移除加購：確認視窗直接寫出「將扣回多少錢／收回多少分鐘」這兩個確定的數字
        * （回沖＝減去該筆加購當初實際加上去的量，見 addons route 檔頭）。
        * 之後若又調過價或套過打折票券，扣回值可能與店家預期不同——那兩種情況
        * 無法從資料判定，所以不猜，直接把數字攤在使用者眼前。
        */}
      <ConfirmModal
        open={!!removeAddonTarget}
        danger
        title={t.rowActions.addon}
        confirmText={common.delete}
        message={
          <span className="whitespace-pre-line">
            {removeAddonTarget ? t.confirmMessages.removeAddon(
              removeAddonTarget.name,
              formatCurrency(removeAddonTarget.appliedAmount),
              removeAddonTarget.appliedMinutes,
            ) : ''}
          </span>
        }
        onClose={() => setRemoveAddonTarget(null)}
        onConfirm={() => {
          const addon = removeAddonTarget;
          const booking = detailTarget;
          setRemoveAddonTarget(null);
          if (!addon || !booking) return;
          void (async () => {
            try {
              const r = await deleteBookingAddon(booking.id, addon.id, {
                appliedAmount: addon.appliedAmount, appliedMinutes: addon.appliedMinutes,
              });
              applyAddonResult(r);
              toast.show(t.messages.addonRemoved(formatCurrency(r.revertedAmount)));
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
  /**
   * 編輯模式會帶回 PUT /api/bookings/:id 的 `notifyTriggered`（本次有沒有觸發
   * 顧客端「預約已變更」推播）；新增模式不適用，帶 undefined。
   */
  onSaved: (result?: { notifyTriggered: boolean }) => void;
}) {
  const toast = useToast();
  const businessType = useBusinessType();
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
    if (!serviceId) return resolveNavTerms(c.serviceInvalid, businessType);
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
        // 回應的 notifyTriggered 決定成功訊息要不要提通知（只改備註時後端不推播）
        const res = await updateBooking(booking.id, { startAt, staffId: staffId || null, note });
        onSaved(res);
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
      <p className="mb-4 text-base text-neutral-700">
        {resolveNavTerms(isEdit ? e.intro : c.intro, businessType)}
      </p>

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
          <Label required htmlFor="bookingService">
            {resolveNavTerms(isEdit ? e.service : c.service, businessType)}
          </Label>
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
          <FormText>{resolveNavTerms(isEdit ? e.durationHelp : c.durationHelp, businessType)}</FormText>
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
  booking, onClose, onSubmitted, onFailed,
}: {
  booking: Booking | null;
  onClose: () => void;
  onSubmitted: (result: CreateBookingAddonResult) => void;
  /** 失敗但可能已經寫入（例：額度 409）→ 交給父層關窗＋重新載入，見 submit 的註解 */
  onFailed: (message: string) => void;
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
  const [notify, setNotify] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    if (!booking) return;
    setServiceId(''); setName(''); setPrice(''); setDuration('0');
    setQuantity('1'); setStaffId(''); setNotify(false); setSaving(false); setError('');
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

  /**
   * 送出＝真的呼叫 POST /api/bookings/:id/addons（issue #17）。
   * 成功回應才 onSubmitted()，由呼叫端依 API 回來的 notified 顯示訊息；
   * 失敗（含推播額度用完的 409——那個訊息本身會說明加購已寫入）一律原文顯示。
   */
  const submit = () => {
    if (!booking || saving) return;
    if (!name.trim()) { setError(t.messages.itemNameRequired); return; }
    if (!price || Number(price) < 0 || Number.isNaN(Number(price))) {
      setError(t.messages.invalidAmount);
      return;
    }
    setError('');
    setSaving(true);
    void (async () => {
      try {
        const r = await createBookingAddon(booking.id, {
          serviceId: serviceId || null,
          name: name.trim(),
          price: Number(price),
          quantity: Math.max(1, Number(quantity) || 1),
          durationMinutes: Number(duration) || 0,
          staffId: staffId || null,
          notify,
        });
        onSubmitted(r);
      } catch (e) {
        const message = `${t.messages.addonFailed}${e instanceof Error ? e.message : t.messages.unknownError}`;
        /*
         * ⚠️ 失敗**不一定代表什麼都沒發生**：推播額度用完時 API 回 409，但加購
         * 已經寫入且金額已生效（04 §B-1.1）。若照一般作法把錯誤留在視窗裡、
         * 讓表單原樣停著，店家很可能再按一次「加入」而重複加購，畫面上的金額
         * 也還是舊的——那就是拿一個過期的畫面當現況。
         *
         * 所以只有「輸入格式錯誤」（REQ_001，伺服器保證沒有寫入）才留在視窗裡
         * 讓店家就地改；其餘一律關掉視窗並重新載入，由 onFailed 處理。
         */
        if (e instanceof ApiError && e.code === 'REQ_001') setError(message);
        else onFailed(message);
      } finally {
        setSaving(false);
      }
    })();
  };

  return (
    <Modal
      open={!!booking}
      onClose={onClose}
      title={a.title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{common.cancel}</Button>
          <Button onClick={submit} disabled={saving}>{a.submit}</Button>
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
        {/* 業績歸戶不看這一欄（主導者裁示：計入本預約的服務人員），所以說明白 */}
        <FormText>{a.staffHelp}</FormText>
      </FormGroup>

      <FormGroup>
        <label className="flex items-start gap-1.5 text-base text-secondary">
          <input
            id="addonNotify" type="checkbox" className="mt-1"
            checked={notify} onChange={(ev) => setNotify(ev.target.checked)}
          />
          {a.notifyLabel}
        </label>
        <FormText>{a.notifyHelp}</FormText>
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
      // API 直接回本次折抵金額（issue #35 補的 couponDiscount，原站也有這個欄位）
      const res = await applyBookingCoupon(booking.id, code.trim());
      onApplied(res.couponDiscount, res.finalPrice);
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
  /*
   * 加購筆數要向 API 取（issue #17）。先前只讀頁內 byMode 假資料，接上真實後端後
   * 那份假資料在正式模式一定是空的 —— 於是「此預約有 N 筆加購明細」的警告
   * 會**永遠不出現**，店家在有加購的預約上手動調價卻收不到提醒。
   * 取不到就當 0（不顯示警告），不亂猜一個數字。
   */
  const [addonCount, setAddonCount] = React.useState(0);

  React.useEffect(() => {
    setAmount(booking ? String(booking.finalPrice) : '');
    setError('');
    if (!booking) { setAddonCount(0); return; }
    let alive = true;
    void (async () => {
      try {
        const rows = await listBookingAddons(booking.id);
        if (alive) setAddonCount((rows ?? addonsOf(booking)).length);
      } catch { if (alive) setAddonCount(0); }
    })();
    return () => { alive = false; };
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

  /*
   * issue #35：原站在這裡會比對「已收金額」與新的應付金額，多收就提醒退差額。
   * 我方沒有 paid_amount 欄位（見檔頭），比不出來 → **不顯示**這則提醒，
   * 而不是拿一個編出來的已收金額去算差額。待「已收金額」裁決落地後補回。
   */

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
  /*
   * issue #35：餘額改吃真的 `customers.points`（0022 起由 bookings_view 帶出）。
   * `null`／`undefined` = 這一列沒有帶到餘額 → 顯示 `--` 並在畫面上說明，
   * **不顯示 0**（0 是「沒有點數」，是另一個答案）。
   */
  const balance = booking?.customerPoints ?? null;

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
      const res = await applyBookingPoints(booking.id, value, balance ?? undefined);
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
        <div className="text-lg font-bold text-dark">
          {balance === null ? pm.balanceUnknown : balance}
        </div>
        {balance === null ? <FormText>{pm.balanceUnknownHint}</FormText> : null}
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
  booking, addonsVersion, onClose, onAddon, onCoupon, onPoints, onAdjust, onMarkPaid,
  onCopyPayLink, onComplete, onCancel, onRevert, onRemoveAddon,
}: {
  booking: Booking | null;
  /** 父層在加購新增／移除後 +1，用來重新向 API 取一次明細 */
  addonsVersion: number;
  onClose: () => void;
  onAddon: () => void;
  onCoupon: () => void;
  onPoints: () => void;
  onAdjust: () => void;
  onMarkPaid: () => void;
  onCopyPayLink: () => void;
  onComplete: () => void;
  onCancel: () => void;
  onRevert: () => void;
  onRemoveAddon: (item: BookingAddon) => void;
}) {
  const d = t.detailModal;
  const toast = useToast();
  const [addons, setAddons] = React.useState<BookingAddon[]>([]);
  /*
   * issue #35：折抵金額改吃真的欄位（0022 的 bookings.coupon_discount /
   * points_redeemed，由 apply-coupon / apply-points 在折抵當下寫入）。
   *
   * ⚠️「應收金額」就是 `finalPrice` 本身，**不可以再減一次折抵**——apply-coupon /
   * apply-points 已經把差額寫進 final_price 了（原站文案也是這樣講的：
   * 「下方『應收金額』已自動扣除」）。舊版用假資料時把折抵當成「還沒扣」的數字再減
   * 一次，接上真實資料後就會變成扣兩次。
   */
  const couponDiscount = booking?.couponDiscount ?? null;
  const pointsRedeemed = booking?.pointsRedeemed ?? null;
  const net = booking?.finalPrice ?? 0;
  /** 加購會動到金額與時段，與 API 同一條規則：只有未結案的預約可以增刪 */
  const addonsEditable = booking?.status === 'PENDING' || booking?.status === 'CONFIRMED';

  /*
   * 加購明細一律向 API 取（issue #17）。mock 模式服務層回 null，畫面沿用頁內
   * byMode 假資料——這是既有慣例（listRecurringBookings），不是假成功：
   * mock 模式本來就沒有資料庫。載入失敗顯示既有的 addonLoadFailed 文案，
   * **不顯示空清單**（空清單會讓店家以為這筆預約沒有加購）。
   */
  const [loadFailed, setLoadFailed] = React.useState(false);
  /*
   * ⚠️ 載入中要顯示「載入中」，不可以先顯示「無資料」。
   * 2026-08-25 的 Playwright 實測抓到：明細還在向 API 取的那 1〜5 秒內，
   * 畫面寫著「無資料」而金額欄位已經是加購後的金額——店家會讀成
   * 「錢加了但明細不見了」。那是把「還不知道」畫成「已知為空」，
   * 正是 CLAUDE.md「Never fabricate a known」要擋的東西。
   */
  const [addonsLoading, setAddonsLoading] = React.useState(false);
  React.useEffect(() => {
    if (!booking) { setAddons([]); setLoadFailed(false); setAddonsLoading(false); return; }
    let alive = true;
    setAddonsLoading(true);
    void (async () => {
      try {
        const rows = await listBookingAddons(booking.id);
        if (!alive) return;
        setAddons(rows ?? addonsOf(booking));
        setLoadFailed(false);
      } catch (e) {
        if (!alive) return;
        setLoadFailed(true);
        toast.show(
          `${t.messages.loadAddonsFailed}${e instanceof Error ? e.message : t.messages.unknownError}`,
          'danger',
        );
      } finally {
        if (alive) setAddonsLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [booking, addonsVersion, toast]);

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
            {addonsLoading ? (
              <p className="form-text">{d.addonLoading}</p>
            ) : loadFailed ? (
              <p className="form-text text-danger">{d.addonLoadFailed}</p>
            ) : addons.length === 0 ? (
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
                    {/* 已結案的預約不能增刪加購（同 API 規則）→ 不提供會 409 的按鈕 */}
                    {addonsEditable ? (
                      <Button
                        size="sm" variant="outlineDanger" aria-label={common.delete}
                        onClick={() => onRemoveAddon(item)}
                      >
                        <Trash2 size={13} />
                      </Button>
                    ) : null}
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
            {couponDiscount !== null && couponDiscount > 0 ? (
              <div className="form-text">{d.couponDiscount(formatCurrency(couponDiscount))}</div>
            ) : null}
            {pointsRedeemed !== null && pointsRedeemed > 0 ? (
              <div className="form-text">{d.pointsDiscount(pointsRedeemed)}</div>
            ) : null}
          </div>

          {booking.status === 'PENDING' ? (
            <span className="text-xs text-warning">{d.notConfirmed}</span>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            {/* issue #28 ②：/pay 頁尚未建置（issue #32），鈕停用＋畫面上直接說明，不只是 tooltip */}
            <div className="flex flex-wrap items-center gap-1.5">
              <Button variant="outline" size="sm" disabled onClick={onCopyPayLink}>
                <ClipboardCopy size={13} />{t.rowActions.copyPayLink}
              </Button>
              <span className="text-xs text-secondary">{t.detailModal.payLinkUnavailable}</span>
            </div>
            <Button variant="outline" size="sm" onClick={onMarkPaid}>
              <Wallet size={13} />
              {t.rowActions.markPaidOffline}
            </Button>
            {booking.source === 'LINE' ? (
              <Link href="/tenant/chat" className="btn btn-line btn-sm">{t.rowActions.chat}</Link>
            ) : null}
          </div>
        </div>
      )}
    </Modal>
  );
}
