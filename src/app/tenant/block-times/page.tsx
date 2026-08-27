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
/* migration 0027（issue #33 ②）之後 block_times 有                            */
/* title / recurrence / day_of_week / full_day / auto，所以這一頁恢復呈現：     */
/*   - 每週循環 → 真的存得進去，且 /api/calendar 與 available-slots 會展開      */
/*     成每一週的實際時段（＝真的擋得住預約）                                    */
/*   - 自動產生 → auto 旗標由 GET /api/block-times 帶回；這些列不可編輯／刪除    */
/*     （前端停用按鈕、後端 PUT/DELETE 回 409）                                  */
/*   - 原因     → **仍然不呈現**：表單只填「封鎖名稱」，reason 跟著寫同一個值。 */
/*     再開一個獨立的「原因」輸入框就會變成兩個欄位各自演化，而列表沒有那一欄。 */
/* -------------------------------------------------------------------------- */

type Draft = {
  id: string;
  /** 存進 block_times.title（migration 0027 之前只有 reason 一欄可用） */
  title: string;
  recurrence: 'SINGLE' | 'WEEKLY';
  /** WEEKLY 用，0 = 週日 */
  dayOfWeek: number;
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
  id: '', title: '', recurrence: 'SINGLE', dayOfWeek: 1,
  date: '', fullDay: false, startTime: '10:00', endTime: '11:00',
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

/**
 * 整天＝當地 00:00 起、剛好 24 小時（createBlockTime 在行事曆頁封整天時就是
 * 這樣寫的）。migration 0027 之後 `full_day` 是真欄位，優先用它——
 * 舊資料沒有這個旗標，才退回用時間長度推。
 */
const isFullDay = (b: BlockTimeItem) =>
  b.fullDay
  || (toLocalTime(b.startAt) === '00:00'
    && Date.parse(b.endAt) - Date.parse(b.startAt) === 24 * 60 * 60_000);

const toDraft = (b: BlockTimeItem): Draft => ({
  id: b.id,
  title: b.title || b.reason,
  recurrence: b.recurrence ?? 'SINGLE',
  dayOfWeek: b.dayOfWeek ?? 1,
  date: toLocalDate(b.startAt),
  fullDay: isFullDay(b),
  startTime: toLocalTime(b.startAt),
  endTime: toLocalTime(b.endAt),
});

/**
 * 表單值 → 端點的 ISO 起訖時間；整天＝當地 00:00 起算 24 小時。
 *
 * WEEKLY 沒有「日期」可填，起訖時間存的是**參考週**裡的那一次
 * （1970-01-04 是週日，同 src/server/business-hours-blocks.ts 的
 * weeklyBlockRange，兩邊必須是同一個基準，否則同一筆封鎖會有兩種時間表示）。
 *
 * ⚠️ 這裡（與下面 SINGLE 的那一行）用的是**瀏覽器當地時區**，伺服器端則固定
 * 用台北 +08:00。店家與員工都在台灣，兩者一致；這是本頁接線時就有的既有慣例
 * （不是本輪引入的），一併記在這裡以免日後被當成新缺陷。
 */
const REFERENCE_SUNDAY = '1970-01-04';
const weeklyDate = (dayOfWeek: number): string => {
  const d = new Date(`${REFERENCE_SUNDAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dayOfWeek);
  return d.toISOString().slice(0, 10);
};

const toRange = (d: Draft): { startAt: string; endAt: string } => {
  const date = d.recurrence === 'WEEKLY' ? weeklyDate(d.dayOfWeek) : d.date;
  if (d.fullDay) {
    const start = new Date(`${date}T00:00:00`);
    return {
      startAt: start.toISOString(),
      endAt: new Date(start.getTime() + 24 * 60 * 60_000).toISOString(),
    };
  }
  return {
    startAt: new Date(`${date}T${d.startTime}:00`).toISOString(),
    endAt: new Date(`${date}T${d.endTime}:00`).toISOString(),
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
        <span className="font-semibold text-dark">{b.title || b.reason || common.none}</span>
      ),
    },
    {
      key: 'type', header: t.columns.type, width: '150px',
      render: (b) => (
        <div className="flex flex-wrap items-center gap-1">
          <Badge tone="primary">
            {b.recurrence === 'WEEKLY' ? t.tags.weekly : t.tags.single}
          </Badge>
          {isFullDay(b) ? <Badge tone="warning">{t.tags.fullDay}</Badge> : null}
          {/* auto 旗標由 GET /api/block-times 帶回（migration 0027），不是頁內假資料 */}
          {b.auto ? <Badge tone="neutral">{t.tags.auto}</Badge> : null}
        </div>
      ),
    },
    {
      key: 'date', header: t.columns.date, width: '140px',
      // WEEKLY 的 startAt 是參考週的時間，印出來會是 1970 年的某一天——
      // 對每週封鎖要印的是「星期幾」，不是那個沒有意義的日期。
      render: (b) => (b.recurrence === 'WEEKLY' && b.dayOfWeek != null
        ? common.weekdays[b.dayOfWeek]
        : formatDate(b.startAt)),
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
        /*
         * auto 列（「每天不同營業時間」自動產生）不可編輯／刪除：下一次存營業
         * 設定會整批重建，改了也留不住。按鈕停用並用 title 說明去哪裡調整；
         * 後端也擋（PUT/DELETE /api/block-times/:id 回 409），不只靠畫面。
         */
        <div className="btn-group">
          <Button
            variant="outline" size="sm" aria-label={common.edit}
            disabled={b.auto} title={b.auto ? t.autoLocked : undefined}
            onClick={() => setEditing(toDraft(b))}
          >
            <Pencil size={13} />
          </Button>
          <Button
            variant="outlineDanger" size="sm" aria-label={common.delete}
            disabled={b.auto} title={b.auto ? t.autoLocked : undefined}
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
    // WEEKLY 沒有日期欄位（改成選星期幾），只有 SINGLE 要檢查日期
    if (form.recurrence === 'SINGLE' && !form.date) return t.validation.dateRequired;
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
      const payload = {
        startAt, endAt,
        title: form.title.trim(),
        // reason 仍然一起送：行事曆頁與 0027 之前的資料都拿 reason 當標籤，
        // 只寫 title 會讓行事曆上的既有封鎖突然沒有名字。
        reason: form.title.trim(),
        recurrence: form.recurrence,
        dayOfWeek: form.recurrence === 'WEEKLY' ? form.dayOfWeek : null,
        fullDay: form.fullDay,
      };
      if (form.id) await updateBlockTime(form.id, payload);
      else await createBlockTime(payload);
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

      {/*
        「每週」在 issue #33 ② 之後是真的：migration 0027 給 block_times 補了
        recurrence / day_of_week，`/api/calendar` 與
        `/api/bookings/available-slots` 都會把每週封鎖展開成實際發生的時段，
        也就是**存下去真的會擋掉預約**。
      */}
      <FormGroup>
        <Label>{t.form.recurrence}</Label>
        <div className="flex items-center gap-4">
          {(['SINGLE', 'WEEKLY'] as const).map((r) => (
            <label key={r} className="flex items-center gap-1.5 text-base">
              <input
                type="radio" name="btRecurrence" value={r}
                checked={form.recurrence === r}
                onChange={() => set('recurrence', r)}
              />
              {r === 'SINGLE' ? t.form.single : t.form.weekly}
            </label>
          ))}
        </div>
      </FormGroup>

      <div className="grid gap-x-4 md:grid-cols-2">
        {form.recurrence === 'WEEKLY' ? (
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
        ) : (
          <FormGroup>
            <Label required htmlFor="btDate">{t.form.date}</Label>
            <Input
              id="btDate" type="date" value={form.date}
              onChange={(e) => set('date', e.target.value)}
            />
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
      {hours ? null : <FormText>{t.businessHoursUnknown}</FormText>}
      {error ? <FormError>{error}</FormError> : null}
    </Modal>
  );
}
