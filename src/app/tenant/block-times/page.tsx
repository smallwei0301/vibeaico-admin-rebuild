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
import { FormGroup, FormError, FormText, Input, Label, Select } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { common } from '@/i18n/zh-TW/common';
import { nav } from '@/i18n/zh-TW/nav';
import { blockTimesPage as t } from '@/i18n/zh-TW/pages/block-times';
import { formatDate } from '@/lib/utils';

/* -------------------------------------------------------------------------- */
/* 本頁專用假資料（不寫進 src/mock，避免與其他頁面衝突）                          */
/* -------------------------------------------------------------------------- */

type BlockTime = {
  id: string;
  title: string;
  reason: string;
  recurrence: 'SINGLE' | 'WEEKLY';
  /** SINGLE 用 */
  date: string | null;
  /** WEEKLY 用，0 = 週日 */
  dayOfWeek: number | null;
  fullDay: boolean;
  startTime: string;
  endTime: string;
  /** 由「每天不同營業時間」自動產生的休息時段，不可編輯 */
  auto: boolean;
};

const MOCK_BLOCK_TIMES: BlockTime[] = [
  { id: 'bt_1', title: '店休', reason: '中秋連假', recurrence: 'SINGLE', date: '2026-09-05', dayOfWeek: null, fullDay: true, startTime: '', endTime: '', auto: false },
  { id: 'bt_2', title: '團隊會議', reason: '每週例會', recurrence: 'WEEKLY', date: null, dayOfWeek: 2, fullDay: false, startTime: '09:00', endTime: '10:30', auto: false },
  { id: 'bt_3', title: '午休', reason: '', recurrence: 'WEEKLY', date: null, dayOfWeek: 3, fullDay: false, startTime: '14:00', endTime: '15:00', auto: true },
];

/** 營業時間：原站由 /api/settings 取得，骨架階段固定 */
const BUSINESS_HOURS = { open: '10:00', close: '21:00', restStart: '14:00', restEnd: '15:00' };

/** 時間下拉：00:00 – 23:30，每 30 分鐘一檔（避免 render 期產生隨機值） */
const TIME_OPTIONS: string[] = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, '0');
  const m = i % 2 === 0 ? '00' : '30';
  return `${h}:${m}`;
});

const emptyDraft = (): BlockTime => ({
  id: '',
  title: '',
  reason: '',
  recurrence: 'SINGLE',
  date: '',
  dayOfWeek: 1,
  fullDay: false,
  startTime: '10:00',
  endTime: '11:00',
  auto: false,
});

/* -------------------------------------------------------------------------- */

export default function BlockTimesPage() {
  const toast = useToast();
  const [rows, setRows] = React.useState<BlockTime[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [editing, setEditing] = React.useState<BlockTime | null>(null);
  const [deleting, setDeleting] = React.useState<BlockTime | null>(null);
  const [deletingBusy, setDeletingBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      await new Promise((r) => setTimeout(r, 320));
      setRows(MOCK_BLOCK_TIMES);
    } catch {
      toast.show(t.messages.loadFailed, 'danger');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  React.useEffect(() => { void load(); }, [load]);

  const columns: Column<BlockTime>[] = [
    {
      key: 'title', header: t.columns.title,
      render: (b) => (
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-semibold text-dark">{b.title}</span>
          {b.auto ? <Badge tone="neutral">{t.tags.auto}</Badge> : null}
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
        : b.date ? formatDate(b.date) : common.none),
    },
    {
      key: 'time', header: t.columns.time, width: '140px',
      render: (b) => (b.fullDay ? t.tags.fullDay : `${b.startTime} - ${b.endTime}`),
    },
    {
      key: 'reason', header: t.columns.reason,
      render: (b) => b.reason || <span className="text-muted">{common.none}</span>,
    },
    {
      key: 'actions', header: t.columns.actions, width: '110px',
      render: (b) => (
        <div className="btn-group">
          <Button
            variant="outline" size="sm" aria-label={common.edit} disabled={b.auto}
            onClick={() => setEditing(b)}
          >
            <Pencil size={13} />
          </Button>
          <Button
            variant="outlineDanger" size="sm" aria-label={common.delete} disabled={b.auto}
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
          <Button onClick={() => setEditing(emptyDraft())}>
            <Plus size={15} />{t.actions.create}
          </Button>
        }
      />

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
                <Button onClick={() => setEditing(emptyDraft())}>
                  <Plus size={15} />{t.actions.create}
                </Button>
              }
            />
          }
        />
      </DataTableContainer>

      <BlockTimeModal
        draft={editing}
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
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          setDeletingBusy(true);
          try {
            await new Promise((r) => setTimeout(r, 320));
            setRows((s) => s.filter((x) => x.id !== deleting?.id));
            toast.show(t.messages.deleted);
          } catch {
            toast.show(`${t.messages.deleteFailed}${t.messages.unknownError}`, 'danger');
          } finally {
            setDeletingBusy(false);
            setDeleting(null);
          }
        }}
      />
    </>
  );
}

/* --------------------------------------------------------- 新增/編輯封鎖時段 */

function BlockTimeModal({
  draft, onClose, onSaved,
}: {
  draft: BlockTime | null;
  onClose: () => void;
  onSaved: (isNew: boolean) => void;
}) {
  const [form, setForm] = React.useState<BlockTime>(emptyDraft);
  const [error, setError] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (draft) { setForm({ ...draft }); setError(''); }
  }, [draft]);

  const set = <K extends keyof BlockTime>(key: K, value: BlockTime[K]) =>
    setForm((s) => ({ ...s, [key]: value }));

  const validate = (): string => {
    if (!form.title.trim()) return t.validation.titleRequired;
    if (form.recurrence === 'SINGLE' && !form.date) return t.validation.dateRequired;
    if (!form.fullDay) {
      if (!form.startTime || !form.endTime) return t.validation.timeRequired;
      if (form.startTime >= form.endTime) return t.validation.startBeforeEnd;
      if (form.startTime < BUSINESS_HOURS.open) return t.validation.startBeforeOpen(BUSINESS_HOURS.open);
      if (form.endTime > BUSINESS_HOURS.close) return t.validation.endAfterClose(BUSINESS_HOURS.close);
      if (form.startTime < BUSINESS_HOURS.restEnd && form.endTime > BUSINESS_HOURS.restStart) {
        return t.validation.overlapRest(`${BUSINESS_HOURS.restStart}-${BUSINESS_HOURS.restEnd}`);
      }
    }
    return '';
  };

  const submit = async () => {
    const err = validate();
    setError(err);
    if (err) return;
    setSaving(true);
    try {
      await new Promise((r) => setTimeout(r, 400));
      onSaved(!form.id);
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
          <Button loading={saving} loadingText={common.saving} onClick={() => void submit()}>
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
              id="btDate" type="date" value={form.date ?? ''}
              onChange={(e) => set('date', e.target.value)}
            />
          </FormGroup>
        ) : (
          <FormGroup>
            <Label required htmlFor="btDayOfWeek">{t.form.dayOfWeek}</Label>
            <Select
              id="btDayOfWeek" value={String(form.dayOfWeek ?? 0)}
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
      {error ? <FormError>{error}</FormError> : null}
    </Modal>
  );
}
