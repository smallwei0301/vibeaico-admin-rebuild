'use client';
import * as React from 'react';
import Link from 'next/link';
import { Eye, Pencil, Plus, Radio, Send, Trash2, XCircle } from 'lucide-react';
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
import { listMembershipLevels } from '@/services/catalog';
import { getDashboardStats } from '@/services/reports';
import {
  cancelMarketingPush, createMarketingPush, deleteMarketingPush, listMarketingPushes,
  sendMarketingPush, updateMarketingPush,
} from '@/services/marketing';
import type { MarketingPushFormPayload } from '@/services/marketing';
import { common } from '@/i18n/zh-TW/common';
import { nav } from '@/i18n/zh-TW/nav';
import { marketingPage as t } from '@/i18n/zh-TW/pages/marketing';
import { formatDateTime } from '@/lib/utils';
import type { MarketingPush, MembershipLevel } from '@/lib/types';

type PushStatus = MarketingPush['status'];
type PushTargetType = MarketingPush['targetType'];

const STATUS_TONE: Record<PushStatus, 'neutral' | 'info' | 'primary' | 'success' | 'danger'> = {
  DRAFT: 'neutral',
  SCHEDULED: 'info',
  SENDING: 'primary',
  SENT: 'success',
  FAILED: 'danger',
  CANCELLED: 'neutral',
};

const PAGE_SIZE = 20;

type PendingAction = { kind: 'delete' | 'cancel' | 'send'; push: MarketingPush };

/* -------------------------------------------------------------------------- */

export default function MarketingPage() {
  const toast = useToast();

  const [rows, setRows] = React.useState<MarketingPush[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [page, setPage] = React.useState(0);
  const [levels, setLevels] = React.useState<MembershipLevel[]>([]);
  const [quota, setQuota] = React.useState<{ used: number; total: number } | null>(null);

  const [formTarget, setFormTarget] = React.useState<MarketingPush | null | undefined>(undefined);
  const [viewTarget, setViewTarget] = React.useState<MarketingPush | null>(null);
  const [pending, setPending] = React.useState<PendingAction | null>(null);
  const [working, setWorking] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listMarketingPushes());
    } catch (e) {
      toast.show(
        `${t.messages.loadPushesFailed}${e instanceof Error ? e.message : t.messages.unknownError}`,
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
        setLevels(await listMembershipLevels());
      } catch {
        toast.show(t.messages.loadLevelsFailed, 'danger');
      }
    })();
  }, [toast]);

  React.useEffect(() => {
    void (async () => {
      try {
        const stats = await getDashboardStats();
        setQuota({ used: stats.pushQuotaUsed, total: stats.pushQuotaTotal });
      } catch {
        toast.show(t.messages.loadQuotaFailed, 'danger');
      }
    })();
  }, [toast]);

  const visible = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const targetText = (p: MarketingPush) =>
    p.targetType === 'ALL' || !p.targetLabel
      ? t.targetType[p.targetType]
      : t.labels.targetWithValue(t.targetType[p.targetType], p.targetLabel);

  const runPending = async () => {
    if (!pending) return;
    const { kind, push } = pending;
    setWorking(true);
    try {
      if (kind === 'delete') await deleteMarketingPush(push.id);
      else if (kind === 'cancel') await cancelMarketingPush(push.id);
      else await sendMarketingPush(push.id);
      setPending(null);
      toast.show(
        kind === 'delete' ? t.messages.deleted
          : kind === 'cancel' ? t.messages.cancelled
            : t.messages.sending,
      );
      void load();
    } catch (e) {
      const detail = e instanceof Error ? e.message : t.messages.unknownError;
      toast.show(
        kind === 'delete' ? `${t.messages.deleteFailed}: ${detail}`
          : kind === 'cancel' ? `${t.messages.cancelFailed}: ${detail}`
            : `${t.messages.sendFailedPrefix}${detail}`,
        'danger',
      );
    } finally {
      setWorking(false);
    }
  };

  const columns: Column<MarketingPush>[] = [
    {
      key: 'title', header: t.columns.title,
      render: (p) => (
        <div className="min-w-0">
          <div className="font-semibold text-dark">{p.title}</div>
          <div className="text-2xs text-secondary">
            {p.sentAt
              ? t.labels.sentAt(formatDateTime(p.sentAt))
              : p.scheduledAt
                ? t.labels.scheduledAt(formatDateTime(p.scheduledAt))
                : formatDateTime(p.createdAt)}
          </div>
        </div>
      ),
    },
    {
      key: 'target', header: t.columns.target, width: '160px',
      render: (p) => <Badge tone="info">{targetText(p)}</Badge>,
    },
    {
      key: 'estimated', header: t.columns.estimated, width: '110px',
      /* 後端沒有任何欄位或關聯表能在發送前算出受眾人數，這是誠實佔位，不是假資料 —— 見 Issue #24。 */
      render: () => <span className="text-muted">{t.labels.estimatedUnavailable}</span>,
    },
    {
      key: 'result', header: t.columns.result, width: '140px',
      render: (p) => (p.sentCount ? (
        <span className="text-success">{t.labels.resultSuccess(p.sentCount)}</span>
      ) : p.status === 'FAILED' ? (
        <span className="text-danger">{t.status.FAILED}</span>
      ) : <span className="text-muted">{t.labels.notSent}</span>),
    },
    {
      key: 'status', header: t.columns.status, width: '110px',
      render: (p) => <Badge tone={STATUS_TONE[p.status]}>{t.status[p.status]}</Badge>,
    },
    {
      key: 'actions', header: t.columns.actions, width: '190px',
      render: (p) => (
        <div className="btn-group">
          <Button
            variant="outline" size="sm" title={t.actions.view} aria-label={t.actions.view}
            onClick={() => setViewTarget(p)}
          >
            <Eye size={13} />
          </Button>
          {p.status === 'DRAFT' || p.status === 'SCHEDULED' ? (
            <Button
              variant="outline" size="sm" title={t.actions.edit} aria-label={t.actions.edit}
              onClick={() => setFormTarget(p)}
            >
              <Pencil size={13} />
            </Button>
          ) : null}
          {p.status === 'DRAFT' || p.status === 'SCHEDULED' || p.status === 'FAILED' ? (
            <Button
              variant="outline" size="sm" title={t.actions.send} aria-label={t.actions.send}
              onClick={() => setPending({ kind: 'send', push: p })}
            >
              <Send size={13} />
            </Button>
          ) : null}
          {p.status === 'SCHEDULED' ? (
            <Button
              variant="outline" size="sm" title={t.actions.cancelPush} aria-label={t.actions.cancelPush}
              onClick={() => setPending({ kind: 'cancel', push: p })}
            >
              <XCircle size={13} />
            </Button>
          ) : null}
          <Button
            variant="outlineDanger" size="sm" title={t.actions.delete} aria-label={t.actions.delete}
            onClick={() => setPending({ kind: 'delete', push: p })}
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
        eyebrow={nav.navMarketing}
        title={t.title}
        actions={
          <Button onClick={() => setFormTarget(null)}>
            <Plus size={15} />{t.actions.create}
          </Button>
        }
      />

      <Alert tone="info" className="mb-3" title={t.intro.heading}>
        <p>
          {t.intro.lead}
          <strong>{t.intro.leadStrong}</strong>
          {t.intro.leadTail}
        </p>
        <p className="mt-1">
          <span className="font-semibold">{t.intro.useCaseLabel}</span>
          {t.intro.useCaseText}
        </p>
        <p className="mt-1">
          {t.intro.crossLead}
          <Link className="underline" href="/tenant/campaigns">{t.intro.crossLink}</Link>
          {t.intro.crossTail}
        </p>
      </Alert>

      <Alert tone="neutral" icon={false} className="mb-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {t.statusLegend.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5">
              <Badge tone={STATUS_TONE[s.key as PushStatus]}>{s.name}</Badge>
              <span className="text-xs text-secondary">{s.desc}</span>
            </span>
          ))}
        </div>
      </Alert>

      <Alert tone="neutral" icon={false} className="mb-4">
        <div className="flex items-center justify-between gap-3">
          <span className="font-semibold">{t.quota.label}</span>
          <span className="tabular-nums text-neutral-700">
            {quota
              ? t.quota.usage(quota.used, quota.total, Math.max(0, quota.total - quota.used))
              : t.quota.loading}
          </span>
        </div>
      </Alert>

      <DataTableContainer>
        <DataTableHeader title={t.tableTitle} />
        <DataTable
          columns={columns}
          rows={visible}
          loading={loading}
          rowKey={(p) => p.id}
          scroll
          empty={
            <EmptyState
              icon={Radio}
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
          <Pagination page={page} size={PAGE_SIZE} total={rows.length} onChange={setPage} />
        </DataTableFooter>
      </DataTableContainer>

      <PushFormModal
        open={formTarget !== undefined}
        push={formTarget ?? null}
        levels={levels}
        onClose={() => setFormTarget(undefined)}
        onSaved={() => {
          const wasEdit = !!formTarget;
          setFormTarget(undefined);
          toast.show(wasEdit ? t.messages.updated : t.messages.created);
          void load();
        }}
      />

      <Modal
        open={!!viewTarget}
        onClose={() => setViewTarget(null)}
        size="lg"
        title={t.actions.view}
        footer={<Button variant="secondary" onClick={() => setViewTarget(null)}>{common.close}</Button>}
      >
        {viewTarget ? (
          <dl className="grid gap-x-4 gap-y-3 md:grid-cols-2">
            <div>
              <dt className="form-label">{t.form.title}</dt>
              <dd className="text-base text-dark">{viewTarget.title}</dd>
            </div>
            <div>
              <dt className="form-label">{t.columns.status}</dt>
              <dd><Badge tone={STATUS_TONE[viewTarget.status]}>{t.status[viewTarget.status]}</Badge></dd>
            </div>
            <div>
              <dt className="form-label">{t.columns.target}</dt>
              <dd className="text-base text-dark">{targetText(viewTarget)}</dd>
            </div>
            <div>
              <dt className="form-label">{t.columns.estimated}</dt>
              <dd className="text-base text-muted">{t.labels.estimatedUnavailable}</dd>
            </div>
            <div className="md:col-span-2">
              <dt className="form-label">{t.form.content}</dt>
              <dd className="whitespace-pre-wrap text-base text-dark">{viewTarget.content}</dd>
            </div>
            <div className="md:col-span-2">
              <dt className="form-label">{t.form.image}</dt>
              <dd className="text-base text-dark">
                {viewTarget.imageUrl || <span className="text-muted">{t.labels.noImage}</span>}
              </dd>
            </div>
            <div className="md:col-span-2">
              <dt className="form-label">{t.form.note}</dt>
              <dd className="text-base text-dark">
                {viewTarget.note || <span className="text-muted">{common.none}</span>}
              </dd>
            </div>
            <div className="md:col-span-2">
              <dt className="form-label">{t.columns.result}</dt>
              <dd className="text-base tabular-nums text-dark">
                {viewTarget.sentCount
                  ? t.labels.resultSuccess(viewTarget.sentCount)
                  : viewTarget.status === 'FAILED' ? t.status.FAILED : t.labels.notSent}
              </dd>
            </div>
          </dl>
        ) : null}
      </Modal>

      <ConfirmModal
        open={!!pending}
        loading={working}
        danger={pending?.kind !== 'send'}
        title={
          pending?.kind === 'delete' ? t.confirm.deleteTitle
            : pending?.kind === 'cancel' ? t.confirm.cancelTitle
              : t.confirm.sendTitle
        }
        confirmText={
          pending?.kind === 'delete' ? common.delete
            : pending?.kind === 'cancel' ? common.confirmText
              : t.actions.send
        }
        message={
          pending?.kind === 'delete' ? t.confirm.delete
            : pending?.kind === 'cancel' ? t.confirm.cancelPush
              : t.confirm.send
        }
        onClose={() => setPending(null)}
        onConfirm={() => void runPending()}
      />
    </>
  );
}

/* ========================================================================== */
/* 建立 / 編輯推播                                                             */
/* ========================================================================== */

function PushFormModal({
  open, push, levels, onClose, onSaved,
}: {
  open: boolean;
  push: MarketingPush | null;
  levels: MembershipLevel[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const isEdit = !!push;

  const [title, setTitle] = React.useState('');
  const [content, setContent] = React.useState('');
  const [targetType, setTargetType] = React.useState<PushTargetType>('ALL');
  const [targetValue, setTargetValue] = React.useState('');
  const [customTargets, setCustomTargets] = React.useState('');
  const [imageName, setImageName] = React.useState('');
  const [imageUrl, setImageUrl] = React.useState('');
  const [scheduledAt, setScheduledAt] = React.useState('');
  const [note, setNote] = React.useState('');
  const [error, setError] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setError('');
    setTitle(push?.title ?? '');
    setContent(push?.content ?? '');
    setTargetType(push?.targetType ?? 'ALL');
    setTargetValue(push?.targetType === 'MEMBERSHIP_LEVEL' ? push.targetValue : '');
    setCustomTargets(push?.targetType === 'CUSTOM' ? push.targetValue : '');
    setImageName('');
    setImageUrl(push?.imageUrl ?? '');
    setScheduledAt(push?.scheduledAt ? push.scheduledAt.slice(0, 16) : '');
    setNote(push?.note ?? '');
  }, [open, push]);

  const pickImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      e.target.value = '';
      toast.show(t.messages.imageTooLarge, 'warning');
      return;
    }
    setImageName(file.name);
  };

  const validate = (): string => {
    if (!title.trim()) return t.form.titleRequired;
    if (!content.trim()) return t.form.contentRequired;
    if (content.length > t.form.contentMax) return common.validation.maxLength(t.form.contentMax);
    if (targetType === 'MEMBERSHIP_LEVEL' && !targetValue) return t.form.targetValueRequired;
    if (targetType === 'CUSTOM' && !customTargets.trim()) return t.form.customTargetsRequired;
    return '';
  };

  const submit = async () => {
    const err = validate();
    setError(err);
    if (err) { toast.show(err, 'warning'); return; }
    setSaving(true);
    try {
      const targetLabel = targetType === 'MEMBERSHIP_LEVEL'
        ? (levels.find((l) => l.id === targetValue)?.name ?? '')
        : targetType === 'TAG' || targetType === 'CUSTOM'
          ? (push?.targetType === targetType ? push.targetLabel : '')
          : '';
      const payload: MarketingPushFormPayload = {
        title: title.trim(),
        content: content.trim(),
        imageUrl: imageUrl.trim(),
        note: note.trim(),
        targetType,
        targetValue: targetType === 'CUSTOM' ? customTargets.trim() : targetValue,
        targetLabel,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
      };
      if (isEdit && push) await updateMarketingPush(push.id, payload);
      else await createMarketingPush(payload);
      onSaved();
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
      <FormGroup>
        <Label required htmlFor="pushTitle">{t.form.title}</Label>
        <Input
          id="pushTitle" value={title} placeholder={t.form.titlePlaceholder}
          onChange={(e) => setTitle(e.target.value)}
        />
      </FormGroup>

      <FormGroup>
        <Label required htmlFor="pushContent">{t.form.content}</Label>
        <Textarea
          id="pushContent" rows={4} value={content} maxLength={t.form.contentMax}
          placeholder={t.form.contentPlaceholder}
          onChange={(e) => setContent(e.target.value)}
        />
        <div className="flex items-center justify-between">
          <FormText>{t.form.contentHelp}</FormText>
          <CharCounter value={content} max={t.form.contentMax} />
        </div>
      </FormGroup>

      <FormGroup>
        <Label required htmlFor="pushTargetType">{t.form.targetType}</Label>
        <Select
          id="pushTargetType" value={targetType}
          onChange={(e) => setTargetType(e.target.value as PushTargetType)}
        >
          {t.form.targetTypeOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>
      </FormGroup>

      {targetType === 'MEMBERSHIP_LEVEL' ? (
        <FormGroup>
          <Label htmlFor="pushTargetValue">{t.form.targetValue}</Label>
          <Select
            id="pushTargetValue" value={targetValue}
            onChange={(e) => setTargetValue(e.target.value)}
          >
            <option value="">{t.form.targetValuePlaceholder}</option>
            {levels.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </Select>
        </FormGroup>
      ) : null}

      {targetType === 'CUSTOM' ? (
        <FormGroup>
          <Label htmlFor="pushCustomTargets">{t.form.customTargets}</Label>
          <Textarea
            id="pushCustomTargets" rows={3} value={customTargets}
            placeholder={t.form.customTargetsPlaceholder}
            onChange={(e) => setCustomTargets(e.target.value)}
          />
        </FormGroup>
      ) : null}

      <FormGroup>
        <Label htmlFor="pushImageInput">{t.form.image}</Label>
        <Input id="pushImageInput" type="file" accept="image/*" onChange={pickImage} />
        <div className="flex items-center justify-between">
          <FormText>{t.form.imageUploadHint}</FormText>
          {imageName ? (
            <Button variant="ghost" size="sm" onClick={() => setImageName('')}>
              {t.form.imageRemove}
            </Button>
          ) : null}
        </div>
        <FormText>{t.form.imageFormatHint}</FormText>
      </FormGroup>

      <FormGroup>
        <Label htmlFor="pushImageUrl">{t.form.imageUrl}</Label>
        <Input
          id="pushImageUrl" type="url" value={imageUrl}
          placeholder={t.form.imageUrlPlaceholder}
          onChange={(e) => setImageUrl(e.target.value)}
        />
        <FormText>{t.form.imageUrlHelp}</FormText>
      </FormGroup>

      <FormGroup>
        <Label htmlFor="pushScheduledAt">{t.form.scheduledAt}</Label>
        <Input
          id="pushScheduledAt" type="datetime-local" value={scheduledAt}
          onChange={(e) => setScheduledAt(e.target.value)}
        />
        <FormText>{t.form.scheduledAtHelp}</FormText>
      </FormGroup>

      <FormGroup>
        <Label htmlFor="pushNote">{t.form.note}</Label>
        <Input
          id="pushNote" value={note} placeholder={t.form.notePlaceholder}
          onChange={(e) => setNote(e.target.value)}
        />
      </FormGroup>

      {error ? <FormError>{error}</FormError> : null}
    </Modal>
  );
}
