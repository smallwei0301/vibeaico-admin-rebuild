'use client';
import * as React from 'react';
import {
  Download, Info, Link2, Pencil, Plus, Search, Trash2, Unlink, Users, X,
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
  CharCounter, FormError, FormGroup, FormText, Input, Label, Select, Textarea,
} from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import {
  bindLineUser, createCustomer, deleteCustomer, listCustomers, listUnboundLineUsers,
  unbindLineUser, updateCustomer, type UnboundLineUser,
} from '@/services/customers';
import { listMembershipLevels } from '@/services/catalog';
import { exportCustomersExcel } from '@/services/reports';
import { MOCK_CUSTOMERS } from '@/mock';
import { common } from '@/i18n/zh-TW/common';
import { nav } from '@/i18n/zh-TW/nav';
import { customersPage as t } from '@/i18n/zh-TW/pages/customers';
import { formatCurrency, formatDate, formatNumber } from '@/lib/utils';
import type { Customer, Gender, MembershipLevel } from '@/lib/types';

/* -------------------------------------------------------------------------- */
/* 本頁專用假資料（不寫進 src/mock，避免與其他頁面衝突）                          */
/* -------------------------------------------------------------------------- */

/**
 * 原站 /api/customers/tags；骨架階段由假資料推導，避免與 mock 脫節。
 * 必須在 render 時求值 —— 假資料會隨業態模式切換（見 src/mock/index.ts）。
 */
const customerTags = (): string[] =>
  Array.from(new Set(MOCK_CUSTOMERS.flatMap((c) => c.tags)));

const GENDER_OPTIONS = Object.entries(common.gender) as [Gender, string][];

const PAGE_SIZE = 20;

type AdvancedFilters = {
  levelId: string;
  tag: string;
  minSpent: string;
  maxSpent: string;
  minVisits: string;
};

const EMPTY_ADVANCED: AdvancedFilters = {
  levelId: '', tag: '', minSpent: '', maxSpent: '', minVisits: '',
};

const toNumber = (v: string): number | undefined => (v.trim() === '' ? undefined : Number(v));

/* -------------------------------------------------------------------------- */

export default function CustomersPage() {
  const toast = useToast();

  const [rows, setRows] = React.useState<Customer[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [levels, setLevels] = React.useState<MembershipLevel[]>([]);
  const [helpTipOpen, setHelpTipOpen] = React.useState(true);

  /* 搜尋列 */
  const [keywordDraft, setKeywordDraft] = React.useState('');
  const [keyword, setKeyword] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('');

  /* 進階篩選：draft 是畫面上的值，applied 才會送去查詢（按「篩選」才生效）*/
  const [draft, setDraft] = React.useState<AdvancedFilters>(EMPTY_ADVANCED);
  const [applied, setApplied] = React.useState<AdvancedFilters>(EMPTY_ADVANCED);

  /* 4 個 modal */
  const [formTarget, setFormTarget] = React.useState<Customer | null | undefined>(undefined);
  const [bindTarget, setBindTarget] = React.useState<Customer | null>(null);
  const [unbindTarget, setUnbindTarget] = React.useState<Customer | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<Customer | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [unbinding, setUnbinding] = React.useState(false);

  /** 原站以 /tenant/customers?atRisk=true 從儀表板的流失預警進入本頁 */
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('atRisk') === 'true') setStatusFilter('atRisk');
  }, []);

  React.useEffect(() => {
    void (async () => {
      try {
        setLevels(await listMembershipLevels());
      } catch {
        toast.show(t.messages.loadFailedRetry, 'danger');
      }
    })();
  }, [toast]);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await listCustomers({
        page: 0,
        size: 200,
        keyword,
        atRisk: statusFilter === 'atRisk' || undefined,
        levelId: applied.levelId || undefined,
        tag: applied.tag || undefined,
        minSpent: toNumber(applied.minSpent),
        maxSpent: toNumber(applied.maxSpent),
        minVisits: toNumber(applied.minVisits),
      });

      /* 標籤篩選骨架階段由前端補做（原站是 /api/customers?tag=）*/
      const list = applied.tag
        ? res.content.filter((c) => c.tags.includes(applied.tag))
        : res.content;

      setTotal(list.length);
      setRows(list.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE));
    } catch (e) {
      toast.show(
        `${t.messages.loadCustomersFailed}${e instanceof Error ? e.message : t.messages.unknownError}`,
        'danger',
      );
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, keyword, statusFilter, applied, toast]);

  React.useEffect(() => { void load(); }, [load]);

  const runSearch = () => { setKeyword(keywordDraft); setPage(0); };
  const clearSearch = () => { setKeywordDraft(''); setKeyword(''); setPage(0); };
  const applyAdvanced = () => { setApplied(draft); setPage(0); };
  const clearAdvanced = () => { setDraft(EMPTY_ADVANCED); setApplied(EMPTY_ADVANCED); setPage(0); };

  const exportExcel = () => {
    void exportCustomersExcel().catch(() => {
      toast.show(t.messages.exportFailed, 'danger');
    });
  };

  /* ------------------------------------------------------------------ 欄位 */

  const columns: Column<Customer>[] = [
    {
      key: 'info', header: t.columns.info,
      render: (c) => (
        <div className="min-w-0">
          <div className="font-semibold text-dark">{c.name || t.labels.noName}</div>
          {c.lineDisplayName ? (
            <div className="text-xs text-secondary">
              {t.labels.linePrefix}{c.lineDisplayName}
            </div>
          ) : null}
          <div className="text-2xs text-secondary">
            {c.lastVisitAt ? t.labels.lastVisit(formatDate(c.lastVisitAt)) : t.labels.neverVisited}
          </div>
        </div>
      ),
    },
    {
      key: 'contact', header: t.columns.contact,
      render: (c) => (
        <div className="min-w-0">
          <div>{c.phone}</div>
          {c.email ? <div className="text-xs text-secondary">{c.email}</div> : null}
        </div>
      ),
    },
    {
      key: 'level', header: t.columns.level, width: '120px',
      render: (c) => (c.membershipLevelName
        ? <Badge tone="purple">{c.membershipLevelName}</Badge>
        : <span className="text-muted">{common.none}</span>),
    },
    {
      key: 'bookingCount', header: t.columns.bookingCount, numeric: true, width: '100px',
      render: (c) => formatNumber(c.bookingCount),
    },
    {
      key: 'totalSpent', header: t.columns.totalSpent, numeric: true, width: '130px',
      render: (c) => formatCurrency(c.totalSpent),
    },
    {
      key: 'status', header: t.columns.status, width: '130px',
      render: (c) => (
        <div className="flex flex-col items-start gap-1">
          {!c.active ? (
            <Badge tone="neutral">{t.status.inactive}</Badge>
          ) : c.atRisk ? (
            <Badge tone="warning">{t.status.atRisk}</Badge>
          ) : (
            <Badge tone="success">{t.status.active}</Badge>
          )}
          {!c.lineUserId ? <Badge tone="neutral">{t.status.unbound}</Badge> : null}
          {c.source === 'LINE' || c.source === 'PUBLIC_BOOKING' ? (
            <Badge tone="info">{t.status.autoCreated}</Badge>
          ) : null}
        </div>
      ),
    },
    {
      key: 'actions', header: t.columns.actions, width: '150px',
      render: (c) => (
        <div className="btn-group">
          <Button
            variant="outline" size="sm" title={t.actions.edit} aria-label={t.actions.edit}
            onClick={() => setFormTarget(c)}
          >
            <Pencil size={13} />
          </Button>
          {c.lineUserId ? (
            <Button
              variant="outline" size="sm" title={t.actions.unbindLine} aria-label={t.actions.unbindLine}
              onClick={() => setUnbindTarget(c)}
            >
              <Unlink size={13} />
            </Button>
          ) : (
            <Button
              variant="line" size="sm" title={t.actions.bindLine} aria-label={t.actions.bindLine}
              onClick={() => setBindTarget(c)}
            >
              <Link2 size={13} />
            </Button>
          )}
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

  const isAtRiskMode = statusFilter === 'atRisk';

  return (
    <>
      <PageHeader
        eyebrow={nav.navCustomer}
        title={t.title}
        subtitle={t.subtitle}
        actions={
          <>
            <Button variant="ghost" onClick={exportExcel}>
              <Download size={15} />{t.actions.export}
            </Button>
            <Button onClick={() => setFormTarget(null)}>
              <Plus size={15} />{t.actions.create}
            </Button>
          </>
        }
      />

      {helpTipOpen && !isAtRiskMode ? (
        <Alert
          tone="info"
          className="mb-4"
          action={
            <Button variant="ghost" size="icon" aria-label={common.close} onClick={() => setHelpTipOpen(false)}>
              <X size={14} />
            </Button>
          }
        >
          <span className="font-semibold">{t.helpTip.prefix}</span>
          {t.helpTip.text}
        </Alert>
      ) : null}

      {isAtRiskMode ? (
        <Alert
          tone="warning"
          className="mb-4"
          title={t.atRisk.bannerTitle}
          action={
            <Button variant="outline" size="sm" onClick={() => { setStatusFilter(''); setPage(0); }}>
              <Users size={13} />{t.atRisk.backToAll}
            </Button>
          }
        >
          {t.atRisk.count(total)}
        </Alert>
      ) : null}

      <DataTableContainer>
        <DataTableHeader
          title={t.tableTitle}
          actions={
            <>
              <Select
                className="form-select-sm w-auto"
                aria-label={t.search.statusFilter.all}
                value={statusFilter}
                onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
              >
                <option value="">{t.search.statusFilter.all}</option>
                <option value="atRisk">{t.search.statusFilter.atRisk}</option>
              </Select>
              <div className="input-group">
                <Input
                  className="w-56"
                  placeholder={t.search.placeholder}
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

        {/* -------------------------------------------------------- 進階篩選 */}
        <div className="border-b border-neutral-250 px-4 py-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-neutral-700">
            <Info size={13} />{t.search.advancedTitle}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[9rem]">
              <Label className="text-xs" htmlFor="filterLevel">{t.search.level}</Label>
              <Select
                id="filterLevel" className="form-select-sm" value={draft.levelId}
                onChange={(e) => setDraft((d) => ({ ...d, levelId: e.target.value }))}
              >
                <option value="">{t.search.levelAll}</option>
                {levels.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </Select>
            </div>

            <div className="min-w-[9rem]">
              <Label className="text-xs" htmlFor="filterTag">{t.search.tag}</Label>
              <Select
                id="filterTag" className="form-select-sm" value={draft.tag}
                onChange={(e) => setDraft((d) => ({ ...d, tag: e.target.value }))}
              >
                <option value="">{t.search.tagAll}</option>
                {customerTags().map((tag) => (
                  <option key={tag} value={tag}>{tag}</option>
                ))}
              </Select>
            </div>

            <div className="w-28">
              <Label className="text-xs" htmlFor="filterMinSpent">{t.search.minSpent}</Label>
              <Input
                id="filterMinSpent" type="number" className="form-control-sm"
                placeholder={t.search.minSpentPlaceholder} value={draft.minSpent}
                onChange={(e) => setDraft((d) => ({ ...d, minSpent: e.target.value }))}
              />
            </div>

            <div className="w-28">
              <Label className="text-xs" htmlFor="filterMaxSpent">{t.search.maxSpent}</Label>
              <Input
                id="filterMaxSpent" type="number" className="form-control-sm"
                placeholder={t.search.maxSpentPlaceholder} value={draft.maxSpent}
                onChange={(e) => setDraft((d) => ({ ...d, maxSpent: e.target.value }))}
              />
            </div>

            <div className="w-28">
              <Label className="text-xs" htmlFor="filterMinVisits">{t.search.minVisits}</Label>
              <Input
                id="filterMinVisits" type="number" className="form-control-sm"
                placeholder={t.search.minVisitsPlaceholder} value={draft.minVisits}
                onChange={(e) => setDraft((d) => ({ ...d, minVisits: e.target.value }))}
              />
            </div>

            <div className="btn-group pb-0.5">
              <Button size="sm" onClick={applyAdvanced}>{t.search.apply}</Button>
              <Button size="sm" variant="outline" onClick={clearAdvanced}>{t.search.clear}</Button>
            </div>
          </div>

          <p className="form-text">
            {t.featureTip.textLead}
            <strong>{t.featureTip.textTag}</strong>
            {t.featureTip.textMiddle}
            <strong>{t.featureTip.textLevel}</strong>
            {t.featureTip.textTail}
            {' '}
            <a className="underline" href="/tenant/feature-store">{t.featureTip.learnMore}</a>
          </p>
        </div>

        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          rowKey={(c) => c.id}
          scroll
          empty={
            <EmptyState
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
          <Pagination page={page} size={PAGE_SIZE} total={total} onChange={setPage} />
        </DataTableFooter>
      </DataTableContainer>

      {/* ------------------------------------------- modal 1：新增/編輯顧客 */}
      <CustomerFormModal
        open={formTarget !== undefined}
        customer={formTarget ?? null}
        onClose={() => setFormTarget(undefined)}
        onSaved={(isEdit) => {
          setFormTarget(undefined);
          toast.show(isEdit ? t.messages.updated : t.messages.created);
          void load();
        }}
      />

      {/* ------------------------------------------------ modal 2：綁定 LINE */}
      <BindLineModal
        customer={bindTarget}
        onClose={() => setBindTarget(null)}
        onBound={() => { setBindTarget(null); toast.show(t.messages.lineBound); void load(); }}
      />

      {/* ---------------------------------------------- modal 3：解除綁定 */}
      <ConfirmModal
        open={!!unbindTarget}
        danger
        loading={unbinding}
        title={t.confirm.unbindTitle}
        confirmText={t.actions.unbindLine}
        message={unbindTarget ? t.confirm.unbindLine(unbindTarget.name) : common.confirm.message}
        onClose={() => setUnbindTarget(null)}
        onConfirm={async () => {
          if (!unbindTarget) return;
          setUnbinding(true);
          try {
            await unbindLineUser(unbindTarget.id);
            setUnbindTarget(null);
            toast.show(t.messages.lineUnbound);
            void load();
          } catch (e) {
            toast.show(
              `${t.messages.unbindFailed}${e instanceof Error ? `: ${e.message}` : ''}`,
              'danger',
            );
          } finally {
            setUnbinding(false);
          }
        }}
      />

      {/* -------------------------------------------------- modal 4：確認 */}
      <ConfirmModal
        open={!!deleteTarget}
        danger
        loading={deleting}
        title={t.confirm.deleteTitle}
        confirmText={common.delete}
        message={deleteTarget ? t.confirm.delete(deleteTarget.name) : common.confirm.message}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          setDeleting(true);
          try {
            await deleteCustomer(deleteTarget.id);
            toast.show(t.messages.deleted);
            setDeleteTarget(null);
            void load();
          } catch {
            toast.show(t.messages.deleteFailed, 'danger');
          } finally {
            setDeleting(false);
          }
        }}
      />
    </>
  );
}

/* ========================================================================== */
/* 新增 / 編輯顧客                                                             */
/* ========================================================================== */

function CustomerFormModal({
  open, customer, onClose, onSaved,
}: {
  open: boolean;
  customer: Customer | null;
  onClose: () => void;
  onSaved: (isEdit: boolean) => void;
}) {
  const toast = useToast();
  const isEdit = !!customer;

  const [name, setName] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [gender, setGender] = React.useState<Gender>('');
  const [birthday, setBirthday] = React.useState('');
  const [note, setNote] = React.useState('');
  const [error, setError] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setError('');
    setName(customer?.name ?? '');
    setPhone(customer?.phone ?? '');
    setEmail(customer?.email ?? '');
    setGender(customer?.gender ?? '');
    setBirthday(customer?.birthday ?? '');
    setNote(customer?.note ?? '');
  }, [open, customer]);

  const validate = (): string => {
    if (!name.trim()) return t.form.nameInvalid;
    if (!phone.trim()) return t.form.phoneInvalid;
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return t.form.emailInvalid;
    if (note.length > t.form.noteMax) return common.validation.maxLength(t.form.noteMax);
    return '';
  };

  const submit = async () => {
    const err = validate();
    setError(err);
    if (err) { toast.show(t.messages.checkFields, 'warning'); return; }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim(),
        gender,
        birthday,
        note,
      };
      if (isEdit && customer) {
        await updateCustomer(customer.id, payload);
      } else {
        await createCustomer(payload);
      }
      onSaved(isEdit);
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
      <p className="form-text mb-4">{common.requiredHint}</p>

      <h6 className="mb-3 text-base font-bold text-dark">{t.form.sectionBasic}</h6>
      <div className="grid gap-x-4 md:grid-cols-2">
        <FormGroup>
          <Label required htmlFor="customerName">{t.form.name}</Label>
          <Input
            id="customerName" value={name} placeholder={t.form.namePlaceholder}
            onChange={(e) => setName(e.target.value)}
          />
        </FormGroup>

        <FormGroup>
          <Label required htmlFor="customerPhone">{t.form.phone}</Label>
          <Input
            id="customerPhone" type="tel" value={phone} placeholder={t.form.phonePlaceholder}
            onChange={(e) => setPhone(e.target.value)}
          />
          <FormText>{t.form.phoneHelp}</FormText>
        </FormGroup>

        <FormGroup>
          <Label htmlFor="customerEmail">{t.form.email}</Label>
          <Input
            id="customerEmail" type="email" value={email} placeholder={t.form.emailPlaceholder}
            onChange={(e) => setEmail(e.target.value)}
          />
        </FormGroup>

        <FormGroup>
          <Label htmlFor="customerGender">{t.form.gender}</Label>
          <Select
            id="customerGender" value={gender}
            onChange={(e) => setGender(e.target.value as Gender)}
          >
            {GENDER_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </Select>
        </FormGroup>

        <FormGroup>
          <Label htmlFor="customerBirthday">{t.form.birthday}</Label>
          <Input
            id="customerBirthday" type="date" value={birthday}
            onChange={(e) => setBirthday(e.target.value)}
          />
          <FormText>{t.form.birthdayHelp}</FormText>
        </FormGroup>
      </div>

      <h6 className="mb-3 mt-2 text-base font-bold text-dark">{t.form.sectionNote}</h6>
      <FormGroup>
        <Label htmlFor="customerNote">{t.form.note}</Label>
        <Textarea
          id="customerNote" rows={3} value={note} maxLength={t.form.noteMax}
          placeholder={t.form.notePlaceholder}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="flex items-center justify-between">
          <FormText>{t.form.noteHelp}</FormText>
          <CharCounter value={note} max={t.form.noteMax} />
        </div>
      </FormGroup>

      {error ? <FormError>{error}</FormError> : null}
    </Modal>
  );
}

/* ========================================================================== */
/* 綁定 LINE 用戶                                                              */
/* ========================================================================== */

function BindLineModal({
  customer, onClose, onBound,
}: {
  customer: Customer | null;
  onClose: () => void;
  onBound: () => void;
}) {
  const toast = useToast();
  const [users, setUsers] = React.useState<UnboundLineUser[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [bindingId, setBindingId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!customer) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const list = await listUnboundLineUsers();
        if (!cancelled) setUsers(list);
      } catch {
        if (!cancelled) toast.show(t.bindLine.loadFailed, 'danger');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [customer, toast]);

  const bind = async (u: UnboundLineUser) => {
    if (!customer) return;
    setBindingId(u.lineUserId);
    try {
      await bindLineUser(customer.id, u.lineUserId, u.displayName);
      onBound();
    } catch (e) {
      toast.show(
        e instanceof Error ? `${t.messages.bindFailedPrefix}${e.message}` : t.messages.bindFailedRetry,
        'danger',
      );
    } finally {
      setBindingId(null);
    }
  };

  return (
    <Modal
      open={!!customer}
      onClose={onClose}
      size="lg"
      title={t.bindLine.title(customer?.name ?? '')}
      footer={<Button variant="secondary" onClick={onClose}>{common.cancel}</Button>}
    >
      <p className="mb-4 text-base text-neutral-700">{t.bindLine.intro}</p>

      {loading ? (
        <div className="py-8 text-center text-muted">{t.bindLine.loading}</div>
      ) : users.length === 0 ? (
        <EmptyState title={t.bindLine.emptyTitle} description={t.bindLine.emptyDescription} />
      ) : (
        <div className="flex flex-col gap-2">
          {users.map((u) => (
            <button
              key={u.lineUserId}
              type="button"
              disabled={bindingId !== null}
              onClick={() => void bind(u)}
              className="flex items-center gap-3 rounded-md border border-neutral-250 px-3 py-2.5 text-left transition-colors hover:bg-neutral-100 disabled:opacity-60"
            >
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-pill bg-neutral-200 text-xs font-semibold text-neutral-600">
                {(u.displayName || '?').slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base font-semibold text-dark">
                  {u.displayName || t.labels.noNickname}
                </span>
              </span>
              {bindingId === u.lineUserId ? (
                <span className="text-xs text-secondary">{t.bindLine.binding}</span>
              ) : (
                <Badge tone="neutral">{t.status.unbound}</Badge>
              )}
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
