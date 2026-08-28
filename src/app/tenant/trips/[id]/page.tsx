'use client';
import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  AlertTriangle, CalendarDays, CalendarPlus, Clock, Download, Image as ImageIcon, Layers,
  ListPlus, Package, Pencil, Plus, Send, Trash2, Upload, Users,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Tabs, TabPanel } from '@/components/ui/Tabs';
import {
  DataTable, DataTableContainer, DataTableHeader, type Column,
} from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmModal, Modal } from '@/components/ui/Modal';
import {
  FormGroup, FormText, Input, Label, Select, Switch, SwitchField, Textarea,
} from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import {
  batchCreateDepartures, deleteTripAddon, deleteTripDeparture, deleteTripPlan,
  getTrip, listTripAddons, listTripDepartures, listTripPlans,
  exportTripJson, getDepartureStaffAvailability, saveTripAddon, saveTripDeparture, saveTripPlan, updateTrip,
} from '@/services/tours';
import { common } from '@/i18n/zh-TW/common';
import { navLabel } from '@/i18n/zh-TW/nav';
import { useBusinessType } from '@/components/layout/BusinessTypeContext';
import { tripsPage as t } from '@/i18n/zh-TW/pages/trips';
import { formatCurrency, formatNumber } from '@/lib/utils';
import type {
  DepartureStatus, PlanReviewState, PriceType, Trip, TripAddon,
  DepartureStaffAvailability, TripBookingType, TripDeparture, TripPlan, TripPlanSeason,
} from '@/lib/types';

const GALLERY_MAX = 8;
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];

const REVIEW_TONE: Record<PlanReviewState, 'info' | 'danger' | 'neutral'> = {
  PENDING: 'info', CHANGES_REQUESTED: 'danger', NONE: 'neutral',
};
const DEPARTURE_TONE: Record<DepartureStatus, 'success' | 'neutral' | 'danger'> = {
  OPEN: 'success', CLOSED: 'neutral', CANCELLED: 'danger',
};

/** 空白方案（新增用） */
const emptyPlan = (tripId: string): TripPlan => ({
  id: '', tripId, name: '', description: '', durationMinutes: 180,
  priceType: 'PER_PERSON', basePrice: 0, childPrice: null,
  minParticipants: 1, maxParticipants: 10, bookingType: 'SCHEDULED',
  depositMode: 'FULL', depositValue: 0,
  active: true, yearRound: true, seasons: [], reviewState: 'NONE',
  reviewNote: '', sortOrder: 0,
});

const emptyAddon = (tripId: string): TripAddon => ({
  id: '', tripId, name: '', price: 0, unit: 'PER_PERSON',
  stock: null, active: true, sortOrder: 0,
});

const emptyDeparture = (tripId: string, planId: string): TripDeparture => ({
  id: '', tripId, planId, planName: '', departsOn: '', startTime: '09:00',
  capacity: 10, seatsBooked: 0, status: 'OPEN', note: '',
});

export default function TripDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const businessType = useBusinessType();
  const tripId = String(params?.id ?? '');

  const [tab, setTab] = React.useState(searchParams?.get('tab') ?? 'basic');
  const [loading, setLoading] = React.useState(true);
  const [trip, setTrip] = React.useState<Trip | null>(null);
  const [plans, setPlans] = React.useState<TripPlan[]>([]);
  const [departures, setDepartures] = React.useState<TripDeparture[]>([]);
  const [addons, setAddons] = React.useState<TripAddon[]>([]);

  /* 編輯中的表單狀態 */
  const [form, setForm] = React.useState<Trip | null>(null);
  /** 有寫入請求在飛：儲存鈕轉圈並鎖住，避免重複送出 */
  const [busy, setBusy] = React.useState(false);
  const [planDraft, setPlanDraft] = React.useState<TripPlan | null>(null);
  const [addonDraft, setAddonDraft] = React.useState<TripAddon | null>(null);
  const [departureDraft, setDepartureDraft] = React.useState<TripDeparture | null>(null);
  const [departureStaff, setDepartureStaff] = React.useState<DepartureStaffAvailability[]>([]);
  const [batchOpen, setBatchOpen] = React.useState(false);
  const [batchStaff, setBatchStaff] = React.useState<DepartureStaffAvailability[]>([]);
  const [batchConflicts, setBatchConflicts] = React.useState<Array<{ date: string; staffId: string; staffName: string; reason: string }>>([]);
  const [batch, setBatch] = React.useState({
    planId: '', from: '', to: '', startTime: '09:00', capacity: 10,
    weekdays: [6, 0] as number[],
    primaryStaffId: null as string | null, assistantStaffIds: [] as string[],
  });
  const [deleteTarget, setDeleteTarget] = React.useState<
    { kind: 'plan' | 'addon' | 'departure'; id: string; name: string } | null
  >(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [tr, pl, dp, ad] = await Promise.all([
        getTrip(tripId), listTripPlans(tripId),
        listTripDepartures(tripId), listTripAddons(tripId),
      ]);
      setTrip(tr ?? null);
      setForm(tr ?? null);
      setPlans(pl);
      setDepartures(dp);
      setAddons(ad);
    } catch {
      toast.show(t.messages.loadFailed, 'danger');
    } finally {
      setLoading(false);
    }
  }, [tripId, toast]);

  React.useEffect(() => { void load(); }, [load]);

  React.useEffect(() => {
    if (!departureDraft?.planId || !departureDraft.departsOn) {
      setDepartureStaff([]);
      return;
    }
    let cancelled = false;
    void getDepartureStaffAvailability(tripId, {
      planId: departureDraft.planId, departsOn: departureDraft.departsOn,
      startTime: departureDraft.startTime, excludeDepartureId: departureDraft.id || undefined,
    }).then((result) => { if (!cancelled) setDepartureStaff(result.staff); })
      .catch(() => { if (!cancelled) setDepartureStaff([]); });
    return () => { cancelled = true; };
  }, [departureDraft?.id, departureDraft?.planId, departureDraft?.departsOn, departureDraft?.startTime, tripId]);

  React.useEffect(() => {
    if (!batchOpen || !batch.planId || !batch.from) { setBatchStaff([]); return; }
    let cancelled = false;
    void getDepartureStaffAvailability(tripId, {
      planId: batch.planId, departsOn: batch.from, startTime: batch.startTime,
    }).then((result) => { if (!cancelled) setBatchStaff(result.staff); })
      .catch(() => { if (!cancelled) setBatchStaff([]); });
    return () => { cancelled = true; };
  }, [batchOpen, batch.planId, batch.from, batch.startTime, tripId]);

  React.useEffect(() => { if (!batchOpen) setBatchConflicts([]); }, [batchOpen]);

  const patch = (p: Partial<Trip>) => setForm((f) => (f ? { ...f, ...p } : f));
  const lines = (arr: string[]) => arr.join('\n');
  const toLines = (v: string) => v.split('\n').map((s) => s.trim()).filter(Boolean);

  /**
   * 以下每一個寫入動作都是 **await 端點成功之後**才改畫面與 toast
   * （00 鐵則 12）。修改前它們只改本地 state（外加一顆假的成功訊息），
   * 重新整理就會全部消失。
   * 一律用端點回傳的那一份資料回填，而不是自己手上的草稿——後端會重算
   * 欄位（方案的 slug/sort_order、團次的 planName、審核狀態），
   * 用草稿回填會讓畫面顯示一份資料庫裡不存在的值。
   */
  const failMessage = (e: unknown) =>
    (e instanceof Error && e.message ? e.message : t.messages.actionFailed);

  const saveBasic = async () => {
    if (!form) return;
    setBusy(true);
    try {
      const saved = await updateTrip(form.id, {
        title: form.title,
        slug: form.slug,
        tagline: form.tagline,
        summary: form.summary,
        description: form.description,
        region: form.region,
        category: form.category,
        coverImageUrl: form.coverImageUrl,
        galleryUrls: form.galleryUrls,
        meetingPoint: form.meetingPoint,
        meetingPointMapUrl: form.meetingPointMapUrl,
        inclusions: form.inclusions,
        exclusions: form.exclusions,
        notices: form.notices,
        safetyNotice: form.safetyNotice,
      });
      setTrip(saved);
      setForm(saved);
      toast.show(t.messages.updated);
    } catch (e) {
      toast.show(failMessage(e), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const exportJson = async () => {
    setBusy(true);
    try {
      const result = await exportTripJson(tripId);
      if (!result) toast.show(t.messages.exportNotDownloaded, 'warning');
      else toast.show(t.messages.exported);
    } catch (e) {
      toast.show(failMessage(e), 'danger');
    } finally {
      setBusy(false);
    }
  };

  /* ------------------------------------------------------------- 方案 */
  const savePlan = async () => {
    if (!planDraft) return;
    const isNew = !planDraft.id;
    setBusy(true);
    try {
      const saved = await saveTripPlan(tripId, planDraft);
      setPlans((prev) => (isNew
        ? [...prev, saved]
        : prev.map((p) => (p.id === saved.id ? saved : p))));
      setPlanDraft(null);
      /*
       * 「已送出審核」這句以前是純文案：頁面看 trip.midaoListing === 'LISTED'
       * 就這樣講，而後端根本沒有寫 review_state。現在改成看**端點回傳的**
       * reviewState —— 說「已送審」的依據是資料庫真的變成 PENDING 了。
       */
      toast.show(saved.reviewState === 'PENDING' ? t.messages.planSubmitted : t.messages.planSaved);
    } catch (e) {
      toast.show(failMessage(e), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const patchPlan = (p: Partial<TripPlan>) => setPlanDraft((d) => (d ? { ...d, ...p } : d));

  const addSeason = () => {
    if (!planDraft) return;
    const season: TripPlanSeason = {
      id: `ss_new_${planDraft.seasons.length + 1}`, name: '',
      startMonth: 1, startDay: 1, endMonth: 12, endDay: 31,
      priceOverride: null, active: true,
    };
    patchPlan({ seasons: [...planDraft.seasons, season] });
  };

  const patchSeason = (id: string, p: Partial<TripPlanSeason>) => {
    if (!planDraft) return;
    patchPlan({ seasons: planDraft.seasons.map((s) => (s.id === id ? { ...s, ...p } : s)) });
  };

  const removeSeason = (id: string) => {
    if (!planDraft) return;
    patchPlan({ seasons: planDraft.seasons.filter((s) => s.id !== id) });
  };

  /* ------------------------------------------------------------- 團次 */
  const saveDeparture = async () => {
    if (!departureDraft) return;
    // 前端先擋一次是為了給出人話（後端與 DB 各自也擋，見 0026 的 check 約束）
    if (departureDraft.capacity < departureDraft.seatsBooked) {
      toast.show(t.departures.capacityTooLow(departureDraft.seatsBooked), 'danger');
      return;
    }
    const isNew = !departureDraft.id;
    setBusy(true);
    try {
      const saved = await saveTripDeparture(tripId, {
        id: departureDraft.id || undefined,
        planId: departureDraft.planId,
        departsOn: departureDraft.departsOn,
        startTime: departureDraft.startTime,
        capacity: departureDraft.capacity,
        status: departureDraft.status,
        note: departureDraft.note,
        primaryStaffId: departureDraft.primaryStaffId,
        assistantStaffIds: departureDraft.assistantStaffIds,
      });
      setDepartures((prev) => (isNew
        ? [...prev, saved].sort((a, b) => a.departsOn.localeCompare(b.departsOn))
        : prev.map((d) => (d.id === saved.id ? saved : d))));
      setDepartureDraft(null);
      toast.show(isNew ? t.messages.departureCreated : t.messages.departureUpdated);
    } catch (e) {
      toast.show(failMessage(e), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const batchCount = React.useMemo(() => {
    if (!batch.from || !batch.to) return 0;
    const from = new Date(batch.from);
    const to = new Date(batch.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return 0;
    let n = 0;
    for (const d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      if (batch.weekdays.includes(d.getDay())) n += 1;
    }
    return n;
  }, [batch]);

  /**
   * 批次開團：日期展開交給後端（`POST …/departures/batch`），前端的
   * `batchCount` 只是**預覽**。回應的 `created` / `skipped` 要照實顯示——
   * 已存在的日期會被跳過，把 skipped 併進 created 報成「已建立 N 個」
   * 就是在虛報一個沒發生的數字。
   */
  const runBatch = async () => {
    const plan = plans.find((p) => p.id === batch.planId);
    if (!plan || batchCount === 0) return;
    setBusy(true);
    try {
      const res = await batchCreateDepartures(tripId, {
        planId: plan.id,
        from: batch.from,
        to: batch.to,
        weekdays: batch.weekdays,
        startTime: batch.startTime,
        capacity: batch.capacity,
        primaryStaffId: batch.primaryStaffId,
        assistantStaffIds: batch.assistantStaffIds,
      });
      setDepartures((prev) => [...prev, ...res.departures]
        .sort((a, b) => a.departsOn.localeCompare(b.departsOn)));
      setBatchConflicts(res.conflicts ?? []);
      if ((res.conflicts?.length ?? 0) === 0) setBatchOpen(false);
      toast.show(res.skipped > 0
        ? t.messages.departureBatchPartial(res.created, res.skipped)
        : t.messages.departureBatchCreated(res.created));
    } catch (e) {
      toast.show(failMessage(e), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const setDepartureStatus = async (id: string, status: DepartureStatus) => {
    setBusy(true);
    try {
      const saved = await saveTripDeparture(tripId, { id, status });
      setDepartures((prev) => prev.map((d) => (d.id === saved.id ? saved : d)));
      toast.show(t.messages.departureUpdated);
    } catch (e) {
      toast.show(failMessage(e), 'danger');
    } finally {
      setBusy(false);
    }
  };

  /* ------------------------------------------------------------- 加購 */
  const saveAddon = async () => {
    if (!addonDraft) return;
    const isNew = !addonDraft.id;
    setBusy(true);
    try {
      const saved = await saveTripAddon(tripId, {
        id: addonDraft.id || undefined,
        name: addonDraft.name,
        price: addonDraft.price,
        unit: addonDraft.unit,
        stock: addonDraft.stock,
        active: addonDraft.active,
      });
      setAddons((prev) => (isNew
        ? [...prev, saved]
        : prev.map((a) => (a.id === saved.id ? saved : a))));
      setAddonDraft(null);
      toast.show(t.messages.addonSaved);
    } catch (e) {
      toast.show(failMessage(e), 'danger');
    } finally {
      setBusy(false);
    }
  };

  /* ------------------------------------------------------------- 刪除 */
  const doDelete = async () => {
    if (!deleteTarget) return;
    const { kind, id } = deleteTarget;
    setBusy(true);
    try {
      if (kind === 'plan') {
        await deleteTripPlan(id);
        setPlans((p) => p.filter((x) => x.id !== id));
        toast.show(t.messages.planDeleted);
      } else if (kind === 'addon') {
        await deleteTripAddon(id);
        setAddons((a) => a.filter((x) => x.id !== id));
        toast.show(t.messages.addonDeleted);
      } else {
        await deleteTripDeparture(id);
        setDepartures((d) => d.filter((x) => x.id !== id));
        toast.show(t.messages.departureDeleted);
      }
      setDeleteTarget(null);
    } catch (e) {
      toast.show(failMessage(e), 'danger');
    } finally {
      setBusy(false);
    }
  };

  if (loading || !form || !trip) {
    return (
      <>
        <PageHeader eyebrow={navLabel('navOperation', businessType)} title={t.detailTitle} />
        <Card><CardBody><span className="text-muted">{common.loading}</span></CardBody></Card>
      </>
    );
  }

  /* -------------------------------------------------------- 方案表格欄位 */
  const planColumns: Column<TripPlan>[] = [
    {
      key: 'name', header: t.plans.columns.name,
      render: (p) => (
        <div className="min-w-0">
          <div className="font-semibold text-dark">{p.name}</div>
          {p.description ? (
            <div className="truncate text-2xs text-secondary">{p.description}</div>
          ) : null}
          <div className="mt-0.5 inline-flex items-center gap-1 text-2xs text-muted">
            <Clock size={11} />{formatNumber(p.durationMinutes)}{' 分鐘'}
          </div>
        </div>
      ),
    },
    {
      key: 'price', header: t.plans.columns.price, numeric: true, width: '130px',
      render: (p) => (
        <div>
          <div>{formatCurrency(p.basePrice)}</div>
          <div className="text-2xs text-secondary">{t.plans.priceTypeSuffix[p.priceType]}</div>
        </div>
      ),
    },
    {
      key: 'party', header: t.plans.columns.party, numeric: true, width: '100px',
      render: (p) => (
        <span className="inline-flex items-center gap-1">
          <Users size={12} className="text-muted" />{p.minParticipants}–{p.maxParticipants}
        </span>
      ),
    },
    {
      key: 'bookingType', header: t.plans.columns.bookingType, width: '110px',
      render: (p) => <Badge tone="info">{t.plans.bookingType[p.bookingType]}</Badge>,
    },
    {
      key: 'deposit', header: t.plans.columns.deposit, width: '120px',
      render: (p) => (
        <div>
          <div className="text-xs">{t.plans.depositMode[p.depositMode]}</div>
          {p.depositMode === 'DEPOSIT_FIXED' ? (
            <div className="text-2xs text-secondary">{formatCurrency(p.depositValue)}</div>
          ) : p.depositMode === 'DEPOSIT_PERCENT' ? (
            <div className="text-2xs text-secondary">{p.depositValue}%</div>
          ) : null}
        </div>
      ),
    },
    {
      key: 'season', header: t.plans.columns.season, width: '110px',
      render: (p) => (p.yearRound
        ? <span className="text-secondary">{t.plans.seasonSummary.yearRound}</span>
        : p.seasons.length
          ? <span className="text-secondary">{t.plans.seasonSummary.count(p.seasons.length)}</span>
          : <span className="text-danger">{t.plans.seasonSummary.none}</span>),
    },
    {
      key: 'review', header: t.plans.columns.review, width: '100px',
      render: (p) => (p.reviewState === 'NONE'
        ? <span className="text-muted">{t.plans.review.NONE}</span>
        : <Badge tone={REVIEW_TONE[p.reviewState]}>{t.plans.review[p.reviewState]}</Badge>),
    },
    {
      key: 'status', header: t.plans.columns.status, width: '80px',
      render: (p) => (p.active
        ? <Badge tone="success">{common.enabled}</Badge>
        : <Badge tone="neutral">{common.disabled}</Badge>),
    },
    {
      key: 'actions', header: t.plans.columns.actions, width: '100px',
      render: (p) => (
        <div className="btn-group">
          <Button
            variant="outline" size="sm" title={t.actions.edit} aria-label={t.actions.edit}
            onClick={() => setPlanDraft(p)}
          >
            <Pencil size={13} />
          </Button>
          <Button
            variant="outlineDanger" size="sm" title={t.actions.delete} aria-label={t.actions.delete}
            onClick={() => setDeleteTarget({ kind: 'plan', id: p.id, name: p.name })}
          >
            <Trash2 size={13} />
          </Button>
        </div>
      ),
    },
  ];

  /* -------------------------------------------------------- 團次表格欄位 */
  const departureColumns: Column<TripDeparture>[] = [
    {
      key: 'date', header: t.departures.columns.date, width: '150px',
      render: (d) => (
        <div>
          <div className="font-semibold text-dark">{d.departsOn}</div>
          {d.startTime ? <div className="text-2xs text-secondary">{d.startTime}</div> : null}
        </div>
      ),
    },
    { key: 'plan', header: t.departures.columns.plan, render: (d) => d.planName },
    {
      key: 'guides', header: t.departures.columns.guides,
      render: (d) => (
        <div className="text-2xs">
          <div className={d.primaryStaffName ? 'text-dark' : 'text-warning'}>
            {d.primaryStaffName ?? t.departures.unassigned}
          </div>
          {(d.assistantStaffNames?.length ?? 0) > 0 ? (
            <div className="text-secondary">{t.departures.assistants(d.assistantStaffNames!.join('、'))}</div>
          ) : null}
        </div>
      ),
    },
    {
      key: 'seats', header: t.departures.columns.seats, numeric: true, width: '150px',
      render: (d) => {
        const left = d.capacity - d.seatsBooked;
        return (
          <div>
            <div>{t.departures.seatsText(d.seatsBooked, d.capacity)}</div>
            <div className={left === 0 ? 'text-2xs text-danger' : 'text-2xs text-secondary'}>
              {left === 0 ? t.departures.soldOut : t.departures.remaining(left)}
            </div>
          </div>
        );
      },
    },
    {
      key: 'status', header: t.departures.columns.status, width: '100px',
      render: (d) => <Badge tone={DEPARTURE_TONE[d.status]}>{t.departures.status[d.status]}</Badge>,
    },
    {
      key: 'note', header: t.departures.columns.note,
      render: (d) => (d.note
        ? <span className="text-2xs text-secondary">{d.note}</span>
        : <span className="text-muted">—</span>),
    },
    {
      key: 'actions', header: t.departures.columns.actions, width: '200px',
      render: (d) => (
        <div className="btn-group">
          <Button
            variant="outline" size="sm" title={t.actions.edit} aria-label={t.actions.edit}
            onClick={() => setDepartureDraft(d)}
          >
            <Pencil size={13} />
          </Button>
          {d.status === 'OPEN' ? (
            <Button
              variant="outline" size="sm"
              title={t.departures.closeAction} aria-label={t.departures.closeAction}
              disabled={busy}
              onClick={() => { void setDepartureStatus(d.id, 'CLOSED'); }}
            >
              {t.departures.closeAction}
            </Button>
          ) : d.status === 'CLOSED' ? (
            <Button
              variant="outline" size="sm"
              title={t.departures.reopenAction} aria-label={t.departures.reopenAction}
              disabled={busy}
              onClick={() => { void setDepartureStatus(d.id, 'OPEN'); }}
            >
              {t.departures.reopenAction}
            </Button>
          ) : null}
          <Button
            variant="outlineDanger" size="sm" title={t.actions.delete} aria-label={t.actions.delete}
            onClick={() => setDeleteTarget({ kind: 'departure', id: d.id, name: d.departsOn })}
          >
            <Trash2 size={13} />
          </Button>
        </div>
      ),
    },
  ];

  /* -------------------------------------------------------- 加購表格欄位 */
  const addonColumns: Column<TripAddon>[] = [
    { key: 'name', header: t.addons.columns.name, render: (a) => <span className="font-semibold text-dark">{a.name}</span> },
    { key: 'price', header: t.addons.columns.price, numeric: true, width: '120px', render: (a) => formatCurrency(a.price) },
    { key: 'unit', header: t.addons.columns.unit, width: '110px', render: (a) => t.plans.priceType[a.unit] },
    {
      key: 'stock', header: t.addons.columns.stock, numeric: true, width: '110px',
      render: (a) => (a.stock === null
        ? <span className="text-secondary">{t.addons.unlimited}</span>
        : formatNumber(a.stock)),
    },
    {
      key: 'status', header: t.addons.columns.status, width: '80px',
      render: (a) => (a.active
        ? <Badge tone="success">{common.enabled}</Badge>
        : <Badge tone="neutral">{common.disabled}</Badge>),
    },
    {
      key: 'actions', header: t.addons.columns.actions, width: '100px',
      render: (a) => (
        <div className="btn-group">
          <Button
            variant="outline" size="sm" title={t.actions.edit} aria-label={t.actions.edit}
            onClick={() => setAddonDraft(a)}
          >
            <Pencil size={13} />
          </Button>
          <Button
            variant="outlineDanger" size="sm" title={t.actions.delete} aria-label={t.actions.delete}
            onClick={() => setDeleteTarget({ kind: 'addon', id: a.id, name: a.name })}
          >
            <Trash2 size={13} />
          </Button>
        </div>
      ),
    },
  ];

  const pendingPlans = plans.filter((p) => p.reviewState !== 'NONE');

  return (
    <>
      <PageHeader
        eyebrow={navLabel('trips', businessType)}
        eyebrowHref="/tenant/trips"
        title={trip.title}
        subtitle={trip.region}
        actions={
          <>
            <Badge tone={trip.status === 'PUBLISHED' ? 'success' : 'neutral'}>
              {t.status[trip.status]}
            </Badge>
            <Badge tone={trip.midaoListing === 'LISTED' ? 'primary' : 'neutral'}>
              Midao · {t.midaoListing[trip.midaoListing]}
            </Badge>
            <Button variant="outline" onClick={() => router.push('/tenant/trips')}>
              {t.actions.back}
            </Button>
            <Button variant="outline" loading={busy} onClick={() => { void exportJson(); }}>
              <Download size={14} />{t.actions.exportJson}
            </Button>
            <Button loading={busy} onClick={() => { void saveBasic(); }}>{t.actions.save}</Button>
          </>
        }
      />

      {/* -------------------------------------- Midao 狀態說明（含退回原因） */}
      <Alert
        tone={trip.midaoListing === 'REJECTED' ? 'danger'
          : trip.midaoListing === 'LISTED' ? 'success' : 'info'}
        className="mb-3"
        action={trip.midaoListing === 'NONE' || trip.midaoListing === 'REJECTED' ? (
          <Button size="sm" variant="outline">
            <Send size={13} />{t.actions.requestMidao}
          </Button>
        ) : undefined}
      >
        {t.midaoHint[trip.midaoListing]}
        {trip.midaoListing === 'REJECTED' && trip.midaoListingNote ? (
          <div className="mt-1">
            <span className="font-semibold">{t.midaoRejectLabel}：</span>{trip.midaoListingNote}
          </div>
        ) : null}
      </Alert>

      {/* -------------------------------------------------- 方案審核中的提醒 */}
      {pendingPlans.map((p) => (
        <Alert
          key={p.id}
          tone={p.reviewState === 'PENDING' ? 'info' : 'warning'}
          title={`${p.name}｜${t.plans.review[p.reviewState]}`}
          className="mb-3"
        >
          {p.reviewState === 'PENDING' ? t.plans.review.pendingHint : t.plans.review.changesHint}
          {p.reviewNote ? (
            <div className="mt-1">
              <span className="font-semibold">{t.plans.review.noteLabel}：</span>{p.reviewNote}
            </div>
          ) : null}
        </Alert>
      ))}

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { key: 'basic', label: t.tabs.basic, icon: ImageIcon },
          { key: 'plans', label: t.tabs.plans, icon: Layers },
          { key: 'departures', label: t.tabs.departures, icon: CalendarDays },
          { key: 'addons', label: t.tabs.addons, icon: Package },
        ]}
      />

      {/* ==================================================== 分頁：基本資料 */}
      <TabPanel active={tab === 'basic'}>
        <div className="grid gap-3 lg:grid-cols-3">
          <div className="flex flex-col gap-3 lg:col-span-2">
            <Card>
              <CardHeader><CardTitle>{t.tabs.basic}</CardTitle></CardHeader>
              <CardBody className="flex flex-col gap-3">
                <FormGroup>
                  <Label required>{t.form.titleLabel}</Label>
                  <Input
                    value={form.title}
                    placeholder={t.form.titlePlaceholder}
                    onChange={(e) => patch({ title: e.target.value })}
                  />
                </FormGroup>
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormGroup>
                    <Label required>{t.form.slugLabel}</Label>
                    <Input
                      value={form.slug}
                      placeholder={t.form.slugPlaceholder}
                      onChange={(e) => patch({ slug: e.target.value })}
                    />
                    <FormText>{t.form.slugHelp}</FormText>
                  </FormGroup>
                  <FormGroup>
                    <Label>{t.form.regionLabel}</Label>
                    <Input
                      value={form.region}
                      placeholder={t.form.regionPlaceholder}
                      onChange={(e) => patch({ region: e.target.value })}
                    />
                  </FormGroup>
                </div>
                <FormGroup>
                  <Label>{t.form.taglineLabel}</Label>
                  <Input
                    value={form.tagline}
                    placeholder={t.form.taglinePlaceholder}
                    onChange={(e) => patch({ tagline: e.target.value })}
                  />
                </FormGroup>
                <FormGroup>
                  <Label>{t.form.summaryLabel}</Label>
                  <Textarea
                    rows={2}
                    value={form.summary}
                    onChange={(e) => patch({ summary: e.target.value })}
                  />
                  <FormText>{t.form.summaryHelp}</FormText>
                </FormGroup>
                <FormGroup>
                  <Label>{t.form.descriptionLabel}</Label>
                  <Textarea
                    rows={8}
                    value={form.description}
                    onChange={(e) => patch({ description: e.target.value })}
                  />
                  <FormText>{t.form.descriptionHelp}</FormText>
                </FormGroup>
              </CardBody>
            </Card>

            <Card>
              <CardHeader><CardTitle>{t.form.inclusionsLabel} / {t.form.exclusionsLabel}</CardTitle></CardHeader>
              <CardBody className="flex flex-col gap-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormGroup>
                    <Label>{t.form.inclusionsLabel}</Label>
                    <Textarea
                      rows={5}
                      value={lines(form.inclusions)}
                      onChange={(e) => patch({ inclusions: toLines(e.target.value) })}
                    />
                    <FormText>{t.form.listHelp}</FormText>
                  </FormGroup>
                  <FormGroup>
                    <Label>{t.form.exclusionsLabel}</Label>
                    <Textarea
                      rows={5}
                      value={lines(form.exclusions)}
                      onChange={(e) => patch({ exclusions: toLines(e.target.value) })}
                    />
                    <FormText>{t.form.listHelp}</FormText>
                  </FormGroup>
                </div>
                <FormGroup>
                  <Label>{t.form.noticesLabel}</Label>
                  <Textarea
                    rows={4}
                    value={lines(form.notices)}
                    onChange={(e) => patch({ notices: toLines(e.target.value) })}
                  />
                  <FormText>{t.form.listHelp}</FormText>
                </FormGroup>
                <FormGroup>
                  <Label>{t.form.safetyLabel}</Label>
                  <Textarea
                    rows={2}
                    value={form.safetyNotice}
                    onChange={(e) => patch({ safetyNotice: e.target.value })}
                  />
                </FormGroup>
              </CardBody>
            </Card>
          </div>

          <div className="flex flex-col gap-3">
            <Card>
              <CardHeader><CardTitle>{t.form.coverLabel}</CardTitle></CardHeader>
              <CardBody className="flex flex-col gap-2">
                <div className="flex aspect-[3/2] items-center justify-center rounded-lg border border-dashed border-neutral-300 bg-neutral-50 text-muted">
                  <ImageIcon size={28} />
                </div>
                <Button variant="outline" size="sm"><Upload size={14} />{t.form.uploadCta}</Button>
                <FormText>{t.form.coverHelp}</FormText>
                <div className="mt-2 border-t border-neutral-200 pt-2">
                  <Label>{t.form.galleryLabel}</Label>
                  <div className="mt-1 grid grid-cols-3 gap-1.5">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div
                        key={i}
                        className="flex aspect-square items-center justify-center rounded-md border border-dashed border-neutral-300 bg-neutral-50 text-muted"
                      >
                        <Plus size={14} />
                      </div>
                    ))}
                  </div>
                  <FormText>{t.form.galleryHelp(GALLERY_MAX)}</FormText>
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader><CardTitle>{t.form.meetingPointLabel}</CardTitle></CardHeader>
              <CardBody className="flex flex-col gap-3">
                <FormGroup>
                  <Label>{t.form.meetingPointLabel}</Label>
                  <Input
                    value={form.meetingPoint}
                    placeholder={t.form.meetingPointPlaceholder}
                    onChange={(e) => patch({ meetingPoint: e.target.value })}
                  />
                </FormGroup>
                <FormGroup>
                  <Label>{t.form.meetingMapLabel}</Label>
                  <Input
                    value={form.meetingPointMapUrl}
                    onChange={(e) => patch({ meetingPointMapUrl: e.target.value })}
                  />
                </FormGroup>
                <FormGroup>
                  <Label>{t.form.refundLabel}</Label>
                  <Select
                    value={form.refundPolicyType}
                    onChange={(e) => patch({ refundPolicyType: e.target.value as Trip['refundPolicyType'] })}
                  >
                    {(Object.keys(t.form.refundOptions) as Trip['refundPolicyType'][]).map((k) => (
                      <option key={k} value={k}>{t.form.refundOptions[k]}</option>
                    ))}
                  </Select>
                </FormGroup>
              </CardBody>
            </Card>
          </div>
        </div>
      </TabPanel>

      {/* ====================================================== 分頁：方案 */}
      <TabPanel active={tab === 'plans'}>
        <Alert tone="info" className="mb-3">{t.plans.review.submitNotice}</Alert>
        <DataTableContainer>
          <DataTableHeader
            title={t.plans.sectionTitle}
            actions={
              <Button size="sm" onClick={() => setPlanDraft(emptyPlan(tripId))}>
                <Plus size={14} />{t.plans.create}
              </Button>
            }
          />
          <DataTable
            columns={planColumns}
            rows={plans}
            rowKey={(p) => p.id}
            empty={
              <EmptyState
                icon={Layers}
                title={t.plans.empty.title}
                description={t.plans.empty.description}
                action={
                  <Button onClick={() => setPlanDraft(emptyPlan(tripId))}>
                    <Plus size={15} />{t.plans.create}
                  </Button>
                }
              />
            }
          />
        </DataTableContainer>
        <p className="mt-2 text-2xs text-muted">{t.plans.sectionHint}</p>
      </TabPanel>

      {/* ====================================================== 分頁：團次 */}
      <TabPanel active={tab === 'departures'}>
        <DataTableContainer>
          <DataTableHeader
            title={t.departures.sectionTitle}
            actions={
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setBatchOpen(true)}>
                  <CalendarPlus size={14} />{t.departures.batchCreate}
                </Button>
                <Button
                  size="sm"
                  onClick={() => setDepartureDraft(emptyDeparture(tripId, plans[0]?.id ?? ''))}
                >
                  <Plus size={14} />{t.departures.create}
                </Button>
              </div>
            }
          />
          <DataTable
            columns={departureColumns}
            rows={departures}
            rowKey={(d) => d.id}
            scroll
            empty={
              <EmptyState
                icon={CalendarDays}
                title={t.departures.empty.title}
                description={t.departures.empty.description}
                action={
                  <Button onClick={() => setDepartureDraft(emptyDeparture(tripId, plans[0]?.id ?? ''))}>
                    <Plus size={15} />{t.departures.create}
                  </Button>
                }
              />
            }
          />
        </DataTableContainer>
        <p className="mt-2 text-2xs text-muted">{t.departures.sectionHint}</p>
      </TabPanel>

      {/* ====================================================== 分頁：加購 */}
      <TabPanel active={tab === 'addons'}>
        <DataTableContainer>
          <DataTableHeader
            title={t.addons.sectionTitle}
            actions={
              <Button size="sm" onClick={() => setAddonDraft(emptyAddon(tripId))}>
                <Plus size={14} />{t.addons.create}
              </Button>
            }
          />
          <DataTable
            columns={addonColumns}
            rows={addons}
            rowKey={(a) => a.id}
            empty={
              <EmptyState
                icon={Package}
                title={t.addons.empty.title}
                description={t.addons.empty.description}
                action={
                  <Button onClick={() => setAddonDraft(emptyAddon(tripId))}>
                    <Plus size={15} />{t.addons.create}
                  </Button>
                }
              />
            }
          />
        </DataTableContainer>
        <p className="mt-2 text-2xs text-muted">{t.addons.sectionHint}</p>
      </TabPanel>

      {/* ================================================== 方案編輯 Modal */}
      <Modal
        open={!!planDraft}
        onClose={() => setPlanDraft(null)}
        size="lg"
        title={planDraft?.id ? t.plans.editTitle(planDraft.name) : t.plans.createTitle}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPlanDraft(null)}>{common.cancel}</Button>
            <Button loading={busy} onClick={() => { void savePlan(); }}>{common.save}</Button>
          </>
        }
      >
        {planDraft ? (
          <div className="flex flex-col gap-3">
            {planDraft.reviewState === 'CHANGES_REQUESTED' && planDraft.reviewNote ? (
              <Alert tone="warning" icon={<AlertTriangle size={18} className="mt-0.5" />}>
                <span className="font-semibold">{t.plans.review.noteLabel}：</span>{planDraft.reviewNote}
              </Alert>
            ) : null}

            <FormGroup>
              <Label required>{t.plans.fields.nameLabel}</Label>
              <Input
                value={planDraft.name}
                placeholder={t.plans.fields.namePlaceholder}
                onChange={(e) => patchPlan({ name: e.target.value })}
              />
            </FormGroup>
            <FormGroup>
              <Label>{t.plans.fields.descriptionLabel}</Label>
              <Textarea
                rows={2}
                value={planDraft.description}
                onChange={(e) => patchPlan({ description: e.target.value })}
              />
            </FormGroup>

            <div className="grid gap-3 sm:grid-cols-3">
              <FormGroup>
                <Label required>{t.plans.fields.priceTypeLabel}</Label>
                <Select
                  value={planDraft.priceType}
                  onChange={(e) => patchPlan({ priceType: e.target.value as PriceType })}
                >
                  {(Object.keys(t.plans.priceType) as PriceType[]).map((k) => (
                    <option key={k} value={k}>{t.plans.priceType[k]}</option>
                  ))}
                </Select>
              </FormGroup>
              <FormGroup>
                <Label required>{t.plans.fields.basePriceLabel}</Label>
                <Input
                  type="number" min={0} value={planDraft.basePrice}
                  onChange={(e) => patchPlan({ basePrice: Number(e.target.value) })}
                />
              </FormGroup>
              <FormGroup>
                <Label>{t.plans.fields.childPriceLabel}</Label>
                <Input
                  type="number" min={0}
                  value={planDraft.childPrice ?? ''}
                  onChange={(e) => patchPlan({
                    childPrice: e.target.value === '' ? null : Number(e.target.value),
                  })}
                />
                <FormText>{t.plans.fields.childPriceHelp}</FormText>
              </FormGroup>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <FormGroup>
                <Label required>{t.plans.fields.durationLabel}</Label>
                <Input
                  type="number" min={1} value={planDraft.durationMinutes}
                  onChange={(e) => patchPlan({ durationMinutes: Number(e.target.value) })}
                />
              </FormGroup>
              <FormGroup>
                <Label required>{t.plans.fields.minLabel}</Label>
                <Input
                  type="number" min={1} value={planDraft.minParticipants}
                  onChange={(e) => patchPlan({ minParticipants: Number(e.target.value) })}
                />
              </FormGroup>
              <FormGroup>
                <Label required>{t.plans.fields.maxLabel}</Label>
                <Input
                  type="number" min={1} value={planDraft.maxParticipants}
                  onChange={(e) => patchPlan({ maxParticipants: Number(e.target.value) })}
                />
                <FormText>{t.plans.fields.partyHelp}</FormText>
              </FormGroup>
            </div>

            <FormGroup>
              <Label required>{t.plans.fields.bookingTypeLabel}</Label>
              <Select
                value={planDraft.bookingType}
                onChange={(e) => patchPlan({ bookingType: e.target.value as TripBookingType })}
              >
                {(Object.keys(t.plans.bookingType) as TripBookingType[]).map((k) => (
                  <option key={k} value={k}>{t.plans.bookingType[k]}</option>
                ))}
              </Select>
              <FormText>{t.plans.bookingTypeHint[planDraft.bookingType]}</FormText>
            </FormGroup>

            <div className="grid gap-3 sm:grid-cols-2">
              <FormGroup>
                <Label required>{t.plans.fields.depositLabel}</Label>
                <Select
                  value={planDraft.depositMode}
                  onChange={(e) => patchPlan({
                    depositMode: e.target.value as TripPlan['depositMode'],
                    depositValue: 0,
                  })}
                >
                  {(Object.keys(t.plans.depositMode) as TripPlan['depositMode'][]).map((k) => (
                    <option key={k} value={k}>{t.plans.depositMode[k]}</option>
                  ))}
                </Select>
                <FormText>{t.plans.fields.depositHelp[planDraft.depositMode]}</FormText>
              </FormGroup>
              {planDraft.depositMode === 'DEPOSIT_FIXED'
                || planDraft.depositMode === 'DEPOSIT_PERCENT' ? (
                  <FormGroup>
                    <Label required>
                      {planDraft.depositMode === 'DEPOSIT_FIXED'
                        ? t.plans.fields.depositValueLabel
                        : t.plans.fields.depositPercentLabel}
                    </Label>
                    <Input
                      type="number" min={0}
                      max={planDraft.depositMode === 'DEPOSIT_PERCENT' ? 100 : undefined}
                      value={planDraft.depositValue}
                      onChange={(e) => patchPlan({ depositValue: Number(e.target.value) })}
                    />
                    {planDraft.depositMode === 'DEPOSIT_FIXED'
                      && planDraft.priceType === 'PER_PERSON' ? (
                        <FormText>{t.plans.fields.depositPerPersonNote}</FormText>
                      ) : null}
                  </FormGroup>
                ) : null}
            </div>

            <SwitchField
              label={t.plans.fields.activeLabel}
              checked={planDraft.active}
              onCheckedChange={(v) => patchPlan({ active: v })}
            />

            <div className="rounded-lg border border-neutral-200 p-3">
              <SwitchField
                label={t.plans.fields.yearRoundLabel}
                description={t.plans.fields.yearRoundHelp}
                checked={planDraft.yearRound}
                onCheckedChange={(v) => patchPlan({ yearRound: v })}
              />

              {!planDraft.yearRound ? (
                <div className="mt-3 border-t border-neutral-200 pt-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-dark">{t.seasons.sectionTitle}</span>
                    <Button size="sm" variant="outline" onClick={addSeason}>
                      <ListPlus size={13} />{t.seasons.add}
                    </Button>
                  </div>
                  <p className="mt-1 text-2xs text-muted">{t.seasons.sectionHint}</p>

                  {planDraft.seasons.length === 0 ? (
                    <p className="mt-2 text-xs text-danger">{t.seasons.empty}</p>
                  ) : (
                    <div className="mt-2 flex flex-col gap-2">
                      {planDraft.seasons.map((s) => (
                        <div key={s.id} className="rounded-md border border-neutral-200 bg-neutral-50 p-2">
                          <div className="flex items-start gap-2">
                            <div className="grid flex-1 gap-2 sm:grid-cols-2">
                              <Input
                                value={s.name}
                                placeholder={t.seasons.fields.namePlaceholder}
                                onChange={(e) => patchSeason(s.id, { name: e.target.value })}
                              />
                              <Input
                                type="number" min={0}
                                value={s.priceOverride ?? ''}
                                placeholder={t.seasons.fields.pricePlaceholder}
                                onChange={(e) => patchSeason(s.id, {
                                  priceOverride: e.target.value === '' ? null : Number(e.target.value),
                                })}
                              />
                            </div>
                            <Button
                              variant="ghost" size="sm"
                              aria-label={t.actions.delete} title={t.actions.delete}
                              onClick={() => removeSeason(s.id)}
                            >
                              <Trash2 size={13} className="text-danger" />
                            </Button>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-secondary">
                            <span>{t.seasons.fields.rangeLabel}</span>
                            {([
                              ['startMonth', s.startMonth, 12], ['startDay', s.startDay, 31],
                            ] as const).map(([key, val, max]) => (
                              <Input
                                key={key} type="number" min={1} max={max} value={val}
                                className="w-16"
                                onChange={(e) => patchSeason(s.id, { [key]: Number(e.target.value) })}
                              />
                            ))}
                            <span>～</span>
                            {([
                              ['endMonth', s.endMonth, 12], ['endDay', s.endDay, 31],
                            ] as const).map(([key, val, max]) => (
                              <Input
                                key={key} type="number" min={1} max={max} value={val}
                                className="w-16"
                                onChange={(e) => patchSeason(s.id, { [key]: Number(e.target.value) })}
                              />
                            ))}
                          </div>
                        </div>
                      ))}
                      <p className="text-2xs text-muted">{t.seasons.crossYearNote}</p>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </Modal>

      {/* ================================================== 團次編輯 Modal */}
      <Modal
        open={!!departureDraft}
        onClose={() => setDepartureDraft(null)}
        title={departureDraft?.id ? t.actions.edit : t.departures.create}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDepartureDraft(null)}>{common.cancel}</Button>
            <Button loading={busy} onClick={() => { void saveDeparture(); }}>{common.save}</Button>
          </>
        }
      >
        {departureDraft ? (
          <div className="flex flex-col gap-3">
            <FormGroup>
              <Label required>{t.departures.fields.planLabel}</Label>
              <Select
                value={departureDraft.planId}
                onChange={(e) => setDepartureDraft({ ...departureDraft, planId: e.target.value })}
              >
                {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </FormGroup>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormGroup>
                <Label required>{t.departures.fields.dateLabel}</Label>
                <Input
                  type="date" value={departureDraft.departsOn}
                  onChange={(e) => setDepartureDraft({ ...departureDraft, departsOn: e.target.value })}
                />
              </FormGroup>
              <FormGroup>
                <Label>{t.departures.fields.timeLabel}</Label>
                <Input
                  type="time" value={departureDraft.startTime}
                  onChange={(e) => setDepartureDraft({ ...departureDraft, startTime: e.target.value })}
                />
              </FormGroup>
            </div>
            {departureDraft.status === 'OPEN' ? (
              departureStaff.length === 0 ? (
                <Alert tone="warning">{t.departures.noGuideOnboarding}</Alert>
              ) : departureStaff.length === 1 ? (
                <Alert tone={departureStaff[0].available ? 'info' : 'danger'}>
                  {t.departures.singleGuide(departureStaff[0].staffName)}
                  {!departureStaff[0].available && departureStaff[0].conflicts[0]
                    ? ` ${t.departures.conflict(departureStaff[0].conflicts[0].reason)}` : ''}
                </Alert>
              ) : (
                <>
                  <FormGroup>
                    <Label required>{t.departures.fields.primaryGuideLabel}</Label>
                    <Select
                      value={departureDraft.primaryStaffId ?? ''}
                      onChange={(event) => setDepartureDraft({ ...departureDraft, primaryStaffId: event.target.value || null })}
                    >
                      <option value="">{t.departures.fields.primaryGuideLabel}</option>
                      {departureStaff.map((staff) => (
                        <option key={staff.staffId} value={staff.staffId} disabled={!staff.available}>
                          {staff.staffName} · {staff.available ? t.departures.available : t.departures.busy}
                        </option>
                      ))}
                    </Select>
                  </FormGroup>
                  <FormGroup>
                    <Label>{t.departures.fields.assistantGuidesLabel}</Label>
                    <select
                      multiple className="form-select" value={departureDraft.assistantStaffIds ?? []}
                      onChange={(event) => setDepartureDraft({
                        ...departureDraft,
                        assistantStaffIds: Array.from(event.currentTarget.selectedOptions).map((option) => option.value),
                      })}
                    >
                      {departureStaff.map((staff) => (
                        <option key={staff.staffId} value={staff.staffId}
                          disabled={!staff.available || staff.staffId === departureDraft.primaryStaffId}>
                          {staff.staffName} · {staff.available ? t.departures.available : t.departures.busy}
                        </option>
                      ))}
                    </select>
                  </FormGroup>
                  <div className="flex flex-col gap-1 text-2xs text-secondary">
                    <span>{t.departures.fields.guideAvailabilityLabel}</span>
                    {departureStaff.filter((staff) => !staff.available).map((staff) => (
                      <span key={staff.staffId}>{staff.staffName}：{t.departures.conflict(staff.conflicts[0]?.reason ?? '')}</span>
                    ))}
                  </div>
                </>
              )
            ) : null}
            <FormGroup>
              <Label required>{t.departures.fields.capacityLabel}</Label>
              <Input
                type="number" min={departureDraft.seatsBooked} value={departureDraft.capacity}
                onChange={(e) => setDepartureDraft({ ...departureDraft, capacity: Number(e.target.value) })}
              />
              <FormText>{t.departures.fields.capacityHelp}</FormText>
            </FormGroup>
            <FormGroup>
              <Label>{t.departures.fields.noteLabel}</Label>
              <Input
                value={departureDraft.note}
                placeholder={t.departures.fields.notePlaceholder}
                onChange={(e) => setDepartureDraft({ ...departureDraft, note: e.target.value })}
              />
            </FormGroup>
          </div>
        ) : null}
      </Modal>

      {/* ================================================== 批次開團 Modal */}
      <Modal
        open={batchOpen}
        onClose={() => setBatchOpen(false)}
        title={t.departures.batch.title}
        footer={
          <>
            <Button variant="secondary" onClick={() => setBatchOpen(false)}>{common.cancel}</Button>
            <Button loading={busy} onClick={() => { void runBatch(); }} disabled={batchCount === 0 || batchStaff.length === 0 || batchStaff.every((staff) => !staff.available)}>
              {t.departures.batch.confirm}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <FormGroup>
            <Label required>{t.departures.fields.planLabel}</Label>
            <Select value={batch.planId} onChange={(e) => setBatch({ ...batch, planId: e.target.value })}>
              <option value="">{t.departures.fields.planLabel}</option>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </FormGroup>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormGroup>
              <Label required>{t.departures.batch.fromLabel}</Label>
              <Input type="date" value={batch.from} onChange={(e) => setBatch({ ...batch, from: e.target.value })} />
            </FormGroup>
            <FormGroup>
              <Label required>{t.departures.batch.toLabel}</Label>
              <Input type="date" value={batch.to} onChange={(e) => setBatch({ ...batch, to: e.target.value })} />
            </FormGroup>
          </div>
          {batch.planId && batch.from && batchStaff.length === 0 ? (
            <Alert tone="warning">{t.departures.noGuideOnboarding}</Alert>
          ) : batchStaff.length === 1 ? (
            <Alert tone={batchStaff[0].available ? 'info' : 'danger'}>
              {t.departures.singleGuide(batchStaff[0].staffName)} {!batchStaff[0].available && batchStaff[0].conflicts[0]
                ? t.departures.conflict(batchStaff[0].conflicts[0].reason) : ''}
            </Alert>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <FormGroup>
                <Label required>{t.departures.fields.primaryGuideLabel}</Label>
                <Select value={batch.primaryStaffId ?? ''}
                  onChange={(event) => setBatch({ ...batch, primaryStaffId: event.target.value || null })}>
                  <option value="">{t.departures.fields.primaryGuideLabel}</option>
                  {batchStaff.map((staff) => <option key={staff.staffId} value={staff.staffId} disabled={!staff.available}>
                    {staff.staffName} · {staff.available ? t.departures.available : `${t.departures.busy}（${t.departures.conflict(staff.conflicts[0]?.reason ?? '')}）`}
                  </option>)}
                </Select>
              </FormGroup>
              <FormGroup>
                <Label>{t.departures.fields.assistantGuidesLabel}</Label>
                <select multiple className="form-select" value={batch.assistantStaffIds}
                  onChange={(event) => setBatch({
                    ...batch, assistantStaffIds: Array.from(event.currentTarget.selectedOptions).map((option) => option.value),
                  })}>
                  {batchStaff.map((staff) => <option key={staff.staffId} value={staff.staffId}
                    disabled={!staff.available || staff.staffId === batch.primaryStaffId}>
                    {staff.staffName} · {staff.available ? t.departures.available : `${t.departures.busy}（${t.departures.conflict(staff.conflicts[0]?.reason ?? '')}）`}
                  </option>)}
                </select>
              </FormGroup>
            </div>
          )}
          {batchStaff.filter((staff) => !staff.available).length > 0 ? (
            <div className="flex flex-col gap-1 text-2xs text-secondary">
              {batchStaff.filter((staff) => !staff.available).map((staff) => (
                <span key={staff.staffId}>{staff.staffName}：{t.departures.conflict(staff.conflicts[0]?.reason ?? '')}</span>
              ))}
            </div>
          ) : null}
          <FormGroup>
            <Label>{t.departures.batch.weekdaysLabel}</Label>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((d) => {
                const on = batch.weekdays.includes(d);
                return (
                  <Button
                    key={d}
                    size="sm"
                    variant={on ? 'primary' : 'outline'}
                    onClick={() => setBatch({
                      ...batch,
                      weekdays: on ? batch.weekdays.filter((x) => x !== d) : [...batch.weekdays, d],
                    })}
                  >
                    {common.weekdays[d]}
                  </Button>
                );
              })}
            </div>
            <FormText>{t.departures.batch.weekdaysHelp}</FormText>
          </FormGroup>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormGroup>
              <Label>{t.departures.fields.timeLabel}</Label>
              <Input type="time" value={batch.startTime} onChange={(e) => setBatch({ ...batch, startTime: e.target.value })} />
            </FormGroup>
            <FormGroup>
              <Label required>{t.departures.fields.capacityLabel}</Label>
              <Input
                type="number" min={1} value={batch.capacity}
                onChange={(e) => setBatch({ ...batch, capacity: Number(e.target.value) })}
              />
            </FormGroup>
          </div>
          <Alert tone="info">{t.departures.batch.preview(batchCount)}</Alert>
          {batchConflicts.length > 0 ? (
            <Alert tone="danger">
              {batchConflicts.map((conflict) => (
                <div key={`${conflict.date}-${conflict.staffId}`}>{conflict.date}：{conflict.reason}</div>
              ))}
            </Alert>
          ) : null}
        </div>
      </Modal>

      {/* ================================================== 加購編輯 Modal */}
      <Modal
        open={!!addonDraft}
        onClose={() => setAddonDraft(null)}
        title={addonDraft?.id ? t.actions.edit : t.addons.create}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAddonDraft(null)}>{common.cancel}</Button>
            <Button loading={busy} onClick={() => { void saveAddon(); }}>{common.save}</Button>
          </>
        }
      >
        {addonDraft ? (
          <div className="flex flex-col gap-3">
            <FormGroup>
              <Label required>{t.addons.fields.nameLabel}</Label>
              <Input
                value={addonDraft.name}
                placeholder={t.addons.fields.namePlaceholder}
                onChange={(e) => setAddonDraft({ ...addonDraft, name: e.target.value })}
              />
            </FormGroup>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormGroup>
                <Label required>{t.addons.fields.priceLabel}</Label>
                <Input
                  type="number" min={0} value={addonDraft.price}
                  onChange={(e) => setAddonDraft({ ...addonDraft, price: Number(e.target.value) })}
                />
              </FormGroup>
              <FormGroup>
                <Label required>{t.addons.fields.unitLabel}</Label>
                <Select
                  value={addonDraft.unit}
                  onChange={(e) => setAddonDraft({ ...addonDraft, unit: e.target.value as PriceType })}
                >
                  {(Object.keys(t.plans.priceType) as PriceType[]).map((k) => (
                    <option key={k} value={k}>{t.plans.priceType[k]}</option>
                  ))}
                </Select>
              </FormGroup>
            </div>
            <FormGroup>
              <Label>{t.addons.fields.stockLabel}</Label>
              <Input
                type="number" min={0}
                value={addonDraft.stock ?? ''}
                onChange={(e) => setAddonDraft({
                  ...addonDraft,
                  stock: e.target.value === '' ? null : Number(e.target.value),
                })}
              />
              <FormText>{t.addons.fields.stockHelp}</FormText>
            </FormGroup>
            <div className="flex items-center gap-2">
              <Switch
                checked={addonDraft.active}
                onCheckedChange={(v) => setAddonDraft({ ...addonDraft, active: v })}
              />
              <span className="text-sm">{t.addons.fields.activeLabel}</span>
            </div>
          </div>
        ) : null}
      </Modal>

      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        loading={busy}
        onConfirm={() => { void doDelete(); }}
        title={t.confirm.deleteTitle}
        message={
          deleteTarget?.kind === 'plan' ? t.confirm.deletePlan(deleteTarget.name)
            : deleteTarget?.kind === 'addon' ? t.confirm.deleteAddon(deleteTarget.name)
              : common.confirm.message
        }
        confirmText={t.actions.delete}
        danger
      />
    </>
  );
}
