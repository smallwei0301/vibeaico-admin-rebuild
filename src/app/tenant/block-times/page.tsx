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
import {
  createBlockTime, deleteBlockTime, listBlockTimes, updateBlockTime, type BlockTimeItem,
} from '@/services/bookings';
import { getTenantSettings } from '@/services/settings';
import { common } from '@/i18n/zh-TW/common';
import { nav } from '@/i18n/zh-TW/nav';
import { blockTimesPage as t } from '@/i18n/zh-TW/pages/block-times';
import { formatDate } from '@/lib/utils';

/* -------------------------------------------------------------------------- */
/* 資料模型                                                                     */
/*                                                                            */
/* 這一頁的唯一資料源是 GET /api/block-times（services/bookings.ts 的          */
/* listBlockTimes），寫入走 createBlockTime / updateBlockTime / deleteBlockTime */
/* ——與 /tenant/calendar 頁的快速封鎖用的是同一組 service 函式。                */
/*                                                                            */
/* ⚠️ block_times 表只有 staff_id / start_at / end_at / reason。接線前這一頁的 */
/* 頁內假資料另外有「循環類型（每週）」「自動產生」「原因（第二個文字欄）」，   */
/* 三者都沒有欄位可存也沒有端點會讀，因此不再呈現成可以儲存的東西：             */
/*   - 每週循環 → 表單裡照實說明尚未支援（見 t.form.weeklyUnavailable）        */
/*   - 自動產生 → 刪除（GET 沒有這個旗標）                                     */
/*   - 原因     → 刪除（只有一個 text 欄位，留著就是打了字卻不會進資料庫）       */
/* -------------------------------------------------------------------------- */

type Draft = {
  id: string;
  /** 存進 block_times.reason；行事曆頁也是拿這個欄位當封鎖標籤 */
  title: string;
  date: string;
  fullDay: boolean;
  startTime: string;
  endTime: string;
};

/** 時間下拉：00:00 – 23:30，每 30 分鐘一檔（避免 render 期產生隨機值） */
const TIME_OPTIONS: string[] = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, '0');
  const m = i % 2 === 0 ? '00' : '30';
  return `${h}:${m}`;
});

const emptyDraft = (): Draft => ({
  id: '', title: '', date: '', fullDay: false, startTime: '10:00', endTime: '11:00',
});

const pad = (n: number) => String(n).padStart(2, '0');
const toLocalDate = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const toLocalTime = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** 整天＝當地 00:00 起、剛好 24 小時（createBlockTime 在行事曆頁封整天時就是這樣寫的） */
const isFullDay = (b: BlockTimeItem) =>
  toLocalTime(b.startAt) === '00:00'
  && Date.parse(b.endAt) - Date.parse(b.startAt) === 24 * 60 * 60_000;

const toDraft = (b: BlockTimeItem): Draft => ({
  id: b.id,
  title: b.reason,
  date: toLocalDate(b.startAt),
  fullDay: isFullDay(b),
  startTime: toLocalTime(b.startAt),
  endTime: toLocalTime(b.endAt),
});

/** 表單值 → 端點的 ISO 起訖時間；整天＝當地 00:00 起算 24 小時 */
const toRange = (d: Draft): { startAt: string; endAt: string } => {
  if (d.fullDay) {
    const start = new Date(`${d.date}T00:00:00`);
    return {
      startAt: start.toISOString(),
      endAt: new Date(start.getTime() + 24 * 60 * 60_000).toISOString(),
    };
  }
  return {
    startAt: new Date(`${d.date}T${d.startTime}:00`).toISOString(),
    endAt: new Date(`${d.date}T${d.endTime}:00`).toISOString(),
  };
};

/** 營業時間；null = 還沒查到（載入中或查詢失敗），此時不做營業時間相關的檢查 */
type BusinessHours = { open: string; close: string; restStart: string; restEnd: string };

/* -------------------------------------------------------------------------- */

export default function BlockTimesPage() {
  const toast = useToast();
  const [rows, setRows] = React.useState<BlockTimeItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [editing, setEditing] = React.useState<Draft | null>(null);
  const [deleting, setDeleting] = React.useState<BlockTimeItem | null>(null);
  const [deletingBusy, setDeletingBusy] = React.useState(false);
  const [hours, setHours] = React.useState<BusinessHours | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const list = await listBlockTimes();
      setRows([...list].sort((a, b) => a.startAt.localeCompare(b.startAt)));
    } catch (e) {
      toast.show(
        `${t.messages.loadFailed}${e instanceof Error ? `：${e.message}` : ''}`,
        'danger',
      );
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  React.useEffect(() => { void load(); }, [load]);

  /**
   * 營業時間來自 /api/settings（business 群組）。
   * ⚠️ 接線前這裡是一組寫死的 `{ open:'10:00', close:'21:00', rest 14:00–15:00 }`，
   * 於是驗證訊息會對店家說「開始時間不能早於營業開始時間（10:00）」——那個 10:00
   * 是編出來的，跟他自己設的營業時間無關。查不到就不做這組檢查（見 render 的提示），
   * 不拿一個假的營業時間去擋人。
   */
  React.useEffect(() => {
    void (async () => {
      try {
        const s = await getTenantSettings();
        setHours({
          open: s.business.businessStart,
          close: s.business.businessEnd,
          restStart: s.business.breakStart,
          restEnd: s.business.breakEnd,
        });
      } catch {
        setHours(null);
      }
    })();
  }, []);

  const columns: Column<BlockTimeItem>[] = [
    {
      key: 'title', header: t.columns.title,
      render: (b) => (
        <span className="font-semibold text-dark">{b.reason || common.none}</span>
      ),
    },
    {
      key: 'type', header: t.columns.type, width: '110px',
      render: (b) => (
        <div className="flex items-center gap-1">
          <Badge tone="primary">{t.tags.single}</Badge>
          {isFullDay(b) ? <Badge tone="warning">{t.tags.fullDay}</Badge> : null}
        </div>
      ),
    },
    {
      key: 'date', header: t.columns.date, width: '140px',
      render: (b) => formatDate(b.startAt),
    },
    {
      key: 'time', header: t.columns.time, width: '150px',
      render: (b) => (isFullDay(b)
        ? t.tags.fullDay
        : `${toLocalTime(b.startAt)} - ${toLocalTime(b.endAt)}`),
    },
    {
      key: 'staff', header: t.columns.staff, width: '130px',
      render: (b) => (b.staffId
        ? (b.staffName || common.none)
        : <Badge tone="neutral">{t.tags.allStaff}</Badge>),
    },
    {
      key: 'actions', header: t.columns.actions, width: '110px',
      render: (b) => (
        <div className="btn-group">
          <Button
            variant="outline" size="sm" aria-label={common.edit}
            onClick={() => setEditing(toDraft(b))}
          >
            <Pencil size={13} />
          </Button>
          <Button
            variant="outlineDanger" size="sm" aria-label={common.delete}
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
        hours={hours}
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
          if (!deleting) return;
          setDeletingBusy(true);
          try {
            /* 成功訊息只能在 await 真的過了之後出現（00 鐵則 12） */
            await deleteBlockTime(deleting.id);
            toast.show(t.messages.deleted);
            setDeleting(null);
            void load();
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
  draft, hours, onClose, onSaved,
}: {
  draft: Draft | null;
  hours: BusinessHours | null;
  onClose: () => void;
  onSaved: (isNew: boolean) => void;
}) {
  const toast = useToast();
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
    if (!form.date) return t.validation.dateRequired;
    if (!form.fullDay) {
      if (!form.startTime || !form.endTime) return t.validation.timeRequired;
      if (form.startTime >= form.endTime) return t.validation.startBeforeEnd;
      /* 營業時間查不到就不檢查——不拿編出來的時間擋人 */
      if (hours) {
        if (form.startTime < hours.open) return t.validation.startBeforeOpen(hours.open);
        if (form.endTime > hours.close) return t.validation.endAfterClose(hours.close);
        if (hours.restStart && hours.restEnd
          && form.startTime < hours.restEnd && form.endTime > hours.restStart) {
          return t.validation.overlapRest(`${hours.restStart}-${hours.restEnd}`);
        }
      }
    }
    return '';
  };

  /**
   * 新增 → POST /api/block-times；編輯 → PUT /api/block-times/:id。
   * 接線前這裡是 `await new Promise(r => setTimeout(r, 400))`，上層照樣顯示
   * 「封鎖時段已新增」，但沒有任何請求送出去（14 分冊 §1 A-1）。
   */
  const submit = async () => {
    const err = validate();
    setError(err);
    if (err) return;
    setSaving(true);
    try {
      const { startAt, endAt } = toRange(form);
      if (form.id) await updateBlockTime(form.id, { startAt, endAt, reason: form.title.trim() });
      else await createBlockTime({ startAt, endAt, reason: form.title.trim() });
      onSaved(!form.id);
    } catch (e) {
      toast.show(
        `${t.messages.saveFailed}${e instanceof Error ? e.message : t.messages.unknownError}`,
        'danger',
      );
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
        <Label>{t.form.recurrence}</Label>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-1.5 text-base">
            <input type="radio" name="btRecurrence" value="SINGLE" checked readOnly />
            {t.form.single}
          </label>
          <label className="flex items-center gap-1.5 text-base text-muted">
            <input type="radio" name="btRecurrence" value="WEEKLY" disabled />
            {t.form.weekly}
          </label>
        </div>
        <FormText>{t.form.weeklyUnavailable}</FormText>
      </FormGroup>

      <div className="grid gap-x-4 md:grid-cols-2">
        <FormGroup>
          <Label required htmlFor="btDate">{t.form.date}</Label>
          <Input
            id="btDate" type="date" value={form.date}
            onChange={(e) => set('date', e.target.value)}
          />
        </FormGroup>

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
      {hours ? null : <FormText>{t.businessHoursUnknown}</FormText>}
      {error ? <FormError>{error}</FormError> : null}
    </Modal>
  );
}
