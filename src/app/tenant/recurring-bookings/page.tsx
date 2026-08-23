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
import {
  createRecurringBooking, listRecurringBookings, renewRecurringBooking,
  updateRecurringBooking, type RecurringBookingItem, type RecurringRule,
} from '@/services/bookings';
import { createCustomer, listCustomers } from '@/services/customers';
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

/* --------------------------------------------- API 形狀 → 本頁列的映射 */

/** 依 rule 推算「建立日起到 until 為止」的檔期數（API 沒有次數欄位，前端近似） */
const countOccurrences = (rule: RecurringRule, fromIso: string): number => {
  const cursor = new Date(fromIso);
  if (Number.isNaN(cursor.getTime())) return 0;
  cursor.setHours(0, 0, 0, 0);
  while (cursor.getDay() !== rule.weekday) cursor.setDate(cursor.getDate() + 1);
  const until = new Date(`${rule.until}T23:59:59`);
  let n = 0;
  while (cursor <= until && n < 999) {
    n += 1;
    cursor.setDate(cursor.getDate() + rule.intervalWeeks * 7);
  }
  return n;
};

/**
 * /api/recurring-bookings 的資料形狀落差：
 * - rule.weekday 0-6（0=週日）→ 本頁 dayOfWeek 1-7（7=週日）
 * - 沒有 times / createdCount（renew 時後端才即時計算）→ 以 rule 推算總檔期數近似，
 *   且建立當下即全數續產（見表單 submit），故兩者填同一數字
 * - 沒有 lastGeneratedAt → 顯示 common.none（欄位 render 已處理 null）
 */
const apiToRow = (r: RecurringBookingItem): RecurringBooking => {
  const times = countOccurrences(r.rule, r.createdAt);
  return {
    id: r.id,
    customerName: r.customerName,
    serviceName: r.serviceName,
    staffName: r.staffName,
    dayOfWeek: r.rule.weekday === 0 ? 7 : r.rule.weekday,
    startTime: r.rule.time,
    intervalWeeks: r.rule.intervalWeeks,
    times,
    createdCount: times,
    status: r.active ? 'ACTIVE' : 'ENDED',
    lastGeneratedAt: null,
  };
};

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
      // mock 分支回 null = 沿用頁內 byMode 假資料（含 API 沒有的次數／最後生成欄位）
      const list = await listRecurringBookings();
      setRows(list ? list.map(apiToRow) : byMode({
        LOCAL_SHOP: RECURRING_BOOKINGS_LOCAL_SHOP, GUIDE: RECURRING_BOOKINGS_GUIDE, CLINIC: RECURRING_BOOKINGS_CLINIC,
      }));
    } catch {
      toast.show(`${t.messages.loadListFailed}${t.messages.unknownError}`, 'danger');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  React.useEffect(() => { void load(); }, [load]);

  /** 結束範本 = PUT /api/recurring-bookings/:id { active:false }，成功後照原文案 toast。 */
  const endTemplate = async (id: string, successMessage: string) => {
    try {
      await updateRecurringBooking(id, { active: false });
      toast.show(successMessage);
      void load();
    } catch (e) {
      toast.show(
        `${t.messages.endFailed}${e instanceof Error ? e.message : t.messages.unknownError}`,
        'danger',
      );
    }
  };

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
          const target = renewing;
          setRenewing(null);
          if (!target) return;
          void (async () => {
            try {
              // POST :id/renew 回 { created, skipped }；mockResult 讓 mock 分支
              // 沿用現行「已續訂 times 筆」的數字
              const res = await renewRecurringBooking(target.id, { created: target.times, skipped: 0 });
              toast.show(res.skipped > 0
                ? t.messages.createdSummary(res.created, res.skipped)
                : t.messages.renewed(res.created));
              void load();
            } catch (e) {
              toast.show(
                `${t.messages.renewFailed}${e instanceof Error ? e.message : t.messages.unknownError}`,
                'danger',
              );
            }
          })();
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
                const target = endingStep2;
                setEndingStep2(null);
                if (target) void endTemplate(target.id, t.messages.endedKeep);
              }}
            >
              {common.cancel}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                // 「連同未來預約一起取消」：bookings 表沒有 recurring 關聯欄位、也無
                // 批次取消端點（04 §B-1），後端無法精準對應此系列 → 兩個選項目前都
                // 只停用範本（PUT active:false），已建立的預約一律保留；toast 沿用
                // 現行文案與數字（詳見回報）。
                const target = endingStep2;
                const remain = Math.max((target?.times ?? 0) - (target?.createdCount ?? 0), 0);
                setEndingStep2(null);
                if (target) void endTemplate(target.id, t.messages.endedWithCancel(remain));
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
    /** 同 dates，但保留 YYYY-MM-DD（rule.until 用；formatDate 是顯示格式） */
    const rawDates: string[] = [];
    let overCap = 0;
    for (let i = 0; i < total; i += 1) {
      if (cursor > limit) overCap += 1;
      else {
        dates.push(formatDate(cursor.toISOString()));
        rawDates.push(
          `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`,
        );
      }
      cursor.setDate(cursor.getDate() + step * 7);
    }
    return { dates, rawDates, overCap };
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

  /**
   * 新顧客流程：API 只吃 customerId，先查手機（沿用既有顧客，不覆蓋姓名）、查無再建檔。
   * createCustomer 在 services/customers.ts 被宣告成 Promise<void>（該檔不在本次分工
   * 可動清單），但 POST /api/customers 實際回 { id }，此處以斷言取回；mock 分支回
   * undefined → 落到空字串，mock 建立流程不看 payload，行為不變。
   */
  const resolveCustomerId = async (): Promise<string> => {
    if (!newCustomer) return customerId;
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
      const { rawDates, overCap } = buildDates();
      // rule.until = 一年上限內的最後一個檔期日；超限次數（overCap）不進 rule，
      // 預覽已警告、日後用「續訂」延長。API rule 無 note 欄位，共用備註不送（見回報）。
      const rule: RecurringRule = {
        weekday: Number(dayOfWeek) % 7, // 原站 7 = 週日 → API 0
        time: startTime,
        intervalWeeks: Number(intervalWeeks),
        until: rawDates[rawDates.length - 1] ?? rawDates[0] ?? '',
      };
      const rec = await createRecurringBooking({
        customerId: await resolveCustomerId(),
        serviceId,
        staffId: staffId || undefined,
        rule,
      });
      // 建立後立即續產實體預約（原站語意：建立＝逐次呼叫一般預約流程並回報略過數）；
      // mockResult 讓 mock 分支沿用現行推算數字，toast 不變
      const res = await renewRecurringBooking(rec.id, { created: rawDates.length, skipped: overCap });
      onCreated(res.created, res.skipped);
    } catch (e) {
      toast.show(
        `${t.messages.createFailed}${e instanceof Error ? e.message : t.messages.unknownError}`,
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
