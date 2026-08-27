'use client';
import * as React from 'react';
import Link from 'next/link';
import {
  BadgeCheck, CalendarOff, ChevronDown, ChevronUp, Link2, Pencil, Plus, Tag, Trash2,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import {
  DataTable, DataTableContainer, DataTableFooter, DataTableHeader, type Column,
} from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmModal, Modal } from '@/components/ui/Modal';
import {
  CharCounter, FormError, FormGroup, FormText, Input, Label, Select, Textarea,
} from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import {
  createStaff, createStaffLeave, deleteStaff, deleteStaffLeave,
  listServices, listStaff, listStaffLeaves, updateStaff, type StaffLeave,
} from '@/services/catalog';
import { getTenantSettings, saveTenantSettings } from '@/services/settings';
import type { TenantSettings } from '@/config/tenant-settings';
import { byMode } from '@/mock';
import { common } from '@/i18n/zh-TW/common';
import { nav, resolveNavTerms } from '@/i18n/zh-TW/nav';
import { useBusinessType } from '@/components/layout/BusinessTypeContext';
import { staffPage as t } from '@/i18n/zh-TW/pages/staff';
import { formatDate, formatNumber } from '@/lib/utils';
import type { Service, Staff } from '@/lib/types';

/* -------------------------------------------------------------------------- */
/* 本頁專用假資料（不寫進 src/mock，避免與其他頁面衝突）                          */
/* -------------------------------------------------------------------------- */

/** 原站 Staff 另有顯示名稱／簡介／同時段最大預約數／前台顯示旗標 */
type StaffExtras = {
  displayName: string;
  bio: string;
  maxConcurrentBookings: number;
  visible: boolean;
};

const DEFAULT_EXTRAS: StaffExtras = {
  displayName: '', bio: '', maxConcurrentBookings: 1, visible: true,
};

const STAFF_EXTRAS_LOCAL_SHOP: Record<string, StaffExtras> = {
  s_1: { displayName: 'Amy 老師', bio: '10 年剪燙染資歷，擅長韓系空氣感瀏海。', maxConcurrentBookings: 1, visible: true },
  s_2: { displayName: '', bio: '擅長男士俐落短髮與頭皮養護。', maxConcurrentBookings: 1, visible: true },
  s_3: { displayName: '', bio: '', maxConcurrentBookings: 2, visible: false },
};

const STAFF_EXTRAS_GUIDE: Record<string, StaffExtras> = {
  s_1: { displayName: '阿海', bio: 'PADI 潛水長，10 年海域嚮導資歷，擅長賞鯨與浮潛行程。', maxConcurrentBookings: 1, visible: true },
  s_2: { displayName: '小雨', bio: '持有高山嚮導證，熟悉花東山域路線與溯溪安全評估。', maxConcurrentBookings: 1, visible: true },
  s_3: { displayName: '老陳船長', bio: '', maxConcurrentBookings: 1, visible: true },
  s_4: { displayName: 'Kai', bio: '攝影嚮導，擅長行程紀錄與空拍。', maxConcurrentBookings: 2, visible: false },
};

const STAFF_EXTRAS_CLINIC: Record<string, StaffExtras> = {
  s_1: { displayName: '林醫師', bio: '家庭醫學科主治醫師，專長慢性病長期追蹤與健康評估。', maxConcurrentBookings: 1, visible: true },
  s_2: { displayName: '陳醫師', bio: '健檢中心主任，專長成人健檢與異常報告判讀。', maxConcurrentBookings: 1, visible: true },
  s_3: { displayName: '王醫師', bio: '內科醫師，擅長一般內科疾病診治。', maxConcurrentBookings: 1, visible: true },
  s_4: { displayName: '護理師 小美', bio: '', maxConcurrentBookings: 2, visible: false },
};

/** 原站 /api/staff/${id}/leaves */
type LeaveRecord = {
  id: string;
  staffId: string;
  /** WEEKLY 時為代表日期，另以 dayOfWeek 標示每週重複 */
  date: string;
  dayOfWeek: number;
  recurrence: 'SINGLE' | 'WEEKLY';
  type: keyof typeof t.leave.typeOptions;
  reason: string;
  fullDay: boolean;
  startTime: string;
  endTime: string;
};

const MOCK_LEAVES: LeaveRecord[] = [
  { id: 'lv_1', staffId: 's_1', date: '2026-08-24', dayOfWeek: 1, recurrence: 'SINGLE', type: 'PERSONAL', reason: '家中有事', fullDay: true, startTime: '', endTime: '' },
  { id: 'lv_2', staffId: 's_1', date: '2026-08-28', dayOfWeek: 5, recurrence: 'WEEKLY', type: 'VACATION', reason: '', fullDay: false, startTime: '14:00', endTime: '18:00' },
  { id: 'lv_3', staffId: 's_2', date: '2026-09-02', dayOfWeek: 3, recurrence: 'SINGLE', type: 'SICK', reason: '身體不適', fullDay: true, startTime: '', endTime: '' },
];

/** 原站 /api/settings 的營業時間（班表／請假時段驗證用） */
const BUSINESS_HOURS = { start: '10:00', end: '20:00', breakStart: '14:00', breakEnd: '15:00' };

/** 原站免費版員工數量上限，超過需訂閱「無限員工」（129 點/月） */
const FREE_STAFF_LIMIT = 5;

/** 原站以「全員可做」標記未限制人員的服務 */
const ALL_STAFF_SERVICE_IDS = new Set<string>(['sv_4']);

const LEAVE_TYPE_OPTIONS = Object.entries(t.leave.typeOptions) as [LeaveRecord['type'], string][];

const WEEKDAY_OPTIONS = common.weekdays.map((label, value) => ({ value: String(value), label }));

const PHONE_RE = /^[0-9+\-() ]{6,}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* -------------------------------------------------------------------------- */

type StaffRow = Staff & StaffExtras;

const toRow = (s: Staff): StaffRow => {
  const extras = byMode({
    LOCAL_SHOP: STAFF_EXTRAS_LOCAL_SHOP, GUIDE: STAFF_EXTRAS_GUIDE, CLINIC: STAFF_EXTRAS_CLINIC,
  });
  return { ...s, ...(extras[s.id] ?? DEFAULT_EXTRAS) };
};

export default function StaffPage() {
  const toast = useToast();

  const [rows, setRows] = React.useState<StaffRow[]>([]);
  const [services, setServices] = React.useState<Service[]>([]);
  const [loading, setLoading] = React.useState(true);
  /**
   * 自訂員工稱呼 = `tenant_settings.basic.staffTerm`（PUT /api/settings 的 basic 群組）。
   * 端點是**整包覆蓋**該群組，所以必須留著整份 settings，儲存時只覆寫 staffTerm
   * 再送回去——否則店家名稱／電話／地址等欄位會被 zod 預設值洗掉。
   */
  const [settings, setSettings] = React.useState<TenantSettings | null>(null);
  const staffTerm = settings?.basic.staffTerm ?? '';
  const [termOpen, setTermOpen] = React.useState(false);

  const [formTarget, setFormTarget] = React.useState<StaffRow | null | undefined>(undefined);
  const [leaveTarget, setLeaveTarget] = React.useState<StaffRow | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<StaffRow | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const list = await listStaff();
      setRows([...list].sort((a, b) => a.sortOrder - b.sortOrder).map(toRow));
    } catch (e) {
      toast.show(
        `${t.messages.loadStaffFailed}${e instanceof Error ? e.message : t.messages.unknownError}`,
        'danger',
      );
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  React.useEffect(() => { void load(); }, [load]);

  React.useEffect(() => {
    void (async () => {
      try {
        setServices(await listServices());
      } catch {
        toast.show(t.messages.loadFailedRetry, 'danger');
      }
    })();
  }, [toast]);

  React.useEffect(() => {
    void (async () => {
      try {
        setSettings(await getTenantSettings());
      } catch {
        toast.show(t.staffTerm.loadFailed, 'danger');
      }
    })();
  }, [toast]);

  const upsert = (draft: StaffRow) => {
    setRows((list) => (list.some((s) => s.id === draft.id)
      ? list.map((s) => (s.id === draft.id ? draft : s))
      : [...list, draft]));
  };

  const move = (index: number, delta: number) => {
    setRows((list) => {
      const target = index + delta;
      if (target < 0 || target >= list.length) return list;
      const next = [...list];
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((s, i) => ({ ...s, sortOrder: i + 1 }));
    });
    toast.show(t.messages.reordered);
  };

  const copyLink = async (s: StaffRow) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/book/staff/${s.id}`);
      toast.show(t.messages.linkCopied);
    } catch (e) {
      toast.show(
        `${t.messages.linkFailedPrefix}${e instanceof Error ? e.message : t.messages.unknownError}`,
        'danger',
      );
    }
  };

  const overLimit = rows.length >= FREE_STAFF_LIMIT;

  /* ------------------------------------------------------------------ 欄位 */

  const columns: Column<StaffRow>[] = [
    {
      key: 'index', header: t.columns.index, numeric: true, width: '60px',
      render: (_s, i) => formatNumber(i + 1),
    },
    {
      key: 'info', header: t.columns.info,
      render: (s) => (
        <div className="flex items-start gap-2">
          <span
            aria-hidden
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-pill bg-neutral-200 text-xs font-semibold text-neutral-600"
          >
            {s.name.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0">
            <div className="font-semibold text-dark">{s.displayName || s.name}</div>
            {s.title ? <div className="text-xs text-secondary">{s.title}</div> : null}
            {s.bio ? <div className="text-2xs text-secondary">{s.bio}</div> : null}
          </div>
        </div>
      ),
    },
    {
      key: 'contact', header: t.columns.contact,
      render: (s) => (
        <div className="min-w-0">
          <div>{s.phone || common.none}</div>
          {s.email ? <div className="text-xs text-secondary">{s.email}</div> : null}
        </div>
      ),
    },
    {
      key: 'bookable', header: t.columns.bookable, width: '90px',
      render: (s) => (s.bookable
        ? <Badge tone="success">{t.labels.yes}</Badge>
        : <Badge tone="neutral">{t.labels.no}</Badge>),
    },
    {
      key: 'status', header: t.columns.status, width: '110px',
      render: (s) => (s.active
        ? <Badge tone="success">{t.status.active}</Badge>
        : <Badge tone="neutral">{t.status.inactive}</Badge>),
    },
    {
      key: 'actions', header: t.columns.actions, width: '220px',
      render: (s, i) => (
        <div className="btn-group">
          <Button
            variant="outline" size="sm" title={t.labels.moveUp} aria-label={t.labels.moveUp}
            disabled={i === 0} onClick={() => move(i, -1)}
          >
            <ChevronUp size={13} />
          </Button>
          <Button
            variant="outline" size="sm" title={t.labels.moveDown} aria-label={t.labels.moveDown}
            disabled={i === rows.length - 1} onClick={() => move(i, 1)}
          >
            <ChevronDown size={13} />
          </Button>
          <Button
            variant="outline" size="sm" title={t.actions.edit} aria-label={t.actions.edit}
            onClick={() => setFormTarget(s)}
          >
            <Pencil size={13} />
          </Button>
          <Button
            variant="outline" size="sm" title={t.actions.leave} aria-label={t.actions.leave}
            onClick={() => setLeaveTarget(s)}
          >
            <CalendarOff size={13} />
          </Button>
          <Button
            variant="outline" size="sm" title={t.actions.copyLink} aria-label={t.actions.copyLink}
            onClick={() => void copyLink(s)}
          >
            <Link2 size={13} />
          </Button>
          <Button
            variant="outlineDanger" size="sm" title={t.actions.delete} aria-label={t.actions.delete}
            onClick={() => setDeleteTarget(s)}
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
          <>
            <Button variant="ghost" onClick={() => setTermOpen(true)}>
              <Tag size={15} />{t.actions.staffTerm}
            </Button>
            <Button onClick={() => setFormTarget(null)}>
              <Plus size={15} />{t.actions.create}
            </Button>
          </>
        }
      />

      <Alert tone="info" className="mb-4">
        {t.shiftsTip.lead}
        {' '}
        <Link href="/tenant/shifts" title={t.shiftsTip.linkTitle} className="underline">
          {t.shiftsTip.link}
        </Link>
        {t.shiftsTip.tail}
      </Alert>

      {overLimit ? (
        <Alert
          tone="warning"
          className="mb-4"
          title={t.limit.reached(FREE_STAFF_LIMIT)}
          action={
            <Link href="/tenant/feature-store" className="btn btn-outline btn-sm">
              {t.limit.subscribe}
            </Link>
          }
        >
          <div>
            {t.limit.currentLead}
            <strong>{formatNumber(rows.length)}</strong>
            {t.limit.currentTail}
          </div>
          <div>{t.limit.upsell}</div>
        </Alert>
      ) : null}

      <DataTableContainer>
        <DataTableHeader title={t.tableTitle} />

        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          rowKey={(s) => s.id}
          scroll
          empty={
            <EmptyState
              icon={BadgeCheck}
              title={t.empty.title}
              description={t.empty.description}
              action={
                <Button onClick={() => setFormTarget(null)}>
                  <Plus size={15} />{t.actions.create}
                </Button>
              }
            />
          }
        />

        <DataTableFooter>
          <div className="data-table-info">
            {common.pagination.range(rows.length === 0 ? 0 : 1, rows.length, rows.length)}
          </div>
        </DataTableFooter>
      </DataTableContainer>

      {/* --------------------------------------------- modal 1：自訂員工稱呼 */}
      <StaffTermModal
        open={termOpen}
        settings={settings}
        onClose={() => setTermOpen(false)}
        onSaved={(next) => {
          setSettings(next);
          setTermOpen(false);
          const val = next.basic.staffTerm;
          toast.show(val ? t.staffTerm.changed(val) : t.staffTerm.restored);
        }}
      />

      {/* -------------------------------------------- modal 2：新增/編輯員工 */}
      <StaffFormModal
        open={formTarget !== undefined}
        staff={formTarget ?? null}
        services={services}
        onClose={() => setFormTarget(undefined)}
        onSaved={(draft, isEdit) => {
          upsert({ ...draft, sortOrder: isEdit ? draft.sortOrder : rows.length + 1 });
          setFormTarget(undefined);
          toast.show(isEdit ? t.messages.updated : t.messages.created);
        }}
      />

      {/* ------------------------------------------------- modal 3：請假管理 */}
      <LeaveModal staff={leaveTarget} onClose={() => setLeaveTarget(null)} />

      {/* ----------------------------------------------------- modal 4：確認 */}
      <ConfirmModal
        open={!!deleteTarget}
        danger
        loading={deleting}
        title={t.confirm.deleteTitle}
        confirmText={common.delete}
        message={t.confirm.delete}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          setDeleting(true);
          try {
            const res = await deleteStaff(deleteTarget.id);
            if (res.deactivated) {
              /* 後端因未來預約改為停用：保留該列並標記停用 */
              setRows((list) => list.map((s) => (
                s.id === deleteTarget.id ? { ...s, active: false } : s
              )));
            } else {
              setRows((list) => list.filter((s) => s.id !== deleteTarget.id));
            }
            setDeleteTarget(null);
            toast.show(res.message ?? t.messages.deleted);
          } catch (e) {
            toast.show(
              `${t.messages.deleteFailedPrefix}${e instanceof Error ? e.message : t.messages.unknownError}`,
              'danger',
            );
          } finally {
            setDeleting(false);
          }
        }}
      />
    </>
  );
}

/* ========================================================================== */
/* 自訂員工稱呼                                                                */
/* ========================================================================== */

/**
 * 自訂員工稱呼。
 *
 * ⚠️ 接線前這裡是 `await new Promise(r => setTimeout(r, 320))` 之後直接 onSaved()，
 * 於是畫面顯示「已將稱呼改為…」但沒有任何請求送出去，重新整理就回到空值
 * （14 分冊 §1 A-1）。現在寫進 `tenant_settings.basic.staffTerm`，成功訊息
 * 只在 `await saveTenantSettings(...)` 真的回來之後才由 onSaved() 觸發。
 */
function StaffTermModal({
  open, settings, onClose, onSaved,
}: {
  open: boolean;
  settings: TenantSettings | null;
  onClose: () => void;
  onSaved: (next: TenantSettings) => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (open) setDraft(settings?.basic.staffTerm ?? '');
  }, [open, settings]);

  const submit = async () => {
    if (!settings) return;
    const next: TenantSettings = {
      ...settings,
      basic: { ...settings.basic, staffTerm: draft.trim() },
    };
    setSaving(true);
    try {
      await saveTenantSettings({ basic: next.basic });
      onSaved(next);
    } catch (e) {
      toast.show(
        `${t.staffTerm.saveFailed}${e instanceof Error ? e.message : t.messages.unknownError}`,
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
      title={t.staffTerm.title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{common.cancel}</Button>
          <Button
            loading={saving} loadingText={common.saving} disabled={!settings}
            onClick={() => void submit()}
          >
            {common.save}
          </Button>
        </>
      }
    >
      <FormGroup>
        <Label htmlFor="staffTermInput">{t.staffTerm.label}</Label>
        <Input
          id="staffTermInput" value={draft} placeholder={t.staffTerm.placeholder}
          onChange={(e) => setDraft(e.target.value)}
        />
        <FormText>{t.staffTerm.help}</FormText>
      </FormGroup>
    </Modal>
  );
}

/* ========================================================================== */
/* 新增 / 編輯員工                                                             */
/* ========================================================================== */

const EMPTY_STAFF: StaffRow = {
  id: '', name: '', phone: '', email: '', title: '', avatarUrl: '',
  serviceIds: [], bookable: true, active: true, sortOrder: 0,
  displayName: '', bio: '', maxConcurrentBookings: 1, visible: true,
};

function StaffFormModal({
  open, staff, services, onClose, onSaved,
}: {
  open: boolean;
  staff: StaffRow | null;
  services: Service[];
  onClose: () => void;
  onSaved: (draft: StaffRow, isEdit: boolean) => void;
}) {
  /** 跨頁文案的「目錄／訂單」名稱依當下模式展開（14 分冊 §8.13） */
  const businessType = useBusinessType();
  const toast = useToast();
  const isEdit = !!staff;

  const [draft, setDraft] = React.useState<StaffRow>(EMPTY_STAFF);
  const [errors, setErrors] = React.useState<string[]>([]);
  const [saving, setSaving] = React.useState(false);
  /** 取消勾選「全員可做」服務時的二次確認 */
  const [confirmService, setConfirmService] = React.useState<Service | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setErrors([]);
    setDraft(staff ?? EMPTY_STAFF);
  }, [open, staff]);

  const patch = (p: Partial<StaffRow>) => setDraft((d) => ({ ...d, ...p }));

  const toggleService = (svc: Service, checked: boolean) => {
    if (!checked && ALL_STAFF_SERVICE_IDS.has(svc.id)) {
      setConfirmService(svc);
      return;
    }
    patch({
      serviceIds: checked
        ? [...draft.serviceIds, svc.id]
        : draft.serviceIds.filter((id) => id !== svc.id),
    });
  };

  const validate = (): string[] => {
    const list: string[] = [];
    if (!draft.name.trim() || draft.name.trim().length > 50) list.push(t.form.nameInvalid);
    if (draft.phone.trim() && !PHONE_RE.test(draft.phone.trim())) list.push(t.form.phoneInvalid);
    if (draft.email.trim() && !EMAIL_RE.test(draft.email.trim())) list.push(t.form.emailInvalid);
    if (draft.bio.length > t.form.bioMax) list.push(common.validation.maxLength(t.form.bioMax));
    return list;
  };

  const submit = async () => {
    const list = validate();
    setErrors(list);
    if (list.length) return;
    setSaving(true);
    try {
      /* API 契約欄位（頁面 StaffExtras 僅存在前端，不送出）；body 含 serviceIds[] */
      const payload = {
        name: draft.name,
        phone: draft.phone,
        email: draft.email,
        title: draft.title,
        avatarUrl: draft.avatarUrl,
        bookable: draft.bookable,
        active: draft.active,
        serviceIds: draft.serviceIds,
      };
      if (isEdit) {
        await updateStaff(draft.id, payload);
        onSaved(draft, true);
      } else {
        const { id } = await createStaff(payload);
        onSaved({ ...draft, id }, false);
      }
    } catch (e) {
      toast.show(
        `${t.messages.saveFailedPrefix}${e instanceof Error ? e.message : t.messages.unknownError}`,
        'danger',
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
        size="lg"
        title={isEdit ? t.form.editTitle : t.form.createTitle}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>{common.cancel}</Button>
            <Button loading={saving} loadingText={common.processing} onClick={() => void submit()}>
              {common.save}
            </Button>
          </>
        }
      >
        <p className="form-text mb-4">{common.requiredHint}</p>

        {/* ---------------------------------------------------------- 頭像 */}
        <FormGroup>
          <Label htmlFor="avatarInput">{t.form.avatar}</Label>
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-pill bg-neutral-200 text-md font-semibold text-neutral-600"
            >
              {(draft.name || '?').slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0">
              <Input
                id="avatarInput" type="file" accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file && file.size > 2 * 1024 * 1024) {
                    toast.show(t.form.avatarTooLarge, 'warning');
                    e.target.value = '';
                    return;
                  }
                  patch({ avatarUrl: file ? file.name : '' });
                }}
              />
              <FormText>{t.form.avatarHelp}</FormText>
            </div>
            {draft.avatarUrl ? (
              <Button variant="outline" size="sm" onClick={() => patch({ avatarUrl: '' })}>
                {t.form.avatarRemove}
              </Button>
            ) : null}
          </div>
        </FormGroup>

        <div className="grid gap-x-4 md:grid-cols-2">
          <FormGroup>
            <Label required htmlFor="staffName">{t.form.name}</Label>
            <Input
              id="staffName" value={draft.name} maxLength={50}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </FormGroup>

          <FormGroup>
            <Label htmlFor="staffDisplayName">{t.form.displayName}</Label>
            <Input
              id="staffDisplayName" value={draft.displayName}
              onChange={(e) => patch({ displayName: e.target.value })}
            />
            <FormText>{t.form.displayNameHelp}</FormText>
          </FormGroup>

          <FormGroup>
            <Label htmlFor="staffPhone">{t.form.phone}</Label>
            <Input
              id="staffPhone" type="tel" value={draft.phone}
              onChange={(e) => patch({ phone: e.target.value })}
            />
          </FormGroup>

          <FormGroup>
            <Label htmlFor="staffEmail">{t.form.email}</Label>
            <Input
              id="staffEmail" type="email" value={draft.email}
              onChange={(e) => patch({ email: e.target.value })}
            />
          </FormGroup>
        </div>

        <FormGroup>
          <Label htmlFor="staffBio">{t.form.bio}</Label>
          <Textarea
            id="staffBio" rows={3} value={draft.bio} maxLength={t.form.bioMax}
            onChange={(e) => patch({ bio: e.target.value })}
          />
          <div className="flex justify-end">
            <CharCounter value={draft.bio} max={t.form.bioMax} />
          </div>
        </FormGroup>

        <FormGroup>
          <Label htmlFor="staffMaxConcurrent">{t.form.maxConcurrentBookings}</Label>
          <Input
            id="staffMaxConcurrent" type="number" min={1} value={String(draft.maxConcurrentBookings)}
            onChange={(e) => patch({ maxConcurrentBookings: Number(e.target.value) || 1 })}
          />
          <FormText>{t.form.maxConcurrentBookingsHelp}</FormText>
        </FormGroup>

        {/* ------------------------------------------------ 可承接的服務項目 */}
        <FormGroup>
          <div className="mb-2 flex items-center justify-between gap-2">
            <Label className="mb-0">{resolveNavTerms(t.form.services, businessType)}</Label>
            <div className="btn-group">
              <Button
                variant="outline" size="sm"
                onClick={() => patch({ serviceIds: services.map((s) => s.id) })}
              >
                {t.form.servicesSelectAll}
              </Button>
              <Button variant="outline" size="sm" onClick={() => patch({ serviceIds: [] })}>
                {t.form.servicesClear}
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-1 rounded-md border border-neutral-250 p-3">
            {services.map((svc) => (
              <label key={svc.id} className="flex items-center gap-2 text-base">
                <input
                  type="checkbox"
                  checked={draft.serviceIds.includes(svc.id)}
                  onChange={(e) => toggleService(svc, e.target.checked)}
                />
                <span>{svc.name}</span>
                {ALL_STAFF_SERVICE_IDS.has(svc.id) ? (
                  <Badge tone="info">{t.labels.allStaffCapable}</Badge>
                ) : null}
              </label>
            ))}
          </div>
          <FormText>{resolveNavTerms(t.form.servicesHelp, businessType)}</FormText>
        </FormGroup>

        <label className="mb-2 flex items-center gap-2 text-base">
          <input
            type="checkbox" checked={draft.bookable}
            onChange={(e) => patch({ bookable: e.target.checked })}
          />
          {t.form.isBookable}
        </label>

        <label className="flex items-center gap-2 text-base">
          <input
            type="checkbox" checked={draft.visible}
            onChange={(e) => patch({ visible: e.target.checked })}
          />
          {t.form.isVisible}
        </label>

        {errors.length ? (
          <FormError>
            {t.form.validationLead}
            <ul className="list-disc pl-4">
              {errors.map((msg) => <li key={msg}>{msg}</li>)}
            </ul>
          </FormError>
        ) : null}
      </Modal>

      <ConfirmModal
        open={!!confirmService}
        title={resolveNavTerms(t.form.services, businessType)}
        message={confirmService ? t.form.unlinkAllStaffConfirm(confirmService.name) : common.confirm.message}
        onClose={() => setConfirmService(null)}
        onConfirm={() => {
          if (confirmService) {
            patch({ serviceIds: draft.serviceIds.filter((id) => id !== confirmService.id) });
          }
          setConfirmService(null);
        }}
      />
    </>
  );
}

/* ========================================================================== */
/* 請假管理                                                                    */
/* ========================================================================== */

type LeaveDraft = {
  type: LeaveRecord['type'];
  recurrence: LeaveRecord['recurrence'];
  date: string;
  dayOfWeek: string;
  reason: string;
  fullDay: boolean;
  startTime: string;
  endTime: string;
};

const EMPTY_LEAVE: LeaveDraft = {
  type: 'PERSONAL', recurrence: 'SINGLE', date: '', dayOfWeek: '1',
  reason: '', fullDay: true, startTime: '', endTime: '',
};

/**
 * API（staff_leaves）只有 {startAt, endAt, reason} 單一時間區間：
 * 類型／每週循環不在契約內，載入時以預設值補齊；整天以 00:00–23:59 判定。
 */
const fromApiLeave = (l: StaffLeave): LeaveRecord => {
  const date = l.startAt.slice(0, 10);
  const startTime = l.startAt.slice(11, 16);
  const endTime = l.endAt.slice(11, 16);
  const fullDay = startTime === '00:00' && (endTime === '23:59' || endTime === '00:00');
  return {
    id: l.id,
    staffId: l.staffId,
    date,
    dayOfWeek: new Date(`${date}T00:00:00`).getDay(),
    recurrence: 'SINGLE',
    type: 'PERSONAL',
    reason: l.reason,
    fullDay,
    startTime: fullDay ? '' : startTime,
    endTime: fullDay ? '' : endTime,
  };
};

function LeaveModal({ staff, onClose }: { staff: StaffRow | null; onClose: () => void }) {
  const toast = useToast();

  const [rows, setRows] = React.useState<LeaveRecord[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [draft, setDraft] = React.useState<LeaveDraft>(EMPTY_LEAVE);
  const [error, setError] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<LeaveRecord | null>(null);

  React.useEffect(() => {
    if (!staff) return;
    setDraft(EMPTY_LEAVE);
    setError('');
    setLoading(true);
    let cancelled = false;
    void (async () => {
      try {
        /* mock 分支回 null → 沿用 MOCK_LEAVES 篩選（行為不變） */
        const res = await listStaffLeaves(staff.id);
        if (cancelled) return;
        setRows(res ? res.map(fromApiLeave) : MOCK_LEAVES.filter((l) => l.staffId === staff.id));
      } catch (e) {
        if (cancelled) return;
        setRows([]);
        toast.show(
          `${t.messages.loadLeavesFailed}${e instanceof Error ? e.message : t.messages.unknownError}`,
          'danger',
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [staff, toast]);

  const patch = (p: Partial<LeaveDraft>) => setDraft((d) => ({ ...d, ...p }));

  /** 快速選擇：以事件當下的日期計算，render 期不碰 Date */
  const quickPick = (kind: 'TOMORROW' | 'NEXT_WEEKDAYS' | 'THIS_WEEKEND' | 'NEXT_WEEKEND') => {
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    const add = (days: number) => {
      const d = new Date(base);
      d.setDate(d.getDate() + days);
      return d.toISOString().slice(0, 10);
    };
    const dow = base.getDay();
    if (kind === 'TOMORROW') patch({ recurrence: 'SINGLE', date: add(1) });
    if (kind === 'NEXT_WEEKDAYS') patch({ recurrence: 'SINGLE', date: add(8 - dow) });
    if (kind === 'THIS_WEEKEND') patch({ recurrence: 'SINGLE', date: add((6 - dow + 7) % 7) });
    if (kind === 'NEXT_WEEKEND') patch({ recurrence: 'SINGLE', date: add(((6 - dow + 7) % 7) + 7) });
  };

  const validate = (): string => {
    if (draft.recurrence === 'SINGLE' && !draft.date) return t.validation.dateRequired;
    if (!draft.fullDay) {
      if (!draft.startTime || !draft.endTime) return t.validation.timeRequired;
      if (draft.startTime >= draft.endTime) return t.validation.startBeforeEnd;
      if (draft.startTime < BUSINESS_HOURS.start) {
        return t.validation.startBeforeBusiness(BUSINESS_HOURS.start);
      }
      if (draft.endTime > BUSINESS_HOURS.end) {
        return t.validation.endAfterBusiness(BUSINESS_HOURS.end);
      }
      if (draft.startTime >= BUSINESS_HOURS.breakStart && draft.endTime <= BUSINESS_HOURS.breakEnd) {
        return t.validation.overlapBreak(`${BUSINESS_HOURS.breakStart}–${BUSINESS_HOURS.breakEnd}`);
      }
    }
    return '';
  };

  const submit = async () => {
    if (!staff) return;
    const err = validate();
    setError(err);
    if (err) return;
    setSaving(true);
    try {
      /* API 只收 {startAt, endAt, reason}：每週循環以「下一個該星期」為代表日攤平送出
         （循環與類型不在契約內，僅保留於本地列表顯示）；整天以 00:00–23:59 表示 */
      const repDate = (() => {
        if (draft.recurrence === 'SINGLE') return draft.date;
        const base = new Date();
        base.setHours(0, 0, 0, 0);
        base.setDate(base.getDate() + ((Number(draft.dayOfWeek) - base.getDay() + 7) % 7));
        return base.toISOString().slice(0, 10);
      })();
      const { id } = await createStaffLeave(staff.id, {
        startAt: draft.fullDay ? `${repDate}T00:00:00` : `${repDate}T${draft.startTime}:00`,
        endAt: draft.fullDay ? `${repDate}T23:59:59` : `${repDate}T${draft.endTime}:00`,
        reason: draft.reason,
      });
      const record: LeaveRecord = {
        id,
        staffId: staff.id,
        date: draft.date,
        dayOfWeek: draft.recurrence === 'WEEKLY' ? Number(draft.dayOfWeek) : new Date(draft.date).getDay(),
        recurrence: draft.recurrence,
        type: draft.type,
        reason: draft.reason,
        fullDay: draft.fullDay,
        startTime: draft.fullDay ? '' : draft.startTime,
        endTime: draft.fullDay ? '' : draft.endTime,
      };
      setRows((list) => [...list, record]);
      setDraft(EMPTY_LEAVE);
      toast.show(
        draft.recurrence === 'WEEKLY' ? t.messages.leaveCreatedWeekly : t.messages.leaveCreated,
      );
    } catch (e) {
      toast.show(
        `${t.messages.createLeaveFailed}${e instanceof Error ? e.message : t.messages.unknownError}`,
        'danger',
      );
    } finally {
      setSaving(false);
    }
  };

  const columns: Column<LeaveRecord>[] = [
    {
      key: 'date', header: t.leave.columns.date, width: '150px',
      render: (l) => (l.recurrence === 'WEEKLY'
        ? <Badge tone="purple">{t.leave.weeklyBadge}</Badge>
        : formatDate(l.date)),
    },
    {
      key: 'weekday', header: t.leave.columns.weekday, width: '80px',
      render: (l) => common.weekdays[l.dayOfWeek],
    },
    {
      key: 'type', header: t.leave.columns.type, width: '110px',
      render: (l) => (
        <div className="flex flex-col items-start gap-1">
          <Badge tone="info">{t.leave.typeOptions[l.type]}</Badge>
          {l.fullDay
            ? <Badge tone="neutral">{t.leave.fullDayBadge}</Badge>
            : <span className="text-2xs text-secondary">{l.startTime}–{l.endTime}</span>}
        </div>
      ),
    },
    {
      key: 'reason', header: t.leave.columns.reason,
      render: (l) => l.reason || <span className="text-muted">{common.none}</span>,
    },
    {
      key: 'actions', header: t.leave.columns.actions, width: '80px',
      render: (l) => (
        <Button
          variant="outlineDanger" size="sm" title={common.delete} aria-label={common.delete}
          onClick={() => setDeleteTarget(l)}
        >
          <Trash2 size={13} />
        </Button>
      ),
    },
  ];

  return (
    <>
      <Modal
        open={!!staff}
        onClose={onClose}
        size="lg"
        title={t.leave.titleWith(staff?.name ?? '')}
        footer={<Button variant="secondary" onClick={onClose}>{common.close}</Button>}
      >
        <h6 className="mb-3 text-base font-bold text-dark">{t.leave.createSectionTitle}</h6>

        <div className="grid gap-x-4 md:grid-cols-2">
          <FormGroup>
            <Label htmlFor="leaveType">{t.leave.type}</Label>
            <Select
              id="leaveType" value={draft.type}
              onChange={(e) => patch({ type: e.target.value as LeaveRecord['type'] })}
            >
              {LEAVE_TYPE_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </Select>
          </FormGroup>

          <FormGroup>
            <Label>{t.leave.recurrence}</Label>
            <div className="btn-group">
              <Button
                size="sm" variant={draft.recurrence === 'SINGLE' ? 'primary' : 'outline'}
                onClick={() => patch({ recurrence: 'SINGLE' })}
              >
                {t.leave.recurrenceSingle}
              </Button>
              <Button
                size="sm" variant={draft.recurrence === 'WEEKLY' ? 'primary' : 'outline'}
                onClick={() => patch({ recurrence: 'WEEKLY' })}
              >
                {t.leave.recurrenceWeekly}
              </Button>
            </div>
          </FormGroup>

          {draft.recurrence === 'SINGLE' ? (
            <FormGroup>
              <Label required htmlFor="leaveDate">{t.leave.date}</Label>
              <Input
                id="leaveDate" type="date" value={draft.date}
                onChange={(e) => patch({ date: e.target.value })}
              />
              <FormText>{t.leave.dateHelp}</FormText>
            </FormGroup>
          ) : (
            <FormGroup>
              <Label required htmlFor="leaveDayOfWeek">{t.leave.dayOfWeek}</Label>
              <Select
                id="leaveDayOfWeek" value={draft.dayOfWeek} options={WEEKDAY_OPTIONS}
                onChange={(e) => patch({ dayOfWeek: e.target.value })}
              />
            </FormGroup>
          )}

          <FormGroup>
            <Label htmlFor="leaveReason">{t.leave.reason}</Label>
            <Input
              id="leaveReason" value={draft.reason} placeholder={t.leave.reasonPlaceholder}
              onChange={(e) => patch({ reason: e.target.value })}
            />
          </FormGroup>
        </div>

        {draft.recurrence === 'SINGLE' ? (
          <FormGroup>
            <Label>{t.leave.quickPick}</Label>
            <div className="btn-group flex-wrap">
              <Button variant="outline" size="sm" onClick={() => quickPick('TOMORROW')}>
                {t.leave.quickTomorrow}
              </Button>
              <Button variant="outline" size="sm" onClick={() => quickPick('NEXT_WEEKDAYS')}>
                {t.leave.quickNextWeekdays}
              </Button>
              <Button variant="outline" size="sm" onClick={() => quickPick('THIS_WEEKEND')}>
                {t.leave.quickThisWeekend}
              </Button>
              <Button variant="outline" size="sm" onClick={() => quickPick('NEXT_WEEKEND')}>
                {t.leave.quickNextWeekend}
              </Button>
            </div>
            {draft.date ? (
              <FormText>{t.leave.selectedDatesWith(formatDate(draft.date))}</FormText>
            ) : null}
          </FormGroup>
        ) : null}

        <label className="mb-3 flex items-center gap-2 text-base">
          <input
            type="checkbox" checked={draft.fullDay}
            onChange={(e) => patch({ fullDay: e.target.checked })}
          />
          {t.leave.fullDay}
        </label>

        {!draft.fullDay ? (
          <div className="grid gap-x-4 md:grid-cols-2">
            <FormGroup>
              <Label htmlFor="leaveStartTime">{t.leave.startTime}</Label>
              <Input
                id="leaveStartTime" type="time" value={draft.startTime}
                onChange={(e) => patch({ startTime: e.target.value })}
              />
            </FormGroup>
            <FormGroup>
              <Label htmlFor="leaveEndTime">{t.leave.endTime}</Label>
              <Input
                id="leaveEndTime" type="time" value={draft.endTime}
                onChange={(e) => patch({ endTime: e.target.value })}
              />
            </FormGroup>
          </div>
        ) : null}

        {error ? <FormError>{error}</FormError> : null}

        <Button loading={saving} loadingText={t.leave.submitting} onClick={() => void submit()}>
          <Plus size={15} />{t.leave.submit}
        </Button>

        {/* ------------------------------------------------------ 已排定請假 */}
        <div className="mt-6">
          <h6 className="text-base font-bold text-dark">{t.leave.listTitle}</h6>
          <p className="form-text mb-2">{t.leave.listHint}</p>

          <DataTableContainer>
            <DataTable
              columns={columns}
              rows={rows}
              loading={loading}
              rowKey={(l) => l.id}
              empty={<EmptyState icon={CalendarOff} title={t.leave.emptyText} />}
            />
          </DataTableContainer>
        </div>
      </Modal>

      <ConfirmModal
        open={!!deleteTarget}
        danger
        title={common.delete}
        confirmText={common.delete}
        message={t.leave.deleteConfirm}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget && staff) {
            const target = deleteTarget;
            setRows((list) => list.filter((l) => l.id !== target.id));
            void deleteStaffLeave(staff.id, target.id).catch((e) => {
              toast.show(
                `${t.messages.deleteLeaveFailed}${e instanceof Error ? e.message : t.messages.unknownError}`,
                'danger',
              );
            });
          }
          setDeleteTarget(null);
          toast.show(t.messages.leaveDeleted);
        }}
      />
    </>
  );
}
