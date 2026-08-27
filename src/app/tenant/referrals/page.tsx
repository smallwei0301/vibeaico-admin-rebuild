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
import { Input, Label } from '@/components/ui/Form';
import { nav } from '@/i18n/zh-TW/nav';
import { referralsPage as t } from '@/i18n/zh-TW/pages/referrals';
import { formatDateTime } from '@/lib/utils';

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

/*
 * ⚠️ 這裡曾有 MOCK_REFERRALS：五筆假推薦記錄（含店名、獎勵點數、完成時間），
 * 四張統計卡的 5／2／2／1,000 點就是從它們算出來的。推薦後端不存在，
 * 那是平台對店家的獎勵陳述，店家可能據此以為自己已賺到點數。
 * 依 CLAUDE.md「未知就顯示未知」，統計一律 `--`、歷史一律空表，版面保留。
 * 禁止再放示範記錄。
 */

const STATUS_TONE: Record<ReferralStatus, 'success' | 'warning' | 'neutral'> = {
  COMPLETED: 'success',
  PENDING: 'warning',
  EXPIRED: 'neutral',
};

const PAGE_SIZE = 20;

/* -------------------------------------------------------------------------- */

export default function ReferralsPage() {
  const [page, setPage] = React.useState(0);

  /* 後端尚未建置：沒有 /api/referrals/dashboard，也就沒有任何推薦記錄可讀 */
  const rows: ReferralRecord[] = [];

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

      <Alert tone="warning" title={t.notBuilt.title} className="mb-4">
        {t.notBuilt.body}
      </Alert>

      <Card className="mb-4">
        <CardBody>
          <h5 className="mb-3 text-lg font-bold text-dark">{t.code.heading}</h5>

          {/*
            * ⚠️ 推薦碼後端尚未建置：欄位不可以再填入任何看起來像真推薦碼的字串，
            * 複製／分享也必須停用 —— 舊實作用硬編碼的假碼組出註冊連結給店家發出去。
            */}
          <div className="input-group mb-4">
            <Input
              readOnly
              disabled
              className="text-center font-mono"
              aria-label={t.code.heading}
              value={t.notBuilt.codeUnavailable}
            />
            <Button
              variant="outline"
              disabled
              title={t.notBuilt.disabledHint}
              aria-label={t.code.copyCode}
            >
              <Clipboard size={14} />
            </Button>
          </div>

          <Label htmlFor="referralLink">{t.code.linkLabel}</Label>
          <div className="input-group">
            <Input
              id="referralLink" readOnly disabled className="text-center"
              value={t.notBuilt.linkUnavailable}
            />
            <Button variant="outline" disabled title={t.notBuilt.disabledHint}>
              <Link2 size={14} />{t.code.copyLink}
            </Button>
            <Button variant="success" disabled title={t.notBuilt.disabledHint}>
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

      {/*
        * ⚠️ 四張統計卡一律顯示未知態：後端沒查過，就不能給數字。
        * 版面保留，接上真後端後把 t.notBuilt.unknownValue 換成真值即可。
        */}
      <div className="card-grid mb-4">
        <StatCard
          label={t.stats.total}
          value={t.notBuilt.unknownValue}
          icon={Users}
          tone="primary"
        />
        <StatCard
          label={t.stats.completed}
          value={t.notBuilt.unknownValue}
          icon={CheckCircle2}
          tone="success"
        />
        <StatCard
          label={t.stats.pending}
          value={t.notBuilt.unknownValue}
          icon={Hourglass}
          tone="warning"
        />
        <StatCard
          label={t.stats.earnedPoints}
          value={t.notBuilt.unknownValue}
          icon={Coins}
          tone="info"
        />
      </div>

      <DataTableContainer>
        <DataTableHeader title={t.tableTitle} />
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          scroll
          empty={
            <EmptyState
              icon={Share2}
              title={t.notBuilt.historyEmptyTitle}
              description={t.notBuilt.historyEmptyDescription}
            />
          }
        />
        <DataTableFooter>
          <Pagination page={page} size={PAGE_SIZE} total={rows.length} onChange={setPage} />
        </DataTableFooter>
      </DataTableContainer>
    </>
  );
}
