'use client';
import * as React from 'react';
import { Award, Pencil, Plus, Trash2, X } from 'lucide-react';
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
  FormError, FormGroup, FormText, Input, Label, Textarea,
} from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { listMembershipLevels } from '@/services/catalog';
import {
  createMembershipLevel, deleteMembershipLevel, updateMembershipLevel,
} from '@/services/coupons';
import { listFeatures } from '@/services/settings';
import { common } from '@/i18n/zh-TW/common';
import { nav } from '@/i18n/zh-TW/nav';
import { membershipLevelsPage as t } from '@/i18n/zh-TW/pages/membership-levels';
import { formatCurrency, formatNumber } from '@/lib/utils';
import type { MembershipLevel } from '@/lib/types';

/* -------------------------------------------------------------------------- */
/* 欄位來源                                                                     */
/* -------------------------------------------------------------------------- */

type LevelRow = MembershipLevel & {
  description: string;
  active: boolean;
  isDefault: boolean;
};

/** 說明、啟用與預設旗標由 membership_levels API 回傳，缺少時使用安全預設值。 */
const toRow = (level: MembershipLevel): LevelRow => ({
  ...level,
  description: level.description ?? '',
  active: level.active ?? true,
  isDefault: level.isDefault ?? false,
});

/** 新增等級時的預設顏色（同 mock 的一般會員灰） */
const DEFAULT_LEVEL_COLOR = '#86868b';

/* -------------------------------------------------------------------------- */

export default function MembershipLevelsPage() {
  const toast = useToast();

  const [rows, setRows] = React.useState<LevelRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [helpTipOpen, setHelpTipOpen] = React.useState(true);
  const [featureActive, setFeatureActive] = React.useState(true);

  const [formTarget, setFormTarget] = React.useState<LevelRow | null | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = React.useState<LevelRow | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  /** 新等級的本地 id 產生器：render 期不可用 Date.now()／Math.random() */
  const nextId = React.useRef(1);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const list = await listMembershipLevels();
      setRows([...list].sort((a, b) => a.sortOrder - b.sortOrder).map(toRow));
    } catch {
      toast.show(t.messages.loadFailed, 'danger');
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
        setFeatureActive(features.some((f) => f.code === 'MEMBERSHIP_SYSTEM' && f.active));
      } catch {
        toast.show(t.messages.retryLater, 'danger');
      }
    })();
  }, [toast]);

  const upsert = (draft: LevelRow) => {
    setRows((list) => {
      const exists = list.some((l) => l.id === draft.id);
      const next = exists
        ? list.map((l) => (l.id === draft.id ? draft : l))
        : [...list, draft];
      /* 只有一個預設等級 */
      const normalized = draft.isDefault
        ? next.map((l) => (l.id === draft.id ? l : { ...l, isDefault: false }))
        : next;
      return normalized.sort((a, b) => a.sortOrder - b.sortOrder);
    });
  };

  const columns: Column<LevelRow>[] = [
    {
      key: 'sortOrder', header: t.columns.sortOrder, numeric: true, width: '70px',
      render: (l) => formatNumber(l.sortOrder),
    },
    {
      key: 'name', header: t.columns.name,
      render: (l) => (
        <div className="flex items-start gap-2">
          <span
            aria-hidden
            className="mt-1 h-3 w-3 flex-shrink-0 rounded-pill"
            style={{ backgroundColor: l.color }}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-dark">{l.name}</span>
              {l.isDefault ? <Badge tone="primary">{t.labels.default}</Badge> : null}
            </div>
            {l.description ? (
              <div className="text-xs text-secondary">{l.description}</div>
            ) : null}
            <div className="text-2xs text-secondary">{t.labels.customerCount(l.customerCount)}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'threshold', header: t.columns.threshold, numeric: true, width: '130px',
      render: (l) => formatCurrency(l.thresholdSpent),
    },
    {
      key: 'discount', header: t.columns.discount, numeric: true, width: '100px',
      render: (l) => formatNumber(l.discountPercent),
    },
    {
      key: 'pointMultiplier', header: t.columns.pointMultiplier, numeric: true, width: '110px',
      render: (l) => t.labels.multiplier(l.pointRateMultiplier),
    },
    {
      key: 'status', header: t.columns.status, width: '100px',
      render: (l) => (l.active
        ? <Badge tone="success">{t.labels.active}</Badge>
        : <Badge tone="neutral">{t.labels.inactive}</Badge>),
    },
    {
      key: 'actions', header: t.columns.actions, width: '110px',
      render: (l) => (
        <div className="btn-group">
          <Button
            variant="outline" size="sm" title={t.actions.edit} aria-label={t.actions.edit}
            onClick={() => setFormTarget(l)}
          >
            <Pencil size={13} />
          </Button>
          <Button
            variant="outlineDanger" size="sm" title={t.actions.delete} aria-label={t.actions.delete}
            onClick={() => setDeleteTarget(l)}
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
        eyebrow={nav.navCustomer}
        title={t.title}
        actions={
          <Button onClick={() => setFormTarget(null)}>
            <Plus size={15} />{t.actions.create}
          </Button>
        }
      />

      {helpTipOpen ? (
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

      {!featureActive ? (
        <Alert tone="warning" className="mb-4">
          {t.featureWarning.lead}
          <strong>{t.featureWarning.strong}</strong>
          {t.featureWarning.tail}
        </Alert>
      ) : null}

      <DataTableContainer>
        <DataTableHeader title={t.tableTitle} />

        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          rowKey={(l) => l.id}
          empty={
            <EmptyState
              icon={Award}
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

      <LevelFormModal
        open={formTarget !== undefined}
        level={formTarget ?? null}
        onClose={() => setFormTarget(undefined)}
        onSaved={(draft, isEdit, fresh) => {
          if (fresh) {
            /* real：後端儲存後已全店重算等級，直接以重拉的列表（含新 customerCount）更新 */
            setRows([...fresh].sort((a, b) => a.sortOrder - b.sortOrder).map(toRow));
          } else {
            const id = isEdit ? draft.id : `ml_new_${nextId.current++}`;
            upsert({ ...draft, id });
          }
          setFormTarget(undefined);
          toast.show(isEdit ? t.messages.updated : t.messages.created);
        }}
      />

      <ConfirmModal
        open={!!deleteTarget}
        danger
        loading={deleting}
        title={t.confirm.deleteTitle}
        confirmText={common.delete}
        message={t.confirm.delete}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) { setDeleteTarget(null); return; }
          setDeleting(true);
          try {
            const fresh = await deleteMembershipLevel(deleteTarget.id);
            if (fresh) {
              /* real：刪除後受影響顧客已重算落到次高等級，以重拉的列表更新 */
              setRows([...fresh].sort((a, b) => a.sortOrder - b.sortOrder).map(toRow));
            } else {
              setRows((list) => list.filter((l) => l.id !== deleteTarget.id));
            }
            setDeleteTarget(null);
            toast.show(t.messages.deleted);
          } catch (e) {
            /* i18n 尚無刪除失敗前綴（契約檔不可加字），直接顯示後端錯誤訊息 */
            toast.show(
              e instanceof Error && e.message ? e.message : common.message.deleteFailed,
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
/* 新增 / 編輯會員等級                                                          */
/* ========================================================================== */

const EMPTY_LEVEL: LevelRow = {
  id: '',
  name: '',
  color: DEFAULT_LEVEL_COLOR,
  thresholdSpent: 0,
  discountPercent: 0,
  pointRateMultiplier: 1,
  customerCount: 0,
  sortOrder: 0,
  description: '',
  active: true,
  isDefault: false,
};

function LevelFormModal({
  open, level, onClose, onSaved,
}: {
  open: boolean;
  level: LevelRow | null;
  onClose: () => void;
  onSaved: (draft: LevelRow, isEdit: boolean, fresh?: MembershipLevel[]) => void;
}) {
  const toast = useToast();
  const isEdit = !!level;

  const [draft, setDraft] = React.useState<LevelRow>(EMPTY_LEVEL);
  const [error, setError] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setError('');
    setDraft(level ?? EMPTY_LEVEL);
  }, [open, level]);

  const patch = (p: Partial<LevelRow>) => setDraft((d) => ({ ...d, ...p }));

  const submit = async () => {
    if (!draft.name.trim()) {
      setError(t.form.nameInvalid);
      return;
    }
    setError('');
    setSaving(true);
    try {
      const payload = {
        name: draft.name,
        color: draft.color,
        thresholdSpent: draft.thresholdSpent,
        discountPercent: draft.discountPercent,
        pointRateMultiplier: draft.pointRateMultiplier,
        sortOrder: draft.sortOrder,
        description: draft.description,
        active: draft.active,
        isDefault: draft.isDefault,
      };
      const fresh = isEdit
        ? await updateMembershipLevel(draft.id, payload)
        : await createMembershipLevel(payload);
      onSaved(draft, isEdit, fresh);
    } catch (e) {
      toast.show(
        `${t.messages.saveFailedPrefix}${e instanceof Error ? e.message : t.messages.unknownError}`,
        'danger',
      );
    } finally {
      setSaving(false);
    }
  };

  const n = t.form.notice;

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
      <FormGroup>
        <Label required htmlFor="levelName">{t.form.nameLabel}</Label>
        <Input
          id="levelName" value={draft.name} placeholder={t.form.namePlaceholder}
          onChange={(e) => patch({ name: e.target.value })}
        />
      </FormGroup>

      <div className="grid gap-x-4 md:grid-cols-2">
        <FormGroup>
          <Label htmlFor="thresholdAmount">{t.form.threshold}</Label>
          <div className="input-group">
            <span className="flex items-center rounded-l-md border border-r-0 border-neutral-250 bg-neutral-100 px-3 text-xs text-secondary">
              {t.form.thresholdPrefix}
            </span>
            <Input
              id="thresholdAmount" type="number" min={0} className="rounded-l-none"
              value={String(draft.thresholdSpent)}
              onChange={(e) => patch({ thresholdSpent: Number(e.target.value) || 0 })}
            />
          </div>
          <FormText>{t.form.thresholdHelp}</FormText>
        </FormGroup>

        <FormGroup>
          <Label htmlFor="levelColor">{t.form.color}</Label>
          <Input
            id="levelColor" type="color" className="h-9 p-1"
            value={draft.color}
            onChange={(e) => patch({ color: e.target.value })}
          />
          <FormText>{t.form.colorHelp}</FormText>
        </FormGroup>

        <FormGroup>
          <Label htmlFor="discountPercent">{t.form.discount}</Label>
          <Input
            id="discountPercent" type="number" min={0} max={100}
            value={String(draft.discountPercent)}
            onChange={(e) => patch({ discountPercent: Number(e.target.value) || 0 })}
          />
          <FormText>{t.form.discountHelp}</FormText>
        </FormGroup>

        <FormGroup>
          <Label htmlFor="pointMultiplier">{t.form.pointMultiplier}</Label>
          <Input
            id="pointMultiplier" type="number" min={0} step={0.5}
            value={String(draft.pointRateMultiplier)}
            onChange={(e) => patch({ pointRateMultiplier: Number(e.target.value) || 0 })}
          />
          <FormText>{t.form.pointMultiplierHelp}</FormText>
        </FormGroup>
      </div>

      <Alert tone="warning" className="mb-4">
        <ul className="flex list-disc flex-col gap-1 pl-4">
          <li>{n.scopeLead}<strong>{n.scopeStrong}</strong>{n.scopeTail}</li>
          <li>{n.stackLead}<strong>{n.stackStrong}</strong>{n.stackTail}</li>
          <li>{n.effectLead}<strong>{n.effectStrong}</strong>{n.effectTail}</li>
        </ul>
      </Alert>

      <FormGroup>
        <Label htmlFor="levelDescription">{t.form.description}</Label>
        <Textarea
          id="levelDescription" rows={2} value={draft.description}
          placeholder={t.form.descriptionPlaceholder}
          onChange={(e) => patch({ description: e.target.value })}
        />
      </FormGroup>

      <FormGroup>
        <Label htmlFor="sortOrder">{t.form.sortOrder}</Label>
        <Input
          id="sortOrder" type="number" value={String(draft.sortOrder)}
          onChange={(e) => patch({ sortOrder: Number(e.target.value) || 0 })}
        />
        <FormText>{t.form.sortOrderHelp}</FormText>
      </FormGroup>

      <label className="mb-2 flex items-center gap-2 text-base">
        <input
          type="checkbox" checked={draft.active}
          onChange={(e) => patch({ active: e.target.checked })}
        />
        {t.form.isActive}
      </label>

      <label className="flex items-center gap-2 text-base">
        <input
          type="checkbox" checked={draft.isDefault}
          onChange={(e) => patch({ isDefault: e.target.checked })}
        />
        {t.form.isDefault}
      </label>

      {error ? <FormError>{error}</FormError> : null}
    </Modal>
  );
}
