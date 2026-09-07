'use client';
import * as React from 'react';
import Link from 'next/link';
import {
  Eye, Pause, Pencil, Play, Plus, QrCode, RotateCcw, Search, Send, Ticket, Trash2, Upload, X,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import {
  DataTable, DataTableContainer, DataTableFooter, DataTableHeader, type Column,
} from '@/components/ui/DataTable';
import { Pagination } from '@/components/ui/Pagination';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmModal, Modal } from '@/components/ui/Modal';
import {
  FormError, FormGroup, FormText, Input, Label, Select, Switch, Textarea,
} from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { listCoupons } from '@/services/catalog';
import {
  batchIssueCoupon, createCoupon, deleteCoupon, listCouponInstances, pauseCoupon,
  publishCoupon, redeemCouponByCode, resumeCoupon, unredeemCouponInstance, updateCoupon,
} from '@/services/coupons';
import { listCustomers } from '@/services/customers';
import { listFeatures } from '@/services/settings';
import { common } from '@/i18n/zh-TW/common';
import { nav } from '@/i18n/zh-TW/nav';
import { couponsPage as t } from '@/i18n/zh-TW/pages/coupons';
import { formatCurrency, formatDate, formatNumber } from '@/lib/utils';
import type { Coupon, Customer } from '@/lib/types';

/* -------------------------------------------------------------------------- */
/* 欄位來源                                                                     */
/* -------------------------------------------------------------------------- */

type CouponType = keyof typeof t.types;
type DisplayStatus = keyof typeof t.status;

/**
 * 原本的模式專用頁內資料把門檻、上限、兌換項目、每人限領與私密旗標寫死在頁面，
 * 讓它們和真實票券資料混在一起。現在這五個欄位由 API 契約提供。
 *
 * `type` 仍是由真實的 `discountType` 推導；`displayStatus` 是 `status` 的顯示別名。
 * `lastRedeemedCode` 由 GET /api/coupons 依 coupon_instances 即時計算。
 * 票券層級 `code` 與服務適用範圍沒有可靠的設定／寫入入口，因此不再渲染。
 *
 * `addonItem` / `addonPrice` 與 `imageUrl` 仍是未接線的表單草稿欄位，留待各自的
 * 業務規則／上傳鏈路處理；本 slice 不把它們冒充成持久資料。
 */
type CouponExtras = {
  type: CouponType;
  addonItem: string;
  addonPrice: number;
  imageUrl: string;
  displayStatus: DisplayStatus;
};

const DEFAULT_EXTRAS: CouponExtras = {
  type: 'DISCOUNT_AMOUNT',
  addonItem: '',
  addonPrice: 0,
  imageUrl: '',
  displayStatus: 'DRAFT',
};

const TYPE_FROM_DISCOUNT: Record<Coupon['discountType'], CouponType> = {
  AMOUNT: 'DISCOUNT_AMOUNT',
  PERCENT: 'DISCOUNT_PERCENT',
  GIFT: 'GIFT',
};

const PAGE_SIZE = 20;
const ISSUE_MAX = t.issue.max;

/* -------------------------------------------------------------------------- */

type CouponRow = Coupon & CouponExtras & {
  minOrderAmount: number | null;
  maxDiscountAmount: number | null;
  giftItem: string;
  limitPerCustomer: number | null;
  privateMode: boolean;
  lastRedeemedCode: string | null;
};

const toRow = (c: Coupon): CouponRow => ({
  ...c,
  minOrderAmount: c.minOrderAmount ?? null,
  maxDiscountAmount: c.maxDiscountAmount ?? null,
  giftItem: c.giftItem ?? '',
  limitPerCustomer: c.limitPerCustomer ?? null,
  privateMode: c.privateMode ?? false,
  lastRedeemedCode: c.lastRedeemedCode ?? null,
  ...DEFAULT_EXTRAS,
  type: TYPE_FROM_DISCOUNT[c.discountType],
  displayStatus: c.status,
});

const STATUS_TONE: Record<DisplayStatus, 'neutral' | 'success' | 'warning' | 'danger' | 'info'> = {
  DRAFT: 'neutral',
  PUBLISHED: 'success',
  PAUSED: 'warning',
  EXPIRED: 'danger',
  ENDED: 'info',
};

const discountText = (c: CouponRow): string => {
  if (c.type === 'DISCOUNT_PERCENT') return t.labels.percentOff(c.discountValue);
  if (c.type === 'GIFT') return t.labels.gift(c.giftItem || t.labels.giftItem);
  if (c.type === 'ADDON') return `${t.detail.addonPrice}${formatCurrency(c.addonPrice)}`;
  return t.labels.discountAmount(formatCurrency(c.discountValue));
};

type StatusAction =
  | { kind: 'PUBLISH'; coupon: CouponRow }
  | { kind: 'PAUSE'; coupon: CouponRow }
  | { kind: 'RESUME'; coupon: CouponRow };

export default function CouponsPage() {
  const toast = useToast();

  const [rows, setRows] = React.useState<CouponRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [featureActive, setFeatureActive] = React.useState(true);

  const [keywordDraft, setKeywordDraft] = React.useState('');
  const [keyword, setKeyword] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('');
  const [page, setPage] = React.useState(0);

  /* 7 個 modal */
  const [formTarget, setFormTarget] = React.useState<CouponRow | null | undefined>(undefined);
  const [redeemOpen, setRedeemOpen] = React.useState(false);
  const [undoTarget, setUndoTarget] = React.useState<CouponRow | null>(null);
  const [issueTarget, setIssueTarget] = React.useState<CouponRow | null>(null);
  const [detailTarget, setDetailTarget] = React.useState<CouponRow | null>(null);
  const [statusAction, setStatusAction] = React.useState<StatusAction | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<CouponRow | null>(null);
  const [acting, setActing] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  const nextId = React.useRef(1);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const list = await listCoupons();
      setRows(list.map(toRow));
    } catch (e) {
      toast.show(
        `${t.messages.loadCouponsFailed}${e instanceof Error ? e.message : t.messages.unknownError}`,
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
        const features = await listFeatures();
        setFeatureActive(features.some((f) => f.code === 'COUPON_SYSTEM' && f.active));
      } catch {
        toast.show(t.messages.retryLater, 'danger');
      }
    })();
  }, [toast]);

  const filtered = React.useMemo(() => rows.filter((c) => {
    if (statusFilter && c.displayStatus !== statusFilter) return false;
    if (keyword && !c.name.toLowerCase().includes(keyword.toLowerCase())) return false;
    return true;
  }), [rows, statusFilter, keyword]);

  const visible = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const isFiltering = !!keyword || !!statusFilter;

  const runSearch = () => { setKeyword(keywordDraft); setPage(0); };
  const clearSearch = () => { setKeywordDraft(''); setKeyword(''); setPage(0); };

  const patchCoupon = (id: string, patch: Partial<CouponRow>) =>
    setRows((list) => list.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const upsert = (draft: CouponRow) => {
    setRows((list) => (list.some((c) => c.id === draft.id)
      ? list.map((c) => (c.id === draft.id ? draft : c))
      : [draft, ...list]));
  };

  const runStatusAction = async () => {
    if (!statusAction) return;
    const { kind, coupon } = statusAction;
    setActing(true);
    try {
      if (kind === 'PUBLISH') {
        await publishCoupon(coupon.id);
        patchCoupon(coupon.id, { displayStatus: 'PUBLISHED', status: 'PUBLISHED' });
        toast.show(t.messages.published);
      } else if (kind === 'PAUSE') {
        await pauseCoupon(coupon.id);
        patchCoupon(coupon.id, { displayStatus: 'PAUSED', status: 'PAUSED' });
        toast.show(t.messages.paused);
      } else {
        await resumeCoupon(coupon.id);
        patchCoupon(coupon.id, { displayStatus: 'PUBLISHED', status: 'PUBLISHED' });
        toast.show(t.messages.resumed);
      }
      setStatusAction(null);
    } catch (e) {
      const prefix = kind === 'PUBLISH'
        ? t.messages.publishFailedPrefix
        : kind === 'PAUSE'
          ? t.messages.pauseFailedPrefix
          : t.messages.resumeFailedPrefix;
      toast.show(`${prefix}${e instanceof Error ? e.message : t.messages.unknownError}`, 'danger');
    } finally {
      setActing(false);
    }
  };

  /* ------------------------------------------------------------------ 欄位 */

  const columns: Column<CouponRow>[] = [
    {
      key: 'name', header: t.columns.name,
      render: (c) => (
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-semibold text-dark">{c.name || t.labels.unnamed}</span>
            {c.privateMode ? <Badge tone="purple">{t.labels.private}</Badge> : null}
          </div>
          {c.description ? <div className="text-xs text-secondary">{c.description}</div> : null}
        </div>
      ),
    },
    {
      key: 'type', header: t.columns.type, width: '100px',
      render: (c) => <Badge tone="neutral">{t.types[c.type]}</Badge>,
    },
    {
      key: 'discount', header: t.columns.discount, width: '160px',
      render: (c) => discountText(c),
    },
    {
      key: 'validPeriod', header: t.columns.validPeriod, width: '190px',
      render: (c) => (c.endAt
        ? `${formatDate(c.startAt)} - ${formatDate(c.endAt)}`
        : <span className="text-muted">{t.labels.noExpiry}</span>),
    },
    {
      key: 'issued', header: t.columns.issued, numeric: true, width: '130px',
      render: (c) => (
        <div>
          <div>{t.labels.issuedOf(c.issuedQuantity, c.totalQuantity || null)}</div>
          <div className="text-2xs text-secondary">{t.labels.redeemed(c.redeemedQuantity)}</div>
        </div>
      ),
    },
    {
      key: 'status', header: t.columns.status, width: '100px',
      render: (c) => <Badge tone={STATUS_TONE[c.displayStatus]}>{t.status[c.displayStatus]}</Badge>,
    },
    {
      key: 'actions', header: t.columns.actions, width: '250px',
      render: (c) => (
        <div className="btn-group">
          <Button
            variant="outline" size="sm" title={t.actions.view} aria-label={t.actions.view}
            onClick={() => setDetailTarget(c)}
          >
            <Eye size={13} />
          </Button>
          <Button
            variant="outline" size="sm" title={t.actions.edit} aria-label={t.actions.edit}
            onClick={() => setFormTarget(c)}
          >
            <Pencil size={13} />
          </Button>
          {c.displayStatus === 'DRAFT' ? (
            <Button
              variant="outline" size="sm" title={t.actions.publish} aria-label={t.actions.publish}
              onClick={() => setStatusAction({ kind: 'PUBLISH', coupon: c })}
            >
              <Upload size={13} />
            </Button>
          ) : null}
          {c.displayStatus === 'PUBLISHED' ? (
            <>
              <Button
                variant="outline" size="sm" title={t.actions.issue} aria-label={t.actions.issue}
                onClick={() => setIssueTarget(c)}
              >
                <Send size={13} />
              </Button>
              <Button
                variant="outline" size="sm" title={t.actions.pause} aria-label={t.actions.pause}
                onClick={() => setStatusAction({ kind: 'PAUSE', coupon: c })}
              >
                <Pause size={13} />
              </Button>
            </>
          ) : null}
          {c.displayStatus === 'PAUSED' ? (
            <Button
              variant="outline" size="sm" title={t.actions.resume} aria-label={t.actions.resume}
              onClick={() => setStatusAction({ kind: 'RESUME', coupon: c })}
            >
              <Play size={13} />
            </Button>
          ) : null}
          {c.lastRedeemedCode ? (
            <Button
              variant="outline" size="sm"
              title={t.actions.undoRedeem} aria-label={t.actions.undoRedeem}
              onClick={() => setUndoTarget(c)}
            >
              <RotateCcw size={13} />
            </Button>
          ) : null}
          <Button
            variant="outlineDanger" size="sm" title={t.actions.delete} aria-label={t.actions.delete}
            onClick={() => setDeleteTarget(c)}
          >
            <Trash2 size={13} />
          </Button>
        </div>
      ),
    },
  ];

  const statusTitle = statusAction?.kind === 'PUBLISH'
    ? t.confirm.publishTitle
    : statusAction?.kind === 'PAUSE'
      ? t.confirm.pauseTitle
      : t.confirm.resumeTitle;

  const statusMessage = statusAction?.kind === 'PUBLISH'
    ? (statusAction.coupon.privateMode ? t.confirm.publishPrivate : t.confirm.publish)
    : statusAction?.kind === 'PAUSE'
      ? t.confirm.pause
      : t.confirm.resume;

  const statusConfirmText = statusAction?.kind === 'PUBLISH'
    ? t.actions.publish
    : statusAction?.kind === 'PAUSE'
      ? t.actions.pause
      : t.actions.resume;

  return (
    <>
      <PageHeader
        eyebrow={nav.navOperation}
        title={t.title}
        actions={
          <>
            <Button variant="success" onClick={() => setRedeemOpen(true)}>
              <QrCode size={15} />{t.actions.redeem}
            </Button>
            <Button onClick={() => setFormTarget(null)}>
              <Plus size={15} />{t.actions.create}
            </Button>
          </>
        }
      />

      {!featureActive ? (
        <Alert tone="warning" className="mb-3" title={t.feature.title}>
          {t.feature.lead}
          <strong>{t.feature.strong}</strong>
          {t.feature.tail}
          {' '}
          <Link className="underline" href="/tenant/feature-store">{t.feature.learnMore}</Link>
        </Alert>
      ) : null}

      <DataTableContainer>
        <DataTableHeader
          title={t.tableTitle}
          actions={
            <>
              <Select
                className="form-select-sm w-auto"
                aria-label={t.search.statusOptions[0].label}
                value={statusFilter}
                onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
              >
                {t.search.statusOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Select>
              <div className="input-group">
                <Input
                  type="search" className="w-56" placeholder={t.search.placeholder}
                  value={keywordDraft}
                  onChange={(e) => setKeywordDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
                />
                {keywordDraft ? (
                  <Button variant="outline" aria-label={common.clearSearch} onClick={clearSearch}>
                    <X size={14} />
                  </Button>
                ) : (
                  <Button variant="outline" aria-label={common.search} onClick={runSearch}>
                    <Search size={14} />
                  </Button>
                )}
              </div>
            </>
          }
        />

        <DataTable
          columns={columns}
          rows={visible}
          loading={loading}
          rowKey={(c) => c.id}
          scroll
          empty={
            isFiltering ? (
              <EmptyState
                icon={Ticket}
                title={t.empty.filteredTitle}
                action={
                  <Button variant="outline" onClick={() => { clearSearch(); setStatusFilter(''); }}>
                    {common.clear}
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={Ticket}
                title={t.empty.title}
                description={t.empty.description}
                action={
                  <Button onClick={() => setFormTarget(null)}>
                    <Plus size={15} />{t.actions.create}
                  </Button>
                }
              />
            )
          }
        />

        <DataTableFooter>
          <Pagination page={page} size={PAGE_SIZE} total={filtered.length} onChange={setPage} />
        </DataTableFooter>
      </DataTableContainer>

      {/* -------------------------------------------- modal 1：新增/編輯票券 */}
      <CouponFormModal
        open={formTarget !== undefined}
        coupon={formTarget ?? null}
        onClose={() => setFormTarget(undefined)}
        onSaved={(draft, isEdit, newId) => {
          const id = isEdit ? draft.id : newId ?? `cp_new_${nextId.current++}`;
          upsert({ ...draft, id });
          setFormTarget(undefined);
          toast.show(isEdit ? t.messages.updated : t.messages.created);
        }}
      />

      {/* ------------------------------------------------ modal 2：核銷票券 */}
      <RedeemModal open={redeemOpen} onClose={() => setRedeemOpen(false)} />

      {/* ------------------------------------- modal 3：還原票券（反核銷） */}
      <RedeemUndoModal
        coupon={undoTarget}
        onClose={() => setUndoTarget(null)}
        onUndone={async () => {
          // GET /api/coupons is authoritative: after undoing the newest instance,
          // an older redeemed instance may still be the next undo candidate.
          await load();
          setUndoTarget(null);
        }}
      />

      {/* -------------------------------------------- modal 4：發放給顧客 */}
      <IssueModal
        coupon={issueTarget}
        onClose={() => setIssueTarget(null)}
        onIssued={(coupon, count) => {
          patchCoupon(coupon.id, { issuedQuantity: coupon.issuedQuantity + count });
          setIssueTarget(null);
        }}
      />

      {/* ------------------------------------------------ modal 5：票券詳情 */}
      <CouponDetailModal coupon={detailTarget} onClose={() => setDetailTarget(null)} />

      {/* ---------------------------- modal 6：發布 / 暫停 / 恢復 確認 */}
      <ConfirmModal
        open={!!statusAction}
        loading={acting}
        title={statusTitle}
        confirmText={statusConfirmText}
        message={statusMessage}
        onClose={() => setStatusAction(null)}
        onConfirm={() => void runStatusAction()}
      />

      {/* -------------------------------------------------- modal 7：刪除 */}
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
            await deleteCoupon(deleteTarget.id);
            setRows((list) => list.filter((c) => c.id !== deleteTarget.id));
            setDeleteTarget(null);
            toast.show(t.messages.deleted);
          } catch (e) {
            toast.show(
              `${t.messages.deleteCouponFailed}${e instanceof Error ? e.message : t.messages.unknownError}`,
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
/* modal 1：新增 / 編輯票券                                                     */
/* ========================================================================== */

const EMPTY_COUPON: CouponRow = {
  id: '', name: '', description: '', discountType: 'AMOUNT', discountValue: 0,
  totalQuantity: 0, issuedQuantity: 0, redeemedQuantity: 0,
  startAt: '', endAt: '', status: 'DRAFT',
  minOrderAmount: null,
  maxDiscountAmount: null,
  giftItem: '',
  limitPerCustomer: null,
  privateMode: false,
  lastRedeemedCode: null,
  ...DEFAULT_EXTRAS,
};

const DISCOUNT_FROM_TYPE: Record<CouponType, Coupon['discountType']> = {
  DISCOUNT_AMOUNT: 'AMOUNT',
  DISCOUNT_PERCENT: 'PERCENT',
  GIFT: 'GIFT',
  ADDON: 'GIFT',
};

function CouponFormModal({
  open, coupon, onClose, onSaved,
}: {
  open: boolean;
  coupon: CouponRow | null;
  onClose: () => void;
  onSaved: (draft: CouponRow, isEdit: boolean, newId?: string) => void;
}) {
  const toast = useToast();
  const isEdit = !!coupon;
  const locked = coupon?.displayStatus === 'PUBLISHED';

  const [draft, setDraft] = React.useState<CouponRow>(EMPTY_COUPON);
  const [errors, setErrors] = React.useState<string[]>([]);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setErrors([]);
    setDraft(coupon ?? EMPTY_COUPON);
  }, [open, coupon]);

  const patch = (p: Partial<CouponRow>) => setDraft((d) => ({ ...d, ...p }));

  const validate = (): string[] => {
    const list: string[] = [];
    if (!draft.name.trim()) list.push(t.form.nameInvalid);
    if (draft.type === 'DISCOUNT_AMOUNT' && !(draft.discountValue > 0)) {
      list.push(t.form.discountAmountInvalid);
    }
    if (draft.startAt && draft.endAt && draft.endAt <= draft.startAt) {
      list.push(t.form.endBeforeStart);
    }
    return list;
  };

  const submit = async () => {
    const list = validate();
    setErrors(list);
    if (list.length) { toast.show(t.messages.checkFields, 'warning'); return; }
    setSaving(true);
    try {
      const discountType = DISCOUNT_FROM_TYPE[draft.type];
      const payload = {
        name: draft.name,
        description: draft.description,
        discountType,
        discountValue: draft.discountValue,
        totalQuantity: draft.totalQuantity || 0,
        startAt: draft.startAt,
        endAt: draft.endAt,
        minOrderAmount: draft.minOrderAmount,
        maxDiscountAmount: draft.maxDiscountAmount,
        giftItem: draft.giftItem,
        limitPerCustomer: draft.limitPerCustomer,
        privateMode: draft.privateMode,
      };
      let newId: string | undefined;
      if (isEdit) {
        await updateCoupon(draft.id, payload);
      } else {
        newId = (await createCoupon(payload))?.id;
      }
      onSaved({ ...draft, discountType }, isEdit, newId);
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
      {locked ? <Alert tone="info" className="mb-4">{t.form.publishedNotice}</Alert> : null}

      <p className="form-text mb-4">{common.requiredHint}</p>

      <div className="grid gap-x-4 md:grid-cols-2">
        <FormGroup>
          <Label required htmlFor="couponName">{t.form.name}</Label>
          <Input
            id="couponName" value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
          />
        </FormGroup>

        <FormGroup>
          <Label required htmlFor="couponType">{t.form.type}</Label>
          <Select
            id="couponType" value={draft.type} disabled={locked}
            onChange={(e) => patch({ type: e.target.value as CouponType })}
          >
            {t.typeOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>
        </FormGroup>

        {draft.type === 'DISCOUNT_AMOUNT' ? (
          <>
            <FormGroup>
              <Label required htmlFor="couponDiscountAmount">{t.form.discountAmount}</Label>
              <div className="input-group">
                <span className="form-control w-auto flex-none">{t.form.currencyUnit}</span>
                <Input
                  id="couponDiscountAmount" type="number" value={draft.discountValue} disabled={locked}
                  onChange={(e) => patch({ discountValue: Number(e.target.value) })}
                />
              </div>
            </FormGroup>

            <FormGroup>
              <Label htmlFor="couponMinOrderAmount">{t.form.minOrderAmount}</Label>
              <div className="input-group">
                <span className="form-control w-auto flex-none">{t.form.currencyUnit}</span>
                <Input
                  id="couponMinOrderAmount" type="number" value={draft.minOrderAmount ?? ''}
                  onChange={(e) => patch({
                    minOrderAmount: e.target.value === '' ? null : Number(e.target.value),
                  })}
                />
              </div>
              <FormText>{t.form.minOrderAmountHelp}</FormText>
            </FormGroup>
          </>
        ) : null}

        {draft.type === 'DISCOUNT_PERCENT' ? (
          <>
            <FormGroup>
              <Label required htmlFor="couponDiscountPercent">{t.form.discountPercent}</Label>
              <div className="input-group">
                <Input
                  id="couponDiscountPercent" type="number" value={draft.discountValue} disabled={locked}
                  placeholder={t.form.discountPercentPlaceholder}
                  onChange={(e) => patch({ discountValue: Number(e.target.value) })}
                />
                <span className="form-control w-auto flex-none">{t.form.discountPercentUnit}</span>
              </div>
              <FormText>{t.form.discountPercentHelp}</FormText>
            </FormGroup>

            <FormGroup>
              <Label htmlFor="couponMaxDiscountAmount">{t.form.maxDiscountAmount}</Label>
              <div className="input-group">
                <span className="form-control w-auto flex-none">{t.form.currencyUnit}</span>
                <Input
                  id="couponMaxDiscountAmount" type="number" value={draft.maxDiscountAmount ?? ''}
                  onChange={(e) => patch({
                    maxDiscountAmount: e.target.value === '' ? null : Number(e.target.value),
                  })}
                />
              </div>
              <FormText>{t.form.maxDiscountAmountHelp}</FormText>
            </FormGroup>
          </>
        ) : null}

        {draft.type === 'GIFT' ? (
          <FormGroup>
            <Label required htmlFor="couponGiftItem">{t.form.giftItem}</Label>
            <Input
              id="couponGiftItem" value={draft.giftItem} disabled={locked}
              placeholder={t.form.giftItemPlaceholder}
              onChange={(e) => patch({ giftItem: e.target.value })}
            />
          </FormGroup>
        ) : null}

        {draft.type === 'ADDON' ? (
          <>
            <FormGroup>
              <Label required htmlFor="couponAddonItem">{t.form.addonItem}</Label>
              <Input
                id="couponAddonItem" value={draft.addonItem} disabled={locked}
                placeholder={t.form.addonItemPlaceholder}
                onChange={(e) => patch({ addonItem: e.target.value })}
              />
            </FormGroup>

            <FormGroup>
              <Label required htmlFor="couponAddonPrice">{t.form.addonPrice}</Label>
              <div className="input-group">
                <span className="form-control w-auto flex-none">{t.form.currencyUnit}</span>
                <Input
                  id="couponAddonPrice" type="number" value={draft.addonPrice} disabled={locked}
                  onChange={(e) => patch({ addonPrice: Number(e.target.value) })}
                />
              </div>
            </FormGroup>
          </>
        ) : null}

        <FormGroup>
          <Label htmlFor="couponValidStartAt">{t.form.validStartAt}</Label>
          <Input
            id="couponValidStartAt" type="datetime-local" value={draft.startAt.slice(0, 16)}
            onChange={(e) => patch({ startAt: e.target.value })}
          />
          <FormText>{t.form.validStartAtHelp}</FormText>
        </FormGroup>

        <FormGroup>
          <Label htmlFor="couponValidEndAt">{t.form.validEndAt}</Label>
          <Input
            id="couponValidEndAt" type="datetime-local" value={draft.endAt.slice(0, 16)}
            onChange={(e) => patch({ endAt: e.target.value })}
          />
          {draft.startAt && draft.endAt && draft.endAt <= draft.startAt ? (
            <FormError>{t.form.validEndAtError}</FormError>
          ) : (
            <FormText>{t.form.validEndAtHelp}</FormText>
          )}
        </FormGroup>

        <FormGroup>
          <Label htmlFor="couponTotalQuantity">{t.form.totalQuantity}</Label>
          <Input
            id="couponTotalQuantity" type="number" value={draft.totalQuantity || ''}
            onChange={(e) => patch({ totalQuantity: Number(e.target.value) })}
          />
          <FormText>{t.form.totalQuantityHelp}</FormText>
        </FormGroup>

        <FormGroup>
          <Label htmlFor="couponLimitPerCustomer">{t.form.limitPerCustomer}</Label>
          <Input
            id="couponLimitPerCustomer" type="number" value={draft.limitPerCustomer ?? ''}
            onChange={(e) => patch({
              limitPerCustomer: e.target.value === '' ? null : Number(e.target.value),
            })}
          />
          <FormText>{t.form.limitPerCustomerHelp}</FormText>
        </FormGroup>
      </div>

      <FormGroup>
        <div className="flex items-center gap-2">
          <Switch
            id="couponPrivateMode"
            checked={draft.privateMode}
            onCheckedChange={(v) => patch({ privateMode: v })}
          />
          <Label htmlFor="couponPrivateMode" className="mb-0">{t.form.privateMode}</Label>
        </div>
        <FormText>{t.form.privateModeHelp}</FormText>
      </FormGroup>

      <FormGroup>
        <Label htmlFor="couponDescription">{t.form.description}</Label>
        <Textarea
          id="couponDescription" rows={2} value={draft.description}
          onChange={(e) => patch({ description: e.target.value })}
        />
      </FormGroup>

      <FormGroup>
        <Label htmlFor="couponImageInput">{t.form.image}</Label>
        <div className="flex items-center gap-2">
          <Input id="couponImageInput" type="file" accept="image/*" />
          {draft.imageUrl ? (
            <Button variant="outline" size="sm" onClick={() => patch({ imageUrl: '' })}>
              {t.form.imageRemove}
            </Button>
          ) : null}
        </div>
        <FormText>{t.form.imageUpload}</FormText>
      </FormGroup>

      {errors.map((err) => <FormError key={err}>{err}</FormError>)}
    </Modal>
  );
}

/* ========================================================================== */
/* modal 2：核銷票券                                                           */
/* ========================================================================== */

function RedeemModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [code, setCode] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setCode('');
    setAmount('');
    setError('');
  }, [open]);

  const submit = async () => {
    if (!code.trim()) { setError(t.redeem.codeRequired); return; }
    setError('');
    setBusy(true);
    try {
      const res = await redeemCouponByCode(code.trim());
      /* 折抵資訊：定額券直接顯示面額；百分比券以消費金額計算實際折抵。
         mock 摘要無票券資料（discountType=null），沿用現行「8 折示意」試算。 */
      const orderAmount = amount.trim() ? Number(amount) : 0;
      let discountInfo = '';
      if (res.discountType === 'AMOUNT') {
        discountInfo = t.redeem.discountInfoAmount(res.discountValue);
      } else if (res.discountType !== 'GIFT') {
        const percent = res.discountType === 'PERCENT' ? res.discountValue : 20;
        const actual = orderAmount ? Math.round((orderAmount * percent) / 100) : 0;
        if (actual) discountInfo = t.redeem.discountInfoActual(actual);
      }
      toast.show(t.redeem.success(
        res.couponName || t.labels.unnamed,
        discountInfo,
        res.customerName || t.labels.unknown,
        code.trim().toUpperCase(),
      ));
      onClose();
    } catch (e) {
      toast.show(
        `${t.redeem.failedPrefix}${e instanceof Error ? e.message : t.redeem.failedCheckCode}`,
        'danger',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t.redeem.title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{common.close}</Button>
          <Button
            variant="success" loading={busy} loadingText={t.redeem.submitting}
            onClick={() => void submit()}
          >
            {t.redeem.submit}
          </Button>
        </>
      }
    >
      <FormGroup>
        <Label htmlFor="couponCode">{t.redeem.codeLabel}</Label>
        <Input
          id="couponCode" className="text-center text-md" value={code}
          placeholder={t.redeem.codePlaceholder}
          onChange={(e) => setCode(e.target.value)}
        />
        <FormText>{t.redeem.codeHelp}</FormText>
      </FormGroup>

      <FormGroup>
        <Label htmlFor="redeemOrderAmount">{t.redeem.orderAmountLabel}</Label>
        <div className="input-group">
          <span className="form-control w-auto flex-none">{t.form.currencyUnit}</span>
          <Input
            id="redeemOrderAmount" type="number" value={amount}
            placeholder={t.redeem.orderAmountPlaceholder}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <FormText>{t.redeem.orderAmountHelp}</FormText>
      </FormGroup>

      {error ? <FormError>{error}</FormError> : null}
    </Modal>
  );
}

/* ========================================================================== */
/* modal 3：還原票券（反核銷）                                                  */
/* ========================================================================== */

function RedeemUndoModal({
  coupon, onClose, onUndone,
}: {
  coupon: CouponRow | null;
  onClose: () => void;
  onUndone: (coupon: CouponRow) => void | Promise<void>;
}) {
  const toast = useToast();
  const [reason, setReason] = React.useState('');
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!coupon) return;
    setReason('');
    setError('');
  }, [coupon]);

  const submit = async () => {
    if (!coupon) return;
    if (!reason.trim()) { setError(t.undo.reasonRequired); return; }
    setError('');
    setBusy(true);
    try {
      /* real：從發放明細找出這張已核銷的票券實例後反核銷；
         mock：明細為空陣列，直接視為還原成功（行為不變）。 */
      const instances = await listCouponInstances(coupon.id);
      const target = instances.find((i) => i.redeemedAt && i.code === coupon.lastRedeemedCode)
        ?? instances.find((i) => i.redeemedAt);
      if (target) await unredeemCouponInstance(target.id);
      toast.show(t.undo.success);
      await onUndone(coupon);
    } catch (e) {
      toast.show(
        `${t.undo.failedPrefix}${e instanceof Error ? e.message : t.messages.unknownError}`,
        'danger',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!coupon}
      onClose={onClose}
      title={t.undo.title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{common.cancel}</Button>
          <Button
            variant="warning" loading={busy} loadingText={t.undo.submitting}
            onClick={() => void submit()}
          >
            {t.undo.submit}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-base">
        {t.undo.lead(coupon?.name ?? '', coupon?.lastRedeemedCode ?? '')}
      </p>

      <Alert tone="warning" className="mb-4" title={t.undo.noticeTitle}>
        <ul className="flex list-disc flex-col gap-1 pl-4">
          {t.undo.notices.map((n) => (
            <li key={n.strong}>
              {n.lead}
              <strong>{n.strong}</strong>
              {n.text}
            </li>
          ))}
        </ul>
      </Alert>

      <FormGroup>
        <Label required htmlFor="redeemUndoReason">{t.undo.reasonLabel}</Label>
        <Input
          id="redeemUndoReason" value={reason} placeholder={t.undo.reasonPlaceholder}
          onChange={(e) => setReason(e.target.value)}
        />
        <FormText>{t.undo.reasonHelp}</FormText>
      </FormGroup>

      {error ? <FormError>{error}</FormError> : null}
    </Modal>
  );
}

/* ========================================================================== */
/* modal 4：發放給指定顧客                                                      */
/* ========================================================================== */

function IssueModal({
  coupon, onClose, onIssued,
}: {
  coupon: CouponRow | null;
  onClose: () => void;
  onIssued: (coupon: CouponRow, count: number) => void;
}) {
  const toast = useToast();

  const [keyword, setKeyword] = React.useState('');
  const [tag, setTag] = React.useState('');
  const [minVisits, setMinVisits] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [queried, setQueried] = React.useState(false);
  const [candidates, setCandidates] = React.useState<Customer[]>([]);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [sourceDesc, setSourceDesc] = React.useState('');
  const [notifyLine, setNotifyLine] = React.useState(false);
  const [error, setError] = React.useState('');
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!coupon) return;
    setKeyword(''); setTag(''); setMinVisits('');
    setQueried(false); setCandidates([]); setSelected(new Set());
    setSourceDesc(''); setNotifyLine(false); setError('');
  }, [coupon]);

  const query = async () => {
    setLoading(true);
    try {
      const res = await listCustomers({
        size: ISSUE_MAX,
        keyword,
        tag: tag || undefined,
        minVisits: minVisits.trim() === '' ? undefined : Number(minVisits),
      });
      const list = tag ? res.content.filter((c) => c.tags.includes(tag)) : res.content;
      setCandidates(list.slice(0, ISSUE_MAX));
      if (res.totalElements > ISSUE_MAX) toast.show(t.issue.truncated, 'info');
    } catch (e) {
      setCandidates([]);
      toast.show(
        `${t.issue.loadCustomersFailed}${e instanceof Error ? e.message : t.messages.unknownError}`,
        'danger',
      );
    } finally {
      setLoading(false);
      setQueried(true);
    }
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); return next; }
      if (next.size >= ISSUE_MAX) { toast.show(t.issue.reachedLimit, 'warning'); return next; }
      next.add(id);
      return next;
    });
  };

  const selectAll = (checked: boolean) => {
    if (!checked) { setSelected(new Set()); return; }
    const next = new Set<string>();
    for (const c of candidates) {
      if (next.size >= ISSUE_MAX) { toast.show(t.issue.reachedLimit, 'warning'); break; }
      next.add(c.id);
    }
    setSelected(next);
  };

  const lineBound = candidates.filter((c) => selected.has(c.id) && c.lineUserId).length;

  const openConfirm = () => {
    if (selected.size === 0) { setError(t.issue.selectSomeone); return; }
    if (selected.size > ISSUE_MAX) { setError(t.issue.batchLimit); return; }
    setError('');
    setConfirmOpen(true);
  };

  const submit = async () => {
    if (!coupon) return;
    setSaving(true);
    try {
      const res = await batchIssueCoupon(coupon.id, [...selected]);
      setConfirmOpen(false);
      onIssued(coupon, res.issued);
      toast.show(t.issue.submit);
    } catch (e) {
      toast.show(
        `${t.issue.failedPrefix}${e instanceof Error ? e.message : t.messages.unknownError}`,
        'danger',
      );
    } finally {
      setSaving(false);
    }
  };

  const columns: Column<Customer>[] = [
    {
      key: 'select', header: t.issue.columns.select, width: '48px',
      render: (c) => (
        <input
          type="checkbox"
          aria-label={c.name}
          checked={selected.has(c.id)}
          onChange={() => toggle(c.id)}
        />
      ),
    },
    {
      key: 'name', header: t.issue.columns.name,
      render: (c) => (
        <div className="min-w-0">
          <div className="font-semibold text-dark">{c.name || t.labels.unnamed}</div>
          {c.lineUserId ? <div className="text-2xs text-secondary">{t.issue.notifyStrong}</div> : null}
        </div>
      ),
    },
    { key: 'phone', header: t.issue.columns.phone, width: '140px', render: (c) => c.phone },
    {
      key: 'visits', header: t.issue.columns.visits, numeric: true, width: '110px',
      render: (c) => t.issue.visits(c.bookingCount),
    },
  ];

  return (
    <>
      <Modal
        open={!!coupon}
        onClose={onClose}
        size="lg"
        title={t.issue.title(coupon?.name ?? '')}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>{common.close}</Button>
            <Button loading={saving} loadingText={t.issue.submitting} onClick={openConfirm}>
              {t.issue.submit}
            </Button>
          </>
        }
      >
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <div className="min-w-[10rem] flex-1">
            <Input
              type="search" className="form-control-sm" value={keyword}
              placeholder={t.issue.keywordPlaceholder} aria-label={t.issue.keywordPlaceholder}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>
          <div className="w-36">
            <Input
              className="form-control-sm" value={tag}
              placeholder={t.issue.tagPlaceholder} aria-label={t.issue.tagPlaceholder}
              onChange={(e) => setTag(e.target.value)}
            />
          </div>
          <div className="w-32">
            <Input
              type="number" className="form-control-sm" value={minVisits}
              placeholder={t.issue.minVisitsPlaceholder} aria-label={t.issue.minVisitsPlaceholder}
              onChange={(e) => setMinVisits(e.target.value)}
            />
          </div>
          <Button size="sm" variant="outline" onClick={() => void query()}>
            <Search size={13} />{t.issue.query}
          </Button>
        </div>

        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-xs text-neutral-700">
            <input
              type="checkbox"
              checked={candidates.length > 0 && selected.size === candidates.length}
              onChange={(e) => selectAll(e.target.checked)}
            />
            {t.issue.selectAll}
          </label>
          <span className="text-xs text-secondary">{t.issue.selectedCount(selected.size)}</span>
        </div>

        <DataTableContainer>
          <DataTable
            columns={columns}
            rows={candidates}
            loading={loading}
            rowKey={(c) => c.id}
            empty={
              <EmptyState
                title={queried ? t.issue.noMatch : t.issue.beforeQuery}
              />
            }
          />
        </DataTableContainer>

        {lineBound > 0 ? (
          <p className="form-text mt-2">{t.issue.lineQuotaHint(lineBound)}</p>
        ) : null}

        <FormGroup className="mt-4">
          <Label htmlFor="issueSourceDesc">{t.issue.sourceDescLabel}</Label>
          <Input
            id="issueSourceDesc" className="form-control-sm" value={sourceDesc}
            placeholder={t.issue.sourceDescPlaceholder}
            onChange={(e) => setSourceDesc(e.target.value)}
          />
        </FormGroup>

        <label className="flex items-start gap-2 text-base text-neutral-700">
          <input
            type="checkbox" className="mt-1" checked={notifyLine}
            onChange={(e) => setNotifyLine(e.target.checked)}
          />
          <span>
            {t.issue.notifyLead}
            <strong>{t.issue.notifyStrong}</strong>
            {t.issue.notifyTail}
          </span>
        </label>

        {error ? <FormError>{error}</FormError> : null}
      </Modal>

      <ConfirmModal
        open={confirmOpen}
        loading={saving}
        title={t.issue.confirmTitle}
        confirmText={t.issue.submit}
        message={t.issue.confirm(selected.size)}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => void submit()}
      />
    </>
  );
}

/* ========================================================================== */
/* modal 5：票券詳情                                                           */
/* ========================================================================== */

function CouponDetailModal({
  coupon, onClose,
}: {
  coupon: CouponRow | null;
  onClose: () => void;
}) {
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!coupon) return;
    setLoading(true);
    let cancelled = false;
    const timer = setTimeout(() => { if (!cancelled) setLoading(false); }, 280);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [coupon]);

  return (
    <Modal
      open={!!coupon}
      onClose={onClose}
      title={t.detail.title}
      footer={<Button variant="secondary" onClick={onClose}>{common.close}</Button>}
    >
      {loading || !coupon ? (
        <div className="py-8 text-center text-muted">{t.detail.loading}</div>
      ) : (
        <div className="flex flex-col gap-2 text-base">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-md font-bold text-dark">{coupon.name || t.labels.unnamed}</span>
            <Badge tone={STATUS_TONE[coupon.displayStatus]}>{t.status[coupon.displayStatus]}</Badge>
            <Badge tone="neutral">{t.types[coupon.type]}</Badge>
          </div>

          <div>
            <strong>{t.detail.discountContent}</strong>{discountText(coupon)}
          </div>

          {coupon.type === 'DISCOUNT_AMOUNT' ? (
            <>
              <div>
                <strong>{t.detail.discountAmount}</strong>{formatCurrency(coupon.discountValue)}
              </div>
              {coupon.minOrderAmount !== null ? (
                <div>
                  <strong>{t.detail.minOrderAmount}</strong>{formatCurrency(coupon.minOrderAmount)}
                </div>
              ) : null}
            </>
          ) : null}

          {coupon.type === 'DISCOUNT_PERCENT' ? (
            <>
              <div>
                <strong>{t.detail.discountPercent}</strong>{t.labels.percentOff(coupon.discountValue)}
              </div>
              {coupon.maxDiscountAmount !== null ? (
                <div>
                  <strong>{t.detail.maxDiscountAmount}</strong>
                  {formatCurrency(coupon.maxDiscountAmount)}
                </div>
              ) : null}
            </>
          ) : null}

          {coupon.type === 'GIFT' ? (
            <div>
              <strong>{t.detail.giftItem}</strong>{coupon.giftItem || t.labels.giftItem}
            </div>
          ) : null}

          {coupon.type === 'ADDON' ? (
            <>
              <div>
                <strong>{t.detail.addonItem}</strong>{coupon.addonItem || t.labels.giftItem}
              </div>
              <div>
                <strong>{t.detail.addonPrice}</strong>{formatCurrency(coupon.addonPrice)}
              </div>
            </>
          ) : null}

          <div>
            <strong>{t.columns.validPeriod}</strong>
            {coupon.endAt
              ? `${formatDate(coupon.startAt)} - ${formatDate(coupon.endAt)}`
              : t.labels.noExpiry}
          </div>

          <div>
            <strong>{t.columns.issued}</strong>
            {t.labels.issuedOf(coupon.issuedQuantity, coupon.totalQuantity || null)}
            {' '}
            {t.labels.redeemed(coupon.redeemedQuantity)}
          </div>

          <div>
            <strong>{t.form.limitPerCustomer}</strong>
            {coupon.limitPerCustomer === null
              ? t.labels.noLimit
              : formatNumber(coupon.limitPerCustomer)}
          </div>

          {coupon.description ? (
            <div>
              <strong>{t.detail.usageDescription}</strong>
              <br />
              {coupon.description}
            </div>
          ) : null}

          {coupon.privateMode ? (
            <div>
              <strong>{t.detail.visibility}</strong>{t.detail.visibilityPrivate}
            </div>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
