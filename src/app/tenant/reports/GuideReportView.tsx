'use client';
import * as React from 'react';
import Link from 'next/link';
import { BarChart3, Ban, Lock, CalendarCheck, DollarSign, ShoppingBag, Wallet } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { ApiError } from '@/lib/api';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Tabs } from '@/components/ui/Tabs';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Input, Label, FormGroup } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import {
  getGuideReport,
  type GuideRankDimension, type GuideRankMetric, type GuideRankRow, type GuideReport,
} from '@/services/reports';
import { reportsPage } from '@/i18n/zh-TW/pages/reports';
import { presetRange } from '@/lib/guide-report-range';
import { formatCurrency, formatNumber, formatPercent } from '@/lib/utils';

const t = reportsPage.guideReport;
const STATUSES = ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED'] as const;
const PRESET_DAYS = { last7: 7, last30: 30, last90: 90 } as const;
const RANK_TONE = ['warning', 'neutral', 'info'] as const;
const METRICS: GuideRankMetric[] = ['orders', 'people', 'revenue'];
const DIMENSIONS: GuideRankDimension[] = ['trip', 'plan'];

/** 與上一期的增減說明；上一期為 0 或無資料 → 不顯示百分比 */
function changeText(pct: number | null): string {
  if (pct === null) return t.noDataPrevious;
  if (pct === 0) return t.change.flat;
  return pct > 0 ? t.change.up(formatPercent(pct, 1)) : t.change.down(formatPercent(Math.abs(pct), 1));
}

export function GuideReportView() {
  const toast = useToast();
  const [report, setReport] = React.useState<GuideReport | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [forbidden, setForbidden] = React.useState(false);
  const [loadError, setLoadError] = React.useState(false);
  const [reloadKey, setReloadKey] = React.useState(0);
  /** 最近一次成功的報表；失敗時用來還原輸入框（避免在 state updater 內產生副作用） */
  const lastReport = React.useRef<GuideReport | null>(null);
  /** null = 使用後端預設（近 30 天，店家時區） */
  const [query, setQuery] = React.useState<{ from: string; to: string } | null>(null);
  const [fromInput, setFromInput] = React.useState('');
  const [toInput, setToInput] = React.useState('');
  const [metric, setMetric] = React.useState<GuideRankMetric>('orders');
  const [dimension, setDimension] = React.useState<GuideRankDimension>('plan');

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError(false);
    void (async () => {
      try {
        const r = await getGuideReport(query ?? {});
        if (!alive) return;
        lastReport.current = r;
        setReport(r);
        setFromInput(r.range.from);
        setToInput(r.range.to);
      } catch (e) {
        if (!alive) return;
        if (e instanceof ApiError && e.status === 403) {
          setForbidden(true);
          lastReport.current = null;
          setReport(null);
        } else {
          toast.show(e instanceof Error ? e.message : t.errors.loadFailed, 'danger');
          // 失敗時保留的是上一份報表：輸入框還原成該報表的區間，數字與區間才一致；
          // 沒有既有報表（首次載入失敗）則顯示錯誤狀態與重試
          const last = lastReport.current;
          if (last) { setFromInput(last.range.from); setToInput(last.range.to); } else setLoadError(true);
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [query, reloadKey, toast]);

  const applyPreset = (days: number) => {
    // 以後端回報的店家時區算「今天」；尚無報表時回退預設時區，不再因沒有 anchor 而無反應
    setQuery(presetRange(days, report?.range.timeZone));
  };

  const retry = () => {
    setQuery(null);
    setReloadKey((k) => k + 1);
  };

  const applyCustom = () => {
    if (!fromInput || !toInput || toInput < fromInput) {
      toast.show(t.errors.invalidRange, 'danger');
      return;
    }
    setQuery({ from: fromInput, to: toInput });
  };

  const columns: Column<GuideRankRow>[] = [
    { key: 'rank', header: t.ranking.columns.rank, width: '64px', render: (_r, i) => <Badge tone={RANK_TONE[i] ?? 'neutral'}>{i + 1}</Badge> },
    { key: 'name', header: t.ranking.columns.name, render: (r) => r.name },
    { key: 'orders', header: t.ranking.columns.orders, numeric: true, render: (r) => formatNumber(r.orders) },
    { key: 'people', header: t.ranking.columns.people, numeric: true, render: (r) => formatNumber(r.people) },
    { key: 'revenue', header: t.ranking.columns.revenue, numeric: true, render: (r) => formatCurrency(r.revenue) },
  ];

  const cardLabel = (name: string) => (report?.truncated ? `${name}（${t.truncatedHint}）` : name);
  const s = report?.summary;
  const prev = report?.previous;
  const rows = report ? report.ranking[dimension][metric] : [];

  if (forbidden) {
    return (
      <>
        <PageHeader eyebrow={t.eyebrow} title={reportsPage.title} />
        <Card>
          <CardBody className="py-12">
            <EmptyState icon={Lock} title={t.forbidden.title} description={t.forbidden.description} />
          </CardBody>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader eyebrow={t.eyebrow} title={reportsPage.title} />

      <Card className="mb-4">
        <CardBody>
          <div className="flex flex-wrap items-end gap-3">
            <FormGroup className="min-w-[9rem] flex-1">
              <Label>{t.from}</Label>
              <Input type="date" value={fromInput} onChange={(e) => setFromInput(e.target.value)} />
            </FormGroup>
            <FormGroup className="min-w-[9rem] flex-1">
              <Label>{t.to}</Label>
              <Input type="date" value={toInput} onChange={(e) => setToInput(e.target.value)} />
            </FormGroup>
            <Button onClick={applyCustom}>{t.apply}</Button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {(Object.keys(PRESET_DAYS) as (keyof typeof PRESET_DAYS)[]).map((k) => (
              <Button key={k} variant="outline" size="sm" onClick={() => applyPreset(PRESET_DAYS[k])}>
                {t.presets[k]}
              </Button>
            ))}
          </div>
          {report ? (
            <p className="form-text mt-3">
              {t.compareLine(report.range.prevFrom, report.range.prevTo)}{t.sep}{t.timeZoneLine(report.range.timeZone)}
            </p>
          ) : null}
        </CardBody>
      </Card>

      {report?.truncated ? (
        <Alert tone="warning" className="mb-4">{t.truncatedWarning}</Alert>
      ) : null}

      {!loading && report && report.summary.totalOrders === 0 ? (
        <Card className="mb-4">
          <CardBody className="py-12">
            <EmptyState
              icon={BarChart3}
              title={t.emptyTitle}
              description={t.emptyDescription}
              action={
                <Link href="/tenant/tour-orders" className="btn btn-primary">
                  <CalendarCheck size={15} />
                  {t.emptyAction}
                </Link>
              }
            />
          </CardBody>
        </Card>
      ) : null}

      {!loading && !report && loadError ? (
        <Card className="mb-4">
          <CardBody className="py-12">
            <EmptyState
              icon={BarChart3}
              title={t.errors.loadFailed}
              description={t.errors.loadFailedHint}
              action={<Button onClick={retry}>{t.errors.retry}</Button>}
            />
          </CardBody>
        </Card>
      ) : null}

      {loading && !report ? (
        <Card className="mb-4"><CardBody className="py-12 text-center form-text">{t.loading}</CardBody></Card>
      ) : null}

      {s && prev && report && s.totalOrders > 0 ? (
        <>
          <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label={cardLabel(t.cards.orders)} icon={ShoppingBag} tone="primary"
              value={`${formatNumber(s.totalOrders)} ${t.unit.orders}`}
              hint={`${changeText(report.changes.totalOrders)}${t.sep}${t.change.previousValue(formatNumber(prev.totalOrders))}`}
            />
            <StatCard
              label={cardLabel(t.cards.revenue)} icon={DollarSign} tone="success"
              value={formatCurrency(s.revenue)}
              hint={
                <>
                  {changeText(report.changes.revenue)}
                  {s.refundedAmount > 0 ? <><br />{t.cardHints.revenueRefunded(formatCurrency(s.refundedAmount))}</> : null}
                  {s.refundPendingCount > 0 ? (
                    <>
                      <br />
                      {t.cardHints.refundPending(s.refundPendingCount)}
                    </>
                  ) : null}
                </>
              }
            />
            <StatCard
              label={cardLabel(t.cards.avgOrderValue)} icon={Wallet} tone="info"
              value={s.avgOrderValue === null ? t.noData : formatCurrency(s.avgOrderValue)}
              hint={
                s.avgOrderValue === null
                  ? undefined
                  : `${changeText(report.changes.avgOrderValue)}${t.sep}${t.cardHints.avgBasis(s.paidOrderCount)}`
              }
            />
            <StatCard
              label={cardLabel(t.cards.cancelled)} icon={Ban} tone="danger"
              value={`${formatNumber(s.cancelledCount)} ${t.unit.orders}`}
              hint={`${changeText(report.changes.cancelledCount)}${t.sep}${t.change.previousValue(formatNumber(prev.cancelledCount))}`}
            />
          </div>

          <Card className="mb-4">
            <CardHeader><CardTitle>{t.statusBreakdownTitle}</CardTitle></CardHeader>
            <CardBody>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {STATUSES.map((k) => (
                  <div key={k}>
                    <div className="stat-label">{t.status[k]}</div>
                    <div className="stat-value">{formatNumber(s.byStatus[k])}</div>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>

          <Card className="mb-4">
            <CardHeader><CardTitle>{t.ranking.title}</CardTitle></CardHeader>
            <CardBody>
              <Tabs
                items={DIMENSIONS.map((k) => ({ key: k, label: t.ranking.dimension[k] }))}
                value={dimension}
                onChange={(k) => setDimension(k as GuideRankDimension)}
              />
              <Tabs
                className="mt-2"
                items={METRICS.map((k) => ({ key: k, label: t.ranking.metric[k] }))}
                value={metric}
                onChange={(k) => setMetric(k as GuideRankMetric)}
              />
              <div className="mt-3">
                <DataTable
                  columns={columns}
                  rows={rows}
                  loading={loading}
                  rowKey={(r) => r.id}
                  empty={<EmptyState icon={BarChart3} title={t.ranking.empty} />}
                />
              </div>
              <p className="form-text mt-2">{t.ranking.tieRule}</p>
            </CardBody>
          </Card>
        </>
      ) : null}

      <Card className="mb-4">
        <CardHeader><CardTitle>{t.defs.title}</CardTitle></CardHeader>
        <CardBody>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {[t.defs.scope, t.defs.orders, t.defs.revenue, t.defs.avgOrderValue, t.defs.cancelled, t.defs.ranking, t.defs.comparison].map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <Card className="mb-4">
        <CardHeader><CardTitle>{t.notEnabled.title}</CardTitle></CardHeader>
        <CardBody>
          <p className="form-text mb-3">{t.notEnabled.description}</p>
          <ul className="space-y-2 text-sm">
            {t.notEnabled.items.map((item) => (
              <li key={item.name}>
                <span className="font-medium">{item.name}</span>
                <span className="form-text">{t.reasonPrefix}{item.reason}</span>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </>
  );
}
