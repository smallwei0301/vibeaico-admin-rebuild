'use client';
import * as React from 'react';
import { CalendarRange, Plus, Repeat, RotateCw, Square } from 'lucide-react';
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
import { listCustomers } from '@/services/customers';
import { listServices, listStaff } from '@/services/catalog';
import { byMode } from '@/mock';
import { common } from '@/i18n/zh-TW/common';
import { nav } from '@/i18n/zh-TW/nav';
import { recurringBookingsPage as t } from '@/i18n/zh-TW/pages/recurring-bookings';
import { formatDate } from '@/lib/utils';
import type { Customer, Service, Staff } from '@/lib/types';

/* -------------------------------------------------------------------------- */
/* 本頁專用假資料（不寫進 src/mock，避免與其他頁面衝突）                          */
/* -------------------------------------------------------------------------- */

type RecurringBooking = {
  id: string;
  customerName: string;
  serviceName: string;
  staffName: string | null;
  /** 1 = 週一 … 7 = 週日（原站選項值） */
  dayOfWeek: number;
  startTime: string;
  intervalWeeks: number;
  times: number;
  createdCount: number;
  status: 'ACTIVE' | 'ENDED';
  lastGeneratedAt: string | null;
};

const RECURRING_BOOKINGS_LOCAL_SHOP: RecurringBooking[] = [
  {
    id: 'rb_1', customerName: '王小明', serviceName: '精緻剪髮', staffName: 'Amy',
    dayOfWeek: 3, startTime: '10:00', intervalWeeks: 1, times: 12, createdCount: 12,
    status: 'ACTIVE', lastGeneratedAt: '2026-08-19T10:00:00+08:00',
  },
  {
    id: 'rb_2', customerName: '陳雅婷', serviceName: '深層護髮', staffName: null,
    dayOfWeek: 6, startTime: '15:30', intervalWeeks: 2, times: 8, createdCount: 6,
    status: 'ACTIVE', lastGeneratedAt: '2026-08-15T15:30:00+08:00',
  },
  {
    id: 'rb_3', customerName: '李美華', serviceName: '全頭染髮', staffName: 'Ben',
    dayOfWeek: 1, startTime: '13:00', intervalWeeks: 4, times: 4, createdCount: 4,
    status: 'ENDED', lastGeneratedAt: '2026-07-06T13:00:00+08:00',
  },
];

/** 嚮導模式較少固定週期預約，主要是企業／長期客戶的例行包團諮詢 */
const RECURRING_BOOKINGS_GUIDE: RecurringBooking[] = [
  {
    id: 'rb_1', customerName: '張家豪', serviceName: '客製包團諮詢', staffName: '小雨',
    dayOfWeek: 3, startTime: '19:00', intervalWeeks: 1, times: 6, createdCount: 6,
    status: 'ACTIVE', lastGeneratedAt: '2026-08-19T19:00:00+08:00',
  },
  {
    id: 'rb_2', customerName: '林巧薇', serviceName: '客製包團諮詢', staffName: null,
    dayOfWeek: 6, startTime: '10:00', intervalWeeks: 2, times: 4, createdCount: 3,
    status: 'ACTIVE', lastGeneratedAt: '2026-08-15T10:00:00+08:00',
  },
  {
    id: 'rb_3', customerName: '陳彥廷', serviceName: '客製包團諮詢', staffName: '阿海',
    dayOfWeek: 1, startTime: '20:00', intervalWeeks: 4, times: 3, createdCount: 3,
    status: 'ENDED', lastGeneratedAt: '2026-07-06T20:00:00+08:00',
  },
];

const RECURRING_BOOKINGS_CLINIC: RecurringBooking[] = [
  {
    id: 'rb_1', customerName: '劉建國', serviceName: '複診', staffName: '林醫師',
    dayOfWeek: 3, startTime: '09:30', intervalWeeks: 4, times: 12, createdCount: 12,
    status: 'ACTIVE', lastGeneratedAt: '2026-08-19T09:30:00+08:00',
  },
  {
    id: 'rb_2', customerName: '蔡淑芬', serviceName: '成人健康檢查', staffName: null,
    dayOfWeek: 6, startTime: '08:00', intervalWeeks: 52, times: 3, createdCount: 3,
    status: 'ACTIVE', lastGeneratedAt: '2026-08-15T08:00:00+08:00',
  },
  {
    id: 'rb_3', customerName: '周佩琪', serviceName: '複診', staffName: '王醫師',
    dayOfWeek: 1, startTime: '14:00', intervalWeeks: 2, times: 6, createdCount: 6,
    status: 'ENDED', lastGeneratedAt: '2026-07-06T14:00:00+08:00',
  },
];

/** 時間下拉：09:00 – 21:30，每 30 分鐘一檔 */
const TIME_OPTIONS: string[] = Array.from({ length: 26 }, (_, i) => {
  const total = 9 * 60 + i * 30;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
});

/** 原站 /api/settings 的「強制指定服務人員」；骨架階段固定 */
const REQUIRE_STAFF = false;

/** 建立上限：今日起一年內 */
const MAX_DAYS_AHEAD = 365;

const weekdayLabel = (dayOfWeek: number) =>
  t.form.weekdays.find((d) => d.value === String(dayOfWeek))?.label ?? '';

const frequencyLabel = (intervalWeeks: number) =>
  (intervalWeeks === 1 ? t.frequency.weekly : t.frequency.everyNWeeks(intervalWeeks));

/* -------------------------------------------------------------------------- */

export default function RecurringBookingsPage() {
  const toast = useToast();
  const [rows, setRows] = React.useState<RecurringBooking[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [renewing, setRenewing] = React.useState<RecurringBooking | null>(null);
  const [ending, setEnding] = React.useState<RecurringBooking | null>(null);
  const [endingStep2, setEndingStep2] = React.useState<RecurringBooking | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      await new Promise((r) => setTimeout(r, 320));
      setRows(byMode({
        LOCAL_SHOP: RECURRING_BOOKINGS_LOCAL_SHOP, GUIDE: RECURRING_BOOKINGS_GUIDE, CLINIC: RECURRING_BOOKINGS_CLINIC,
      }));
    } catch {
      toast.show(`${t.messages.loadListFailed}${t.messages.unknownError}`, 'danger');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  React.useEffect(() => { void load(); }, [load]);

  const columns: Column<RecurringBooking>[] = [
    {
      key: 'customer', header: t.columns.customer,
      render: (r) => <span className="font-semibold text-dark">{r.customerName}</span>,
    },
    { key: 'service', header: t.columns.service, render: (r) => r.serviceName },
    {
      key: 'staff', header: t.columns.staff,
      render: (r) => r.staffName ?? <span className="text-muted">{t.unassigned}</span>,
    },
    {
      key: 'frequency', header: t.columns.frequency, width: '150px',
      render: (r) => `${frequencyLabel(r.intervalWeeks)} ${weekdayLabel(r.dayOfWeek)} ${r.startTime}`,
    },
    {
      key: 'times', header: t.columns.times, numeric: true, width: '90px',
      render: (r) => `${r.createdCount} / ${r.times}`,
    },
    {
      key: 'status', header: t.columns.status, width: '90px',
      render: (r) => (r.status === 'ACTIVE'
        ? <Badge tone="success">{t.status.active}</Badge>
        : <Badge tone="neutral">{t.status.ended}</Badge>),
    },
    {
      key: 'lastGenerated', header: t.columns.lastGenerated, width: '120px',
      render: (r) => (r.lastGeneratedAt ? formatDate(r.lastGeneratedAt) : common.none),
    },
    {
      key: 'actions', header: t.columns.actions, width: '150px',
      render: (r) => (
        <div className="btn-group">
          <Button
            variant="outline" size="sm" disabled={r.status === 'ENDED'}
            onClick={() => setRenewing(r)}
          >
            <RotateCw size={13} />{t.actions.renew}
          </Button>
          <Button
            variant="outlineDanger" size="sm" disabled={r.status === 'ENDED'}
            onClick={() => setEnding(r)}
          >
            <Square size={13} />{t.actions.end}
          </Button>
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
          <Button onClick={() => setCreateOpen(true)}>
            <Plus size={15} />{t.actions.create}
          </Button>
        }
      />

      <Alert tone="neutral" className="mb-4" icon={<Repeat size={18} className="mt-0.5 flex-shrink-0" />}>
        {t.info}
      </Alert>

      <DataTableContainer>
        <DataTableHeader title={t.tableTitle} />
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          rowKey={(r) => r.id}
          empty={
            <EmptyState
              icon={Repeat}
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
      </DataTableContainer>

      <RecurringFormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(created, skipped) => {
          setCreateOpen(false);
          toast.show(skipped > 0
            ? t.messages.createdSummary(created, skipped)
            : t.messages.created(created));
          void load();
        }}
      />

      {/* ------------------------------------------------------------- 續訂 */}
      <ConfirmModal
        open={!!renewing}
        title={t.actions.renew}
        message={
          <span className="whitespace-pre-line">
            {renewing
              ? t.messages.renewConfirm(frequencyLabel(renewing.intervalWeeks), renewing.times)
              : ''}
          </span>
        }
        onClose={() => setRenewing(null)}
        onConfirm={() => {
          const times = renewing?.times ?? 0;
          setRenewing(null);
          toast.show(t.messages.renewed(times));
          void load();
        }}
      />

      {/* ------------------------------------------------------------- 結束 */}
      <ConfirmModal
        open={!!ending}
        danger
        title={t.actions.end}
        message={t.messages.endConfirm}
        onClose={() => setEnding(null)}
        onConfirm={() => { setEndingStep2(ending); setEnding(null); }}
      />

      <Modal
        open={!!endingStep2}
        onClose={() => setEndingStep2(null)}
        title={t.actions.end}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setEndingStep2(null);
                toast.show(t.messages.endedKeep);
                void load();
              }}
            >
              {common.cancel}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const remain = Math.max((endingStep2?.times ?? 0) - (endingStep2?.createdCount ?? 0), 0);
                setEndingStep2(null);
                toast.show(t.messages.endedWithCancel(remain));
                void load();
              }}
            >
              {common.confirmText}
            </Button>
          </>
        }
      >
        <p className="whitespace-pre-line text-base">{t.messages.endCancelFutureConfirm}</p>
      </Modal>
    </>
  );
}

/* ------------------------------------------------------------ 新增定期預約 */

function RecurringFormModal({
  open, onClose, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (created: number, skipped: number) => void;
}) {
  const toast = useToast();
  const [customers, setCustomers] = React.useState<Customer[]>([]);
  const [services, setServices] = React.useState<Service[]>([]);
  const [staff, setStaff] = React.useState<Staff[]>([]);

  const [newCustomer, setNewCustomer] = React.useState(false);
  const [customerId, setCustomerId] = React.useState('');
  const [newName, setNewName] = React.useState('');
  const [newPhone, setNewPhone] = React.useState('');
  const [serviceId, setServiceId] = React.useState('');
  const [staffId, setStaffId] = React.useState('');
  const [dayOfWeek, setDayOfWeek] = React.useState('');
  const [intervalWeeks, setIntervalWeeks] = React.useState('1');
  const [startTime, setStartTime] = React.useState('');
  const [weeks, setWeeks] = React.useState('4');
  const [note, setNote] = React.useState('');
  const [preview, setPreview] = React.useState<{ dates: string[]; overCap: number } | null>(null);
  const [error, setError] = React.useState('');
  const [saving, setSaving] = React.useState(false);

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

  /** 依星期幾 / 頻率 / 次數推算日期（在事件處理中計算，不在 render 用 Date.now） */
  const buildDates = () => {
    const total = Number(weeks);
    const step = Number(intervalWeeks);
    const targetDow = Number(dayOfWeek) % 7; // 原站 7 = 週日 → JS 的 0
    const cursor = new Date();
    cursor.setHours(0, 0, 0, 0);
    while (cursor.getDay() !== targetDow) cursor.setDate(cursor.getDate() + 1);

    const limit = new Date();
    limit.setDate(limit.getDate() + MAX_DAYS_AHEAD);

    const dates: string[] = [];
    let overCap = 0;
    for (let i = 0; i < total; i += 1) {
      if (cursor > limit) overCap += 1;
      else dates.push(formatDate(cursor.toISOString()));
      cursor.setDate(cursor.getDate() + step * 7);
    }
    return { dates, overCap };
  };

  const validate = (): string => {
    if (newCustomer) {
      if (!newName.trim() || !newPhone.trim()) return t.form.newCustomerInvalid;
    } else if (!customerId) {
      return t.form.customerInvalid;
    }
    if (!serviceId) return t.form.serviceInvalid;
    if (REQUIRE_STAFF && !staffId) return t.messages.staffRequired;
    if (!dayOfWeek) return t.form.dayOfWeekInvalid;
    if (!startTime) return t.form.startTimeInvalid;
    if (!weeks) return t.messages.requiredFields;
    return '';
  };

  const submit = async () => {
    const err = validate();
    setError(err);
    if (err) return;
    setSaving(true);
    try {
      await new Promise((r) => setTimeout(r, 500));
      const { dates, overCap } = buildDates();
      onCreated(dates.length, overCap);
    } catch {
      toast.show(`${t.messages.createFailed}${t.messages.unknownError}`, 'danger');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={t.form.createTitle}
      footer={
        <>
          <Button
            variant="outline"
            onClick={() => {
              if (!dayOfWeek || !intervalWeeks || !weeks) {
                setError(t.messages.previewRequired);
                return;
              }
              setError('');
              setPreview(buildDates());
            }}
          >
            <CalendarRange size={15} />{t.form.previewButton}
          </Button>
          <Button loading={saving} loadingText={t.form.submitting} onClick={() => void submit()}>
            {t.form.submit}
          </Button>
        </>
      }
    >
      <FormGroup>
        <Label required htmlFor="recCustomer">{t.form.customer}</Label>
        <label className="mb-2 flex items-center gap-1.5 text-base">
          <input
            id="recNewCustomerToggle" type="checkbox" checked={newCustomer}
            onChange={(e) => setNewCustomer(e.target.checked)}
          />
          {t.form.newCustomerToggle}
        </label>
        {newCustomer ? (
          <>
            <Input
              className="mb-2" value={newName} placeholder={t.form.newCustomerName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <Input
              type="tel" value={newPhone} placeholder={t.form.newCustomerPhone}
              onChange={(e) => setNewPhone(e.target.value)}
            />
          </>
        ) : (
          <Select id="recCustomer" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">{t.form.customerPlaceholder}</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{`${c.name}（${c.phone}）`}</option>
            ))}
          </Select>
        )}
        <FormText>{t.form.customerHelp}</FormText>
      </FormGroup>

      <div className="grid gap-x-4 md:grid-cols-2">
        <FormGroup>
          <Label required htmlFor="recService">{t.form.service}</Label>
          <Select id="recService" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
            <option value="">{t.form.servicePlaceholder}</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
          <FormText>{t.form.serviceHelp}</FormText>
        </FormGroup>

        <FormGroup>
          <Label htmlFor="recStaff">{t.form.staff}</Label>
          <Select id="recStaff" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
            <option value="">{t.form.staffAuto}</option>
            {staff.filter((s) => s.bookable).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
          <FormText>{t.form.staffHelp}</FormText>
        </FormGroup>

        <FormGroup>
          <Label required htmlFor="recDayOfWeek">{t.form.dayOfWeek}</Label>
          <Select id="recDayOfWeek" value={dayOfWeek} onChange={(e) => setDayOfWeek(e.target.value)}>
            <option value="">{t.form.dayOfWeekPlaceholder}</option>
            {t.form.weekdays.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </Select>
        </FormGroup>

        <FormGroup>
          <Label required htmlFor="recIntervalWeeks">{t.form.interval}</Label>
          <Select
            id="recIntervalWeeks" value={intervalWeeks}
            onChange={(e) => setIntervalWeeks(e.target.value)}
            options={t.form.intervalOptions.map((o) => ({ ...o }))}
          />
          <FormText>{t.form.intervalHelp}</FormText>
        </FormGroup>

        <FormGroup>
          <Label required htmlFor="recStartTime">{t.form.startTime}</Label>
          <Select id="recStartTime" value={startTime} onChange={(e) => setStartTime(e.target.value)}>
            <option value="">{t.form.startTimeInvalid}</option>
            {TIME_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
          </Select>
        </FormGroup>

        <FormGroup>
          <Label required htmlFor="recWeeks">{t.form.weeks}</Label>
          <Select
            id="recWeeks" value={weeks} onChange={(e) => setWeeks(e.target.value)}
            options={t.form.weeksOptions.map((o) => ({ ...o }))}
          />
          <FormText>{t.form.weeksHelp}</FormText>
        </FormGroup>
      </div>

      <FormGroup>
        <Label htmlFor="recNote">{t.form.note}</Label>
        <Input
          id="recNote" value={note} placeholder={t.form.notePlaceholder}
          onChange={(e) => setNote(e.target.value)}
        />
      </FormGroup>

      {preview ? (
        <div className="rounded-lg bg-neutral-50 p-3">
          <FormText className="mb-2">{t.form.previewIntro}</FormText>
          <div className="flex flex-wrap gap-1.5">
            {preview.dates.map((d) => <Badge key={d} tone="info">{d}</Badge>)}
          </div>
          {preview.overCap > 0 ? (
            <Alert tone="warning" className="mt-3">
              {t.messages.overCapWarning(Number(weeks), preview.overCap)}
            </Alert>
          ) : null}
        </div>
      ) : null}

      {error ? <FormError>{error}</FormError> : null}
    </Modal>
  );
}
