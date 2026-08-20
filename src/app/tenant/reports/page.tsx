'use client';
import * as React from 'react';
import Link from 'next/link';
import {
  BarChart3, CalendarCheck, Clock, DollarSign, Download, PieChart, Repeat,
  ShoppingBag, Store, TrendingDown, TrendingUp, Trophy, UserPlus, Users,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { useToast } from '@/components/ui/Toast';
import { getStaffPerformance } from '@/services/reports';
import { listFeatures } from '@/services/settings';
import { common } from '@/i18n/zh-TW/common';
import { reportsPage as t } from '@/i18n/zh-TW/pages/reports';
import { formatCurrency, formatNumber, formatPercent } from '@/lib/utils';
import type { StaffPerformance } from '@/lib/types';

/* -------------------------------------------------------------------------- */
/* 本頁專用的骨架假資料（不寫進 src/mock，避免與其他頁面衝突）                    */
/* -------------------------------------------------------------------------- */

type RangeKey = 'week' | 'month' | 'quarter';

const RANGES: RangeKey[] = ['week', 'month', 'quarter'];

/** 進階報表功能代碼；尚未收錄在 config/features.ts 的 FEATURE_CODES */
const ADVANCED_REPORT_CODE = 'ADVANCED_REPORT';
/** 骨架階段：後端沒有這個訂閱旗標時的預設值 */
const MOCK_ADVANCED_REPORT_SUBSCRIBED = true;

type DailyPoint = { label: string; bookings: number; revenue: number };
type NamedCount = { name: string; count: number };
type TopService = { name: string; bookings: number; revenue: number };
type TopProduct = { name: string; quantity: number; revenue: number };
type HourlyPoint = { hourLabel: string; count: number; isPeak: boolean };
type ServiceTrend = { name: string; bookings: number; growth: number };

type ReportData = {
  summary: {
    totalBookings: number;
    totalRevenue: number;
    completedBookings: number;
    newCustomers: number;
  };
  daily: DailyPoint[];
  serviceDistribution: NamedCount[];
  topServices: TopService[];
  topProducts: TopProduct[];
  hourly: HourlyPoint[];
  advanced: {
    totalCustomers: number;
    activeCustomers: number;
    avgVisitCycle: number;
    avgCustomerValue: number;
    serviceTrends: ServiceTrend[];
  };
};

const SERVICE_NAMES = ['精緻剪髮', '全頭染髮', '深層護髮', '瀏海修剪', '頭皮養護'];
const PRODUCT_NAMES = [
  '修護洗髮精 500ml', '護髮油 100ml', '定型噴霧', '頭皮精華液', '深層修護髮膜',
  '免沖洗護髮素', '造型髮蠟', '柔順護色洗髮精', '蓬鬆粉', '寬齒梳',
];

const RANGE_POINTS: Record<RangeKey, number> = { week: 7, month: 30, quarter: 13 };
const RANGE_SCALE: Record<RangeKey, number> = { week: 1, month: 4.2, quarter: 12.5 };

/** 決定性假資料產生器（避免 SSR / CSR 不一致，僅在 effect 內呼叫） */
function buildReport(range: RangeKey): ReportData {
  const points = RANGE_POINTS[range];
  const scale = RANGE_SCALE[range];
  const stepDays = range === 'quarter' ? 7 : 1;

  const daily: DailyPoint[] = Array.from({ length: points }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (points - 1 - i) * stepDays);
    const bookings = 4 + ((i * 7 + points) % 12);
    return {
      label: `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`,
      bookings,
      revenue: bookings * 1180 + ((i * 13) % 5) * 420,
    };
  });

  const totalBookings = daily.reduce((s, d) => s + d.bookings, 0);
  const totalRevenue = daily.reduce((s, d) => s + d.revenue, 0);

  const serviceDistribution: NamedCount[] = SERVICE_NAMES.map((name, i) => ({
    name,
    count: Math.max(Math.round((totalBookings * (5 - i)) / 18), 1),
  }));

  const topServices: TopService[] = serviceDistribution
    .slice(0, 5)
    .map((s, i) => ({ name: s.name, bookings: s.count, revenue: s.count * (600 + i * 340) }));

  const topProducts: TopProduct[] = PRODUCT_NAMES.map((name, i) => {
    const quantity = Math.max(Math.round((28 - i * 2) * (scale / 4.2)), 1);
    return { name, quantity, revenue: quantity * (880 - i * 55) };
  });

  const hourly: HourlyPoint[] = Array.from({ length: 11 }, (_, i) => {
    const hour = 10 + i;
    const count = Math.max(Math.round((3 + ((i * 5) % 9)) * (scale / 2)), 0);
    return { hourLabel: `${String(hour).padStart(2, '0')}:00`, count, isPeak: false };
  });
  const peak = Math.max(...hourly.map((h) => h.count));
  hourly.forEach((h) => { h.isPeak = h.count === peak; });

  const activeCustomers = Math.round(totalBookings * 0.62);

  return {
    summary: {
      totalBookings,
      totalRevenue,
      completedBookings: Math.round(totalBookings * 0.86),
      newCustomers: Math.round(totalBookings * 0.21),
    },
    daily,
    serviceDistribution,
    topServices,
    topProducts,
    hourly,
    advanced: {
      totalCustomers: 246,
      activeCustomers,
      avgVisitCycle: range === 'week' ? 34 : range === 'month' ? 38 : 42,
      avgCustomerValue: activeCustomers ? Math.round(totalRevenue / activeCustomers) : 0,
      serviceTrends: SERVICE_NAMES.map((name, i) => ({
        name,
        bookings: Math.max(Math.round((totalBookings * (5 - i)) / 18), 1),
        growth: [12.4, -6.8, 0, 24.1, -3.2][i] ?? 0,
      })),
    },
  };
}

const todayFileDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const RANK_TONE = ['warning', 'neutral', 'info'] as const;

/* -------------------------------------------------------------------------- */

export default function ReportsPage() {
  const toast = useToast();

  const [range, setRange] = React.useState<RangeKey>('month');
  const [data, setData] = React.useState<ReportData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [staff, setStaff] = React.useState<StaffPerformance[]>([]);
  const [loadingStaff, setLoadingStaff] = React.useState(true);
  /** null = 訂閱狀態尚未確認，先不渲染避免閃爍 */
  const [advancedUnlocked, setAdvancedUnlocked] = React.useState<boolean | null>(null);
  const [exportOpen, setExportOpen] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);

  const fail = React.useCallback(
    (prefix: string, e: unknown) =>
      toast.show(`${prefix}${e instanceof Error ? e.message : t.errors.loadFailed}`, 'danger'),
    [toast],
  );

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    void (async () => {
      try {
        await new Promise((r) => setTimeout(r, 320));
        if (alive) setData(buildReport(range));
      } catch (e) {
        fail(t.errors.summary, e);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [range, fail]);

  React.useEffect(() => {
    void (async () => {
      try {
        setStaff(await getStaffPerformance());
      } catch (e) { fail(t.errors.topStaff, e); } finally { setLoadingStaff(false); }
    })();
    void (async () => {
      try {
        const features = await listFeatures();
        const found = features.find((f) => String(f.code) === ADVANCED_REPORT_CODE);
        setAdvancedUnlocked(found ? found.active : MOCK_ADVANCED_REPORT_SUBSCRIBED);
      } catch (e) {
        fail(t.errors.advancedSubscription, e);
      }
    })();
  }, [fail]);

  const runExport = async (ext: string) => {
    setExportOpen(false);
    setExporting(true);
    try {
      await new Promise((r) => setTimeout(r, 400));
      toast.show(`${t.export.success}：${t.export.fileName(todayFileDate(), ext)}`);
    } catch {
      toast.show(t.export.failed, 'danger');
    } finally {
      setExporting(false);
    }
  };

  const topStaff = staff.slice(0, 5);
  const productTotalRevenue = data?.topProducts.reduce((s, p) => s + p.revenue, 0) ?? 0;
  const serviceTotal = data?.serviceDistribution.reduce((s, x) => s + x.count, 0) ?? 0;
  const maxDailyBookings = Math.max(...(data?.daily.map((d) => d.bookings) ?? [1]), 1);
  const maxDailyRevenue = Math.max(...(data?.daily.map((d) => d.revenue) ?? [1]), 1);
  const maxHourly = Math.max(...(data?.hourly.map((h) => h.count) ?? [1]), 1);

  const rankCell = (index: number) => (
    <Badge tone={RANK_TONE[index] ?? 'neutral'}>{index + 1}</Badge>
  );

  const topServiceColumns: Column<TopService>[] = [
    { key: 'rank', header: t.topServices.columns.rank, width: '64px', render: (_r, i) => rankCell(i) },
    { key: 'name', header: t.topServices.columns.name, render: (r) => r.name },
    {
      key: 'bookings', header: t.topServices.columns.bookings, numeric: true,
      render: (r) => formatNumber(r.bookings),
    },
    {
      key: 'revenue', header: t.topServices.columns.revenue, numeric: true,
      render: (r) => formatCurrency(r.revenue),
    },
  ];

  const topStaffColumns: Column<StaffPerformance>[] = [
    { key: 'rank', header: t.topStaff.columns.rank, width: '64px', render: (_r, i) => rankCell(i) },
    { key: 'name', header: t.topStaff.columns.name, render: (r) => r.staffName },
    {
      key: 'services', header: t.topStaff.columns.services, numeric: true,
      render: (r) => formatNumber(r.bookingCount),
    },
    {
      key: 'revenue', header: t.topStaff.columns.revenue, numeric: true,
      render: (r) => formatCurrency(r.revenue),
    },
  ];

  const topProductColumns: Column<TopProduct>[] = [
    { key: 'rank', header: t.topProducts.columns.rank, width: '64px', render: (_r, i) => rankCell(i) },
    { key: 'name', header: t.topProducts.columns.name, render: (r) => r.name },
    {
      key: 'quantity', header: t.topProducts.columns.quantity, numeric: true,
      render: (r) => formatNumber(r.quantity),
    },
    {
      key: 'revenue', header: t.topProducts.columns.revenue, numeric: true,
      render: (r) => formatCurrency(r.revenue),
    },
    {
      key: 'share', header: t.topProducts.columns.share, numeric: true,
      render: (r) => formatPercent(productTotalRevenue ? (r.revenue / productTotalRevenue) * 100 : 0, 1),
    },
  ];

  const serviceTrendColumns: Column<ServiceTrend>[] = [
    { key: 'name', header: t.advanced.serviceTrends.columns.name, render: (r) => r.name },
    {
      key: 'bookings', header: t.advanced.serviceTrends.columns.bookings, numeric: true,
      render: (r) => formatNumber(r.bookings),
    },
    {
      key: 'growth', header: t.advanced.serviceTrends.columns.growth, numeric: true,
      render: (r) => (r.growth === 0 ? (
        <Badge tone="neutral">{t.advanced.serviceTrends.flat}</Badge>
      ) : r.growth > 0 ? (
        <Badge tone="success"><TrendingUp size={12} />{formatPercent(r.growth, 1)}</Badge>
      ) : (
        <Badge tone="danger"><TrendingDown size={12} />{formatPercent(r.growth, 1)}</Badge>
      )),
    },
  ];

  const completionRate = data && data.summary.totalBookings
    ? (data.summary.completedBookings / data.summary.totalBookings) * 100
    : 0;
  const retentionRate = data && data.advanced.totalCustomers
    ? (data.advanced.activeCustomers / data.advanced.totalCustomers) * 100
    : 0;

  return (
    <>
      <PageHeader
        eyebrow={t.eyebrow}
        title={t.title}
        actions={
          <>
            <div className="btn-group">
              {RANGES.map((r) => (
                <Button
                  key={r}
                  size="sm"
                  variant={range === r ? 'primary' : 'outline'}
                  onClick={() => setRange(r)}
                >
                  {t.range[r]}
                </Button>
              ))}
            </div>
            <div className="relative">
              <Button
                variant="outline"
                size="sm"
                loading={exporting}
                loadingText={common.processing}
                onClick={() => setExportOpen((v) => !v)}
              >
                <Download size={14} />
                {t.export.label}
              </Button>
              {exportOpen ? (
                <div className="absolute right-0 z-topbar mt-1 w-40 rounded-lg border border-neutral-250 bg-neutral-0 p-1 shadow-md">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm btn-block justify-start"
                    onClick={() => void runExport('xlsx')}
                  >
                    {t.export.excel}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm btn-block justify-start"
                    onClick={() => void runExport('csv')}
                  >
                    {t.export.csv}
                  </button>
                </div>
              ) : null}
            </div>
          </>
        }
      />

      {/* ------------------------------------------------------------ 營運總覽 */}
      <div className="mb-4 grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t.summary.totalBookings}
          value={data ? formatNumber(data.summary.totalBookings) : common.loading}
          icon={CalendarCheck}
          tone="primary"
        />
        <StatCard
          label={t.summary.totalRevenue}
          value={data ? formatCurrency(data.summary.totalRevenue) : common.loading}
          icon={DollarSign}
          tone="success"
        />
        <StatCard
          label={t.summary.completionRate}
          value={data ? formatPercent(completionRate, 1) : common.loading}
          icon={Repeat}
          tone="info"
          hint={t.summary.completionRateHint}
        />
        <StatCard
          label={t.summary.newCustomers}
          value={data ? formatNumber(data.summary.newCustomers) : common.loading}
          icon={UserPlus}
          tone="warning"
        />
      </div>

      {/* -------------------------------------------- 每日趨勢 / 熱門服務分布 */}
      <div className="mb-4 grid gap-4 grid-cols-1 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>
              <BarChart3 size={16} className="text-primary" />
              {t.dailyTrend.title}
            </CardTitle>
            <div className="flex items-center gap-4 text-xs text-secondary">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-4 rounded-xs bg-primary" />
                {t.dailyTrend.bookingCount}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-4 rounded-xs bg-success" />
                {t.dailyTrend.revenueAxis}
              </span>
            </div>
          </CardHeader>
          <CardBody>
            {loading ? (
              <div className="py-10 text-center text-muted">{common.loading}</div>
            ) : (
              <div className="flex h-48 items-end gap-1 overflow-x-auto">
                {data?.daily.map((d) => (
                  <div key={d.label} className="flex h-full min-w-[1.75rem] flex-1 flex-col justify-end gap-1">
                    <div className="flex h-full items-end gap-0.5">
                      <div
                        className="flex-1 rounded-sm bg-primary"
                        style={{ height: `${Math.max((d.bookings / maxDailyBookings) * 100, 4)}%` }}
                        title={`${t.dailyTrend.bookingCount}：${formatNumber(d.bookings)}`}
                      />
                      <div
                        className="flex-1 rounded-sm bg-success"
                        style={{ height: `${Math.max((d.revenue / maxDailyRevenue) * 100, 4)}%` }}
                        title={`${t.dailyTrend.revenue}：${formatCurrency(d.revenue)}`}
                      />
                    </div>
                    <div className="text-center text-2xs text-secondary">{d.label}</div>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <PieChart size={16} className="text-primary" />
              {t.serviceDistribution.title}
            </CardTitle>
          </CardHeader>
          <CardBody>
            {loading ? (
              <div className="py-10 text-center text-muted">{common.loading}</div>
            ) : serviceTotal === 0 ? (
              <EmptyState icon={PieChart} title={t.serviceDistribution.empty} />
            ) : (
              <ul className="flex flex-col gap-3">
                {data?.serviceDistribution.map((s) => {
                  const pct = (s.count / serviceTotal) * 100;
                  return (
                    <li key={s.name}>
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <span className="truncate font-semibold text-neutral-800">{s.name}</span>
                        <span className="tabular-nums text-secondary">{formatPercent(pct, 1)}</span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-pill bg-neutral-200">
                        <div className="h-full rounded-pill bg-primary" style={{ width: `${pct}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      {/* ------------------------------------------------ 熱門服務 / 員工排行 */}
      <div className="mb-4 grid gap-4 grid-cols-1 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              <Store size={16} className="text-primary" />
              {t.topServices.title}
            </CardTitle>
          </CardHeader>
          <DataTable
            columns={topServiceColumns}
            rows={data?.topServices ?? []}
            loading={loading}
            rowKey={(r) => r.name}
            empty={<EmptyState icon={Store} title={t.topServices.empty} />}
          />
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <Trophy size={16} className="text-warning" />
              {t.topStaff.title}
            </CardTitle>
          </CardHeader>
          <DataTable
            columns={topStaffColumns}
            rows={topStaff}
            loading={loadingStaff}
            rowKey={(r) => r.staffId}
            empty={<EmptyState icon={Trophy} title={t.topStaff.empty} />}
          />
        </Card>
      </div>

      {/* ---------------------------------------------------- 熱門商品 TOP 10 */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>
            <ShoppingBag size={16} className="text-success" />
            {t.topProducts.title}
          </CardTitle>
          <span className="form-text">{t.topProducts.note}</span>
        </CardHeader>
        <DataTable
          columns={topProductColumns}
          rows={data?.topProducts ?? []}
          loading={loading}
          rowKey={(r) => r.name}
          empty={<EmptyState icon={ShoppingBag} title={t.topProducts.empty} />}
        />
      </Card>

      {/* ---------------------------------------------------------- 時段分布 */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>
            <Clock size={16} className="text-primary" />
            {t.hourly.title}
          </CardTitle>
        </CardHeader>
        <CardBody>
          {loading ? (
            <div className="py-10 text-center text-muted">{common.loading}</div>
          ) : !data || data.hourly.length === 0 ? (
            <EmptyState icon={Clock} title={t.hourly.empty} />
          ) : (
            <div className="flex h-40 items-end gap-1.5">
              {data.hourly.map((h) => (
                <div key={h.hourLabel} className="flex h-full flex-1 flex-col justify-end gap-1">
                  <div
                    className={h.isPeak ? 'w-full rounded-sm bg-warning' : 'w-full rounded-sm bg-primary'}
                    style={{ height: `${Math.max((h.count / maxHourly) * 100, 4)}%` }}
                    title={`${t.hourly.tooltip(h.hourLabel, h.count)}${h.isPeak ? ` · ${t.hourly.peak}` : ''}`}
                  />
                  <div className="text-center text-2xs text-secondary">{h.hourLabel}</div>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* ---------------------------------------------------------- 進階報表 */}
      {advancedUnlocked === null ? null : advancedUnlocked ? (
        <>
          <div className="mb-4 grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label={t.advanced.retentionRate}
              value={data ? formatPercent(retentionRate, 1) : common.loading}
              icon={Repeat}
              tone="info"
              hint={t.advanced.retentionRateHint}
            />
            <StatCard
              label={t.advanced.activeCustomers}
              value={data ? formatNumber(data.advanced.activeCustomers) : common.loading}
              icon={Users}
              tone="primary"
              hint={t.advanced.activeCustomersHint}
            />
            <StatCard
              label={t.advanced.avgVisitCycle}
              value={data
                ? `${formatNumber(data.advanced.avgVisitCycle)} ${t.advanced.avgVisitCycleUnit}`
                : common.loading}
              icon={CalendarCheck}
              tone="success"
            />
            <StatCard
              label={t.advanced.avgCustomerValue}
              value={data ? formatCurrency(data.advanced.avgCustomerValue) : common.loading}
              icon={DollarSign}
              tone="warning"
              hint={t.advanced.avgCustomerValueHint}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>
                <TrendingUp size={16} className="text-primary" />
                {t.advanced.serviceTrends.title}
              </CardTitle>
            </CardHeader>
            <DataTable
              columns={serviceTrendColumns}
              rows={data?.advanced.serviceTrends ?? []}
              loading={loading}
              rowKey={(r) => r.name}
              empty={<EmptyState icon={TrendingUp} title={t.advanced.serviceTrends.empty} />}
            />
          </Card>
        </>
      ) : (
        <Card className="border-primary">
          <CardBody className="py-12 text-center">
            <h2 className="mb-2 text-lg font-bold">{t.advanced.locked.title}</h2>
            <p className="mx-auto mb-4 max-w-xl text-base text-secondary">{t.advanced.locked.body}</p>
            <Link href="/tenant/feature-store?feature=ADVANCED_REPORT" className="btn btn-primary">
              <Store size={15} />
              {t.advanced.locked.action}
            </Link>
          </CardBody>
        </Card>
      )}
    </>
  );
}
