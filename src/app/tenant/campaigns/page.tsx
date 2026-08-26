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
import { getDashboardStats, listFeatures } from '@/services';
import {
  createCampaign, deleteCampaign, endCampaign, listCampaigns, pauseCampaign,
  publishCampaign, resumeCampaign, updateCampaign,
  type Campaign, type CampaignStatus, type CampaignType,
} from '@/services/campaigns';
import { common } from '@/i18n/zh-TW/common';
import { nav } from '@/i18n/zh-TW/nav';
import { campaignsPage as t } from '@/i18n/zh-TW/pages/campaigns';
import { formatCurrency, formatDateTime, formatNumber } from '@/lib/utils';
import type { Coupon } from '@/lib/types';

/* -------------------------------------------------------------------------- */
/* 型別與假資料都搬進 src/services/campaigns.ts                                  */
/*                                                                            */
/* 原本這裡有 150 行的三組 mock 陣列，而發布／暫停／恢復／結束／刪除全都只是         */
/* setTimeout + toast——「活動已發布」印出來的當下資料庫還是 DRAFT，顧客在 LINE     */
/* 打關鍵字什麼都收不到。issue #7 (乙) 把它們接到 `/api/campaigns*`，依「頁面永不   */
/* fetch」一律經 src/services/campaigns.ts；mock 假資料原封搬進該 service。        */
/* -------------------------------------------------------------------------- */
/** 原站以 coupon.isPrivate 標記私密券；骨架階段用固定清單模擬 */
const PRIVATE_COUPON_IDS = new Set<string>(['cp_3']);

const STATUS_TONE: Record<CampaignStatus, 'neutral' | 'info' | 'success' | 'warning'> = {
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

  /**
   * 發布／暫停／恢復／結束／刪除 —— 五個都打 `/api/campaigns/:id/*`。
   *
   * ⚠️ 「發布」的副作用不在畫面上：它把 status 轉成 PUBLISHED，而
   * `src/server/line-events.ts` 只把 PUBLISHED 的活動回給顧客（關鍵字命中與內建
   * 「活動」指令都是）。所以按下去之後顧客在 LINE 才真的看得到這一筆——
   * 這就是為什麼成功 toast 必須等 `await` 回來，而不是等一個假的 380ms。
   * 「暫停」反過來：顧客立刻就查不到了。
   */
  const runPending = async () => {
    if (!pending) return;
    const { kind, campaign } = pending;
    setWorking(true);
    try {
      if (kind === 'delete') {
        await deleteCampaign(campaign.id);
        toast.show(t.messages.deleted);
      } else if (kind === 'publish') {
        await publishCampaign(campaign.id);
        toast.show(campaign.isAutoTrigger ? t.messages.publishedAuto : t.messages.published);
      } else if (kind === 'pause') {
        await pauseCampaign(campaign.id);
        toast.show(t.messages.paused);
      } else if (kind === 'resume') {
        await resumeCampaign(campaign.id);
        toast.show(t.messages.resumed);
      } else {
        await endCampaign(campaign.id);
        toast.show(t.messages.ended);
      }
      setPending(null);
      await load();
    } catch (e) {
      // 後端的 409（「此活動狀態已變更，請重新整理」）要原文帶到畫面上，
      // 否則使用者只會看到「暫停失敗」而不知道別的分頁已經把它結束掉了。
      const detail = e instanceof Error ? e.message : t.messages.retryLater;
      toast.show(
        kind === 'delete' ? `${t.messages.deleteFailed}：${detail}`
          : kind === 'publish' ? `${t.messages.publishFailedPrefix}${detail}`
            : kind === 'pause' ? `${t.messages.pauseFailed}：${detail}`
              : kind === 'resume' ? `${t.messages.resumeFailed}：${detail}`
                : `${t.messages.endFailed}：${detail}`,
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
      render: (c) => <Badge tone="purple">{t.types[c.type]}</Badge>,
    },
    {
      key: 'period', header: t.columns.period, width: '260px',
      render: (c) => <span className="text-sm">{periodText(c)}</span>,
    },
    {
      /**
       * 參與人數。真實模式沒有這個數字——`campaigns` 表沒有欄位，也沒有任何一張表
       * 把「顧客參加了哪個活動」記下來，service 因此回 null → 顯示「--」。
       * 填 0 會讓「沒有人參加」與「我們沒有在算」長得一模一樣（CLAUDE.md 捏造已知）。
       */
      key: 'participants', header: t.columns.participants, numeric: true, width: '110px',
      render: (c) => (c.participantCount === null
        ? <span className="text-muted" title={t.labels.participantsUnknownHint}>{t.labels.unknownValue}</span>
        : t.labels.people(c.participantCount)),
    },
    {
      key: 'status', header: t.columns.status, width: '100px',
      render: (c) => <Badge tone={STATUS_TONE[c.status]}>{t.status[c.status]}</Badge>,
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
          {c.status === 'ACTIVE' || c.status === 'SCHEDULED' ? (
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
          {c.status === 'ACTIVE' || c.status === 'PAUSED' ? (
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
        {/*
          * 載入中不掛頁尾：`total={rows.length}` 在還沒拿到資料時是 0，會印出
          * 「共 0 筆」——把一個「已知的答案」拿來當「還不知道」用（#34 / #17 同坑）。
          */}
        {loading ? null : (
          <DataTableFooter>
            <Pagination page={page} size={PAGE_SIZE} total={rows.length} onChange={setPage} />
          </DataTableFooter>
        )}
      </DataTableContainer>

      <CampaignFormModal
        open={formTarget !== undefined}
        campaign={formTarget ?? null}
        coupons={coupons}
        activeFeatures={activeFeatures}
        onClose={() => setFormTarget(undefined)}
        onSaved={async (isEdit) => {
          setFormTarget(undefined);
          toast.show(isEdit ? t.messages.updated : t.messages.created);
          await load();
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
              <dd><Badge tone="purple">{t.types[viewTarget.type]}</Badge></dd>
            </div>
            <div>
              <dt className="form-label">{t.columns.status}</dt>
              <dd><Badge tone={STATUS_TONE[viewTarget.status]}>{t.status[viewTarget.status]}</Badge></dd>
            </div>
            <div>
              <dt className="form-label">{t.columns.participants}</dt>
              <dd className="text-base tabular-nums text-dark">
                {viewTarget.participantCount === null
                  ? <span className="text-muted">{t.labels.participantsUnknown}</span>
                  : t.labels.people(viewTarget.participantCount)}
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
                {viewTarget.couponName ?? <span className="text-muted">{t.form.couponNone}</span>}
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
  onSaved: (isEdit: boolean) => void | Promise<void>;
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
    setType(campaign?.type ?? 'BIRTHDAY');
    setStartAt(campaign?.startAt ? campaign.startAt.slice(0, 16) : '');
    setEndAt(campaign?.endAt ? campaign.endAt.slice(0, 16) : '');
    setDescription(campaign?.description ?? '');
    setPushMessage(campaign?.pushMessage ?? '');
    setCouponId(campaign?.couponId ?? '');
    setBonusPoints(campaign?.bonusPoints ? String(campaign.bonusPoints) : '');
    setThresholdAmount(campaign?.thresholdAmount ? String(campaign.thresholdAmount) : '');
    setRecallDays(campaign?.recallDays ? String(campaign.recallDays) : '');
    setIsAutoTrigger(campaign?.isAutoTrigger ?? false);
  }, [open, campaign]);

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

  /**
   * 建立／編輯活動 —— POST 或 PUT `/api/campaigns`。
   *
   * 新建的活動後端一律給 DRAFT：**存檔不等於發布**，顧客要按過「發布」才看得到，
   * 這一點頁面上的 draftNotice 已經寫明。推播文案存進 `content.text`，
   * 那就是顧客打「活動」時 webhook 回出去的那段字（line-events.ts replyCampaigns）。
   * 成功 toast 由 onSaved() 在 await 回來之後才顯示。
   */
  const submit = async () => {
    const err = validate();
    setError(err);
    if (err) { toast.show(err, 'warning'); return; }
    setSaving(true);
    try {
      // datetime-local 沒有時區，補上台北時區才是後端 zod 收的 ISO 8601 offset 格式
      const iso = (v: string) => (v ? `${v}:00+08:00` : null);
      const payload = {
        name: name.trim(),
        description,
        type,
        startAt: iso(startAt),
        endAt: iso(endAt),
        pushMessage,
        couponId: couponId || null,
        couponName: selectedCoupon?.name ?? null,
        bonusPoints: Number(bonusPoints) || 0,
        thresholdAmount: thresholdAmount ? Number(thresholdAmount) : null,
        recallDays: recallDays ? Number(recallDays) : null,
        isAutoTrigger,
      };
      if (campaign) await updateCampaign(campaign.id, payload);
      else await createCampaign(payload);
      await onSaved(isEdit);
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

      {/*
        * ⚠️ 檔案選擇器**停用**（issue #7 (乙) 接線這一輪）。
        * 它原本只把檔名記進 imageName 就結束——沒有上傳、沒有 service，送出時也不
        * 會帶走。整頁其餘動作接上真實後端之後，這種「選了會被靜靜丟掉」的控制項
        * 比先前更容易誤導。依 CLAUDE.md「placeholder 要在使用者讀得到的地方說明」，
        * 這裡是停用＋說明，不是刪除。禁止在沒有接上 /api/upload 之前拿掉 disabled。
        */}
      <FormGroup>
        <Label htmlFor="campaignImageInput">{t.form.image}</Label>
        <Input id="campaignImageInput" type="file" accept="image/*" disabled />
        <Alert tone="warning" className="mt-2">{t.form.imageUploadNotWired}</Alert>
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
