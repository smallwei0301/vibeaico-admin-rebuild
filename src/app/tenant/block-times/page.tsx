'use client';
import * as React from 'react';
import Link from 'next/link';
import { Ban, Clock, Pencil, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import {
  DataTable, DataTableContainer, DataTableHeader, type Column,
} from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmModal, Modal } from '@/components/ui/Modal';
import { FormError, FormGroup, FormText, Input, Label, Select } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { common } from '@/i18n/zh-TW/common';
import { nav } from '@/i18n/zh-TW/nav';
import { blockTimesPage as t } from '@/i18n/zh-TW/pages/block-times';
import { formatDate, formatTime, zonedLocalToIso, zonedYmd } from '@/lib/utils';
import { useTenantTimeZoneState } from '@/lib/use-tenant-time-zone';
import {
  createBlockTime, deleteBlockTime, listBlockTimes, updateBlockTime,
  type BlockTimeItem, type BlockTimeWritePayload,
} from '@/services/bookings';
import { listStaff } from '@/services/catalog';
import type { Staff } from '@/lib/types';

/** 時間下拉：00:00 – 23:30，每 30 分鐘一檔（避免 render 期產生隨機值） */
const TIME_OPTIONS: string[] = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, '0');
  const m = i % 2 === 0 ? '00' : '30';
  return `${h}:${m}`;
});

type Draft = {
  id: string | null;
  staffId: string;
  title: string;
  reason: string;
  recurrence: 'SINGLE' | 'WEEKLY';
  /** SINGLE 用（YYYY-MM-DD） */
  date: string;
  /** WEEKLY 用，0 = 週日 */
  dayOfWeek: number;
  fullDay: boolean;
  startTime: string;
  endTime: string;
};

const emptyDraft = (): Draft => ({
  id: null, staffId: '', title: '', reason: '', recurrence: 'SINGLE',
  date: '', dayOfWeek: 1, fullDay: false, startTime: '10:00', endTime: '11:00',
});

/** 純日期運算（UTC 算術，與瀏覽器時區無關）：YYYY-MM-DD 加 n 天。 */
const addDays = (dateStr: string, n: number) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

/** WEEKLY 建立/編輯時，把「星期幾」換算成店家時區今天以後最近一個符合的日期，做為 startAt 的首次發生日 */
const nextDateForWeekday = (dayOfWeek: number, tz: string) => {
  const today = zonedYmd(new Date().toISOString(), tz);
  const [y, m, d] = today.split('-').map(Number);
  const todayDow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDays(today, (dayOfWeek - todayDow + 7) % 7);
};

function itemToDraft(b: BlockTimeItem, tz: string): Draft {
  return {
    id: b.id,
    staffId: b.staffId ?? '',
    title: b.title,
    reason: b.reason,
    recurrence: b.recurrence,
    date: b.recurrence === 'SINGLE' ? zonedYmd(b.startAt, tz) : '',
    dayOfWeek: b.dayOfWeek ?? 0,
    fullDay: b.fullDay,
    startTime: b.fullDay ? '00:00' : formatTime(b.startAt, tz),
    endTime: b.fullDay ? '23:30' : formatTime(b.endAt, tz),
  };
}

function draftToPayload(d: Draft, tz: string): BlockTimeWritePayload {
  const anchorDate = d.recurrence === 'WEEKLY' ? nextDateForWeekday(d.dayOfWeek, tz) : d.date;
  const startDate = anchorDate;
  const endDate = d.fullDay ? addDays(anchorDate, 1) : anchorDate;
  const startTime = d.fullDay ? '00:00' : d.startTime;
  const endTime = d.fullDay ? '00:00' : d.endTime;
  return {
    staffId: d.staffId || null,
    title: d.title.trim(),
    reason: d.reason.trim(),
    recurrence: d.recurrence,
    dayOfWeek: d.recurrence === 'WEEKLY' ? d.dayOfWeek : null,
    fullDay: d.fullDay,
    // #936：以店家時區解讀當地時間（不是瀏覽器時區），輸出仍為 UTC ISO
    startAt: zonedLocalToIso(startDate, startTime, tz),
    endAt: zonedLocalToIso(endDate, endTime, tz),
  };
}

export default function BlockTimesPage() {
  const toast = useToast();
  const { timeZone: tz, ready: tzReady, error: tzError, retry: tzRetry } = useTenantTimeZoneState();
  const [rows, setRows] = React.useState<BlockTimeItem[]>([]);
  const [staff, setStaff] = React.useState<Staff[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [editing, setEditing] = React.useState<Draft | null>(null);
  const [deleting, setDeleting] = React.useState<BlockTimeItem | null>(null);
  const [deletingBusy, setDeletingBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listBlockTimes());
    } catch (e) {
      toast.show(e instanceof Error ? e.message : t.messages.loadFailed, 'danger');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  React.useEffect(() => { void load(); }, [load]);

  // #936：寫入所用時區必須與表單顯示時相同；modal 開啟期間時區改變就關閉，避免平移
  const editingTzRef = React.useRef(tz);
  React.useEffect(() => {
    if (editingTzRef.current !== tz) { editingTzRef.current = tz; setEditing(null); }
  }, [tz]);

  React.useEffect(() => {
    void (async () => {
      try {
        setStaff(await listStaff());
      } catch {
        setStaff([]);
      }
    })();
  }, []);

  const columns: Column<BlockTimeItem>[] = [
    {
      key: 'title', header: t.columns.title,
      render: (b) => (
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-semibold text-dark">{b.title || <span className="text-muted">{common.none}</span>}</span>
          {b.auto ? <Badge tone="neutral" title={t.auto.hint}>{t.tags.auto}</Badge> : null}
        </div>
      ),
    },
    {
      key: 'type', header: t.columns.type, width: '110px',
      render: (b) => (
        <div className="flex items-center gap-1">
          <Badge tone={b.recurrence === 'WEEKLY' ? 'info' : 'primary'}>
            {b.recurrence === 'WEEKLY' ? t.tags.weekly : t.tags.single}
          </Badge>
          {b.fullDay ? <Badge tone="warning">{t.tags.fullDay}</Badge> : null}
        </div>
      ),
    },
    {
      key: 'date', header: t.columns.date, width: '140px',
      render: (b) => (b.recurrence === 'WEEKLY'
        ? common.weekdays[b.dayOfWeek ?? 0]
        : formatDate(b.startAt, tz)),
    },
    {
      key: 'time', header: t.columns.time, width: '140px',
      render: (b) => (b.fullDay ? t.tags.fullDay : `${formatTime(b.startAt, tz)} - ${formatTime(b.endAt, tz)}`),
    },
    {
      key: 'reason', header: t.columns.reason,
      render: (b) => b.reason || <span className="text-muted">{common.none}</span>,
    },
    {
      key: 'staff', header: t.columns.staff, width: '120px',
      render: (b) => b.staffName ?? t.staffAll,
    },
    {
      key: 'actions', header: t.columns.actions, width: '110px',
      render: (b) => (
        <div className="btn-group">
          <Button
            variant="outline" size="sm" aria-label={common.edit} disabled={b.auto || !tzReady}
            title={b.auto ? t.auto.hint : common.edit}
            onClick={() => setEditing(itemToDraft(b, tz))}
          >
            <Pencil size={13} />
          </Button>
          <Button
            variant="outlineDanger" size="sm" aria-label={common.delete} disabled={b.auto}
            title={b.auto ? t.auto.hint : common.delete}
            onClick={() => setDeleting(b)}
          >
            <Trash2 size={13} />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow={nav.navOperation}
        title={t.title}
        actions={
          <Button disabled={!tzReady} onClick={() => setEditing(emptyDraft())}>
            <Plus size={15} />{t.actions.create}
          </Button>
        }
      />

      {tzError ? (
        <div className="mb-4 flex items-center gap-3">
          <FormError>{t.messages.timeZoneLoadFailed}</FormError>
          <Button variant="outline" size="sm" onClick={tzRetry}>{common.retry}</Button>
        </div>
      ) : null}

      <Alert tone="neutral" className="mb-4" icon={<Ban size={18} className="mt-0.5 flex-shrink-0" />}
             action={<Link href="/tenant/settings" className="btn btn-outline btn-sm"><Clock size={13} />{t.intro.businessHours}</Link>}>
        {t.intro.text}
      </Alert>

      <DataTableContainer>
        <DataTableHeader title={t.tableTitle} />
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          rowKey={(b) => b.id}
          empty={
            <EmptyState
              icon={Ban}
              title={t.empty.title}
              description={t.empty.description}
              action={
                <Button disabled={!tzReady} onClick={() => setEditing(emptyDraft())}>
                  <Plus size={15} />{t.actions.create}
                </Button>
              }
            />
          }
        />
      </DataTableContainer>

      <BlockTimeModal
        draft={editing}
        staff={staff}
        tz={tz}
        onClose={() => setEditing(null)}
        onSaved={(isNew) => {
          setEditing(null);
          toast.show(isNew ? t.messages.created : t.messages.updated);
          void load();
        }}
      />

      <ConfirmModal
        open={!!deleting}
        danger
        loading={deletingBusy}
        title={common.delete}
        message={t.messages.deleteConfirm}
        confirmText={common.delete}
        onClose={() => { if (!deletingBusy) setDeleting(null); }}
        onConfirm={async () => {
          if (!deleting) return;
          setDeletingBusy(true);
          try {
            await deleteBlockTime(deleting.id);
            setRows((s) => s.filter((x) => x.id !== deleting.id));
            toast.show(t.messages.deleted);
            setDeleting(null);
          } catch (e) {
            toast.show(
              `${t.messages.deleteFailed}${e instanceof Error ? e.message : t.messages.unknownError}`,
              'danger',
            );
          } finally {
            setDeletingBusy(false);
          }
        }}
      />
    </>
  );
}

/* --------------------------------------------------------- 新增/編輯封鎖時段 */

function BlockTimeModal({
  draft, staff, tz, onClose, onSaved,
}: {
  draft: Draft | null;
  staff: Staff[];
  tz: string;
  onClose: () => void;
  onSaved: (isNew: boolean) => void;
}) {
  const toast = useToast();
  const { ready: tzReady, error: tzError, retry: tzRetry } = useTenantTimeZoneState();
  const [form, setForm] = React.useState<Draft>(emptyDraft);
  const [error, setError] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (draft) { setForm({ ...draft }); setError(''); }
  }, [draft]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setForm((s) => ({ ...s, [key]: value }));

  const validate = (): string => {
    if (!form.title.trim()) return t.validation.titleRequired;
    if (form.recurrence === 'SINGLE' && !form.date) return t.validation.dateRequired;
    if (!form.fullDay) {
      if (!form.startTime || !form.endTime) return t.validation.timeRequired;
      if (form.startTime >= form.endTime) return t.validation.startBeforeEnd;
    }
    return '';
  };

  const submit = async () => {
    if (!tzReady) return;
    const err = validate();
    setError(err);
    if (err) return;
    setSaving(true);
    try {
      const payload = draftToPayload(form, tz);
      if (form.id) await updateBlockTime(form.id, payload);
      else await createBlockTime(payload);
      onSaved(!form.id);
    } catch (e) {
      toast.show(e instanceof Error ? e.message : t.messages.saveFailed, 'danger');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={!!draft}
      onClose={onClose}
      size="lg"
      title={form.id ? t.form.editTitle : t.form.createTitle}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{common.cancel}</Button>
          <Button loading={saving} loadingText={common.saving} disabled={!tzReady} onClick={() => void submit()}>
            {common.save}
          </Button>
        </>
      }
    >
      <FormGroup>
        <Label required htmlFor="btTitle">{t.form.title}</Label>
        <Input
          id="btTitle" value={form.title} placeholder={t.form.titlePlaceholder}
          onChange={(e) => set('title', e.target.value)}
        />
      </FormGroup>

      <FormGroup>
        <Label htmlFor="btReason">{t.form.reason}</Label>
        <Input
          id="btReason" value={form.reason} placeholder={t.form.reasonPlaceholder}
          onChange={(e) => set('reason', e.target.value)}
        />
      </FormGroup>

      <FormGroup>
        <Label htmlFor="btStaff">{t.form.staff}</Label>
        <Select
          id="btStaff" value={form.staffId}
          onChange={(e) => set('staffId', e.target.value)}
        >
          <option value="">{t.staffAll}</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      </FormGroup>

      <FormGroup>
        <Label>{t.form.recurrence}</Label>
        <div className="flex items-center gap-4">
          {(['SINGLE', 'WEEKLY'] as const).map((v) => (
            <label key={v} className="flex items-center gap-1.5 text-base">
              <input
                type="radio" name="btRecurrence" value={v} checked={form.recurrence === v}
                onChange={() => set('recurrence', v)}
              />
              {v === 'SINGLE' ? t.form.single : t.form.weekly}
            </label>
          ))}
        </div>
      </FormGroup>

      <div className="grid gap-x-4 md:grid-cols-2">
        {form.recurrence === 'SINGLE' ? (
          <FormGroup>
            <Label required htmlFor="btDate">{t.form.date}</Label>
            <Input
              id="btDate" type="date" value={form.date}
              onChange={(e) => set('date', e.target.value)}
            />
          </FormGroup>
        ) : (
          <FormGroup>
            <Label required htmlFor="btDayOfWeek">{t.form.dayOfWeek}</Label>
            <Select
              id="btDayOfWeek" value={String(form.dayOfWeek)}
              onChange={(e) => set('dayOfWeek', Number(e.target.value))}
            >
              {t.form.weekdays.map((d) => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </Select>
          </FormGroup>
        )}

        <FormGroup>
          <Label htmlFor="btFullDay">{t.form.fullDay}</Label>
          <label className="flex items-center gap-1.5 text-base">
            <input
              id="btFullDay" type="checkbox" checked={form.fullDay}
              onChange={(e) => set('fullDay', e.target.checked)}
            />
            {t.form.fullDay}
          </label>
        </FormGroup>
      </div>

      {!form.fullDay ? (
        <div className="grid gap-x-4 md:grid-cols-2">
          <FormGroup>
            <Label htmlFor="btStartTime">{t.form.startTime}</Label>
            <Select
              id="btStartTime" value={form.startTime}
              onChange={(e) => set('startTime', e.target.value)}
            >
              {TIME_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
            </Select>
          </FormGroup>
          <FormGroup>
            <Label htmlFor="btEndTime">{t.form.endTime}</Label>
            <Select
              id="btEndTime" value={form.endTime}
              onChange={(e) => set('endTime', e.target.value)}
            >
              {TIME_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
            </Select>
          </FormGroup>
        </div>
      ) : null}

      <FormText>{t.intro.text}</FormText>
      {tzError ? (
        <div className="mb-4 flex items-center gap-3">
          <FormError>{t.messages.timeZoneLoadFailed}</FormError>
          <Button variant="outline" size="sm" onClick={tzRetry}>{common.retry}</Button>
        </div>
      ) : null}
      {error ? <FormError>{error}</FormError> : null}
    </Modal>
  );
}
