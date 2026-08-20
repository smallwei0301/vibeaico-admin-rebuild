'use client';
import * as React from 'react';
import {
  ChevronDown, ChevronUp, Hospital, ListOrdered, Pencil, Plus, SlidersHorizontal,
  Trash2, UserPlus,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { Card, CardBody } from '@/components/ui/Card';
import {
  DataTable, DataTableContainer, DataTableHeader, type Column,
} from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmModal, Modal } from '@/components/ui/Modal';
import {
  FormError, FormGroup, FormText, Input, Label, Select,
} from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { listServices } from '@/services/catalog';
import { common } from '@/i18n/zh-TW/common';
import { nav } from '@/i18n/zh-TW/nav';
import { clinicQueuePage as t } from '@/i18n/zh-TW/pages/clinic-queue';
import { formatDate, formatNumber } from '@/lib/utils';
import type { Service } from '@/lib/types';

/* -------------------------------------------------------------------------- */
/* 本頁專用假資料（不寫進 src/mock，避免與其他頁面衝突）                          */
/* -------------------------------------------------------------------------- */

/** 原站以 Service.queueModeEnabled 標記號碼掛號服務；骨架階段用白名單模擬 */
const QUEUE_SERVICE_IDS = new Set<string>([]);

/** 原站 /api/clinic-queue/sessions */
type QueueSession = {
  id: string;
  serviceId: string;
  name: string;
  totalNumbers: number;
  walkInReserveCount: number;
  oddEvenEnabled: boolean;
  displayStart: string;
  displayEnd: string;
  avgMinutes: number | null;
};

const MOCK_SESSIONS: QueueSession[] = [
  { id: 'qs_1', serviceId: 'svq_1', name: '早診', totalNumbers: 30, walkInReserveCount: 5, oddEvenEnabled: false, displayStart: '09:00', displayEnd: '12:00', avgMinutes: 5 },
  { id: 'qs_2', serviceId: 'svq_1', name: '午診', totalNumbers: 24, walkInReserveCount: 4, oddEvenEnabled: true, displayStart: '14:00', displayEnd: '17:00', avgMinutes: null },
  { id: 'qs_3', serviceId: 'svq_1', name: '晚診', totalNumbers: 20, walkInReserveCount: 3, oddEvenEnabled: false, displayStart: '', displayEnd: '', avgMinutes: null },
];

/** 骨架階段的示範看診項目（原站是 queueModeEnabled 的 Service） */
const MOCK_QUEUE_SERVICES: Service[] = [
  {
    id: 'svq_1', categoryId: null, categoryName: null, name: '看診', description: '',
    durationMinutes: 0, price: 0, imageUrl: '', active: true, lineFeatured: false, sortOrder: 1,
  },
];

/** 原站 /api/clinic-queue/sessions/${sid}/day-board 的掛號名單 */
type QueueEntry = {
  bookingId: string;
  queueNumber: number;
  customerName: string;
  customerPhone: string;
  channel: 'ONLINE' | 'WALK_IN';
  status: 'WAITING' | 'DONE' | 'CANCELLED' | 'NO_SHOW';
  /** 有 LINE／Email 才能自動通知 */
  notifiable: boolean;
};

const MOCK_ROSTER: Record<string, QueueEntry[]> = {
  qs_1: [
    { bookingId: 'q_1', queueNumber: 1, customerName: '王小明', customerPhone: '0912-000-111', channel: 'WALK_IN', status: 'DONE', notifiable: true },
    { bookingId: 'q_2', queueNumber: 2, customerName: '李美華', customerPhone: '0922-333-444', channel: 'WALK_IN', status: 'WAITING', notifiable: true },
    { bookingId: 'q_3', queueNumber: 6, customerName: '張大偉', customerPhone: '', channel: 'ONLINE', status: 'WAITING', notifiable: false },
    { bookingId: 'q_4', queueNumber: 7, customerName: '', customerPhone: '0933-555-666', channel: 'ONLINE', status: 'CANCELLED', notifiable: true },
  ],
  qs_2: [
    { bookingId: 'q_5', queueNumber: 2, customerName: '陳雅婷', customerPhone: '0955-777-888', channel: 'ONLINE', status: 'WAITING', notifiable: true },
  ],
  qs_3: [],
};

/** 當日鎖號／休診設定：key = `${sessionId}|${yyyy-MM-dd}` */
type DayOverride = {
  closed: boolean;
  totalNumbers: number | null;
  lockedNumbers: number[];
  reason: string;
};

const MOCK_OVERRIDES: Record<string, DayOverride> = {
  'qs_1|2026-08-20': { closed: false, totalNumbers: null, lockedNumbers: [6, 10], reason: '' },
};

const NUMBER_RANGE_MAX = 99;

const toKey = (sessionId: string, date: string) => `${sessionId}|${date}`;
const toIsoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/* -------------------------------------------------------------------------- */

export default function ClinicQueuePage() {
  const toast = useToast();

  const [services, setServices] = React.useState<Service[]>([]);
  const [serviceId, setServiceId] = React.useState('');
  const [servicesLoading, setServicesLoading] = React.useState(true);

  const [sessions, setSessions] = React.useState<QueueSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = React.useState(true);

  const [boardSessionId, setBoardSessionId] = React.useState('');
  const [boardDate, setBoardDate] = React.useState('');
  const [roster, setRoster] = React.useState<QueueEntry[]>([]);
  const [rosterLoading, setRosterLoading] = React.useState(false);
  const [overrides, setOverrides] = React.useState<Record<string, DayOverride>>(MOCK_OVERRIDES);

  const [guideOpen, setGuideOpen] = React.useState(true);
  const [serviceModalOpen, setServiceModalOpen] = React.useState(false);
  const [sessionTarget, setSessionTarget] = React.useState<QueueSession | null | undefined>(undefined);
  const [registerOpen, setRegisterOpen] = React.useState(false);
  const [lockOpen, setLockOpen] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<QueueSession | null>(null);
  const [cancelTarget, setCancelTarget] = React.useState<QueueEntry | null>(null);
  const [completeTarget, setCompleteTarget] = React.useState<QueueEntry | null>(null);

  const nextId = React.useRef(1);
  const nextNumber = React.useRef(0);

  /** render 期不可用 Date.now()；今日日期在 effect 內初始化 */
  React.useEffect(() => { setBoardDate(toIsoDate(new Date())); }, []);

  React.useEffect(() => {
    void (async () => {
      setServicesLoading(true);
      try {
        const list = await listServices();
        const queueOnly = list.filter((s) => QUEUE_SERVICE_IDS.has(s.id));
        const merged = [...queueOnly, ...MOCK_QUEUE_SERVICES];
        setServices(merged);
        setServiceId(merged[0]?.id ?? '');
      } catch {
        toast.show(t.serviceSection.selectLoadFailed, 'danger');
        setServices([]);
      } finally {
        setServicesLoading(false);
      }
    })();
  }, [toast]);

  React.useEffect(() => {
    if (!serviceId) {
      setSessions([]);
      setSessionsLoading(false);
      return;
    }
    setSessionsLoading(true);
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      const list = MOCK_SESSIONS.filter((s) => s.serviceId === serviceId);
      setSessions(list);
      setBoardSessionId((prev) => (list.some((s) => s.id === prev) ? prev : list[0]?.id ?? ''));
      setSessionsLoading(false);
    }, 320);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [serviceId]);

  React.useEffect(() => {
    if (!boardSessionId || !boardDate) {
      setRoster([]);
      return;
    }
    setRosterLoading(true);
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      setRoster(MOCK_ROSTER[boardSessionId] ?? []);
      setRosterLoading(false);
    }, 320);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [boardSessionId, boardDate]);

  const session = sessions.find((s) => s.id === boardSessionId) ?? null;
  const override = session ? overrides[toKey(session.id, boardDate)] : undefined;
  const effectiveTotal = override?.totalNumbers ?? session?.totalNumbers ?? 0;

  const upsertSession = (draft: QueueSession) => {
    setSessions((list) => (list.some((s) => s.id === draft.id)
      ? list.map((s) => (s.id === draft.id ? draft : s))
      : [...list, draft]));
  };

  /* --------------------------------------------------------- 看板號碼狀態 */

  const takenNumbers = new Set(
    roster.filter((r) => r.status === 'WAITING' || r.status === 'DONE').map((r) => r.queueNumber),
  );

  const numberState = (n: number): keyof typeof t.board.numberStates => {
    if (override?.closed) return 'disabled';
    if (takenNumbers.has(n)) return 'taken';
    if (override?.lockedNumbers.includes(n)) return 'locked';
    if (session && n <= session.walkInReserveCount) return 'reserved';
    return 'available';
  };

  const numberTone = (state: keyof typeof t.board.numberStates) => ({
    available: 'success',
    taken: 'primary',
    locked: 'danger',
    reserved: 'warning',
    disabled: 'neutral',
  } as const)[state];

  /* ---------------------------------------------------------- 診次表格欄位 */

  const sessionColumns: Column<QueueSession>[] = [
    { key: 'name', header: t.sessionSection.columns.name, render: (s) => s.name },
    {
      key: 'total', header: t.sessionSection.columns.total, numeric: true, width: '100px',
      render: (s) => formatNumber(s.totalNumbers),
    },
    {
      key: 'reserve', header: t.sessionSection.columns.reserve, numeric: true, width: '100px',
      render: (s) => formatNumber(s.walkInReserveCount),
    },
    {
      key: 'oddEven', header: t.sessionSection.columns.oddEven, width: '100px',
      render: (s) => (s.oddEvenEnabled
        ? <Badge tone="success">{t.sessionSection.on}</Badge>
        : <Badge tone="neutral">{t.sessionSection.off}</Badge>),
    },
    {
      key: 'time', header: t.sessionSection.columns.time, width: '140px',
      render: (s) => (s.displayStart && s.displayEnd
        ? `${s.displayStart}–${s.displayEnd}`
        : <span className="text-muted">{t.sessionSection.none}</span>),
    },
    {
      key: 'actions', header: t.sessionSection.columns.actions, width: '110px',
      render: (s) => (
        <div className="btn-group">
          <Button
            variant="outline" size="sm" title={common.edit} aria-label={common.edit}
            onClick={() => setSessionTarget(s)}
          >
            <Pencil size={13} />
          </Button>
          <Button
            variant="outlineDanger" size="sm" title={common.delete} aria-label={common.delete}
            onClick={() => setDeleteTarget(s)}
          >
            <Trash2 size={13} />
          </Button>
        </div>
      ),
    },
  ];

  /* ------------------------------------------------------ 掛號名單欄位 */

  const rosterColumns: Column<QueueEntry>[] = [
    {
      key: 'number', header: t.board.columns.number, numeric: true, width: '80px',
      render: (r) => formatNumber(r.queueNumber),
    },
    {
      key: 'patient', header: t.board.columns.patient,
      render: (r) => (
        <div className="flex items-center gap-1.5">
          <span>{r.customerName || t.board.unnamed}</span>
          <Badge tone={r.channel === 'ONLINE' ? 'info' : 'neutral'}>
            {r.channel === 'ONLINE' ? t.board.channelOnline : t.board.channelWalkIn}
          </Badge>
        </div>
      ),
    },
    {
      key: 'phone', header: t.board.columns.phone, width: '150px',
      render: (r) => r.customerPhone || <span className="text-muted">{common.none}</span>,
    },
    {
      key: 'status', header: t.board.columns.status, width: '110px',
      render: (r) => {
        if (r.status === 'DONE') return <Badge tone="success">{t.board.statusDone}</Badge>;
        if (r.status === 'CANCELLED') return <Badge tone="neutral">{t.board.statusCancelled}</Badge>;
        if (r.status === 'NO_SHOW') return <Badge tone="danger">{t.board.statusNoShow}</Badge>;
        return <Badge tone="warning">{t.board.statusWaiting}</Badge>;
      },
    },
    {
      key: 'actions', header: t.board.columns.actions, width: '160px',
      render: (r) => (r.status === 'WAITING' ? (
        <div className="btn-group">
          <Button variant="outline" size="sm" onClick={() => setCompleteTarget(r)}>
            {t.board.completeShort}
          </Button>
          <Button variant="outlineDanger" size="sm" onClick={() => setCancelTarget(r)}>
            {t.board.cancel}
          </Button>
        </div>
      ) : null),
    },
  ];

  const hasService = services.length > 0;

  return (
    <>
      <PageHeader
        eyebrow={nav.navOperation}
        title={t.title}
        actions={
          <Button onClick={() => setServiceModalOpen(true)}>
            <Plus size={15} />{t.serviceSection.create}
          </Button>
        }
      />

      {/* ------------------------------------------------------- 使用步驟卡 */}
      <Card className="mb-3">
        <CardBody>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-base font-bold text-dark">
              <Hospital size={15} />{t.guide.title}
            </div>
            <Button
              variant="ghost" size="sm" aria-expanded={guideOpen} aria-label={t.guide.title}
              onClick={() => setGuideOpen((v) => !v)}
            >
              {guideOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </Button>
          </div>
          {guideOpen ? (
            <div className="mt-2 flex flex-col gap-1 text-xs text-neutral-700">
              <p>{t.guide.steps}</p>
              <p className="font-semibold">{t.guide.allInPage}</p>
              <p>
                {t.guide.alsoInServicesLead}
                <strong>{t.guide.lineSelfServiceStrong}</strong>
                {t.guide.lineSelfServiceTail}
              </p>
            </div>
          ) : null}
        </CardBody>
      </Card>

      {/* --------------------------------------------------- 先建立看診項目 */}
      <Card className="mb-3">
        <CardBody>
          <h6 className="mb-1 mt-2 text-base font-bold text-dark">{t.serviceSection.heading}</h6>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[14rem]">
              <Label htmlFor="serviceSelect">{t.serviceSection.selectLabel}</Label>
              <Select
                id="serviceSelect" value={serviceId}
                disabled={servicesLoading || !hasService}
                onChange={(e) => setServiceId(e.target.value)}
              >
                {servicesLoading ? (
                  <option value="">{t.serviceSection.selectLoading}</option>
                ) : !hasService ? (
                  <option value="">{t.serviceSection.selectEmpty}</option>
                ) : (
                  services.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))
                )}
              </Select>
            </div>
            <Button size="sm" variant="outline" onClick={() => setServiceModalOpen(true)}>
              <Plus size={13} />{t.serviceSection.create}
            </Button>
          </div>
        </CardBody>
      </Card>

      {!servicesLoading && !hasService ? (
        <EmptyState
          icon={Hospital}
          title={t.empty.serviceTitle}
          description={t.empty.serviceDescription}
          action={
            <Button onClick={() => setServiceModalOpen(true)}>
              <Plus size={15} />{t.serviceSection.create}
            </Button>
          }
        />
      ) : (
        <>
          {/* ------------------------------------------------------ 診次設定 */}
          <DataTableContainer className="mb-3">
            <DataTableHeader
              title={t.sessionSection.title}
              actions={
                <Button size="sm" onClick={() => setSessionTarget(null)}>
                  <Plus size={13} />{t.sessionSection.create}
                </Button>
              }
            />
            <DataTable
              columns={sessionColumns}
              rows={sessions}
              loading={sessionsLoading}
              rowKey={(s) => s.id}
              empty={
                <EmptyState
                  icon={ListOrdered}
                  title={t.empty.sessionTitle}
                  description={t.empty.sessionDescription}
                  action={
                    <Button onClick={() => setSessionTarget(null)}>
                      <Plus size={15} />{t.sessionSection.create}
                    </Button>
                  }
                />
              }
            />
          </DataTableContainer>

          {/* ------------------------------------------------------ 逐號看板 */}
          <DataTableContainer>
            <DataTableHeader
              title={t.board.title}
              actions={
                <>
                  <Select
                    className="form-select-sm w-auto"
                    aria-label={t.board.sessionLabel}
                    value={boardSessionId}
                    disabled={sessions.length === 0}
                    onChange={(e) => setBoardSessionId(e.target.value)}
                  >
                    {sessions.length === 0 ? (
                      <option value="">{t.board.sessionPlaceholder}</option>
                    ) : (
                      sessions.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))
                    )}
                  </Select>
                  <Input
                    type="date" className="form-control-sm w-auto"
                    aria-label={t.board.dateLabel}
                    value={boardDate}
                    onChange={(e) => setBoardDate(e.target.value)}
                  />
                  <Button
                    variant="success" size="sm" disabled={!session}
                    onClick={() => setRegisterOpen(true)}
                  >
                    <UserPlus size={13} />{t.board.register}
                  </Button>
                  <Button
                    variant="outline" size="sm" disabled={!session}
                    onClick={() => setLockOpen(true)}
                  >
                    <SlidersHorizontal size={13} />{t.board.daySettings}
                  </Button>
                </>
              }
            />

            <div className="border-b border-neutral-250 px-4 py-3">
              {!session || !boardDate ? (
                <div className="py-6 text-center text-muted">{t.board.pickFirst}</div>
              ) : rosterLoading ? (
                <div className="py-6 text-center text-muted">{t.board.loading}</div>
              ) : (
                <>
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-neutral-700">
                    <span>{t.lockModal.context(session.name, formatDate(boardDate))}</span>
                    <span>{t.board.summaryTotal(session.totalNumbers)}</span>
                    {override?.totalNumbers ? (
                      <span>{t.board.summaryEffectiveTotal(override.totalNumbers)}</span>
                    ) : null}
                    <span>{t.board.summaryReserve(session.walkInReserveCount)}</span>
                    <span>{t.board.summaryOddEven(session.oddEvenEnabled)}</span>
                    {override?.closed ? <Badge tone="danger">{t.board.closed}</Badge> : null}
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {Array.from({ length: effectiveTotal }, (_, i) => i + 1).map((n) => {
                      const state = numberState(n);
                      return (
                        <span key={n} className={`badge badge-${numberTone(state)} tabular-nums`}>
                          {formatNumber(n)}
                        </span>
                      );
                    })}
                  </div>

                  <div className="mt-2 flex flex-wrap gap-2 text-2xs text-secondary">
                    {(Object.keys(t.board.numberStates) as (keyof typeof t.board.numberStates)[])
                      .map((k) => (
                        <span key={k} className="flex items-center gap-1">
                          <span className={`badge badge-${numberTone(k)}`}>{' '}</span>
                          {t.board.numberStates[k]}
                        </span>
                      ))}
                  </div>
                </>
              )}
            </div>

            <div className="px-4 pt-3">
              <h6 className="mb-2 text-base font-bold text-dark">
                {t.board.rosterTitle}
                <span className="ml-1 text-xs font-normal text-secondary">{t.board.rosterHint}</span>
              </h6>
            </div>

            <DataTable
              columns={rosterColumns}
              rows={roster}
              loading={rosterLoading}
              rowKey={(r) => r.bookingId}
              empty={
                <EmptyState
                  icon={ListOrdered}
                  title={t.empty.rosterTitle}
                  description={t.empty.rosterDescription}
                />
              }
            />
          </DataTableContainer>
        </>
      )}

      {/* -------------------------------------------- modal 1：建立看診項目 */}
      <QueueServiceModal
        open={serviceModalOpen}
        onClose={() => setServiceModalOpen(false)}
        onCreated={(name) => {
          const id = `svq_new_${nextId.current++}`;
          setServices((list) => [...list, {
            id, categoryId: null, categoryName: null, name, description: '',
            durationMinutes: 0, price: 0, imageUrl: '', active: true,
            lineFeatured: false, sortOrder: list.length + 1,
          }]);
          setServiceId(id);
          setServiceModalOpen(false);
          toast.show(t.serviceModal.created(name));
        }}
      />

      {/* ------------------------------------------- modal 2：新增/編輯診次 */}
      <SessionModal
        open={sessionTarget !== undefined}
        session={sessionTarget ?? null}
        onClose={() => setSessionTarget(undefined)}
        onSaved={(draft) => {
          const id = draft.id || `qs_new_${nextId.current++}`;
          upsertSession({ ...draft, id, serviceId });
          if (!boardSessionId) setBoardSessionId(id);
          setSessionTarget(undefined);
          toast.show(t.messages.saved);
        }}
      />

      {/* ---------------------------------------------------- modal 3：代客掛號 */}
      <RegisterModal
        open={registerOpen}
        session={session}
        date={boardDate}
        onClose={() => setRegisterOpen(false)}
        onRegistered={(entry) => {
          setRoster((list) => [...list, entry]);
          setRegisterOpen(false);
          toast.show(t.registerModal.successNumber(entry.queueNumber));
        }}
        nextNumber={() => {
          if (!session) return 1;
          const used = new Set(roster.map((r) => r.queueNumber));
          for (let n = 1; n <= effectiveTotal; n++) {
            if (!used.has(n) && !(override?.lockedNumbers ?? []).includes(n)) return n;
          }
          nextNumber.current += 1;
          return effectiveTotal + nextNumber.current;
        }}
      />

      {/* ------------------------------------ modal 4：當日設定 / 鎖號 / 休診 */}
      <LockModal
        open={lockOpen}
        session={session}
        date={boardDate}
        value={override}
        affected={roster.filter((r) => r.status === 'WAITING').length}
        onClose={() => setLockOpen(false)}
        onApply={(next, cancelled) => {
          if (!session) return;
          setOverrides((map) => ({ ...map, [toKey(session.id, boardDate)]: next }));
          setLockOpen(false);
          toast.show(cancelled > 0 ? t.lockModal.appliedWithCancel(cancelled) : t.lockModal.applied);
        }}
        onRestore={() => {
          if (!session) return;
          setOverrides((map) => {
            const copy = { ...map };
            delete copy[toKey(session.id, boardDate)];
            return copy;
          });
          setLockOpen(false);
          toast.show(t.lockModal.restored);
        }}
      />

      {/* ------------------------------------------------ modal 5：刪除診次 */}
      <ConfirmModal
        open={!!deleteTarget}
        danger
        title={common.delete}
        confirmText={common.delete}
        message={t.sessionSection.deleteConfirm}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) setSessions((list) => list.filter((s) => s.id !== deleteTarget.id));
          setDeleteTarget(null);
          toast.show(t.messages.deleted);
        }}
      />

      {/* ------------------------------------------------ modal 6：取消掛號 */}
      <ConfirmModal
        open={!!cancelTarget}
        danger
        title={t.board.cancel}
        confirmText={t.board.cancel}
        message={cancelTarget
          ? t.cancel.confirm(
            cancelTarget.queueNumber,
            cancelTarget.notifiable ? t.cancel.notifyOk : t.cancel.notifyNone,
          )
          : common.confirm.message}
        onClose={() => setCancelTarget(null)}
        onConfirm={() => {
          if (cancelTarget) {
            setRoster((list) => list.map((r) => (r.bookingId === cancelTarget.bookingId
              ? { ...r, status: 'CANCELLED' as const }
              : r)));
            toast.show(cancelTarget.notifiable
              ? t.cancel.successNotified(cancelTarget.queueNumber)
              : t.cancel.successManual(cancelTarget.queueNumber));
          }
          setCancelTarget(null);
        }}
      />

      {/* ------------------------------------------------ modal 7：完成看診 */}
      <ConfirmModal
        open={!!completeTarget}
        title={t.board.complete}
        confirmText={t.board.complete}
        message={completeTarget ? t.complete.confirm(completeTarget.queueNumber) : common.confirm.message}
        onClose={() => setCompleteTarget(null)}
        onConfirm={() => {
          if (completeTarget) {
            setRoster((list) => list.map((r) => (r.bookingId === completeTarget.bookingId
              ? { ...r, status: 'DONE' as const }
              : r)));
            toast.show(t.complete.success(completeTarget.queueNumber));
          }
          setCompleteTarget(null);
        }}
      />
    </>
  );
}

/* ========================================================================== */
/* 建立看診項目                                                                */
/* ========================================================================== */

function QueueServiceModal({
  open, onClose, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (name: string) => void;
}) {
  const toast = useToast();
  const [name, setName] = React.useState<string>(t.serviceModal.nameDefault);
  const [error, setError] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setName(t.serviceModal.nameDefault);
    setError('');
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t.serviceModal.title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{common.cancel}</Button>
          <Button
            loading={saving} loadingText={common.processing}
            onClick={async () => {
              if (!name.trim()) { setError(t.serviceModal.nameRequired); return; }
              setError('');
              setSaving(true);
              try {
                await new Promise((r) => setTimeout(r, 380));
                onCreated(name.trim());
              } catch (e) {
                toast.show(
                  `${t.serviceModal.createFailedPrefix}${e instanceof Error ? e.message : t.messages.unknownError}`,
                  'danger',
                );
              } finally {
                setSaving(false);
              }
            }}
          >
            {t.serviceModal.submit}
          </Button>
        </>
      }
    >
      <FormGroup>
        <Label required htmlFor="qsName">{t.serviceModal.name}</Label>
        <Input
          id="qsName" value={name} placeholder={t.serviceModal.namePlaceholder}
          onChange={(e) => setName(e.target.value)}
        />
        <FormText>{t.serviceModal.help}</FormText>
      </FormGroup>
      {error ? <FormError>{error}</FormError> : null}
    </Modal>
  );
}

/* ========================================================================== */
/* 新增 / 編輯診次                                                             */
/* ========================================================================== */

const EMPTY_SESSION: QueueSession = {
  id: '', serviceId: '', name: '', totalNumbers: 30, walkInReserveCount: 5,
  oddEvenEnabled: false, displayStart: '', displayEnd: '', avgMinutes: null,
};

function SessionModal({
  open, session, onClose, onSaved,
}: {
  open: boolean;
  session: QueueSession | null;
  onClose: () => void;
  onSaved: (draft: QueueSession) => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = React.useState<QueueSession>(EMPTY_SESSION);
  const [error, setError] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setError('');
    setDraft(session ?? EMPTY_SESSION);
  }, [open, session]);

  const patch = (p: Partial<QueueSession>) => setDraft((d) => ({ ...d, ...p }));

  const validate = (): string => {
    if (!draft.name.trim()) return t.sessionModal.nameRequired;
    if (draft.totalNumbers < 1 || draft.totalNumbers > NUMBER_RANGE_MAX) {
      return t.sessionModal.totalRange;
    }
    if (draft.walkInReserveCount >= draft.totalNumbers) return t.sessionModal.reserveLessThanTotal;
    return '';
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={session ? t.sessionModal.editTitle : t.sessionModal.createTitle}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{common.cancel}</Button>
          <Button
            loading={saving} loadingText={common.saving}
            onClick={async () => {
              const err = validate();
              setError(err);
              if (err) return;
              setSaving(true);
              try {
                await new Promise((r) => setTimeout(r, 380));
                onSaved(draft);
              } catch (e) {
                toast.show(
                  `${t.messages.saveFailedPrefix}${e instanceof Error ? e.message : t.messages.unknownError}`,
                  'danger',
                );
              } finally {
                setSaving(false);
              }
            }}
          >
            {common.save}
          </Button>
        </>
      }
    >
      <div className="grid gap-x-4 md:grid-cols-2">
        <FormGroup>
          <Label required htmlFor="sessionName">{t.sessionModal.name}</Label>
          <Input
            id="sessionName" value={draft.name} placeholder={t.sessionModal.namePlaceholder}
            onChange={(e) => patch({ name: e.target.value })}
          />
        </FormGroup>

        <FormGroup>
          <Label required htmlFor="sessionTotal">{t.sessionModal.total}</Label>
          <Input
            id="sessionTotal" type="number" min={1} max={NUMBER_RANGE_MAX}
            value={String(draft.totalNumbers)}
            onChange={(e) => patch({ totalNumbers: Number(e.target.value) || 0 })}
          />
        </FormGroup>

        <FormGroup>
          <Label htmlFor="sessionReserve">{t.sessionModal.reserve}</Label>
          <Input
            id="sessionReserve" type="number" min={0}
            value={String(draft.walkInReserveCount)}
            onChange={(e) => patch({ walkInReserveCount: Number(e.target.value) || 0 })}
          />
          <FormText>{t.sessionModal.reserveHelp}</FormText>
        </FormGroup>
      </div>

      <label className="mb-3 flex items-center gap-2 text-base">
        <input
          type="checkbox" checked={draft.oddEvenEnabled}
          onChange={(e) => patch({ oddEvenEnabled: e.target.checked })}
        />
        {t.sessionModal.oddEven}
      </label>

      <div className="grid gap-x-4 md:grid-cols-2">
        <FormGroup>
          <Label htmlFor="sessionStart">{t.sessionModal.displayStart}</Label>
          <Input
            id="sessionStart" type="time" value={draft.displayStart}
            onChange={(e) => patch({ displayStart: e.target.value })}
          />
        </FormGroup>
        <FormGroup>
          <Label htmlFor="sessionEnd">{t.sessionModal.displayEnd}</Label>
          <Input
            id="sessionEnd" type="time" value={draft.displayEnd}
            onChange={(e) => patch({ displayEnd: e.target.value })}
          />
        </FormGroup>
      </div>

      <FormGroup>
        <Label htmlFor="sessionAvg">{t.sessionModal.avgMinutes}</Label>
        <Input
          id="sessionAvg" type="number" min={0}
          placeholder={t.sessionModal.avgMinutesPlaceholder}
          value={draft.avgMinutes === null ? '' : String(draft.avgMinutes)}
          onChange={(e) => patch({ avgMinutes: e.target.value === '' ? null : Number(e.target.value) })}
        />
        <FormText>{t.sessionModal.avgMinutesHelp}</FormText>
      </FormGroup>

      {error ? <FormError>{error}</FormError> : null}
    </Modal>
  );
}

/* ========================================================================== */
/* 代客掛號                                                                    */
/* ========================================================================== */

function RegisterModal({
  open, session, date, onClose, onRegistered, nextNumber,
}: {
  open: boolean;
  session: QueueSession | null;
  date: string;
  onClose: () => void;
  onRegistered: (entry: QueueEntry) => void;
  nextNumber: () => number;
}) {
  const toast = useToast();
  const [channel, setChannel] = React.useState<'ONLINE' | 'WALK_IN'>('ONLINE');
  const [phone, setPhone] = React.useState('');
  const [name, setName] = React.useState('');
  const [error, setError] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const seq = React.useRef(1);

  React.useEffect(() => {
    if (!open) return;
    setChannel('ONLINE');
    setPhone('');
    setName('');
    setError('');
  }, [open]);

  const channelHint = channel === 'ONLINE'
    ? (session?.oddEvenEnabled ? t.registerModal.channelOnlineHintOddEven : t.registerModal.channelOnlineHint)
    : (session?.oddEvenEnabled ? t.registerModal.channelWalkInHintOddEven : t.registerModal.channelWalkInHint);

  const submit = async () => {
    if (!session || !date) { setError(t.registerModal.pickSessionFirst); return; }
    if (!phone.trim() && !name.trim()) { setError(t.registerModal.requireNameOrPhone); return; }
    setError('');
    setSaving(true);
    try {
      await new Promise((r) => setTimeout(r, 420));
      onRegistered({
        bookingId: `q_new_${seq.current++}`,
        queueNumber: nextNumber(),
        customerName: name.trim(),
        customerPhone: phone.trim(),
        channel,
        status: 'WAITING',
        notifiable: !!phone.trim(),
      });
    } catch (e) {
      toast.show(
        `${t.registerModal.failedPrefix}${e instanceof Error ? e.message : t.messages.unknownError}`,
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
      title={t.registerModal.title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{common.cancel}</Button>
          <Button
            variant="success" loading={saving} loadingText={common.processing}
            onClick={() => void submit()}
          >
            {channel === 'ONLINE' ? t.registerModal.submitOnline : t.registerModal.submitWalkIn}
          </Button>
        </>
      }
    >
      <p className="form-text mb-3">
        {session && date ? t.registerModal.context(session.name, formatDate(date)) : t.registerModal.pickSessionFirst}
      </p>

      <FormGroup>
        <Label>{t.registerModal.channelLabel}</Label>
        <div className="btn-group">
          <Button
            size="sm" variant={channel === 'ONLINE' ? 'primary' : 'outline'}
            onClick={() => setChannel('ONLINE')}
          >
            {t.registerModal.channelOnline}
          </Button>
          <Button
            size="sm" variant={channel === 'WALK_IN' ? 'primary' : 'outline'}
            onClick={() => setChannel('WALK_IN')}
          >
            {t.registerModal.channelWalkIn}
          </Button>
        </div>
        <FormText>{channelHint}</FormText>
      </FormGroup>

      <FormGroup>
        <Label htmlFor="regPhone">{t.registerModal.phone}</Label>
        <Input
          id="regPhone" type="tel" value={phone} placeholder={t.registerModal.phonePlaceholder}
          onChange={(e) => setPhone(e.target.value)}
        />
        <FormText>
          {t.registerModal.phoneHelpLead}
          <strong>{t.registerModal.phoneHelpStrong}</strong>
          {t.registerModal.phoneHelpTail}
        </FormText>
      </FormGroup>

      <FormGroup>
        <Label htmlFor="regName">{t.registerModal.name}</Label>
        <Input
          id="regName" value={name} placeholder={t.registerModal.namePlaceholder}
          onChange={(e) => setName(e.target.value)}
        />
      </FormGroup>

      {!phone.trim() ? (
        <Alert tone="warning" className="mb-3">{t.registerModal.noPhoneWarning}</Alert>
      ) : null}

      <Alert tone="info">{t.registerModal.noNotifyWarning}</Alert>

      {error ? <FormError>{error}</FormError> : null}
    </Modal>
  );
}

/* ========================================================================== */
/* 當日設定 / 鎖號 / 休診                                                       */
/* ========================================================================== */

const parseNumbers = (raw: string): { ok: number[]; bad: string[] } => {
  const ok: number[] = [];
  const bad: string[] = [];
  for (const piece of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const n = Number(piece);
    if (Number.isInteger(n) && n > 0) ok.push(n);
    else bad.push(piece);
  }
  return { ok, bad };
};

function LockModal({
  open, session, date, value, affected, onClose, onApply, onRestore,
}: {
  open: boolean;
  session: QueueSession | null;
  date: string;
  value?: DayOverride;
  affected: number;
  onClose: () => void;
  onApply: (next: DayOverride, cancelled: number) => void;
  onRestore: () => void;
}) {
  const [closed, setClosed] = React.useState(false);
  const [total, setTotal] = React.useState('');
  const [numbers, setNumbers] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [error, setError] = React.useState('');
  const [confirmStage, setConfirmStage] = React.useState(false);
  const [restoreOpen, setRestoreOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setClosed(value?.closed ?? false);
    setTotal(value?.totalNumbers ? String(value.totalNumbers) : '');
    setNumbers((value?.lockedNumbers ?? []).join(','));
    setReason(value?.reason ?? '');
    setError('');
    setConfirmStage(false);
  }, [open, value]);

  const parsed = parseNumbers(numbers);
  const willCancel = closed ? affected : 0;

  const apply = async () => {
    if (parsed.bad.length) {
      setError(t.lockModal.numbersInvalid(parsed.bad.join(',')));
      return;
    }
    setError('');
    if (willCancel > 0 && !confirmStage) {
      setConfirmStage(true);
      return;
    }
    setSaving(true);
    try {
      await new Promise((r) => setTimeout(r, 380));
      onApply(
        {
          closed,
          totalNumbers: total.trim() === '' ? null : Number(total),
          lockedNumbers: parsed.ok,
          reason: reason.trim(),
        },
        willCancel,
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
        title={t.lockModal.title}
        footer={
          <>
            <Button variant="outlineDanger" className="mr-auto" onClick={() => setRestoreOpen(true)}>
              {t.lockModal.restoreDefault}
            </Button>
            <Button variant="secondary" onClick={onClose}>{common.cancel}</Button>
            <Button loading={saving} loadingText={common.processing} onClick={() => void apply()}>
              {confirmStage ? t.lockModal.applyConfirm : t.lockModal.apply}
            </Button>
          </>
        }
      >
        <p className="form-text mb-3">
          {session && date ? t.lockModal.context(session.name, formatDate(date)) : t.board.pickFirst}
        </p>

        <label className="mb-3 flex items-center gap-2 text-base">
          <input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} />
          <span>
            <strong>{t.lockModal.closed}</strong>
            <span className="text-xs text-secondary">{t.lockModal.closedHint}</span>
          </span>
        </label>

        <FormGroup>
          <Label htmlFor="lockTotal">{t.lockModal.total}</Label>
          <Input
            id="lockTotal" type="number" min={1} max={NUMBER_RANGE_MAX} value={total}
            placeholder={t.lockModal.totalPlaceholder}
            onChange={(e) => setTotal(e.target.value)}
          />
          <FormText>{t.lockModal.totalHelp}</FormText>
        </FormGroup>

        <FormGroup>
          <Label htmlFor="lockNumbers">{t.lockModal.numbers}</Label>
          <Input
            id="lockNumbers" value={numbers} placeholder={t.lockModal.numbersPlaceholder}
            onChange={(e) => setNumbers(e.target.value)}
          />
          <FormText>
            {t.lockModal.numbersHelp}
            {parsed.ok.map((n) => formatNumber(n)).join(', ')}
          </FormText>
        </FormGroup>

        <FormGroup>
          <Label htmlFor="lockReason">{t.lockModal.reason}</Label>
          <Input
            id="lockReason" value={reason} placeholder={t.lockModal.reasonPlaceholder}
            onChange={(e) => setReason(e.target.value)}
          />
        </FormGroup>

        {willCancel > 0 ? (
          <Alert tone="warning" title={t.lockModal.previewLead(willCancel)}>
            <div>{t.lockModal.previewTail}</div>
            {confirmStage ? <div>{t.lockModal.previewConfirmAgain}</div> : null}
          </Alert>
        ) : null}

        {error ? <FormError>{error}</FormError> : null}
      </Modal>

      <ConfirmModal
        open={restoreOpen}
        danger
        title={t.lockModal.restoreDefault}
        confirmText={t.lockModal.restoreDefault}
        message={t.lockModal.restoreConfirm}
        onClose={() => setRestoreOpen(false)}
        onConfirm={() => { setRestoreOpen(false); onRestore(); }}
      />
    </>
  );
}
