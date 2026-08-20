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
import { common } from '@/i18n/zh-TW/common';
import { nav } from '@/i18n/zh-TW/nav';
import { marketingPage as t } from '@/i18n/zh-TW/pages/marketing';
import { formatDateTime } from '@/lib/utils';
import type { MembershipLevel } from '@/lib/types';

/* -------------------------------------------------------------------------- */
/* 本頁專用假資料（不寫進 src/mock，避免與其他頁面衝突）                          */
/* -------------------------------------------------------------------------- */

type PushStatus = keyof typeof t.status;
type PushTargetType = keyof typeof t.targetType;

/** 原站 /api/marketing/pushes */
type MarketingPush = {
  id: string;
  title: string;
  content: string;
  targetType: PushTargetType;
  /** MEMBERSHIP_LEVEL 時為會員等級 id；TAG 時為標籤名稱；CUSTOM 時為 LINE User ID 清單 */
  targetValue: string;
  targetLabel: string;
  estimatedCount: number;
  sentCount: number;
  failedCount: number;
  status: PushStatus;
  imageUrl: string;
  scheduledAt: string | null;
  sentAt: string | null;
  note: string;
  createdAt: string;
};

const MOCK_PUSHES: MarketingPush[] = [
  {
    id: 'mp_1', title: '本週特惠活動通知',
    content: '本週來店指定設計師洗剪只要 499，名額有限，快來 LINE 預約！',
    targetType: 'ALL', targetValue: '', targetLabel: '',
    estimatedCount: 246, sentCount: 0, failedCount: 0,
    status: 'DRAFT', imageUrl: '', scheduledAt: null, sentAt: null,
    note: '待確認文案', createdAt: '2026-08-20T09:30:00+08:00',
  },
  {
    id: 'mp_2', title: '中秋公休公告',
    content: '9/25～9/27 中秋連假公休，造成不便敬請見諒。',
    targetType: 'ALL', targetValue: '', targetLabel: '',
    estimatedCount: 246, sentCount: 0, failedCount: 0,
    status: 'SCHEDULED', imageUrl: '', scheduledAt: '2026-09-18T10:00:00+08:00',
    sentAt: null, note: '', createdAt: '2026-08-18T14:12:00+08:00',
  },
  {
    id: 'mp_3', title: '鑽石卡限定：秋季護髮 8 折',
    content: '親愛的鑽石卡會員，本季護髮課程享 8 折，回覆「護髮」即可預約。',
    targetType: 'MEMBERSHIP_LEVEL', targetValue: 'ml_3', targetLabel: '鑽石卡',
    estimatedCount: 18, sentCount: 0, failedCount: 0,
    status: 'SENDING', imageUrl: '', scheduledAt: null, sentAt: null,
    note: '', createdAt: '2026-08-19T08:05:00+08:00',
  },
  {
    id: 'mp_4', title: '新品上架：修護洗髮精',
    content: '沙龍級修護洗髮精開賣，前 30 名下單享 9 折。',
    targetType: 'ALL', targetValue: '', targetLabel: '',
    estimatedCount: 240, sentCount: 238, failedCount: 2,
    status: 'COMPLETED', imageUrl: 'https://example.com/image.jpg',
    scheduledAt: null, sentAt: '2026-08-12T11:00:00+08:00',
    note: '', createdAt: '2026-08-12T10:40:00+08:00',
  },
  {
    id: 'mp_5', title: '限時優惠：指定名單回饋',
    content: '感謝您長期支持，出示此訊息即可折抵 200 元。',
    targetType: 'CUSTOM', targetValue: 'U1234567890abcdef\nU0987654321fedcba',
    targetLabel: '', estimatedCount: 2, sentCount: 0, failedCount: 2,
    status: 'FAILED', imageUrl: '', scheduledAt: null,
    sentAt: '2026-08-08T19:20:00+08:00', note: '額度不足', createdAt: '2026-08-08T19:00:00+08:00',
  },
  {
    id: 'mp_6', title: '父親節問候',
    content: '祝所有爸爸節日快樂！本週來店贈送造型服務一次。',
    targetType: 'TAG', targetValue: '熟客', targetLabel: '熟客',
    estimatedCount: 42, sentCount: 0, failedCount: 0,
    status: 'CANCELLED', imageUrl: '', scheduledAt: '2026-08-08T09:00:00+08:00',
    sentAt: null, note: '改用行銷活動發送', createdAt: '2026-08-05T16:30:00+08:00',
  },
];

const STATUS_TONE: Record<PushStatus, 'neutral' | 'info' | 'primary' | 'success' | 'danger'> = {
  DRAFT: 'neutral',
  SCHEDULED: 'info',
  SENDING: 'primary',
  COMPLETED: 'success',
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
      await new Promise((r) => setTimeout(r, 320));
      setRows(MOCK_PUSHES);
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
    const { kind } = pending;
    setWorking(true);
    try {
      await new Promise((r) => setTimeout(r, 380));
      setPending(null);
      toast.show(
        kind === 'delete' ? t.messages.deleted
          : kind === 'cancel' ? t.messages.cancelled
            : t.messages.sending,
      );
      void load();
    } catch {
      toast.show(
        kind === 'delete' ? t.messages.deleteFailed
          : kind === 'cancel' ? t.messages.cancelFailed
            : `${t.messages.sendFailedPrefix}${t.messages.retryLater}`,
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
      key: 'estimated', header: t.columns.estimated, numeric: true, width: '110px',
      render: (p) => t.labels.people(p.estimatedCount),
    },
    {
      key: 'result', header: t.columns.result, width: '140px',
      render: (p) => (p.sentCount || p.failedCount ? (
        <div className="flex flex-col items-start gap-0.5">
          <span className="text-success">{t.labels.resultSuccess(p.sentCount)}</span>
          {p.failedCount ? (
            <span className="text-danger">{t.labels.resultFailed(p.failedCount)}</span>
          ) : null}
        </div>
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
          {p.status === 'DRAFT' ? (
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
          setFormTarget(undefined);
          toast.show(t.messages.created);
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
              <dd className="text-base tabular-nums text-dark">
                {t.labels.people(viewTarget.estimatedCount)}
              </dd>
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
                {viewTarget.sentCount || viewTarget.failedCount
                  ? `${t.labels.resultSuccess(viewTarget.sentCount)} / ${t.labels.resultFailed(viewTarget.failedCount)}`
                  : t.labels.notSent}
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
      await new Promise((r) => setTimeout(r, 420));
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
