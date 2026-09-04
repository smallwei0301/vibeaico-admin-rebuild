'use client';
import * as React from 'react';
import Link from 'next/link';
import { Ban, Clock, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
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
import { formatDate, formatTime } from '@/lib/utils';
import { createBlockTime, deleteBlockTime, listBlockTimes, type BlockTimeItem } from '@/services/bookings';
import { listStaff } from '@/services/catalog';
import type { Staff } from '@/lib/types';

/** 時間下拉：00:00 – 23:30，每 30 分鐘一檔（避免 render 期產生隨機值） */
const TIME_OPTIONS: string[] = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, '0');
  const m = i % 2 === 0 ? '00' : '30';
  return `${h}:${m}`;
});

type Draft = {
  staffId: string;
  reason: string;
  date: string;
  startTime: string;
  endTime: string;
};

const emptyDraft = (): Draft => ({
  staffId: '', reason: '', date: '', startTime: '10:00', endTime: '11:00',
});

export default function BlockTimesPage() {
  const toast = useToast();
  const [rows, setRows] = React.useState<BlockTimeItem[]>([]);
  const [staff, setStaff] = React.useState<Staff[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [creating, setCreating] = React.useState(false);
  const [deleting, setDeleting] = React.useState<BlockTimeItem | null>(null);
  const [deletingBusy, setDeletingBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const list = await listBlockTimes();
      setRows(list);
    } catch (e) {
      toast.show(e instanceof Error ? e.message : t.messages.loadFailed, 'danger');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  React.useEffect(() => { void load(); }, [load]);

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
      key: 'reason', header: t.columns.reason,
      render: (b) => b.reason || <span className="text-muted">{common.none}</span>,
    },
    { key: 'date', header: t.columns.date, width: '140px', render: (b) => formatDate(b.startAt) },
    {
      key: 'time', header: t.columns.time, width: '140px',
      render: (b) => `${formatTime(b.startAt)} - ${formatTime(b.endAt)}`,
    },
    {
      key: 'staff', header: t.columns.staff, width: '140px',
      render: (b) => b.staffName ?? t.staffAll,
    },
    {
      key: 'actions', header: t.columns.actions, width: '80px',
      render: (b) => (
        <Button
          variant="outlineDanger" size="sm" aria-label={common.delete}
          onClick={() => setDeleting(b)}
        >
          <Trash2 size={13} />
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow={nav.navOperation}
        title={t.title}
        actions={
          <Button onClick={() => setCreating(true)}>
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
                <Button onClick={() => setCreating(true)}>
                  <Plus size={15} />{t.actions.create}
                </Button>
              }
            />
          }
        />
      </DataTableContainer>

      <CreateBlockTimeModal
        open={creating}
        staff={staff}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          toast.show(t.messages.created);
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

/* --------------------------------------------------------------- 新增封鎖時段 */

function CreateBlockTimeModal({
  open, staff, onClose, onCreated,
}: {
  open: boolean;
  staff: Staff[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = React.useState<Draft>(emptyDraft());
  const [error, setError] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (open) { setForm(emptyDraft()); setError(''); }
  }, [open]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setForm((s) => ({ ...s, [key]: value }));

  const validate = (): string => {
    if (!form.reason.trim()) return t.validation.reasonRequired;
    if (!form.date) return t.validation.dateRequired;
    if (!form.startTime || !form.endTime) return t.validation.timeRequired;
    if (form.startTime >= form.endTime) return t.validation.startBeforeEnd;
    return '';
  };

  const submit = async () => {
    const err = validate();
    setError(err);
    if (err) return;
    setSaving(true);
    try {
      await createBlockTime({
        staffId: form.staffId || null,
        startAt: new Date(`${form.date}T${form.startTime}:00`).toISOString(),
        endAt: new Date(`${form.date}T${form.endTime}:00`).toISOString(),
        reason: form.reason.trim(),
      });
      onCreated();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : t.messages.saveFailed, 'danger');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t.form.createTitle}
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
        <Label required htmlFor="btReason">{t.form.reason}</Label>
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
        <Label required htmlFor="btDate">{t.form.date}</Label>
        <Input
          id="btDate" type="date" value={form.date}
          onChange={(e) => set('date', e.target.value)}
        />
      </FormGroup>

      <div className="grid gap-x-4 md:grid-cols-2">
        <FormGroup>
          <Label required htmlFor="btStartTime">{t.form.startTime}</Label>
          <Select
            id="btStartTime" value={form.startTime}
            onChange={(e) => set('startTime', e.target.value)}
          >
            {TIME_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
          </Select>
        </FormGroup>
        <FormGroup>
          <Label required htmlFor="btEndTime">{t.form.endTime}</Label>
          <Select
            id="btEndTime" value={form.endTime}
            onChange={(e) => set('endTime', e.target.value)}
          >
            {TIME_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
          </Select>
        </FormGroup>
      </div>

      <Button
        type="button" variant="ghost" size="sm" className="mb-3"
        onClick={() => setForm((s) => ({ ...s, startTime: '00:00', endTime: '23:30' }))}
      >
        {t.form.fillFullDay}
      </Button>

      <FormText>{t.intro.text}</FormText>
      {error ? <FormError>{error}</FormError> : null}
    </Modal>
  );
}
