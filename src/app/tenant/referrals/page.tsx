'use client';
import * as React from 'react';
import {
  CheckCircle2, Clipboard, Coins, Hourglass, Link2, MessageCircle, Share2, Users,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { Card, CardBody } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import {
  DataTable, DataTableContainer, DataTableFooter, DataTableHeader, type Column,
} from '@/components/ui/DataTable';
import { Pagination } from '@/components/ui/Pagination';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmModal } from '@/components/ui/Modal';
import { Input, Label } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { APP_URL } from '@/config/env';
import { nav } from '@/i18n/zh-TW/nav';
import { referralsPage as t } from '@/i18n/zh-TW/pages/referrals';
import { formatDateTime, formatNumber } from '@/lib/utils';

/* -------------------------------------------------------------------------- */
/* 本頁專用假資料（不寫進 src/mock，避免與其他頁面衝突）                          */
/* -------------------------------------------------------------------------- */

type ReferralStatus = keyof typeof t.status;

/** 原站 /api/referrals/dashboard 的單筆推薦記錄 */
type ReferralRecord = {
  id: string;
  shopName: string;
  shopCode: string;
  status: ReferralStatus;
  rewardPoints: number;
  referredAt: string;
  completedAt: string | null;
};

const MOCK_REFERRAL_CODE = 'VIBE-DEMO-8421';

const MOCK_REFERRALS: ReferralRecord[] = [
  {
    id: 'rf_1', shopName: '晴天美甲工作室', shopCode: 'sunny-nail',
    status: 'COMPLETED', rewardPoints: 500,
    referredAt: '2026-07-02T10:15:00+08:00', completedAt: '2026-07-05T14:22:00+08:00',
  },
  {
    id: 'rf_2', shopName: '木子按摩會館', shopCode: 'muzi-spa',
    status: 'COMPLETED', rewardPoints: 500,
    referredAt: '2026-06-18T09:40:00+08:00', completedAt: '2026-06-19T11:03:00+08:00',
  },
  {
    id: 'rf_3', shopName: '樂活寵物美容', shopCode: 'loha-pet',
    status: 'PENDING', rewardPoints: 0,
    referredAt: '2026-08-11T16:30:00+08:00', completedAt: null,
  },
  {
    id: 'rf_4', shopName: '光影攝影棚', shopCode: 'light-studio',
    status: 'PENDING', rewardPoints: 0,
    referredAt: '2026-08-05T13:05:00+08:00', completedAt: null,
  },
  {
    id: 'rf_5', shopName: '小樹牙醫診所', shopCode: 'tree-dental',
    status: 'EXPIRED', rewardPoints: 0,
    referredAt: '2026-03-14T08:50:00+08:00', completedAt: null,
  },
];

const STATUS_TONE: Record<ReferralStatus, 'success' | 'warning' | 'neutral'> = {
  COMPLETED: 'success',
  PENDING: 'warning',
  EXPIRED: 'neutral',
};

const PAGE_SIZE = 20;

/* -------------------------------------------------------------------------- */

export default function ReferralsPage() {
  const toast = useToast();

  const [rows, setRows] = React.useState<ReferralRecord[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [page, setPage] = React.useState(0);
  const [shareOpen, setShareOpen] = React.useState(false);

  const referralLink = `${APP_URL.replace(/\/$/, '')}/register?ref=${MOCK_REFERRAL_CODE}`;

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      if (cancelled) return;
      setRows(MOCK_REFERRALS);
      setLoading(false);
    }, 320);
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  const summary = React.useMemo(() => ({
    total: rows.length,
    completed: rows.filter((r) => r.status === 'COMPLETED').length,
    pending: rows.filter((r) => r.status === 'PENDING').length,
    points: rows.reduce((sum, r) => sum + r.rewardPoints, 0),
  }), [rows]);

  const visible = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const copy = async (text: string, message: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.show(message);
    } catch {
      toast.show(t.messages.copyFailed, 'warning');
    }
  };

  const shareViaLine = () => {
    setShareOpen(false);
    const url = `https://line.me/R/msg/text/?${encodeURIComponent(t.code.shareText + referralLink)}`;
    window.open(url, '_blank', 'noreferrer');
  };

  const columns: Column<ReferralRecord>[] = [
    {
      key: 'shopName', header: t.columns.shopName,
      render: (r) => <span className="font-semibold text-dark">{r.shopName}</span>,
    },
    {
      key: 'shopCode', header: t.columns.shopCode, width: '160px',
      render: (r) => <span className="font-mono text-xs">{r.shopCode}</span>,
    },
    {
      key: 'status', header: t.columns.status, width: '110px',
      render: (r) => <Badge tone={STATUS_TONE[r.status]}>{t.status[r.status]}</Badge>,
    },
    {
      key: 'rewardPoints', header: t.columns.rewardPoints, numeric: true, width: '120px',
      render: (r) => t.labels.points(r.rewardPoints),
    },
    {
      key: 'referredAt', header: t.columns.referredAt, width: '160px',
      render: (r) => formatDateTime(r.referredAt),
    },
    {
      key: 'completedAt', header: t.columns.completedAt, width: '160px',
      render: (r) => (r.completedAt
        ? formatDateTime(r.completedAt)
        : <span className="text-muted">{t.labels.notCompleted}</span>),
    },
  ];

  return (
    <>
      <PageHeader eyebrow={nav.navMarketing} title={t.title} />

      <Card className="mb-4">
        <CardBody>
          <h5 className="mb-3 text-lg font-bold text-dark">{t.code.heading}</h5>

          <div className="input-group mb-4">
            <Input
              readOnly
              className="text-center font-mono"
              aria-label={t.code.heading}
              value={MOCK_REFERRAL_CODE}
            />
            <Button
              variant="outline"
              title={t.code.copyCode}
              aria-label={t.code.copyCode}
              onClick={() => void copy(MOCK_REFERRAL_CODE, t.messages.codeCopied)}
            >
              <Clipboard size={14} />
            </Button>
          </div>

          <Label htmlFor="referralLink">{t.code.linkLabel}</Label>
          <div className="input-group">
            <Input id="referralLink" readOnly className="text-center" value={referralLink} />
            <Button
              variant="outline"
              onClick={() => void copy(referralLink, t.messages.linkCopied)}
            >
              <Link2 size={14} />{t.code.copyLink}
            </Button>
            <Button variant="success" onClick={() => setShareOpen(true)}>
              <MessageCircle size={14} />{t.code.shareLine}
            </Button>
          </div>
        </CardBody>
      </Card>

      <Alert tone="neutral" icon={false} className="mb-4">
        <span className="font-semibold">{t.explain.label}</span>
        {t.explain.lead}
        <strong>{t.explain.strong}</strong>
        {t.explain.tail}
      </Alert>

      <div className="card-grid mb-4">
        <StatCard
          label={t.stats.total}
          value={loading ? '—' : formatNumber(summary.total)}
          icon={Users}
          tone="primary"
        />
        <StatCard
          label={t.stats.completed}
          value={loading ? '—' : formatNumber(summary.completed)}
          icon={CheckCircle2}
          tone="success"
        />
        <StatCard
          label={t.stats.pending}
          value={loading ? '—' : formatNumber(summary.pending)}
          icon={Hourglass}
          tone="warning"
        />
        <StatCard
          label={t.stats.earnedPoints}
          value={loading ? '—' : t.labels.points(summary.points)}
          icon={Coins}
          tone="info"
        />
      </div>

      <DataTableContainer>
        <DataTableHeader title={t.tableTitle} />
        <DataTable
          columns={columns}
          rows={visible}
          loading={loading}
          rowKey={(r) => r.id}
          scroll
          empty={
            <EmptyState
              icon={Share2}
              title={t.empty.title}
              description={t.empty.description}
            />
          }
        />
        <DataTableFooter>
          <Pagination page={page} size={PAGE_SIZE} total={rows.length} onChange={setPage} />
        </DataTableFooter>
      </DataTableContainer>

      <ConfirmModal
        open={shareOpen}
        title={t.code.shareConfirmTitle}
        message={t.code.shareConfirmMessage}
        confirmText={t.code.shareLine}
        onClose={() => setShareOpen(false)}
        onConfirm={shareViaLine}
      />
    </>
  );
}
