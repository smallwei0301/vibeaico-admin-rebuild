'use client';
import * as React from 'react';
import Link from 'next/link';
import {
  Ban, CalendarCheck, ChevronLeft, ChevronRight, MessageSquare, Plus, Users,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card, CardBody } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmModal, Modal } from '@/components/ui/Modal';
import { FormGroup, FormText, Label, Select, Textarea } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import {
  cancelBooking, completeBooking, confirmBooking, createBlockTime, deleteBlockTime,
  listCalendarData, markNoShow,
  type BlockTimeItem, type CalendarExternalItem,
} from '@/services/bookings';
import { listStaff } from '@/services/catalog';
import { common } from '@/i18n/zh-TW/common';
import { nav } from '@/i18n/zh-TW/nav';
import { calendarPage as t } from '@/i18n/zh-TW/pages/calendar';
import { formatCurrency, formatDate, formatTime } from '@/lib/utils';
import type { Booking, BookingStatus, Staff } from '@/lib/types';

/* -------------------------------------------------------------------------- */
/* 本頁專用假資料（不寫進 src/mock，避免與其他頁面衝突）                          */
/* -------------------------------------------------------------------------- */

type CalendarBlock = {
  id: string;
  title: string;
  /** YYYY-MM-DD */
  date: string;
  startTime: string;
  endTime: string;
  fullDay: boolean;
  weekly: boolean;
  /** 由「每天不同營業時間」自動產生的休息時段 */
  auto: boolean;
};

const MOCK_CALENDAR_BLOCKS: CalendarBlock[] = [
  { id: 'cb_1', title: '團隊會議', date: '2026-08-25', startTime: '09:00', endTime: '10:30', fullDay: false, weekly: true, auto: false },
  { id: 'cb_2', title: '店休', date: '2026-08-27', startTime: '', endTime: '', fullDay: true, weekly: false, auto: false },
  { id: 'cb_3', title: '午休', date: '2026-08-21', startTime: '14:00', endTime: '15:00', fullDay: false, weekly: false, auto: true },
];

type ExternalEvent = { id: string; title: string; date: string; startTime: string; endTime: string };

const MOCK_EXTERNAL_EVENTS: ExternalEvent[] = [
  { id: 'ex_1', title: 'Booking.com 名單：Chen', date: '2026-08-22', startTime: '11:00', endTime: '12:00' },
  { id: 'ex_2', title: 'Booking.com 名單：Lin', date: '2026-08-26', startTime: '16:00', endTime: '17:00' },
];

/** 週檢視顯示的時段（原站取營業時間，骨架階段固定 09:00–21:00） */
const HOURS: number[] = Array.from({ length: 13 }, (_, i) => i + 9);

const STATUS_CLASS: Record<BookingStatus, string> = {
  PENDING: 'bg-[var(--badge-warning-bg)] text-[var(--badge-warning-fg)]',
  CONFIRMED: 'bg-[var(--badge-primary-bg)] text-[var(--badge-primary-fg)]',
  COMPLETED: 'bg-[var(--badge-success-bg)] text-[var(--badge-success-fg)]',
  CANCELLED: 'bg-[var(--badge-neutral-bg)] text-[var(--badge-neutral-fg)]',
  NO_SHOW: 'bg-[var(--badge-danger-bg)] text-[var(--badge-danger-fg)]',
};

const STATUS_TONE: Record<BookingStatus, 'primary' | 'success' | 'warning' | 'danger' | 'neutral'> = {
  PENDING: 'warning',
  CONFIRMED: 'primary',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
  NO_SHOW: 'danger',
};

/* ------------------------------------------------------------------ 日期工具 */

const dateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

const startOfWeek = (d: Date) => addDays(d, -d.getDay());

const startOfMonthGrid = (d: Date) => startOfWeek(new Date(d.getFullYear(), d.getMonth(), 1));

const hm = (d: Date) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/* --------------------------------------------- API 事件 → 本頁顯示形狀的映射 */

/**
 * /api/calendar 的 BLOCK 事件沒有「每週重複」「自動休息」概念（那是本頁 mock
 * 專屬的展示欄位），一律映成 weekly/auto = false；跨 24 小時視為整天封鎖。
 */
const toCalendarBlock = (b: BlockTimeItem): CalendarBlock => {
  const start = new Date(b.startAt);
  const end = new Date(b.endAt);
  const fullDay = end.getTime() - start.getTime() >= 24 * 60 * 60 * 1000;
  return {
    id: b.id,
    title: b.reason || t.block.quickTitle,
    date: dateKey(start),
    startTime: fullDay ? '' : hm(start),
    endTime: fullDay ? '' : hm(end),
    fullDay,
    weekly: false,
    auto: false,
  };
};

const toExternalEvent = (e: CalendarExternalItem): ExternalEvent => {
  const start = new Date(e.start);
  return {
    id: e.id, title: e.title, date: dateKey(start),
    startTime: hm(start), endTime: hm(new Date(e.end)),
  };
};

/* -------------------------------------------------------------------------- */

export default function CalendarPage() {
  const toast = useToast();

  /** 只在瀏覽器端決定「今天」，避免 SSR/CSR 產生不同輸出 */
  const [anchor, setAnchor] = React.useState<Date | null>(null);
  const [today, setToday] = React.useState('');
  const [view, setView] = React.useState<'month' | 'week'>('month');
  const [mode, setMode] = React.useState<'booking' | 'staff'>('booking');
  const [staffId, setStaffId] = React.useState('');

  const [bookings, setBookings] = React.useState<Booking[]>([]);
  const [staff, setStaff] = React.useState<Staff[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [blocks, setBlocks] = React.useState<CalendarBlock[]>(MOCK_CALENDAR_BLOCKS);
  const [externals, setExternals] = React.useState<ExternalEvent[]>(MOCK_EXTERNAL_EVENTS);

  const [detail, setDetail] = React.useState<Booking | null>(null);
  const [cancelTarget, setCancelTarget] = React.useState<Booking | null>(null);
  const [cancelReason, setCancelReason] = React.useState('');
  const [confirmTarget, setConfirmTarget] = React.useState<Booking | null>(null);
  const [completeTarget, setCompleteTarget] = React.useState<Booking | null>(null);
  const [noShowTarget, setNoShowTarget] = React.useState<Booking | null>(null);
  const [blockTarget, setBlockTarget] = React.useState<{ date: string; hour: number | null } | null>(null);
  const [blockDeleting, setBlockDeleting] = React.useState<CalendarBlock | null>(null);

  React.useEffect(() => {
    const now = new Date();
    setAnchor(now);
    setToday(dateKey(now));
  }, []);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      // GET /api/calendar 要 from/to：抓「今天 ±1 年」一次載入，翻頁不重抓
      //（維持現行「載入一次」的行為，mock 模式不會因翻月閃 loading）。
      const now = new Date();
      const data = await listCalendarData(
        new Date(now.getFullYear() - 1, now.getMonth(), 1).toISOString(),
        new Date(now.getFullYear() + 1, now.getMonth() + 1, 1).toISOString(),
      );
      setBookings(data.bookings);
      // null = mock 模式：封鎖／外部事件沿用本頁假資料 state（含每週重複、自動休息）
      if (data.blocks) setBlocks(data.blocks.map(toCalendarBlock));
      if (data.externals) setExternals(data.externals.map(toExternalEvent));
    } catch {
      toast.show(`${t.messages.loadFailed}${t.messages.unknownError}`, 'danger');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  React.useEffect(() => { void load(); }, [load]);

  React.useEffect(() => {
    void (async () => {
      try { setStaff(await listStaff()); }
      catch { toast.show(t.messages.loadStaffFailed, 'danger'); }
    })();
  }, [toast]);

  const visibleBookings = React.useMemo(
    () => bookings.filter((b) => (staffId ? b.staffId === staffId : true)),
    [bookings, staffId],
  );

  const bookingsByDate = React.useMemo(() => {
    const map = new Map<string, Booking[]>();
    visibleBookings.forEach((b) => {
      const key = dateKey(new Date(b.startAt));
      map.set(key, [...(map.get(key) ?? []), b]);
    });
    map.forEach((list) => list.sort((a, b) => a.startAt.localeCompare(b.startAt)));
    return map;
  }, [visibleBookings]);

  const shift = (delta: number) => {
    if (!anchor) return;
    setAnchor(view === 'month'
      ? new Date(anchor.getFullYear(), anchor.getMonth() + delta, 1)
      : addDays(anchor, delta * 7));
  };

  const weekStart = anchor ? startOfWeek(anchor) : null;
  const weekDays = weekStart ? Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)) : [];
  const monthCells = anchor
    ? Array.from({ length: 42 }, (_, i) => addDays(startOfMonthGrid(anchor), i))
    : [];

  const rangeLabel = !anchor
    ? ''
    : view === 'month'
      ? t.view.monthLabel(anchor.getFullYear(), anchor.getMonth() + 1)
      : t.view.weekLabel(formatDate(weekDays[0].toISOString()), formatDate(weekDays[6].toISOString()));

  const blocksOn = (key: string) => blocks.filter((b) => b.date === key);
  const externalsOn = (key: string) => externals.filter((e) => e.date === key);

  const runAction = async (
    action: () => Promise<unknown>, successMessage: string, failPrefix: string,
  ) => {
    try {
      await action();
      toast.show(successMessage);
      setDetail(null);
      void load();
    } catch (e) {
      toast.show(`${failPrefix}${e instanceof Error ? e.message : t.messages.unknownError}`, 'danger');
    }
  };

  /** 臨時封鎖：hour = null 封整天，否則封該小時起 1 小時。成功後以回傳 id 更新本地 state。 */
  const createBlock = async (date: string, hour: number | null) => {
    const start = hour !== null
      ? new Date(`${date}T${String(hour).padStart(2, '0')}:00:00`)
      : new Date(`${date}T00:00:00`);
    const end = new Date(start.getTime() + (hour !== null ? 1 : 24) * 60 * 60_000);
    try {
      const res = await createBlockTime({
        startAt: start.toISOString(), endAt: end.toISOString(), reason: t.block.quickTitle,
      });
      setBlocks((s) => [...s, {
        id: res.id,
        title: t.block.quickTitle,
        date,
        startTime: hour !== null ? `${String(hour).padStart(2, '0')}:00` : '',
        endTime: hour !== null ? `${String(hour + 1).padStart(2, '0')}:00` : '',
        fullDay: hour === null,
        weekly: false,
        auto: false,
      }]);
      setBlockTarget(null);
      toast.show(t.block.created(1));
    } catch (e) {
      toast.show(e instanceof Error ? e.message : t.messages.unknownError, 'danger');
    }
  };

  const removeBlock = async (target: CalendarBlock) => {
    try {
      await deleteBlockTime(target.id);
      setBlocks((s) => s.filter((x) => x.id !== target.id));
      toast.show(t.block.deleted);
    } catch (e) {
      toast.show(e instanceof Error ? e.message : t.messages.unknownError, 'danger');
    }
  };

  /* ---------------------------------------------------------------- render */

  const renderEvents = (key: string, compact: boolean) => (
    <>
      {blocksOn(key).map((b) => (
        <button
          key={b.id}
          type="button"
          className="w-full truncate rounded-sm bg-neutral-200 px-1 py-0.5 text-left text-2xs text-neutral-700"
          onClick={(e) => { e.stopPropagation(); setBlockDeleting(b); }}
        >
          <Ban size={10} className="mr-0.5 inline" />
          {b.fullDay ? t.block.fullDayLabel(b.title) : `${b.startTime} ${b.title}`}
        </button>
      ))}
      {externalsOn(key).map((e) => (
        <div
          key={e.id}
          title={t.legend.external}
          className="w-full truncate rounded-sm bg-neutral-100 px-1 py-0.5 text-2xs text-neutral-500"
        >
          {e.startTime} {e.title}
        </div>
      ))}
      {(bookingsByDate.get(key) ?? []).map((b) => (
        <button
          key={b.id}
          type="button"
          className={`w-full truncate rounded-sm px-1 py-0.5 text-left text-2xs ${STATUS_CLASS[b.status]}`}
          onClick={(ev) => { ev.stopPropagation(); setDetail(b); }}
        >
          {formatTime(b.startAt)} {b.customerName}
          {compact ? '' : ` · ${b.serviceName}`}
        </button>
      ))}
    </>
  );

  return (
    <>
      <PageHeader
        eyebrow={nav.navBooking}
        title={t.title}
        actions={
          <Link href="/tenant/bookings?action=create" className="btn btn-primary">
            <Plus size={15} />{t.actions.createBooking}
          </Link>
        }
      />

      <Card className="mb-4">
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <div className="btn-group">
            <Button
              size="sm" variant={mode === 'booking' ? 'primary' : 'outline'}
              onClick={() => setMode('booking')}
            >
              <CalendarCheck size={13} />{t.actions.modeBooking}
            </Button>
            <Button
              size="sm" variant={mode === 'staff' ? 'primary' : 'outline'}
              onClick={() => setMode('staff')}
            >
              <Users size={13} />{t.actions.modeStaff}
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" aria-label={t.view.prev} onClick={() => shift(-1)}>
              <ChevronLeft size={14} />
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAnchor(new Date())}>
              {t.view.today}
            </Button>
            <Button size="sm" variant="outline" aria-label={t.view.next} onClick={() => shift(1)}>
              <ChevronRight size={14} />
            </Button>
            <span className="px-2 text-md font-bold text-dark">{rangeLabel}</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="btn-group">
              <Button
                size="sm" variant={view === 'month' ? 'primary' : 'outline'}
                onClick={() => setView('month')}
              >
                {t.view.month}
              </Button>
              <Button
                size="sm" variant={view === 'week' ? 'primary' : 'outline'}
                onClick={() => setView('week')}
              >
                {t.view.week}
              </Button>
            </div>
            <Select
              className="form-select-sm w-auto" value={staffId}
              onChange={(e) => setStaffId(e.target.value)}
            >
              <option value="">{t.filters.staffAll}</option>
              {staff.filter((s) => s.bookable).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          {!anchor || loading ? (
            <div className="py-16 text-center text-secondary">{common.loading}</div>
          ) : mode === 'staff' ? (
            /* ------------------------------------------------------ 員工排班 */
            <div className="overflow-x-auto">
              <div className="min-w-[52rem]">
                <div className="grid grid-cols-8 border-b border-neutral-200">
                  <div className="p-2 text-xs font-semibold text-secondary">{t.actions.modeStaff}</div>
                  {weekDays.map((d) => (
                    <div key={dateKey(d)} className="p-2 text-center text-xs font-semibold text-secondary">
                      {common.weekdays[d.getDay()]}
                      <div className="text-2xs font-normal">{d.getMonth() + 1}/{d.getDate()}</div>
                    </div>
                  ))}
                </div>
                {staff.filter((s) => s.bookable).map((s) => (
                  <div key={s.id} className="grid grid-cols-8 border-b border-neutral-200">
                    <div className="p-2 text-sm font-semibold text-dark">{s.name}</div>
                    {weekDays.map((d) => {
                      const key = dateKey(d);
                      const items = (bookingsByDate.get(key) ?? []).filter((b) => b.staffId === s.id);
                      return (
                        <div key={key} className="flex min-h-[3.5rem] flex-col gap-0.5 border-l border-neutral-150 p-1">
                          {items.map((b) => (
                            <button
                              key={b.id}
                              type="button"
                              className={`w-full truncate rounded-sm px-1 py-0.5 text-left text-2xs ${STATUS_CLASS[b.status]}`}
                              onClick={() => setDetail(b)}
                            >
                              {formatTime(b.startAt)} {b.customerName}
                            </button>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          ) : view === 'month' ? (
            /* ---------------------------------------------------------- 月 */
            <div className="overflow-x-auto">
              <div className="min-w-[48rem]">
                <div className="grid grid-cols-7">
                  {common.weekdays.map((w) => (
                    <div key={w} className="border-b border-neutral-200 p-2 text-center text-xs font-semibold text-secondary">
                      {w}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7">
                  {monthCells.map((d) => {
                    const key = dateKey(d);
                    const inMonth = d.getMonth() === anchor.getMonth();
                    return (
                      <div
                        key={key}
                        role="button"
                        tabIndex={0}
                        onClick={() => setBlockTarget({ date: key, hour: null })}
                        onKeyDown={(e) => { if (e.key === 'Enter') setBlockTarget({ date: key, hour: null }); }}
                        className={`flex min-h-[6rem] flex-col items-stretch gap-0.5 border-b border-r border-neutral-150 p-1 text-left ${
                          inMonth ? 'bg-neutral-0' : 'bg-neutral-50'
                        }`}
                      >
                        <span
                          className={`text-2xs font-semibold ${
                            key === today ? 'text-primary' : inMonth ? 'text-neutral-700' : 'text-neutral-400'
                          }`}
                        >
                          {d.getDate()}
                        </span>
                        {renderEvents(key, true)}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            /* ---------------------------------------------------------- 週 */
            <div className="overflow-x-auto">
              <div className="min-w-[52rem]">
                <div className="grid grid-cols-8 border-b border-neutral-200">
                  <div className="p-2 text-xs font-semibold text-secondary" />
                  {weekDays.map((d) => (
                    <div key={dateKey(d)} className="p-2 text-center text-xs font-semibold text-secondary">
                      {common.weekdays[d.getDay()]}
                      <div className={dateKey(d) === today ? 'text-2xs font-bold text-primary' : 'text-2xs font-normal'}>
                        {d.getMonth() + 1}/{d.getDate()}
                      </div>
                    </div>
                  ))}
                </div>
                {HOURS.map((h) => (
                  <div key={h} className="grid grid-cols-8 border-b border-neutral-150">
                    <div className="p-1 text-right text-2xs text-secondary">
                      {String(h).padStart(2, '0')}:00
                    </div>
                    {weekDays.map((d) => {
                      const key = dateKey(d);
                      const items = (bookingsByDate.get(key) ?? [])
                        .filter((b) => new Date(b.startAt).getHours() === h);
                      const blockItems = blocksOn(key)
                        .filter((b) => !b.fullDay && Number(b.startTime.slice(0, 2)) === h);
                      const extItems = externalsOn(key)
                        .filter((e) => Number(e.startTime.slice(0, 2)) === h);
                      return (
                        <div
                          key={`${key}-${h}`}
                          role="button"
                          tabIndex={0}
                          onClick={() => setBlockTarget({ date: key, hour: h })}
                          onKeyDown={(ev) => { if (ev.key === 'Enter') setBlockTarget({ date: key, hour: h }); }}
                          className="flex min-h-[2.75rem] flex-col gap-0.5 border-l border-neutral-150 p-1 text-left"
                        >
                          {blockItems.map((b) => (
                            <span
                              key={b.id}
                              className="w-full truncate rounded-sm bg-neutral-200 px-1 py-0.5 text-2xs text-neutral-700"
                            >
                              {b.title}
                            </span>
                          ))}
                          {extItems.map((e) => (
                            <span
                              key={e.id}
                              title={t.legend.external}
                              className="w-full truncate rounded-sm bg-neutral-100 px-1 py-0.5 text-2xs text-neutral-500"
                            >
                              {e.title}
                            </span>
                          ))}
                          {items.map((b) => (
                            <span
                              key={b.id}
                              role="button"
                              tabIndex={0}
                              className={`w-full truncate rounded-sm px-1 py-0.5 text-2xs ${STATUS_CLASS[b.status]}`}
                              onClick={(ev) => { ev.stopPropagation(); setDetail(b); }}
                              onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.stopPropagation(); setDetail(b); } }}
                            >
                              {formatTime(b.startAt)} {b.customerName}
                            </span>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}

          {anchor && !loading && visibleBookings.length === 0 ? (
            <EmptyState title={t.empty.title} description={t.empty.description} />
          ) : null}

          {/* 圖例 */}
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-neutral-200 pt-3 text-xs text-secondary">
            {(Object.keys(STATUS_TONE) as BookingStatus[]).map((s) => (
              <span key={s} className="flex items-center gap-1">
                <span aria-hidden className={`h-3 w-3 rounded-sm ${STATUS_CLASS[s]}`} />
                {common.bookingStatus[s]}
              </span>
            ))}
            <span className="flex items-center gap-1">
              <span aria-hidden className="h-3 w-3 rounded-sm bg-neutral-200" />
              {t.legend.block}
            </span>
            <span className="flex items-center gap-1">
              <span aria-hidden className="h-3 w-3 rounded-sm bg-neutral-100" />
              {t.legend.external}
            </span>
          </div>
        </CardBody>
      </Card>

      {/* -------------------------------------------------------- 預約詳情 */}
      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={t.detail.title}
        footer={
          detail ? (
            <>
              <Button variant="secondary" onClick={() => setDetail(null)}>{t.detail.close}</Button>
              <Link href="/tenant/bookings" className="btn btn-outline">{t.detail.viewDetail}</Link>
              {detail.status === 'PENDING' ? (
                <Button onClick={() => setConfirmTarget(detail)}>{t.detail.confirm}</Button>
              ) : null}
              {detail.status === 'CONFIRMED' ? (
                <>
                  <Button variant="success" onClick={() => setCompleteTarget(detail)}>{t.detail.complete}</Button>
                  <Button variant="warning" onClick={() => setNoShowTarget(detail)}>{t.detail.noShow}</Button>
                </>
              ) : null}
              {detail.status === 'PENDING' || detail.status === 'CONFIRMED' ? (
                <Button variant="danger" onClick={() => { setCancelReason(''); setCancelTarget(detail); }}>
                  {t.detail.cancel}
                </Button>
              ) : null}
            </>
          ) : null
        }
      >
        {detail ? (
          <div className="flex flex-col gap-2 text-base">
            <div className="flex flex-wrap items-center gap-2">
              <strong className="text-md">{detail.customerName}</strong>
              <Badge tone={STATUS_TONE[detail.status]}>{common.bookingStatus[detail.status]}</Badge>
              <Badge tone={detail.paymentStatus === 'UNPAID' ? 'warning' : 'success'}>
                {detail.paymentStatus === 'UNPAID' ? t.payment.pending : t.payment.paid}
              </Badge>
              {detail.source === 'LINE' ? (
                <Link href="/tenant/chat" className="btn btn-line btn-sm">
                  <MessageSquare size={13} />{t.detail.chat}
                </Link>
              ) : null}
            </div>
            <div>
              <strong>{t.detail.time}</strong>
              {formatDate(detail.startAt)} {formatTime(detail.startAt)} - {formatTime(detail.endAt)}
            </div>
            <div><strong>{t.detail.service}</strong>{detail.serviceName}</div>
            <div>
              <strong>{t.detail.staff}</strong>
              {detail.staffName ?? t.legend.unassigned}
            </div>
            <div className="flex items-center gap-1">
              {formatCurrency(detail.finalPrice)}
              {detail.finalPrice !== detail.price ? (
                <span className="text-xs text-secondary">
                  {t.detail.discounted(detail.price - detail.finalPrice)}
                </span>
              ) : null}
            </div>
            {detail.note ? <div><strong>{t.detail.note}</strong>{detail.note}</div> : null}
            {detail.status === 'PENDING' ? (
              <span className="text-xs text-warning">{t.detail.notConfirmed}</span>
            ) : null}
          </div>
        ) : (
          <div className="py-8 text-center text-secondary">{t.detail.loading}</div>
        )}
      </Modal>

      {/* -------------------------------------------------------- 取消預約 */}
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
                    `${t.messages.cancelled}${t.messages.notified}`,
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
        <FormGroup>
          <Label htmlFor="cancelReason">{t.cancelModal.label}</Label>
          <Textarea
            id="cancelReason" rows={3} value={cancelReason}
            placeholder={t.cancelModal.placeholder}
            onChange={(e) => setCancelReason(e.target.value)}
          />
        </FormGroup>
      </Modal>

      {/* ------------------------------------------------ 確認 / 完成 / 爽約 */}
      <ConfirmModal
        open={!!confirmTarget}
        title={t.detail.confirm}
        message={<span className="whitespace-pre-line">{t.confirmMessages.confirmBooking}</span>}
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
        title={t.detail.complete}
        message={t.confirmMessages.complete}
        onClose={() => setCompleteTarget(null)}
        onConfirm={() => {
          const target = completeTarget;
          setCompleteTarget(null);
          if (target) {
            void runAction(() => completeBooking(target.id), t.messages.completed, t.messages.completeFailed);
          }
        }}
      />

      <ConfirmModal
        open={!!noShowTarget}
        danger
        title={t.detail.noShow}
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

      {/* ---------------------------------------------------------- 臨時封鎖 */}
      <Modal
        open={!!blockTarget}
        onClose={() => setBlockTarget(null)}
        title={t.block.quickTitle}
        footer={<Button variant="secondary" onClick={() => setBlockTarget(null)}>{common.cancel}</Button>}
      >
        {blockTarget ? (
          <div className="flex flex-col gap-3">
            <div className="text-base font-semibold text-dark">{formatDate(blockTarget.date)}</div>
            {blockTarget.hour !== null ? (
              <div>
                <Button
                  block
                  onClick={() => void createBlock(blockTarget.date, blockTarget.hour ?? 0)}
                >
                  <Ban size={15} />{t.block.blockSlot}
                </Button>
                <FormText>{t.block.blockSlotHint}</FormText>
              </div>
            ) : null}
            <div>
              <Button
                block
                variant="outline"
                onClick={() => void createBlock(blockTarget.date, null)}
              >
                <Ban size={15} />{t.block.blockDay}
              </Button>
              <FormText>{t.block.blockDayHint}</FormText>
            </div>
            <FormText>{t.block.namePlaceholder}</FormText>
          </div>
        ) : null}
      </Modal>

      <ConfirmModal
        open={!!blockDeleting}
        danger
        title={t.block.deleteTitle}
        confirmText={common.delete}
        message={
          <span className="whitespace-pre-line">
            {blockDeleting?.auto
              ? t.block.autoRest
              : blockDeleting
                ? blockDeleting.weekly
                  ? t.block.deleteWeeklyConfirm(blockDeleting.title)
                  : t.block.deleteConfirm(blockDeleting.title)
                : ''}
          </span>
        }
        onClose={() => setBlockDeleting(null)}
        onConfirm={() => {
          const target = blockDeleting;
          setBlockDeleting(null);
          if (target && !target.auto) void removeBlock(target);
        }}
      />
    </>
  );
}
