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
import { byMode } from '@/mock';
import { common } from '@/i18n/zh-TW/common';
import { nav } from '@/i18n/zh-TW/nav';
import { campaignsPage as t } from '@/i18n/zh-TW/pages/campaigns';
import { formatCurrency, formatDateTime, formatNumber } from '@/lib/utils';
import type { Coupon } from '@/lib/types';

/* -------------------------------------------------------------------------- */
/* 本頁專用假資料（不寫進 src/mock，避免與其他頁面衝突）                          */
/* -------------------------------------------------------------------------- */

type CampaignStatus = keyof typeof t.status;
type CampaignType = keyof typeof t.types;

/** 原站 /api/campaigns */
type Campaign = {
  id: string;
  name: string;
  description: string;
  type: CampaignType;
  status: CampaignStatus;
  startAt: string | null;
  endAt: string | null;
  pushMessage: string;
  couponId: string | null;
  couponName: string | null;
  bonusPoints: number;
  thresholdAmount: number | null;
  recallDays: number | null;
  isAutoTrigger: boolean;
  participantCount: number;
  imageUrl: string;
  createdAt: string;
};

const CAMPAIGNS_LOCAL_SHOP: Campaign[] = [
  {
    id: 'cm_1', name: '生日祝福', description: '生日當月來店即贈護髮體驗。',
    type: 'BIRTHDAY', status: 'ACTIVE', startAt: '2026-01-01T00:00:00+08:00', endAt: null,
    pushMessage: '生日快樂！本月來店即可領取專屬生日禮，期待與你見面 🎂',
    couponId: 'cp_3', couponName: '生日禮：免費瀏海修剪', bonusPoints: 100,
    thresholdAmount: null, recallDays: null, isAutoTrigger: true,
    participantCount: 38, imageUrl: '', createdAt: '2025-12-20T10:00:00+08:00',
  },
  {
    id: 'cm_2', name: '新春限時優惠', description: '春節期間全店服務 9 折。',
    type: 'LIMITED_TIME', status: 'SCHEDULED',
    startAt: '2026-09-01T00:00:00+08:00', endAt: '2026-09-30T23:59:00+08:00',
    pushMessage: '新春限時：全店服務 9 折，只到 9/30！',
    couponId: 'cp_1', couponName: '新客體驗 8 折', bonusPoints: 0,
    thresholdAmount: null, recallDays: null, isAutoTrigger: false,
    participantCount: 0, imageUrl: '', createdAt: '2026-08-15T09:20:00+08:00',
  },
  {
    id: 'cm_3', name: '顧客喚回', description: '', type: 'RECALL', status: 'PAUSED',
    startAt: '2026-05-01T00:00:00+08:00', endAt: null,
    pushMessage: '好久不見！回來讓我們幫你整理一下造型吧，出示此訊息折 200。',
    couponId: null, couponName: null, bonusPoints: 200,
    thresholdAmount: null, recallDays: 60, isAutoTrigger: true,
    participantCount: 12, imageUrl: '', createdAt: '2026-04-28T15:40:00+08:00',
  },
  {
    id: 'cm_4', name: '消費滿 2000 送點數', description: '單筆消費滿額回饋。',
    type: 'SPENDING_THRESHOLD', status: 'DRAFT', startAt: null, endAt: null,
    pushMessage: '', couponId: null, couponName: null, bonusPoints: 300,
    thresholdAmount: 2000, recallDays: null, isAutoTrigger: true,
    participantCount: 0, imageUrl: '', createdAt: '2026-08-19T18:05:00+08:00',
  },
  {
    id: 'cm_5', name: '新客首次體驗', description: '首次到店贈 8 折券。',
    type: 'NEW_CUSTOMER', status: 'ENDED',
    startAt: '2026-03-01T00:00:00+08:00', endAt: '2026-06-30T23:59:00+08:00',
    pushMessage: '第一次來？出示這則訊息即可享新客 8 折！',
    couponId: 'cp_1', couponName: '新客體驗 8 折', bonusPoints: 0,
    thresholdAmount: null, recallDays: null, isAutoTrigger: true,
    participantCount: 62, imageUrl: '', createdAt: '2026-02-24T11:10:00+08:00',
  },
];

const CAMPAIGNS_GUIDE: Campaign[] = [
  {
    id: 'cm_g1', name: '早鳥報名回饋', description: '出團前 30 天報名，送 500 點。',
    type: 'LIMITED_TIME', status: 'ACTIVE',
    startAt: '2026-06-01T00:00:00+08:00', endAt: '2026-10-31T23:59:00+08:00',
    pushMessage: '暑期檔期開賣！出團前 30 天報名享 9 折，還送 500 點折抵下次行程 🌊',
    couponId: 'cp_1', couponName: '早鳥報名 9 折', bonusPoints: 500,
    thresholdAmount: null, recallDays: null, isAutoTrigger: false,
    participantCount: 88, imageUrl: '', createdAt: '2026-05-20T10:00:00+08:00',
  },
  {
    id: 'cm_g2', name: '揪團同行折扣', description: '4 人以上同行自動折 500。',
    type: 'SPENDING_THRESHOLD', status: 'ACTIVE', startAt: '2026-07-01T00:00:00+08:00', endAt: null,
    pushMessage: '找朋友一起來！4 人以上同行每筆折 500，人越多越划算 🙌',
    couponId: 'cp_2', couponName: '揪團折 500', bonusPoints: 0,
    thresholdAmount: 5000, recallDays: null, isAutoTrigger: true,
    participantCount: 34, imageUrl: '', createdAt: '2026-06-25T14:30:00+08:00',
  },
  {
    id: 'cm_g3', name: '旅人回訪禮', description: '一年內再次報名贈免費裝備租借。',
    type: 'RECALL', status: 'ACTIVE', startAt: '2026-03-01T00:00:00+08:00', endAt: null,
    pushMessage: '好久不見！最近開了新路線，回訪的旅人享免費裝備租借 🏕',
    couponId: 'cp_3', couponName: '回訪禮：免費裝備租借', bonusPoints: 0,
    thresholdAmount: null, recallDays: 180, isAutoTrigger: true,
    participantCount: 26, imageUrl: '', createdAt: '2026-02-26T09:15:00+08:00',
  },
  {
    id: 'cm_g4', name: '生日出海禮', description: '壽星當月報名任一行程送紀念明信片。',
    type: 'BIRTHDAY', status: 'ACTIVE', startAt: '2026-01-01T00:00:00+08:00', endAt: null,
    pushMessage: '生日快樂！這個月報名任一行程，我們送你一組祕島明信片 🎂',
    couponId: null, couponName: null, bonusPoints: 200,
    thresholdAmount: null, recallDays: null, isAutoTrigger: true,
    participantCount: 17, imageUrl: '', createdAt: '2025-12-28T11:00:00+08:00',
  },
  {
    id: 'cm_g5', name: '賞鯨季開跑', description: '4–9 月賞鯨旺季主打。',
    type: 'LIMITED_TIME', status: 'ENDED',
    startAt: '2026-04-01T00:00:00+08:00', endAt: '2026-08-10T23:59:00+08:00',
    pushMessage: '賞鯨季來了！飛旋海豚出沒率 9 成，週末團次熱賣中 🐬',
    couponId: null, couponName: null, bonusPoints: 0,
    thresholdAmount: null, recallDays: null, isAutoTrigger: false,
    participantCount: 142, imageUrl: '', createdAt: '2026-03-24T16:40:00+08:00',
  },
];

const CAMPAIGNS_CLINIC: Campaign[] = [
  {
    id: 'cm_c1', name: '流感疫苗季提醒', description: '公費疫苗開打通知。',
    type: 'LIMITED_TIME', status: 'ACTIVE',
    startAt: '2026-08-15T00:00:00+08:00', endAt: '2026-12-31T23:59:00+08:00',
    pushMessage: '流感疫苗開打囉！本院已開放線上預約，公費對象免費接種，名額有限。',
    couponId: null, couponName: null, bonusPoints: 0,
    thresholdAmount: null, recallDays: null, isAutoTrigger: false,
    participantCount: 214, imageUrl: '', createdAt: '2026-08-10T09:00:00+08:00',
  },
  {
    id: 'cm_c2', name: '年度健檢回訪', description: '滿一年未健檢者自動提醒。',
    type: 'RECALL', status: 'ACTIVE', startAt: '2026-01-01T00:00:00+08:00', endAt: null,
    pushMessage: '距離您上次健康檢查已滿一年，建議安排今年度檢查，現在預約享早鳥折 800。',
    couponId: 'cp_1', couponName: '健檢早鳥折 800', bonusPoints: 0,
    thresholdAmount: null, recallDays: 365, isAutoTrigger: true,
    participantCount: 96, imageUrl: '', createdAt: '2025-12-30T10:20:00+08:00',
  },
  {
    id: 'cm_c3', name: '慢性病回診提醒', description: '慢性處方箋到期前提醒。',
    type: 'RECALL', status: 'ACTIVE', startAt: '2026-02-01T00:00:00+08:00', endAt: null,
    pushMessage: '提醒您：慢性處方箋即將到期，記得回診由醫師評估後續用藥。',
    couponId: null, couponName: null, bonusPoints: 0,
    thresholdAmount: null, recallDays: 90, isAutoTrigger: true,
    participantCount: 178, imageUrl: '', createdAt: '2026-01-28T15:10:00+08:00',
  },
  {
    id: 'cm_c4', name: '家庭疫苗方案', description: '同戶 3 人以上 9 折。', type: 'SPENDING_THRESHOLD',
    status: 'DRAFT', startAt: null, endAt: null,
    pushMessage: '', couponId: 'cp_2', couponName: '疫苗季家庭方案', bonusPoints: 0,
    thresholdAmount: 2400, recallDays: null, isAutoTrigger: true,
    participantCount: 0, imageUrl: '', createdAt: '2026-08-18T17:30:00+08:00',
  },
];

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
      await new Promise((r) => setTimeout(r, 320));
      setRows(byMode({ LOCAL_SHOP: CAMPAIGNS_LOCAL_SHOP, GUIDE: CAMPAIGNS_GUIDE, CLINIC: CAMPAIGNS_CLINIC }));
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
      await new Promise((r) => setTimeout(r, 380));
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
    } catch {
      toast.show(
        kind === 'delete' ? t.messages.deleteFailed
          : kind === 'publish' ? `${t.messages.publishFailedPrefix}${t.messages.retryLater}`
            : kind === 'pause' ? t.messages.pauseFailed
              : kind === 'resume' ? t.messages.resumeFailed
                : t.messages.endFailed,
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
      key: 'participants', header: t.columns.participants, numeric: true, width: '110px',
      render: (c) => t.labels.people(c.participantCount),
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
              <dd><Badge tone="purple">{t.types[viewTarget.type]}</Badge></dd>
            </div>
            <div>
              <dt className="form-label">{t.columns.status}</dt>
              <dd><Badge tone={STATUS_TONE[viewTarget.status]}>{t.status[viewTarget.status]}</Badge></dd>
            </div>
            <div>
              <dt className="form-label">{t.columns.participants}</dt>
              <dd className="text-base tabular-nums text-dark">
                {t.labels.people(viewTarget.participantCount)}
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
    setType(campaign?.type ?? 'BIRTHDAY');
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
      await new Promise((r) => setTimeout(r, 420));
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
