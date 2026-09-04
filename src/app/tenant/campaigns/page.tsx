'use client';
import * as React from 'react';
import Link from 'next/link';
import {
  ChevronDown, Eye, Pause, Pencil, Play, Plus, Send, Square, Target, Trash2,
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
  CharCounter, FormError, FormGroup, FormText, Input, Label, Select, Switch, Textarea,
} from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { listCoupons } from '@/services/catalog';
import {
  campaignDisplayStatus, createCampaign, deleteCampaign, endCampaign, getDashboardStats,
  listCampaigns, listFeatures, pauseCampaign, publishCampaign, resumeCampaign, updateCampaign,
} from '@/services';
import type { CampaignFormPayload } from '@/services/campaigns';
import { common } from '@/i18n/zh-TW/common';
import { nav } from '@/i18n/zh-TW/nav';
import { campaignsPage as t } from '@/i18n/zh-TW/pages/campaigns';
import { formatCurrency, formatDateTime, formatNumber } from '@/lib/utils';
import type { Campaign, CampaignType, Coupon } from '@/lib/types';

/** 前端顯示狀態（含衍生的 SCHEDULED，見 src/services/campaigns.ts campaignDisplayStatus()） */
type DisplayStatus = keyof typeof t.status;

/** 原站以 coupon.isPrivate 標記私密券；骨架階段用固定清單模擬 */
const PRIVATE_COUPON_IDS = new Set<string>(['cp_3']);

const STATUS_TONE: Record<DisplayStatus, 'neutral' | 'info' | 'success' | 'warning'> = {
  DRAFT: 'neutral',
  SCHEDULED: 'info',
  ACTIVE: 'success',
  PAUSED: 'warning',
  ENDED: 'neutral',
};

/** 自動觸發活動需要的功能訂閱與通知開關（原站前提檢查）；文案一律取自 i18n */
const AUTO_TRIGGER_PREREQ: Partial<Record<CampaignType, {
  featureCode: string; featureName: string; switchName: string;
}>> = {
  BIRTHDAY: {
    featureCode: 'MEMBERSHIP_SYSTEM',
    featureName: t.presetNames.birthday,
    switchName: t.prereq.switchNames.BIRTHDAY,
  },
  RECALL: {
    featureCode: 'MEMBERSHIP_SYSTEM',
    featureName: t.presetNames.recall,
    switchName: t.prereq.switchNames.RECALL,
  },
};

const PAGE_SIZE = 20;

type PendingKind = 'delete' | 'publish' | 'pause' | 'resume' | 'end';
type PendingAction = { kind: PendingKind; campaign: Campaign };

/* -------------------------------------------------------------------------- */

export default function CampaignsPage() {
  const toast = useToast();

  const [rows, setRows] = React.useState<Campaign[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [page, setPage] = React.useState(0);
  const [coupons, setCoupons] = React.useState<Coupon[]>([]);
  const [activeFeatures, setActiveFeatures] = React.useState<string[]>([]);
  const [quota, setQuota] = React.useState<{ used: number; total: number } | null>(null);
  const [introOpen, setIntroOpen] = React.useState(true);

  const [formTarget, setFormTarget] = React.useState<Campaign | null | undefined>(undefined);
  const [viewTarget, setViewTarget] = React.useState<Campaign | null>(null);
  const [pending, setPending] = React.useState<PendingAction | null>(null);
  const [working, setWorking] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listCampaigns());
    } catch (e) {
      toast.show(
        `${t.messages.loadCampaignsFailed}${e instanceof Error ? e.message : t.messages.unknownError}`,
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
        setCoupons(await listCoupons());
      } catch {
        toast.show(t.messages.loadCouponsFailed, 'danger');
      }
    })();
  }, [toast]);

  React.useEffect(() => {
    void (async () => {
      try {
        const features = await listFeatures();
        setActiveFeatures(features.filter((f) => f.active).map((f) => f.code));
      } catch {
        toast.show(t.prereq.loadFailed, 'danger');
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

  const periodText = (c: Campaign) => t.labels.period(
    c.startAt ? formatDateTime(c.startAt) : t.labels.immediately,
    c.endAt ? formatDateTime(c.endAt) : t.labels.forever,
  );

  const runPending = async () => {
    if (!pending) return;
    const { kind, campaign } = pending;
    setWorking(true);
    try {
      if (kind === 'delete') await deleteCampaign(campaign.id);
      else if (kind === 'publish') await publishCampaign(campaign.id);
      else if (kind === 'pause') await pauseCampaign(campaign.id);
      else if (kind === 'resume') await resumeCampaign(campaign.id);
      else await endCampaign(campaign.id);

      setPending(null);
      toast.show(
        kind === 'delete' ? t.messages.deleted
          : kind === 'publish'
            ? (campaign.isAutoTrigger ? t.messages.publishedAuto : t.messages.published)
            : kind === 'pause' ? t.messages.paused
              : kind === 'resume' ? t.messages.resumed
                : t.messages.ended,
      );
      void load();
    } catch (e) {
      const reason = e instanceof Error ? e.message : t.messages.unknownError;
      toast.show(
        kind === 'delete' ? `${t.messages.deleteFailed}: ${reason}`
          : kind === 'publish' ? `${t.messages.publishFailedPrefix}${reason}`
            : kind === 'pause' ? `${t.messages.pauseFailed}: ${reason}`
              : kind === 'resume' ? `${t.messages.resumeFailed}: ${reason}`
                : `${t.messages.endFailed}: ${reason}`,
        'danger',
      );
    } finally {
      setWorking(false);
    }
  };

  const askPublish = (c: Campaign) => {
    if (!c.pushMessage.trim()) {
      toast.show(t.form.pushMessageRequired, 'warning');
      return;
    }
    setPending({ kind: 'publish', campaign: c });
  };

  const columns: Column<Campaign>[] = [
    {
      key: 'name', header: t.columns.name,
      render: (c) => (
        <div className="min-w-0">
          <div className="font-semibold text-dark">{c.name}</div>
          {c.description ? (
            <div className="text-2xs text-secondary">{c.description}</div>
          ) : null}
          {c.isAutoTrigger && (c.type === 'BIRTHDAY' || c.type === 'RECALL') ? (
            <div className="text-2xs text-secondary">{t.autoTriggerHint[c.type]}</div>
          ) : null}
        </div>
      ),
    },
    {
      key: 'type', header: t.columns.type, width: '120px',
      render: (c) => (
        c.type
          ? <Badge tone="purple">{t.types[c.type]}</Badge>
          : <span className="text-muted">{common.none}</span>
      ),
    },
    {
      key: 'period', header: t.columns.period, width: '260px',
      render: (c) => <span className="text-sm">{periodText(c)}</span>,
    },
    {
      key: 'participants', header: t.columns.participants, numeric: true, width: '110px',
      render: () => <span className="text-muted">{t.labels.participantsUnavailable}</span>,
    },
    {
      key: 'status', header: t.columns.status, width: '100px',
      render: (c) => {
        const s = campaignDisplayStatus(c);
        return <Badge tone={STATUS_TONE[s]}>{t.status[s]}</Badge>;
      },
    },
    {
      key: 'actions', header: t.columns.actions, width: '230px',
      render: (c) => (
        <div className="btn-group">
          <Button
            variant="outline" size="sm" title={t.actions.view} aria-label={t.actions.view}
            onClick={() => setViewTarget(c)}
          >
            <Eye size={13} />
          </Button>
          <Button
            variant="outline" size="sm" title={t.actions.edit} aria-label={t.actions.edit}
            onClick={() => setFormTarget(c)}
          >
            <Pencil size={13} />
          </Button>
          {c.status === 'DRAFT' ? (
            <Button
              variant="outline" size="sm" title={t.actions.publish} aria-label={t.actions.publish}
              onClick={() => askPublish(c)}
            >
              <Send size={13} />
            </Button>
          ) : null}
          {c.status === 'PUBLISHED' ? (
            <Button
              variant="outline" size="sm" title={t.actions.pause} aria-label={t.actions.pause}
              onClick={() => setPending({ kind: 'pause', campaign: c })}
            >
              <Pause size={13} />
            </Button>
          ) : null}
          {c.status === 'PAUSED' ? (
            <Button
              variant="outline" size="sm" title={t.actions.resume} aria-label={t.actions.resume}
              onClick={() => setPending({ kind: 'resume', campaign: c })}
            >
              <Play size={13} />
            </Button>
          ) : null}
          {c.status === 'PUBLISHED' || c.status === 'PAUSED' ? (
            <Button
              variant="outline" size="sm" title={t.actions.end} aria-label={t.actions.end}
              onClick={() => setPending({ kind: 'end', campaign: c })}
            >
              <Square size={13} />
            </Button>
          ) : null}
          <Button
            variant="outlineDanger" size="sm" title={t.actions.delete} aria-label={t.actions.delete}
            onClick={() => setPending({ kind: 'delete', campaign: c })}
          >
            <Trash2 size={13} />
          </Button>
        </div>
      ),
    },
  ];

  const pendingTitle = !pending ? common.confirm.title
    : pending.kind === 'delete' ? t.confirm.deleteTitle
      : pending.kind === 'publish' ? t.confirm.publishTitle
        : pending.kind === 'pause' ? t.confirm.pauseTitle
          : pending.kind === 'resume' ? t.confirm.resumeTitle
            : t.confirm.endTitle;

  const pendingMessage = !pending ? common.confirm.message
    : pending.kind === 'delete' ? t.confirm.delete(pending.campaign.name)
      : pending.kind === 'publish'
        ? (pending.campaign.isAutoTrigger ? t.confirm.publishAuto : t.confirm.publish)
        : pending.kind === 'pause' ? t.confirm.pause
          : pending.kind === 'resume' ? t.confirm.resume
            : t.confirm.end;

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

      <Alert
        tone="info"
        className="mb-3"
        title={t.intro.heading}
        action={
          <Button
            variant="ghost" size="icon"
            aria-label={t.intro.toggle} title={t.intro.toggle}
            onClick={() => setIntroOpen((v) => !v)}
          >
            <ChevronDown size={14} className={introOpen ? 'rotate-180' : undefined} />
          </Button>
        }
      >
        {introOpen ? (
          <>
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
              <Link className="underline" href="/tenant/marketing">{t.intro.crossLink}</Link>
              {t.intro.crossTail}
            </p>
          </>
        ) : null}
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
          rowKey={(c) => c.id}
          scroll
          empty={
            <EmptyState
              icon={Target}
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

      <CampaignFormModal
        open={formTarget !== undefined}
        campaign={formTarget ?? null}
        coupons={coupons}
        activeFeatures={activeFeatures}
        onClose={() => setFormTarget(undefined)}
        onSaved={(isEdit) => {
          setFormTarget(undefined);
          toast.show(isEdit ? t.messages.updated : t.messages.created);
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
              <dt className="form-label">{t.labels.campaignName}</dt>
              <dd className="text-base text-dark">{viewTarget.name}</dd>
            </div>
            <div>
              <dt className="form-label">{t.columns.type}</dt>
              <dd>
                {viewTarget.type ? (
                  <Badge tone="purple">{t.types[viewTarget.type]}</Badge>
                ) : (
                  <span className="text-muted">{common.none}</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="form-label">{t.columns.status}</dt>
              <dd>
                {(() => {
                  const s = campaignDisplayStatus(viewTarget);
                  return <Badge tone={STATUS_TONE[s]}>{t.status[s]}</Badge>;
                })()}
              </dd>
            </div>
            <div>
              <dt className="form-label">{t.columns.participants}</dt>
              <dd className="text-base tabular-nums text-dark">
                <span className="text-muted">{t.labels.participantsUnavailable}</span>
              </dd>
            </div>
            <div className="md:col-span-2">
              <dt className="form-label">{t.columns.period}</dt>
              <dd className="text-base text-dark">{periodText(viewTarget)}</dd>
            </div>
            <div className="md:col-span-2">
              <dt className="form-label">{t.labels.pushMessage}</dt>
              <dd className="whitespace-pre-wrap text-base text-dark">
                {viewTarget.pushMessage || <span className="text-muted">{common.none}</span>}
              </dd>
            </div>
            <div>
              <dt className="form-label">{t.form.couponId}</dt>
              <dd className="text-base text-dark">
                {coupons.find((cp) => cp.id === viewTarget.couponId)?.name
                  ?? <span className="text-muted">{t.form.couponNone}</span>}
              </dd>
            </div>
            <div>
              <dt className="form-label">{t.form.bonusPoints}</dt>
              <dd className="text-base tabular-nums text-dark">{formatNumber(viewTarget.bonusPoints)}</dd>
            </div>
            {viewTarget.thresholdAmount !== null ? (
              <div>
                <dt className="form-label">{t.labels.thresholdAmount}</dt>
                <dd className="text-base tabular-nums text-dark">
                  {formatCurrency(viewTarget.thresholdAmount)}
                </dd>
              </div>
            ) : null}
            {viewTarget.recallDays !== null ? (
              <div>
                <dt className="form-label">{t.form.recallDays}</dt>
                <dd className="text-base tabular-nums text-dark">
                  {`${formatNumber(viewTarget.recallDays)} ${t.form.recallDaysUnit}`}
                </dd>
              </div>
            ) : null}
            <div className="md:col-span-2">
              <dt className="form-label">{t.form.description}</dt>
              <dd className="text-base text-dark">
                {viewTarget.description || <span className="text-muted">{common.none}</span>}
              </dd>
            </div>
          </dl>
        ) : null}
      </Modal>

      <ConfirmModal
        open={!!pending}
        loading={working}
        danger={pending?.kind === 'delete' || pending?.kind === 'end'}
        title={pendingTitle}
        message={pendingMessage}
        confirmText={
          pending?.kind === 'delete' ? common.delete
            : pending?.kind === 'publish' ? t.actions.publish
              : pending?.kind === 'pause' ? t.actions.pause
                : pending?.kind === 'resume' ? t.actions.resume
                  : t.actions.end
        }
        onClose={() => setPending(null)}
        onConfirm={() => void runPending()}
      />
    </>
  );
}

/* ========================================================================== */
/* 新增 / 編輯活動                                                             */
/* ========================================================================== */

function CampaignFormModal({
  open, campaign, coupons, activeFeatures, onClose, onSaved,
}: {
  open: boolean;
  campaign: Campaign | null;
  coupons: Coupon[];
  activeFeatures: string[];
  onClose: () => void;
  onSaved: (isEdit: boolean) => void;
}) {
  const toast = useToast();
  const isEdit = !!campaign;
  /** 已發布的活動只能改名稱、描述、結束時間、備註與圖片 */
  const locked = !!campaign && campaign.status !== 'DRAFT';

  const [name, setName] = React.useState('');
  const [type, setType] = React.useState<CampaignType>('BIRTHDAY');
  const [startAt, setStartAt] = React.useState('');
  const [endAt, setEndAt] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [imageName, setImageName] = React.useState('');
  const [pushMessage, setPushMessage] = React.useState('');
  const [couponId, setCouponId] = React.useState('');
  const [bonusPoints, setBonusPoints] = React.useState('');
  const [thresholdAmount, setThresholdAmount] = React.useState('');
  const [recallDays, setRecallDays] = React.useState('');
  const [isAutoTrigger, setIsAutoTrigger] = React.useState(false);
  const [error, setError] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setError('');
    setName(campaign?.name ?? '');
    setType((campaign?.type || 'BIRTHDAY') as CampaignType);
    setStartAt(campaign?.startAt ? campaign.startAt.slice(0, 16) : '');
    setEndAt(campaign?.endAt ? campaign.endAt.slice(0, 16) : '');
    setDescription(campaign?.description ?? '');
    setImageName('');
    setPushMessage(campaign?.pushMessage ?? '');
    setCouponId(campaign?.couponId ?? '');
    setBonusPoints(campaign?.bonusPoints ? String(campaign.bonusPoints) : '');
    setThresholdAmount(campaign?.thresholdAmount ? String(campaign.thresholdAmount) : '');
    setRecallDays(campaign?.recallDays ? String(campaign.recallDays) : '');
    setIsAutoTrigger(campaign?.isAutoTrigger ?? false);
  }, [open, campaign]);

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

  const prereq = AUTO_TRIGGER_PREREQ[type];
  const featureMissing = !!prereq && !activeFeatures.includes(prereq.featureCode);
  /** 骨架階段：通知開關狀態尚未接上 tenant_settings，一律視為已開啟 */
  const switchOff = false;
  const showPrereq = isAutoTrigger && !!prereq && (featureMissing || switchOff);

  const selectedCoupon = coupons.find((c) => c.id === couponId) ?? null;
  const showPrivateWarning = !!selectedCoupon && PRIVATE_COUPON_IDS.has(selectedCoupon.id);

  const validate = (): string => {
    if (!name.trim()) return t.form.nameRequired;
    if (!pushMessage.trim()) return t.form.pushMessageRequired;
    if (startAt && endAt && new Date(endAt) <= new Date(startAt)) return t.form.endAtInvalid;
    if (description.length > t.form.descriptionMax) {
      return common.validation.maxLength(t.form.descriptionMax);
    }
    return '';
  };

  const submit = async () => {
    const err = validate();
    setError(err);
    if (err) { toast.show(err, 'warning'); return; }
    setSaving(true);
    try {
      const payload: CampaignFormPayload = {
        name,
        description,
        type,
        startAt: startAt ? new Date(startAt).toISOString() : null,
        endAt: endAt ? new Date(endAt).toISOString() : null,
        pushMessage,
        couponId: couponId || null,
        bonusPoints: Number(bonusPoints) || 0,
        thresholdAmount: thresholdAmount ? Number(thresholdAmount) : null,
        recallDays: recallDays ? Number(recallDays) : null,
        isAutoTrigger,
        imageUrl: campaign?.imageUrl ?? '',
      };
      if (isEdit && campaign) {
        await updateCampaign(campaign.id, payload);
      } else {
        await createCampaign(payload);
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
      {locked ? (
        <Alert tone="warning" className="mb-4">{t.form.lockedNotice}</Alert>
      ) : (
        <Alert tone="info" className="mb-4">{t.form.draftNotice}</Alert>
      )}

      <div className="grid gap-x-4 md:grid-cols-2">
        <FormGroup>
          <Label required htmlFor="campaignName">{t.form.name}</Label>
          <Input
            id="campaignName" value={name} placeholder={t.form.namePlaceholder}
            onChange={(e) => setName(e.target.value)}
          />
        </FormGroup>

        <FormGroup>
          <Label required htmlFor="campaignType">{t.form.type}</Label>
          <Select
            id="campaignType" value={type} disabled={locked}
            onChange={(e) => setType(e.target.value as CampaignType)}
          >
            {t.form.typeOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>
          <FormText>{t.typeHelp[type]}</FormText>
        </FormGroup>

        <FormGroup>
          <Label htmlFor="campaignStartAt">{t.form.startAt}</Label>
          <Input
            id="campaignStartAt" type="datetime-local" value={startAt} disabled={locked}
            onChange={(e) => setStartAt(e.target.value)}
          />
          <FormText>{t.form.startAtHelp}</FormText>
        </FormGroup>

        <FormGroup>
          <Label htmlFor="campaignEndAt">{t.form.endAt}</Label>
          <Input
            id="campaignEndAt" type="datetime-local" value={endAt}
            onChange={(e) => setEndAt(e.target.value)}
          />
          <FormText>{t.form.endAtHelp}</FormText>
        </FormGroup>
      </div>

      <FormGroup>
        <Label htmlFor="campaignDescription">{t.form.description}</Label>
        <Textarea
          id="campaignDescription" rows={3} value={description} maxLength={t.form.descriptionMax}
          placeholder={t.form.descriptionPlaceholder}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="flex justify-end">
          <CharCounter value={description} max={t.form.descriptionMax} />
        </div>
      </FormGroup>

      <FormGroup>
        <Label htmlFor="campaignImageInput">{t.form.image}</Label>
        <Input id="campaignImageInput" type="file" accept="image/*" onChange={pickImage} />
        <div className="flex items-center justify-between">
          <FormText>{t.form.imageUploadHint}</FormText>
          {imageName ? (
            <Button variant="ghost" size="sm" onClick={() => setImageName('')}>
              {t.form.imageRemove}
            </Button>
          ) : null}
        </div>
      </FormGroup>

      <h6 className="mb-3 mt-2 text-base font-bold text-dark">{t.form.sectionReward}</h6>

      <FormGroup>
        <Label required htmlFor="campaignPushMessage">{t.form.pushMessage}</Label>
        <Textarea
          id="campaignPushMessage" rows={3} value={pushMessage} disabled={locked}
          placeholder={t.form.pushMessagePlaceholder}
          onChange={(e) => setPushMessage(e.target.value)}
        />
        <FormText>{t.form.pushMessageHelp}</FormText>
      </FormGroup>

      <FormGroup>
        <Label htmlFor="campaignCouponId">{t.form.couponId}</Label>
        <Select
          id="campaignCouponId" value={couponId} disabled={locked}
          onChange={(e) => setCouponId(e.target.value)}
        >
          <option value="">{t.form.couponNone}</option>
          {coupons.map((c) => (
            <option key={c.id} value={c.id}>
              {PRIVATE_COUPON_IDS.has(c.id) ? t.form.couponPrivateLabel(c.name) : c.name}
            </option>
          ))}
        </Select>
        <FormText>{t.form.couponHelp}</FormText>
        {showPrivateWarning ? (
          <Alert tone="warning" className="mt-2">{t.form.couponPrivateWarning}</Alert>
        ) : null}
      </FormGroup>

      <FormGroup>
        <Label htmlFor="campaignBonusPoints">{t.form.bonusPoints}</Label>
        <Input
          id="campaignBonusPoints" type="number" value={bonusPoints} disabled={locked}
          placeholder={t.form.bonusPointsPlaceholder}
          onChange={(e) => setBonusPoints(e.target.value)}
        />
        <FormText>{t.form.bonusPointsHelp}</FormText>
      </FormGroup>

      {type === 'SPENDING_THRESHOLD' ? (
        <FormGroup>
          <Label required htmlFor="campaignThreshold">{t.form.thresholdAmount}</Label>
          <div className="input-group">
            <span className="btn btn-secondary pointer-events-none">
              {t.form.thresholdAmountPrefix}
            </span>
            <Input
              id="campaignThreshold" type="number" value={thresholdAmount}
              placeholder={t.form.thresholdAmountPlaceholder}
              onChange={(e) => setThresholdAmount(e.target.value)}
            />
          </div>
          <FormText>{t.form.thresholdAmountHelp}</FormText>
        </FormGroup>
      ) : null}

      {type === 'RECALL' ? (
        <FormGroup>
          <Label htmlFor="campaignRecallDays">{t.form.recallDays}</Label>
          <div className="input-group">
            <Input
              id="campaignRecallDays" type="number" value={recallDays}
              placeholder={t.form.recallDaysPlaceholder}
              onChange={(e) => setRecallDays(e.target.value)}
            />
            <span className="btn btn-secondary pointer-events-none">
              {t.form.recallDaysUnit}
            </span>
          </div>
          <FormText>{t.form.recallDaysHelp}</FormText>
        </FormGroup>
      ) : null}

      <FormGroup>
        <div className="flex items-center gap-3">
          <Switch
            id="campaignAutoTrigger"
            checked={isAutoTrigger}
            disabled={locked}
            onCheckedChange={setIsAutoTrigger}
          />
          <Label htmlFor="campaignAutoTrigger" className="mb-0">{t.form.isAutoTrigger}</Label>
        </div>
        <FormText>{t.form.isAutoTriggerHelp}</FormText>
      </FormGroup>

      {showPrereq && prereq ? (
        <Alert tone="warning" className="mb-4" title={t.prereq.title}>
          <div className="font-semibold">{t.prereq.checkLabel}</div>
          <ul className="ml-4 list-disc">
            {featureMissing ? (
              <li>
                {t.prereq.featureMissing(prereq.featureName)}
                {' '}
                <Link className="underline" href="/tenant/feature-store">{t.prereq.goSubscribe}</Link>
              </li>
            ) : null}
            {switchOff ? (
              <li>
                {t.prereq.switchOff(prereq.switchName)}
                {' '}
                <Link className="underline" href="/tenant/settings">{t.prereq.goSettings}</Link>
              </li>
            ) : null}
          </ul>
          <div className="mt-1">{t.prereq.tail}</div>
        </Alert>
      ) : null}

      {error ? <FormError>{error}</FormError> : null}
    </Modal>
  );
}
