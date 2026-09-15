'use client';
import * as React from 'react';
import Link from 'next/link';
import {
  BarChart3, Clipboard, Download, ExternalLink, Globe2, Megaphone, QrCode,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmModal } from '@/components/ui/Modal';
import { Input, Select } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { getTenantSettings } from '@/services/settings';
import { getPromotionStats, type PromotionRange } from '@/services/promotion';
import { buildPublicBookingUrl } from '@/config/tenant-settings';
import { APP_URL } from '@/config/env';
import { common } from '@/i18n/zh-TW/common';
import { nav } from '@/i18n/zh-TW/nav';
import { promotePage as t } from '@/i18n/zh-TW/pages/promote';
import { formatNumber } from '@/lib/utils';
import type { PromotionStats } from '@/lib/types';

/** QR Code 圖檔在骨架階段以本地占位圖代替；正式站由後端產生 */
const QR_PLACEHOLDER_AVAILABLE = true;

/* -------------------------------------------------------------------------- */

export default function PromotePage() {
  const toast = useToast();

  const [shopCode, setShopCode] = React.useState<string | null>(null);
  const [loadingUrl, setLoadingUrl] = React.useState(true);

  const [days, setDays] = React.useState<PromotionRange>('7');
  const [stats, setStats] = React.useState<PromotionStats | null>(null);
  const [loadingStats, setLoadingStats] = React.useState(true);

  const [qrConfirmOpen, setQrConfirmOpen] = React.useState(false);

  React.useEffect(() => {
    void (async () => {
      setLoadingUrl(true);
      try {
        const settings = await getTenantSettings();
        setShopCode(settings.basic.shopCode);
      } catch (e) {
        setShopCode(null);
        toast.show(
          `${t.messages.loadPromotionFailed}${e instanceof Error ? e.message : t.messages.unknownError}`,
          'danger',
        );
      } finally {
        setLoadingUrl(false);
      }
    })();
  }, [toast]);

  React.useEffect(() => {
    let cancelled = false;
    setLoadingStats(true);
    void (async () => {
      try {
        const result = await getPromotionStats(days);
        if (!cancelled) setStats(result);
      } catch (e) {
        if (cancelled) return;
        setStats(null);
        toast.show(
          `${t.stats.loadFailed}${e instanceof Error ? `：${e.message}` : ''}`,
          'danger',
        );
      } finally {
        if (!cancelled) setLoadingStats(false);
      }
    })();
    return () => { cancelled = true; };
  }, [days, toast]);

  const publicUrl = shopCode ? buildPublicBookingUrl(APP_URL, shopCode) : '';

  const channelUrl = (utmSource: string) =>
    publicUrl ? `${publicUrl}?utm_source=${utmSource}` : '';

  const copy = async (text: string, message: string) => {
    if (!text) { toast.show(t.publicUrl.notConfigured, 'warning'); return; }
    try {
      await navigator.clipboard.writeText(text);
      toast.show(message);
    } catch {
      toast.show(t.messages.copyFailed, 'warning');
    }
  };

  const downloadQr = () => {
    setQrConfirmOpen(false);
    toast.show(t.messages.downloadStarted(t.qr.filename));
  };

  const sourceLabel = (source: string) =>
    t.stats.sourceLabels[source as keyof typeof t.stats.sourceLabels] ?? source;

  const bySourceColumns: Column<PromotionStats['bySource'][number]>[] = [
    {
      key: 'source', header: t.stats.columns.source,
      render: (s) => <span className="font-semibold text-dark">{sourceLabel(s.source)}</span>,
    },
    {
      key: 'pv', header: t.stats.columns.pv, numeric: true, width: '160px',
      render: (s) => formatNumber(s.pv),
    },
    {
      key: 'uv', header: t.stats.columns.uv, numeric: true, width: '160px',
      render: (s) => formatNumber(s.uv),
    },
  ];

  const byDayColumns: Column<PromotionStats['byDay'][number]>[] = [
    { key: 'day', header: t.stats.byDay.columns.day, render: (d) => d.day },
    {
      key: 'pv', header: t.stats.byDay.columns.pv, numeric: true, width: '160px',
      render: (d) => formatNumber(d.pv),
    },
    {
      key: 'uv', header: t.stats.byDay.columns.uv, numeric: true, width: '160px',
      render: (d) => formatNumber(d.uv),
    },
  ];

  return (
    <>
      <PageHeader eyebrow={nav.navMarketing} title={t.title} />

      {!loadingUrl && !shopCode ? (
        <Alert tone="warning" className="mb-4" title={t.publicUrl.notConfigured}>
          {t.publicUrl.notConfiguredHint}
          {' '}
          <Link className="underline" href="/tenant/settings">{nav.settings}</Link>
        </Alert>
      ) : null}

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        {/* ------------------------------------------------ 卡片 1：預約頁 */}
        <Card className="lg:col-span-2">
          <CardBody>
            <h6 className="mb-3 flex items-center gap-2 text-md font-bold text-dark">
              <Globe2 size={16} />{t.publicUrl.heading}
            </h6>
            <div className="input-group">
              <Input readOnly value={loadingUrl ? t.publicUrl.loading : publicUrl} />
              <Button onClick={() => void copy(publicUrl, t.messages.urlCopied)}>
                <Clipboard size={14} />{t.publicUrl.copy}
              </Button>
              <a
                className="btn btn-outline"
                href={publicUrl || '#'}
                target="_blank"
                rel="noreferrer"
                aria-disabled={!publicUrl}
              >
                <ExternalLink size={14} />{t.publicUrl.open}
              </a>
            </div>
            <p className="form-text mt-2">{t.publicUrl.description}</p>
          </CardBody>
        </Card>

        {/* ----------------------------------------------------- 卡片 2：QR */}
        <Card>
          <CardBody className="text-center">
            <h6 className="mb-3 flex items-center justify-center gap-2 text-md font-bold text-dark">
              <QrCode size={16} />{t.qr.heading}
            </h6>
            <div className="mx-auto flex h-40 w-40 items-center justify-center rounded-md border border-neutral-250 bg-neutral-50">
              {loadingUrl ? (
                <span className="text-xs text-muted">{t.publicUrl.loading}</span>
              ) : !publicUrl ? (
                <span className="text-xs text-muted">{t.qr.notReady}</span>
              ) : QR_PLACEHOLDER_AVAILABLE ? (
                <QrCode size={96} className="text-dark" aria-hidden />
              ) : (
                <span className="text-xs text-muted">{t.qr.widgetFailed}</span>
              )}
            </div>
            <Button
              variant="outline" size="sm" className="mt-3"
              disabled={!publicUrl}
              onClick={() => setQrConfirmOpen(true)}
            >
              <Download size={14} />{t.qr.download}
            </Button>
          </CardBody>
        </Card>
      </div>

      {/* -------------------------------------------------- 卡片 3：各通路 */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Megaphone size={16} />{t.channels.heading}
          </CardTitle>
        </CardHeader>
        <CardBody>
          <p className="form-text">
            {t.channels.utmHint.lead}
            <code className="rounded-xs bg-neutral-100 px-1 font-mono text-xs">
              {t.channels.utmHint.code}
            </code>
            {t.channels.utmHint.tail}
          </p>
          <p className="form-text mb-4">{t.channels.platformHint}</p>

          {loadingUrl ? (
            <div className="py-8 text-center text-muted">{t.channels.loading}</div>
          ) : (
            <div className="flex flex-col gap-4">
              {t.channels.items.map((c) => (
                <div key={c.key} className="rounded-md border border-neutral-250 p-4">
                  <div className="text-base font-bold text-dark">{c.name}</div>
                  <p className="form-text">{c.summary}</p>
                  {c.note ? <p className="form-text">{c.note}</p> : null}
                  <ol className="ml-4 list-decimal text-sm text-neutral-700">
                    {c.steps.map((step) => (
                      <li key={step} className="mt-1">{step}</li>
                    ))}
                  </ol>
                  <div className="input-group mt-3">
                    <Input readOnly value={channelUrl(c.utmSource)} aria-label={c.name} />
                    <Button
                      variant="outline"
                      onClick={() => void copy(channelUrl(c.utmSource), t.messages.copied)}
                    >
                      <Clipboard size={14} />{t.channels.copyLink}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* ------------------------------------------------ 卡片 4：推廣成效 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 size={16} />{t.stats.heading}
          </CardTitle>
          <Select
            className="form-select-sm w-auto"
            aria-label={t.stats.heading}
            value={days}
            onChange={(e) => setDays(e.target.value as PromotionRange)}
          >
            {t.stats.daysOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>
        </CardHeader>

        {!loadingStats && stats && !stats.hasData ? (
          <CardBody>
            <EmptyState
              icon={BarChart3}
              title={t.stats.emptyTitle}
              description={t.stats.emptyDescription}
            />
          </CardBody>
        ) : (
          <>
            <CardBody className="flex flex-wrap gap-6 border-b border-neutral-250 pb-4">
              <div>
                <div className="text-2xs text-secondary">{t.stats.totals.pv}</div>
                <div className="text-2xl font-bold text-dark">
                  {loadingStats ? t.stats.loading : formatNumber(stats?.pv ?? 0)}
                </div>
              </div>
              <div>
                <div className="text-2xs text-secondary">{t.stats.totals.uv}</div>
                <div className="text-2xl font-bold text-dark">
                  {loadingStats ? t.stats.loading : formatNumber(stats?.uv ?? 0)}
                </div>
              </div>
            </CardBody>

            <DataTable
              columns={bySourceColumns}
              rows={stats?.bySource ?? []}
              loading={loadingStats}
              rowKey={(s) => s.source}
            />

            {stats && stats.byDay.length > 0 ? (
              <>
                <CardBody className="border-t border-neutral-250 pb-0 pt-4">
                  <h6 className="text-sm font-bold text-dark">{t.stats.byDay.heading}</h6>
                </CardBody>
                <DataTable
                  columns={byDayColumns}
                  rows={stats.byDay}
                  loading={loadingStats}
                  rowKey={(d) => d.day}
                />
              </>
            ) : null}
          </>
        )}

        <CardBody>
          <p className="form-text">{t.stats.approximateNote}</p>
        </CardBody>
      </Card>

      <ConfirmModal
        open={qrConfirmOpen}
        title={t.qr.confirmTitle}
        message={t.qr.confirmMessage}
        confirmText={common.download}
        onClose={() => setQrConfirmOpen(false)}
        onConfirm={downloadQr}
      />
    </>
  );
}
