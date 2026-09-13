'use client';
import * as React from 'react';
import Link from 'next/link';
import {
  ChevronDown, ChevronUp, Copy, FolderPlus, Globe, ListChecks, Pencil, Plus,
  RefreshCcw, Sparkles, Star, Trash2,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { Card, CardBody } from '@/components/ui/Card';
import {
  DataTable, DataTableContainer, DataTableFooter, DataTableHeader, type Column,
} from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmModal, Modal } from '@/components/ui/Modal';
import {
  FormError, FormGroup, FormText, Input, Label, Select, Switch, Textarea,
} from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import {
  createService, createServiceCategory, deleteService, deleteServiceCategory,
  duplicateService, listServiceCategories, listServices, listStaff,
  reorderServiceCategories, reorderServices, toggleServiceLineFeatured, updateService,
  updateServiceCategory,
} from '@/services/catalog';
import { byMode } from '@/mock';
import { common } from '@/i18n/zh-TW/common';
import { nav } from '@/i18n/zh-TW/nav';
import { servicesPage as t } from '@/i18n/zh-TW/pages/services';
import { formatCurrency, formatNumber } from '@/lib/utils';
import type { Service, Staff } from '@/lib/types';

/* -------------------------------------------------------------------------- */
/* 本頁專用假資料（不寫進 src/mock，避免與其他頁面衝突）                          */
/* -------------------------------------------------------------------------- */

/** 原站 /api/service-categories */
type ServiceCategory = {
  id: string;
  name: string;
  description: string;
  active: boolean;
  sortOrder: number;
};

const CATEGORIES_LOCAL_SHOP: ServiceCategory[] = [
  { id: 'sc_1', name: '剪髮', description: '洗剪吹相關服務', active: true, sortOrder: 1 },
  { id: 'sc_2', name: '染燙', description: '', active: true, sortOrder: 2 },
  { id: 'sc_3', name: '護理', description: '頭皮與髮質護理', active: true, sortOrder: 3 },
];

/** 嚮導模式的「服務項目」多半改用行程/方案（見 tenant/trips），此處僅保留少量客製服務分類 */
const CATEGORIES_GUIDE: ServiceCategory[] = [
  { id: 'sc_1', name: '客製諮詢', description: '包團規劃、行前討論', active: true, sortOrder: 1 },
  { id: 'sc_2', name: '加購服務', description: '接駁、攝影紀錄等單次加購', active: true, sortOrder: 2 },
];

const CATEGORIES_CLINIC: ServiceCategory[] = [
  { id: 'sc_1', name: '一般門診', description: '初診、複診相關服務', active: true, sortOrder: 1 },
  { id: 'sc_2', name: '健檢', description: '健康檢查與健檢加項', active: true, sortOrder: 2 },
  { id: 'sc_3', name: '疫苗', description: '公費／自費疫苗接種', active: true, sortOrder: 3 },
];

/** 原站 Service 另有住宿／號碼掛號／人員需求／緩衝／線上收款等旗標 */
type ServiceExtras = {
  requiresStaff: boolean;
  maxCapacity: number;
  overnightMode: boolean;
  checkInTime: string;
  checkOutTime: string;
  queueModeEnabled: boolean;
  bufferAfter: number;
  onlinePaymentMode: 'NONE' | 'DEPOSIT_FIXED' | 'DEPOSIT_PERCENT' | 'FULL';
  onlineDepositValue: number;
  staffIds: string[];
  publicSortOrder: number;
};

const DEFAULT_EXTRAS: ServiceExtras = {
  requiresStaff: true, maxCapacity: 1, overnightMode: false,
  checkInTime: '15:00', checkOutTime: '11:00', queueModeEnabled: false,
  bufferAfter: 0, onlinePaymentMode: 'NONE', onlineDepositValue: 0,
  staffIds: [], publicSortOrder: 0,
};

const MOCK_SERVICE_EXTRAS: Record<string, Partial<ServiceExtras>> = {
  sv_1: { staffIds: ['s_1', 's_2'], bufferAfter: 15, publicSortOrder: 1 },
  sv_2: { staffIds: ['s_1'], bufferAfter: 30, onlinePaymentMode: 'DEPOSIT_FIXED', onlineDepositValue: 500, publicSortOrder: 2 },
  sv_3: { staffIds: ['s_2', 's_3'], publicSortOrder: 3 },
  sv_4: { requiresStaff: false, maxCapacity: 4, publicSortOrder: 4 },
};

/** LINE 精選最多顯示的件數（原站硬性上限） */
const LINE_FEATURED_MAX = 11;
/** 其他圖片上限 */
const EXTRA_IMAGE_MAX = 8;

const CATEGORY_ALL = '';
const CATEGORY_NONE = 'none';

/* -------------------------------------------------------------------------- */

type ServiceRow = Service & ServiceExtras;

const toRow = (s: Service): ServiceRow => ({
  ...s,
  ...DEFAULT_EXTRAS,
  ...(MOCK_SERVICE_EXTRAS[s.id] ?? {}),
});

type SortMode = 'line' | 'public';

export default function ServicesPage() {
  const toast = useToast();

  const [rows, setRows] = React.useState<ServiceRow[]>([]);
  const [categories, setCategories] = React.useState<ServiceCategory[]>(() => byMode({
    LOCAL_SHOP: CATEGORIES_LOCAL_SHOP, GUIDE: CATEGORIES_GUIDE, CLINIC: CATEGORIES_CLINIC,
  }));
  const [staff, setStaff] = React.useState<Staff[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [tipsOpen, setTipsOpen] = React.useState(true);

  const [categoryFilter, setCategoryFilter] = React.useState<string>(CATEGORY_ALL);
  const [sortMode, setSortMode] = React.useState<SortMode>('line');

  const [formTarget, setFormTarget] = React.useState<ServiceRow | null | undefined>(undefined);
  const [categoryOpen, setCategoryOpen] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<ServiceRow | null>(null);
  const [syncOpen, setSyncOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const list = await listServices();
      setRows(list.map(toRow));
    } catch (e) {
      toast.show(
        `${t.messages.loadServicesFailed}${e instanceof Error ? e.message : t.messages.unknownError}`,
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
        setStaff(await listStaff());
      } catch {
        toast.show(t.messages.retryLater, 'danger');
      }
    })();
  }, [toast]);

  /** 分類清單：mock 分支回 null → 沿用 byMode 頁內假資料（行為不變） */
  React.useEffect(() => {
    void (async () => {
      try {
        const list = await listServiceCategories();
        if (list) setCategories(list);
      } catch {
        toast.show(t.messages.retryLater, 'danger');
      }
    })();
  }, [toast]);

  const orderOf = React.useCallback(
    (s: ServiceRow) => (sortMode === 'line' ? s.sortOrder : s.publicSortOrder),
    [sortMode],
  );

  const visible = React.useMemo(() => {
    const filtered = categoryFilter === CATEGORY_ALL
      ? rows
      : categoryFilter === CATEGORY_NONE
        ? rows.filter((s) => !s.categoryId)
        : rows.filter((s) => s.categoryId === categoryFilter);
    return [...filtered].sort((a, b) => orderOf(a) - orderOf(b));
  }, [rows, categoryFilter, orderOf]);

  const lineFeaturedCount = rows.filter((s) => s.lineFeatured).length;
  const uncategorizedCount = rows.filter((s) => !s.categoryId).length;

  /** LINE 排序落地（僅 line 模式；publicSortOrder 為頁面欄位，API 無對應端點） */
  const persistLineOrder = (list: ServiceRow[]) => {
    const ids = [...list].sort((a, b) => a.sortOrder - b.sortOrder).map((s) => s.id);
    void reorderServices(ids).catch((e) => {
      toast.show(e instanceof Error ? e.message : t.messages.reorderFailed, 'danger');
    });
  };

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= visible.length) return;
    const reordered = [...visible];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    const orderById = new Map(reordered.map((s, i) => [s.id, i + 1]));
    const next = rows.map((s) => {
      const order = orderById.get(s.id);
      if (order === undefined) return s;
      return sortMode === 'line' ? { ...s, sortOrder: order } : { ...s, publicSortOrder: order };
    });
    setRows(next);
    toast.show(sortMode === 'line' ? t.messages.lineOrderUpdated : t.messages.publicOrderUpdated);
    if (sortMode === 'line') persistLineOrder(next);
  };

  const toggleLine = (s: ServiceRow) => {
    if (!s.lineFeatured && lineFeaturedCount >= LINE_FEATURED_MAX) {
      toast.show(`${t.form.limitReached}${LINE_FEATURED_MAX}`, 'warning');
      return;
    }
    setRows((list) => list.map((x) => (x.id === s.id ? { ...x, lineFeatured: !x.lineFeatured } : x)));
    toast.show(s.lineFeatured ? t.messages.lineHidden : t.messages.lineShown);
    void toggleServiceLineFeatured(s.id, !s.lineFeatured)
      .then(({ lineFeatured }) => {
        setRows((list) => list.map((x) => (x.id === s.id ? { ...x, lineFeatured } : x)));
      })
      .catch((e) => {
        setRows((list) => list.map((x) => (x.id === s.id ? { ...x, lineFeatured: s.lineFeatured } : x)));
        toast.show(
          `${t.messages.toggleFailedPrefix}${e instanceof Error ? e.message : t.messages.unknownError}`,
          'danger',
        );
      });
  };

  const duplicate = async (s: ServiceRow) => {
    try {
      const { id } = await duplicateService(s.id);
      const copy: ServiceRow = { ...s, id, sortOrder: rows.length + 1 };
      setRows((list) => [...list, copy]);
      toast.show(t.messages.duplicated);
    } catch (e) {
      toast.show(
        `${t.messages.duplicateFailedPrefix}${e instanceof Error ? e.message : t.messages.unknownError}`,
        'danger',
      );
    }
  };

  const upsert = (draft: ServiceRow) => {
    setRows((list) => (list.some((s) => s.id === draft.id)
      ? list.map((s) => (s.id === draft.id ? draft : s))
      : [...list, draft]));
  };

  const fromLabel = sortMode === 'line' ? t.toolbar.lineLabel : t.toolbar.publicLabel;
  const toModeLabel = sortMode === 'line' ? t.toolbar.publicShort : t.toolbar.lineShort;

  /* ------------------------------------------------------------------ 欄位 */

  const columns: Column<ServiceRow>[] = [
    {
      key: 'name', header: t.columns.name,
      render: (s, i) => (
        <div className="flex items-start gap-2">
          <span className="btn-group">
            <Button
              variant="ghost" size="sm" title={t.labels.moveUp} aria-label={t.labels.moveUp}
              disabled={i === 0} onClick={() => move(i, -1)}
            >
              <ChevronUp size={13} />
            </Button>
            <Button
              variant="ghost" size="sm" title={t.labels.moveDown} aria-label={t.labels.moveDown}
              disabled={i === visible.length - 1} onClick={() => move(i, 1)}
            >
              <ChevronDown size={13} />
            </Button>
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-semibold text-dark">{s.name}</span>
              {s.overnightMode ? <Badge tone="purple">{t.labels.overnightBadge}</Badge> : null}
              {s.queueModeEnabled ? <Badge tone="info">{t.labels.queueBadge}</Badge> : null}
              {!s.requiresStaff && !s.overnightMode && !s.queueModeEnabled ? (
                <Badge tone="warning">{t.labels.capacityMode}</Badge>
              ) : null}
            </div>
            {s.description ? <div className="text-xs text-secondary">{s.description}</div> : null}
          </div>
        </div>
      ),
    },
    {
      key: 'category', header: t.columns.category, width: '110px',
      render: (s) => (s.categoryName
        ? <Badge tone="neutral">{s.categoryName}</Badge>
        : <span className="text-muted">{t.toolbar.uncategorized}</span>),
    },
    {
      key: 'price', header: t.columns.price, numeric: true, width: '140px',
      render: (s) => (
        <div>
          <div>{formatCurrency(s.price)}</div>
          {s.overnightMode ? (
            <div className="text-2xs text-secondary">{t.labels.overnightPriceBadge}</div>
          ) : null}
        </div>
      ),
    },
    {
      key: 'duration', header: t.columns.duration, numeric: true, width: '110px',
      render: (s) => (s.queueModeEnabled
        ? <span className="text-muted">{common.none}</span>
        : `${formatNumber(s.durationMinutes)}${t.labels.minutes}`),
    },
    {
      key: 'status', header: t.columns.status, width: '90px',
      render: (s) => (s.active
        ? <Badge tone="success">{t.labels.active}</Badge>
        : <Badge tone="neutral">{t.labels.inactive}</Badge>),
    },
    {
      key: 'line', header: t.columns.line, width: '80px',
      render: (s) => (
        <Button
          variant="ghost" size="sm"
          title={s.lineFeatured ? t.labels.lineShown : t.labels.lineHidden}
          aria-label={s.lineFeatured ? t.labels.lineShown : t.labels.lineHidden}
          onClick={() => toggleLine(s)}
        >
          <Star size={15} className={s.lineFeatured ? 'text-warning' : 'text-neutral-400'} />
        </Button>
      ),
    },
    {
      key: 'actions', header: t.columns.actions, width: '150px',
      render: (s) => (
        <div className="btn-group">
          <Button
            variant="outline" size="sm" title={t.actions.edit} aria-label={t.actions.edit}
            onClick={() => setFormTarget(s)}
          >
            <Pencil size={13} />
          </Button>
          <Button
            variant="outline" size="sm" title={t.actions.duplicate} aria-label={t.actions.duplicate}
            onClick={() => void duplicate(s)}
          >
            <Copy size={13} />
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
            <Button variant="outline" onClick={() => setCategoryOpen(true)}>
              <FolderPlus size={15} />{t.actions.manageCategory}
            </Button>
            <Button onClick={() => setFormTarget(null)}>
              <Plus size={15} />{t.actions.create}
            </Button>
          </>
        }
      />

      {/* ------------------------------------------------------ 使用小提醒卡 */}
      <Card className="mb-3">
        <CardBody>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-base font-bold text-dark">
              <Sparkles size={15} />{t.tips.title}
            </div>
            <Button
              variant="ghost" size="sm"
              aria-expanded={tipsOpen}
              aria-label={t.tips.title}
              onClick={() => setTipsOpen((v) => !v)}
            >
              {tipsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </Button>
          </div>
          {tipsOpen ? (
            <ul className="mt-2 flex list-disc flex-col gap-1 pl-4 text-xs text-neutral-700">
              {t.tips.items.map((item) => (
                <li key={item.term}>
                  <strong>{item.term}</strong>{item.text}
                </li>
              ))}
            </ul>
          ) : null}
        </CardBody>
      </Card>

      {/* --------------------------------------------------- 篩選 / 排序模式 */}
      <Card className="mb-3">
        <CardBody>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-neutral-700">{t.toolbar.filterLabel}</span>
            <Button
              size="sm" variant={categoryFilter === CATEGORY_ALL ? 'primary' : 'outline'}
              onClick={() => setCategoryFilter(CATEGORY_ALL)}
            >
              {t.toolbar.filterAll}
              <span className="badge badge-neutral">{t.toolbar.filterCount(rows.length)}</span>
            </Button>
            {categories.map((c) => (
              <Button
                key={c.id} size="sm"
                variant={categoryFilter === c.id ? 'primary' : 'outline'}
                onClick={() => setCategoryFilter(c.id)}
              >
                {c.name}
              </Button>
            ))}
            {uncategorizedCount > 0 ? (
              <Button
                size="sm" variant={categoryFilter === CATEGORY_NONE ? 'primary' : 'outline'}
                onClick={() => setCategoryFilter(CATEGORY_NONE)}
              >
                {t.toolbar.uncategorized}
                <span className="badge badge-neutral">{t.toolbar.filterCount(uncategorizedCount)}</span>
              </Button>
            ) : null}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-neutral-700">{t.toolbar.sortModeLabel}</span>
            <div className="btn-group">
              <Button
                size="sm" variant={sortMode === 'line' ? 'primary' : 'outline'}
                onClick={() => setSortMode('line')}
              >
                <Sparkles size={13} />{t.toolbar.sortModeLine}
              </Button>
              <Button
                size="sm" variant={sortMode === 'public' ? 'primary' : 'outline'}
                onClick={() => setSortMode('public')}
              >
                <Globe size={13} />{t.toolbar.sortModePublic}
              </Button>
            </div>
            <Button size="sm" variant="outline" onClick={() => setSyncOpen(true)}>
              <RefreshCcw size={13} />
              {sortMode === 'line' ? t.toolbar.syncToPublic : t.toolbar.syncToLine}
            </Button>
          </div>

          <p className="form-text">
            {t.toolbar.lineFeaturedLead}
            <strong>{t.toolbar.lineFeaturedCount(lineFeaturedCount)}</strong>
            {t.toolbar.lineFeaturedMax}
          </p>
          {lineFeaturedCount > LINE_FEATURED_MAX ? (
            <p className="form-error">{t.toolbar.lineFeaturedOver}</p>
          ) : null}
          {sortMode === 'public' ? (
            <p className="form-text">{t.toolbar.publicOrderHint}</p>
          ) : null}
        </CardBody>
      </Card>

      {uncategorizedCount > LINE_FEATURED_MAX ? (
        <Alert tone="warning" className="mb-3">
          <div>
            {t.uncategorizedWarning.lead}
            <strong>{formatNumber(uncategorizedCount)}</strong>
            {t.uncategorizedWarning.tail}
          </div>
          <div>
            {t.uncategorizedWarning.suggestLead}
            <button type="button" className="underline" onClick={() => setCategoryOpen(true)}>
              {t.uncategorizedWarning.suggestLink}
            </button>
            {t.uncategorizedWarning.suggestTail}
          </div>
        </Alert>
      ) : null}

      <DataTableContainer>
        <DataTableHeader title={t.tableTitle} />

        <DataTable
          columns={columns}
          rows={visible}
          loading={loading}
          rowKey={(s) => s.id}
          scroll
          empty={
            <EmptyState
              icon={ListChecks}
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
          <div className="data-table-info">{t.toolbar.totalCount(visible.length)}</div>
        </DataTableFooter>
      </DataTableContainer>

      {/* -------------------------------------------- modal 1：新增/編輯服務 */}
      <ServiceFormModal
        open={formTarget !== undefined}
        service={formTarget ?? null}
        categories={categories}
        staff={staff}
        onClose={() => setFormTarget(undefined)}
        onSaved={(draft, isEdit) => {
          const categoryName = categories.find((c) => c.id === draft.categoryId)?.name ?? null;
          upsert({ ...draft, categoryName, sortOrder: isEdit ? draft.sortOrder : rows.length + 1 });
          setFormTarget(undefined);
          toast.show(isEdit ? t.messages.updated : t.messages.created);
          if (draft.queueModeEnabled) toast.show(t.messages.queueModeEnabled, 'info');
        }}
      />

      {/* ------------------------------------------------ modal 2：管理分類 */}
      <CategoryModal
        open={categoryOpen}
        categories={categories}
        onClose={() => setCategoryOpen(false)}
        onChange={setCategories}
      />

      {/* -------------------------------------------- modal 3：套用排序確認 */}
      <ConfirmModal
        open={syncOpen}
        title={sortMode === 'line' ? t.toolbar.syncToPublic : t.toolbar.syncToLine}
        message={t.confirm.syncOrder(fromLabel, toModeLabel)}
        onClose={() => setSyncOpen(false)}
        onConfirm={() => {
          const next = rows.map((s) => (sortMode === 'line'
            ? { ...s, publicSortOrder: s.sortOrder }
            : { ...s, sortOrder: s.publicSortOrder }));
          setRows(next);
          setSyncOpen(false);
          toast.show(t.messages.orderApplied(toModeLabel));
          /* 公開頁 → LINE 才會改到 sortOrder（API 唯一的排序欄位），需要落地 */
          if (sortMode === 'public') persistLineOrder(next);
        }}
      />

      {/* ------------------------------------------------ modal 4：刪除確認 */}
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
            const res = await deleteService(deleteTarget.id);
            if (res.deactivated) {
              /* 後端因未來預約／歷史紀錄改為停用：保留該列並標記停用 */
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
              `${t.messages.deleteServiceFailed}${e instanceof Error ? e.message : t.messages.unknownError}`,
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
/* 新增 / 編輯服務                                                             */
/* ========================================================================== */

const EMPTY_SERVICE: ServiceRow = {
  id: '', categoryId: null, categoryName: null, name: '', description: '',
  durationMinutes: 0, price: 0, imageUrl: '', active: true, lineFeatured: false,
  sortOrder: 0, ...DEFAULT_EXTRAS,
};

function ServiceFormModal({
  open, service, categories, staff, onClose, onSaved,
}: {
  open: boolean;
  service: ServiceRow | null;
  categories: ServiceCategory[];
  staff: Staff[];
  onClose: () => void;
  onSaved: (draft: ServiceRow, isEdit: boolean) => void;
}) {
  const toast = useToast();
  const isEdit = !!service;

  const [draft, setDraft] = React.useState<ServiceRow>(EMPTY_SERVICE);
  const [extraImages, setExtraImages] = React.useState<string[]>([]);
  const [errors, setErrors] = React.useState<string[]>([]);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setErrors([]);
    setExtraImages([]);
    setDraft(service ?? EMPTY_SERVICE);
  }, [open, service]);

  const patch = (p: Partial<ServiceRow>) => setDraft((d) => ({ ...d, ...p }));

  const isDeposit = draft.onlinePaymentMode === 'DEPOSIT_FIXED'
    || draft.onlinePaymentMode === 'DEPOSIT_PERCENT';

  const validate = (): string[] => {
    const list: string[] = [];
    if (!draft.name.trim()) list.push(t.form.nameInvalid);
    if (!draft.queueModeEnabled && !(draft.price >= 0)) list.push(t.form.priceInvalid);
    if (!draft.queueModeEnabled && !draft.overnightMode && !draft.durationMinutes) {
      list.push(t.form.durationInvalid);
    }
    if (isDeposit && !(draft.onlineDepositValue > 0)) list.push(t.form.depositRequired);
    if (draft.onlinePaymentMode === 'DEPOSIT_PERCENT' && draft.onlineDepositValue > 100) {
      list.push(t.form.depositPercentMax);
    }
    return list;
  };

  const submit = async () => {
    const list = validate();
    setErrors(list);
    if (list.length) return;
    setSaving(true);
    try {
      /* API 契約欄位（頁面 ServiceExtras 僅存在前端，不送出）；
         durationMinutes 後端 min(1)，號碼掛號等 0 分鐘情境略過此欄位 */
      const payload = {
        name: draft.name,
        categoryId: draft.categoryId ?? '',
        description: draft.description,
        durationMinutes: draft.durationMinutes || undefined,
        price: draft.price,
        imageUrl: draft.imageUrl,
        active: draft.active,
        lineFeatured: draft.lineFeatured,
      };
      if (isEdit) {
        await updateService(draft.id, payload);
        onSaved(draft, true);
      } else {
        const { id } = await createService(payload);
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

  const capacityLabel = draft.overnightMode ? t.form.roomCountLabel : t.form.maxCapacity;
  const capacityHelp = draft.overnightMode ? t.form.roomCountHelp : t.form.maxCapacityHint;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={isEdit ? t.form.editTitle : t.form.createTitle}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{common.cancel}</Button>
          <Button loading={saving} loadingText={common.saving} onClick={() => void submit()}>
            {common.save}
          </Button>
        </>
      }
    >
      <p className="form-text mb-4">{common.requiredHint}</p>

      <div className="grid gap-x-4 md:grid-cols-2">
        <FormGroup>
          <Label required htmlFor="serviceName">{t.form.name}</Label>
          <Input
            id="serviceName" value={draft.name} placeholder={t.form.namePlaceholder}
            onChange={(e) => patch({ name: e.target.value })}
          />
        </FormGroup>

        <FormGroup>
          <Label htmlFor="serviceCategory">{t.form.category}</Label>
          <Select
            id="serviceCategory" value={draft.categoryId ?? ''}
            onChange={(e) => patch({ categoryId: e.target.value || null })}
          >
            <option value="">{t.form.categoryPlaceholder}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </FormGroup>

        <FormGroup>
          <Label required htmlFor="servicePrice">{t.form.price}</Label>
          <div className="input-group">
            <span className="flex items-center rounded-l-md border border-r-0 border-neutral-250 bg-neutral-100 px-3 text-xs text-secondary">
              {t.form.pricePrefix}
            </span>
            <Input
              id="servicePrice" type="number" min={0} className="rounded-l-none"
              placeholder={t.form.pricePlaceholder} value={String(draft.price)}
              onChange={(e) => patch({ price: Number(e.target.value) || 0 })}
            />
          </div>
        </FormGroup>

        {!draft.queueModeEnabled && !draft.overnightMode ? (
          <FormGroup>
            <Label required htmlFor="serviceDuration">{t.form.duration}</Label>
            <Select
              id="serviceDuration" value={draft.durationMinutes ? String(draft.durationMinutes) : ''}
              onChange={(e) => patch({ durationMinutes: Number(e.target.value) || 0 })}
            >
              <option value="">{t.form.durationPlaceholder}</option>
              {t.form.durationOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </Select>
          </FormGroup>
        ) : null}
      </div>

      {/* ---------------------------------------------------- 過夜/住宿模式 */}
      <div className="mb-4 rounded-md border border-neutral-250 p-3">
        <label className="flex items-center gap-2 text-base font-semibold">
          <input
            type="checkbox" checked={draft.overnightMode}
            onChange={(e) => patch({ overnightMode: e.target.checked })}
          />
          {t.form.overnightMode}
        </label>
        <p className="form-text">
          {t.form.overnightHelpLead}
          <strong>{t.form.overnightHelpPrice}</strong>
          {t.form.overnightHelpMiddle}
          <strong>{t.form.overnightHelpCapacity}</strong>
          {t.form.overnightHelpTail}
        </p>
        {draft.overnightMode ? (
          <div className="mt-2 grid gap-x-4 md:grid-cols-2">
            <FormGroup>
              <Label htmlFor="checkInTime">{t.form.checkInTime}</Label>
              <Input
                id="checkInTime" type="time" value={draft.checkInTime}
                onChange={(e) => patch({ checkInTime: e.target.value })}
              />
            </FormGroup>
            <FormGroup>
              <Label htmlFor="checkOutTime">{t.form.checkOutTime}</Label>
              <Input
                id="checkOutTime" type="time" value={draft.checkOutTime}
                onChange={(e) => patch({ checkOutTime: e.target.value })}
              />
            </FormGroup>
          </div>
        ) : null}
      </div>

      {/* ------------------------------------------------------ 號碼掛號模式 */}
      <div className="mb-4 rounded-md border border-neutral-250 p-3">
        <label className="flex items-center gap-2 text-base font-semibold">
          <input
            type="checkbox" checked={draft.queueModeEnabled}
            onChange={(e) => patch({ queueModeEnabled: e.target.checked })}
          />
          {t.form.queueMode}
        </label>
        <p className="form-text">
          {t.form.queueHelpLead}
          <strong>{t.form.queueHelpStrong}</strong>
          {t.form.queueHelpMiddle}
          {' '}
          <Link href="/tenant/clinic-queue" className="underline">{t.form.queueHelpLink}</Link>
          {' '}
          {t.form.queueHelpTail}
        </p>
        {draft.queueModeEnabled ? (
          <Alert tone="info" className="mt-2">{t.form.queueNotice}</Alert>
        ) : null}
      </div>

      {/* ---------------------------------------------------- 需要指定員工 */}
      {!draft.queueModeEnabled ? (
        <div className="mb-4 rounded-md border border-neutral-250 p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <label className="flex items-center gap-2 text-base font-semibold">
                <input
                  type="checkbox" checked={draft.requiresStaff}
                  onChange={(e) => patch({ requiresStaff: e.target.checked })}
                />
                {t.form.requiresStaff}
              </label>
              <p className="form-text">
                {t.form.requiresStaffHelpLead}
                <strong>{t.form.requiresStaffHelpStrong}</strong>
                {t.form.requiresStaffHelpMiddle}
                <strong>{t.form.requiresStaffHelpStrong2}</strong>
                {t.form.requiresStaffHelpTail}
              </p>
            </div>

            <FormGroup className="mb-0 w-40">
              <Label htmlFor="maxCapacity">{capacityLabel}</Label>
              <Input
                id="maxCapacity" type="number" min={1} value={String(draft.maxCapacity)}
                disabled={draft.requiresStaff && !draft.overnightMode}
                onChange={(e) => patch({ maxCapacity: Number(e.target.value) || 1 })}
              />
              <FormText>{draft.requiresStaff ? t.form.maxCapacityHelp : capacityHelp}</FormText>
            </FormGroup>
          </div>

          {draft.requiresStaff ? (
            <p className="form-text">
              {t.form.requiresStaffGroupLead}
              <strong>{t.form.requiresStaffGroupStrong}</strong>
              {t.form.requiresStaffGroupTail}
              <br />
              {t.form.requiresStaffGroupOption1Lead}
              <Link href="/tenant/staff" className="underline">
                {t.form.requiresStaffGroupOption1Link}
              </Link>
              {t.form.requiresStaffGroupOption1Tail}
              <br />
              {t.form.requiresStaffGroupOption2}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* -------------------------------------------------- 可承接的服務人員 */}
      {!draft.queueModeEnabled && draft.requiresStaff ? (
        <FormGroup>
          <div className="mb-2 flex items-center justify-between gap-2">
            <Label className="mb-0">{t.form.staffList}</Label>
            <div className="btn-group">
              <Button
                variant="outline" size="sm"
                onClick={() => patch({ staffIds: staff.map((s) => s.id) })}
              >
                {t.form.staffSelectAll}
              </Button>
              <Button variant="outline" size="sm" onClick={() => patch({ staffIds: [] })}>
                {t.form.staffClear}
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-1 rounded-md border border-neutral-250 p-3">
            {staff.length === 0 ? (
              <span className="text-muted">{t.form.staffEmpty}</span>
            ) : (
              staff.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-base">
                  <input
                    type="checkbox"
                    checked={draft.staffIds.includes(s.id)}
                    onChange={(e) => patch({
                      staffIds: e.target.checked
                        ? [...draft.staffIds, s.id]
                        : draft.staffIds.filter((id) => id !== s.id),
                    })}
                  />
                  {s.name}
                </label>
              ))
            )}
          </div>
          <FormText>
            {t.form.staffHelpLead}
            <strong>{t.form.staffHelpStrong}</strong>
            {t.form.staffHelpTail}
          </FormText>
        </FormGroup>
      ) : null}

      {/* -------------------------------------------------------- 進階設定 */}
      {!draft.queueModeEnabled ? (
        <FormGroup>
          <Label htmlFor="bufferAfter">{t.form.bufferAfter}</Label>
          <Select
            id="bufferAfter" value={String(draft.bufferAfter)}
            options={[...t.form.bufferAfterOptions]}
            onChange={(e) => patch({ bufferAfter: Number(e.target.value) || 0 })}
          />
          <FormText>{t.form.bufferAfterHelp}</FormText>
        </FormGroup>
      ) : null}

      <FormGroup>
        <Label htmlFor="onlinePaymentMode">{t.form.onlinePaymentMode}</Label>
        <Select
          id="onlinePaymentMode" value={draft.onlinePaymentMode}
          options={[...t.form.onlinePaymentOptions]}
          onChange={(e) => patch({
            onlinePaymentMode: e.target.value as ServiceExtras['onlinePaymentMode'],
          })}
        />
        <FormText>{t.form.onlinePaymentHelp}</FormText>
      </FormGroup>

      {isDeposit ? (
        <FormGroup>
          <Label htmlFor="onlineDepositValue">
            {draft.onlinePaymentMode === 'DEPOSIT_PERCENT' ? t.form.depositPercent : t.form.depositAmount}
          </Label>
          <Input
            id="onlineDepositValue" type="number" min={0} placeholder={t.form.pricePlaceholder}
            value={String(draft.onlineDepositValue)}
            onChange={(e) => patch({ onlineDepositValue: Number(e.target.value) || 0 })}
          />
          <FormText>
            {draft.onlinePaymentMode === 'DEPOSIT_PERCENT'
              ? t.form.depositPercentHelp
              : t.form.depositAmountHelp}
          </FormText>
        </FormGroup>
      ) : null}

      <FormGroup>
        <Label htmlFor="serviceDescription">{t.form.description}</Label>
        <Textarea
          id="serviceDescription" rows={2} value={draft.description}
          placeholder={t.form.descriptionPlaceholder}
          onChange={(e) => patch({ description: e.target.value })}
        />
      </FormGroup>

      <FormGroup>
        <Label htmlFor="serviceImageInput">{t.form.mainImage}</Label>
        <Input
          id="serviceImageInput" type="file" accept="image/*"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file && file.size > 2 * 1024 * 1024) {
              toast.show(t.form.imageTooLarge, 'warning');
              e.target.value = '';
              return;
            }
            patch({ imageUrl: file ? file.name : '' });
          }}
        />
        <FormText>{t.form.mainImageHelp}</FormText>
      </FormGroup>

      <FormGroup>
        <Label htmlFor="serviceExtraImageFiles">{t.form.extraImages}</Label>
        <Input
          id="serviceExtraImageFiles" type="file" accept="image/*" multiple
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            const kept: string[] = [];
            for (const f of files) {
              if (extraImages.length + kept.length >= EXTRA_IMAGE_MAX) {
                toast.show(`${t.form.limitReached}${EXTRA_IMAGE_MAX}`, 'warning');
                break;
              }
              if (f.size > 2 * 1024 * 1024) {
                toast.show(`${f.name}${t.form.imageOver2mb}`, 'warning');
                continue;
              }
              kept.push(f.name);
            }
            setExtraImages((list) => [...list, ...kept]);
          }}
        />
        <div className="flex items-center justify-between">
          <FormText>{t.form.extraImagesHelp}</FormText>
          <span className="form-text">
            {extraImages.length === 0
              ? t.form.extraImagesNone(EXTRA_IMAGE_MAX)
              : t.form.imagesCount(extraImages.length)}
          </span>
        </div>
      </FormGroup>

      {errors.length ? (
        <FormError>
          {t.form.validationLead}
          <ul className="list-disc pl-4">
            {errors.map((msg) => <li key={msg}>{msg}</li>)}
          </ul>
        </FormError>
      ) : null}
    </Modal>
  );
}

/* ========================================================================== */
/* 管理服務分類                                                                */
/* ========================================================================== */

function CategoryModal({
  open, categories, onClose, onChange,
}: {
  open: boolean;
  categories: ServiceCategory[];
  onClose: () => void;
  onChange: React.Dispatch<React.SetStateAction<ServiceCategory[]>>;
}) {
  const toast = useToast();

  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [error, setError] = React.useState('');
  const [deleteTarget, setDeleteTarget] = React.useState<ServiceCategory | null>(null);
  const nextId = React.useRef(1);

  /** 編輯分類名稱／描述／啟用狀態的子表單（issue #28 第 ⑭ 筆：編輯按鈕先前只切換啟用狀態）。 */
  const [editTarget, setEditTarget] = React.useState<ServiceCategory | null>(null);
  const [editName, setEditName] = React.useState('');
  const [editDescription, setEditDescription] = React.useState('');
  const [editActive, setEditActive] = React.useState(true);
  const [editError, setEditError] = React.useState('');
  const [editSaving, setEditSaving] = React.useState(false);

  const openEdit = (c: ServiceCategory) => {
    setEditTarget(c);
    setEditName(c.name);
    setEditDescription(c.description ?? '');
    setEditActive(c.active);
    setEditError('');
  };

  const saveEdit = async () => {
    if (!editTarget) return;
    const trimmed = editName.trim();
    if (!trimmed) {
      setEditError(t.category.nameRequired);
      return;
    }
    setEditError('');
    setEditSaving(true);
    const categoryDescription = editDescription.trim();
    try {
      await updateServiceCategory(editTarget.id, {
        name: trimmed, description: categoryDescription, active: editActive,
      });
      onChange((list) => list.map((x) => (
        x.id === editTarget.id
          ? { ...x, name: trimmed, description: categoryDescription, active: editActive }
          : x
      )));
      toast.show(t.category.updated);
      setEditTarget(null);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : t.messages.unknownError);
    } finally {
      setEditSaving(false);
    }
  };

  React.useEffect(() => {
    if (!open) return;
    setName('');
    setDescription('');
    setError('');
  }, [open]);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t.category.nameRequired);
      return;
    }

    const categoryDescription = description.trim();
    const localId = 'sc_new_' + nextId.current++;
    setError('');
    try {
      const saved = await createServiceCategory({
        name: trimmed,
        description: categoryDescription,
        active: true,
      });
      onChange((list) => [
        ...list,
        {
          id: saved?.id ?? localId,
          name: trimmed,
          description: categoryDescription,
          active: true,
          sortOrder: saved?.sortOrder ?? list.length + 1,
        },
      ]);
      setName('');
      setDescription('');
      toast.show(t.category.created);
    } catch (e) {
      toast.show(e instanceof Error ? e.message : t.messages.unknownError, 'danger');
    }
  };

  const move = async (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= categories.length) return;
    const next = [...categories];
    [next[index], next[target]] = [next[target], next[index]];
    try {
      await reorderServiceCategories(next.map((c) => c.id));
      onChange(next.map((c, i) => ({ ...c, sortOrder: i + 1 })));
      toast.show(t.category.reordered);
    } catch (e) {
      toast.show(e instanceof Error ? e.message : t.messages.reorderFailed, 'danger');
    }
  };

  const columns: Column<ServiceCategory>[] = [
    { key: 'name', header: t.category.columns.name, render: (c) => c.name },
    {
      key: 'description', header: t.category.columns.description,
      render: (c) => c.description || <span className="text-muted">{common.none}</span>,
    },
    {
      key: 'status', header: t.category.columns.status, width: '90px',
      render: (c) => (c.active
        ? <Badge tone="success">{t.labels.active}</Badge>
        : <Badge tone="neutral">{t.labels.inactive}</Badge>),
    },
    {
      key: 'actions', header: t.category.columns.actions, width: '160px',
      render: (c, i) => (
        <div className="btn-group">
          <Button
            variant="outline" size="sm" title={t.labels.moveUp} aria-label={t.labels.moveUp}
            disabled={i === 0} onClick={() => move(i, -1)}
          >
            <ChevronUp size={13} />
          </Button>
          <Button
            variant="outline" size="sm" title={t.labels.moveDown} aria-label={t.labels.moveDown}
            disabled={i === categories.length - 1} onClick={() => move(i, 1)}
          >
            <ChevronDown size={13} />
          </Button>
          <Button
            variant="outline" size="sm" title={common.edit} aria-label={common.edit}
            onClick={() => openEdit(c)}
          >
            <Pencil size={13} />
          </Button>
          <Button
            variant="outlineDanger" size="sm" title={common.delete} aria-label={common.delete}
            onClick={() => setDeleteTarget(c)}
          >
            <Trash2 size={13} />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        size="lg"
        title={t.category.title}
        footer={<Button variant="secondary" onClick={onClose}>{common.close}</Button>}
      >
        <p className="form-text mb-3">{t.category.intro}</p>

        <h6 className="mb-2 text-base font-bold text-dark">{t.category.createSectionTitle}</h6>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[12rem] flex-1">
            <Label required htmlFor="newCategoryName">{t.category.name}</Label>
            <Input
              id="newCategoryName" className="form-control-sm" value={name}
              placeholder={t.category.namePlaceholder}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="min-w-[12rem] flex-1">
            <Label htmlFor="newCategoryDesc">{t.category.description}</Label>
            <Input
              id="newCategoryDesc" className="form-control-sm" value={description}
              placeholder={t.category.descriptionPlaceholder}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <Button size="sm" onClick={() => void create()}>
            <Plus size={13} />{common.create}
          </Button>
        </div>
        {error ? <FormError>{error}</FormError> : null}

        <p className="form-text mb-2 mt-3">{t.category.dragHint}</p>

        <DataTableContainer>
          <DataTable
            columns={columns}
            rows={categories}
            rowKey={(c) => c.id}
            empty={<EmptyState icon={FolderPlus} title={t.category.empty} />}
          />
        </DataTableContainer>
      </Modal>

      <ConfirmModal
        open={!!deleteTarget}
        danger
        title={common.delete}
        confirmText={common.delete}
        message={t.category.deleteConfirm}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          const id = deleteTarget.id;
          try {
            await deleteServiceCategory(id);
            onChange((list) => list.filter((c) => c.id !== id));
            setDeleteTarget(null);
            toast.show(t.category.deleted);
          } catch (e) {
            toast.show(e instanceof Error ? e.message : t.messages.deleteFailed, 'danger');
          }
        }}
      />

      <Modal
        open={!!editTarget}
        onClose={() => (editSaving ? undefined : setEditTarget(null))}
        title={t.category.editTitle}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setEditTarget(null)} disabled={editSaving}>
              {common.cancel}
            </Button>
            <Button onClick={() => void saveEdit()} disabled={editSaving}>{common.save}</Button>
          </>
        )}
      >
        <FormGroup>
          <Label required htmlFor="editCategoryName">{t.category.name}</Label>
          <Input
            id="editCategoryName" value={editName}
            placeholder={t.category.namePlaceholder}
            onChange={(e) => setEditName(e.target.value)}
          />
        </FormGroup>
        <FormGroup>
          <Label htmlFor="editCategoryDesc">{t.category.description}</Label>
          <Input
            id="editCategoryDesc" value={editDescription}
            placeholder={t.category.descriptionPlaceholder}
            onChange={(e) => setEditDescription(e.target.value)}
          />
        </FormGroup>
        <div className="flex items-center gap-2">
          <Switch id="editCategoryActive" checked={editActive} onCheckedChange={setEditActive} />
          <span className="text-base text-neutral-700">{t.labels.active}</span>
        </div>
        {editError ? <FormError>{editError}</FormError> : null}
      </Modal>
    </>
  );
}
