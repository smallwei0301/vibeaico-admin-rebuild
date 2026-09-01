'use client';
import * as React from 'react';
import Link from 'next/link';
import {
  CalendarDays, ChevronDown, ChevronUp, Copy, ExternalLink, Eye, EyeOff,
  Layers, MapPin, Pencil, Plus, Route, Send, Sparkles, Trash2,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { Card, CardBody } from '@/components/ui/Card';
import {
  DataTable, DataTableContainer, DataTableHeader, type Column,
} from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmModal } from '@/components/ui/Modal';
import { Input, Select } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { listTrips } from '@/services/tours';
import { navLabel } from '@/i18n/zh-TW/nav';
import { useBusinessType, useCurrentTenant } from '@/components/layout/BusinessTypeContext';
import { tripsPage as t } from '@/i18n/zh-TW/pages/trips';
import { APP_URL } from '@/config/env';
import { buildPublicBookingUrl } from '@/config/tenant-settings';
import { MODE_PRESETS } from '@/config/modes';
import { formatCurrency, formatNumber } from '@/lib/utils';
import type { MidaoListing, Trip, TripStatus } from '@/lib/types';
import { GuideTripsView } from '@/components/guide/GuideTripsView';

const STATUS_TONE: Record<TripStatus, 'success' | 'neutral' | 'warning'> = {
  PUBLISHED: 'success',
  DRAFT: 'neutral',
  ARCHIVED: 'warning',
};

const MIDAO_TONE: Record<MidaoListing, 'primary' | 'info' | 'danger' | 'neutral'> = {
  LISTED: 'primary',
  PENDING: 'info',
  REJECTED: 'danger',
  NONE: 'neutral',
};

function LegacyTripsPage() {
  const toast = useToast();
  const businessType = useBusinessType();
  const currentTenant = useCurrentTenant();
  const publicShopUrl = buildPublicBookingUrl(APP_URL, currentTenant.shopCode);

  const [rows, setRows] = React.useState<Trip[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [tipsOpen, setTipsOpen] = React.useState(true);

  const [keyword, setKeyword] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('');
  const [midaoFilter, setMidaoFilter] = React.useState('');

  const [deleteTarget, setDeleteTarget] = React.useState<Trip | null>(null);
  const [unpublishTarget, setUnpublishTarget] = React.useState<Trip | null>(null);
  const [midaoTarget, setMidaoTarget] = React.useState<Trip | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listTrips());
    } catch {
      toast.show(t.messages.loadFailed, 'danger');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  React.useEffect(() => { void load(); }, [load]);

  const visible = React.useMemo(() => rows.filter((r) => {
    if (statusFilter && r.status !== statusFilter) return false;
    if (midaoFilter && r.midaoListing !== midaoFilter) return false;
    if (keyword) {
      const k = keyword.toLowerCase();
      if (![r.title, r.region, r.category].some((v) => v.toLowerCase().includes(k))) return false;
    }
    return true;
  }), [rows, statusFilter, midaoFilter, keyword]);

  /** 只切換商店頁可見性；Midao 前台不受影響 */
  const togglePublish = (trip: Trip) => {
    if (trip.status === 'PUBLISHED') { setUnpublishTarget(trip); return; }
    setRows((prev) => prev.map((r) => (r.id === trip.id ? { ...r, status: 'PUBLISHED' } : r)));
    toast.show(t.messages.published);
  };

  const doUnpublish = () => {
    if (!unpublishTarget) return;
    setRows((prev) => prev.map((r) => (r.id === unpublishTarget.id ? { ...r, status: 'DRAFT' } : r)));
    setUnpublishTarget(null);
    toast.show(t.messages.unpublished);
  };

  const doRequestMidao = () => {
    if (!midaoTarget) return;
    setRows((prev) => prev.map((r) => (
      r.id === midaoTarget.id ? { ...r, midaoListing: 'PENDING', midaoListingNote: '' } : r
    )));
    setMidaoTarget(null);
    toast.show(t.messages.midaoRequested);
  };

  const doDelete = () => {
    if (!deleteTarget) return;
    setRows((prev) => prev.filter((r) => r.id !== deleteTarget.id));
    setDeleteTarget(null);
    toast.show(t.messages.deleted);
  };

  const duplicate = (trip: Trip) => {
    setRows((prev) => [
      { ...trip, id: `${trip.id}_copy`, title: `${trip.title}（複本）`, slug: `${trip.slug}-copy`,
        status: 'DRAFT', midaoListing: 'NONE', midaoListingNote: '' },
      ...prev,
    ]);
    toast.show(t.messages.duplicated);
  };

  const columns: Column<Trip>[] = [
    {
      key: 'trip', header: t.columns.trip,
      render: (r) => (
        <div className="min-w-0">
          <Link href={`/tenant/trips/${r.id}`} className="font-semibold text-dark hover:text-primary">
            {r.title}
          </Link>
          {r.tagline ? (
            <div className="truncate text-2xs text-secondary">{r.tagline}</div>
          ) : null}
          <div className="mt-0.5 flex items-center gap-1 text-2xs text-muted">
            <MapPin size={11} />{r.region}
            {r.category ? <span className="text-neutral-300">·</span> : null}
            {r.category}
          </div>
        </div>
      ),
    },
    {
      key: 'plans', header: t.columns.plans, numeric: true, width: '90px',
      render: (r) => (
        <span className="inline-flex items-center gap-1">
          <Layers size={12} className="text-muted" />{formatNumber(r.planCount)}
        </span>
      ),
    },
    {
      key: 'departures', header: t.columns.departures, numeric: true, width: '110px',
      render: (r) => (
        <span className="inline-flex items-center gap-1">
          <CalendarDays size={12} className="text-muted" />{formatNumber(r.upcomingDepartureCount)}
        </span>
      ),
    },
    {
      key: 'price', header: t.columns.price, numeric: true, width: '110px',
      render: (r) => formatCurrency(r.minPrice),
    },
    {
      key: 'status', header: t.columns.status, width: '150px',
      render: (r) => (
        <div className="flex items-center gap-1.5">
          <Badge tone={STATUS_TONE[r.status]}>{t.status[r.status]}</Badge>
          <Button
            variant="ghost" size="sm"
            title={r.status === 'PUBLISHED' ? t.actions.unpublish : t.actions.publish}
            aria-label={r.status === 'PUBLISHED' ? t.actions.unpublish : t.actions.publish}
            onClick={() => togglePublish(r)}
          >
            {r.status === 'PUBLISHED' ? <Eye size={14} className="text-success" />
              : <EyeOff size={14} className="text-neutral-400" />}
          </Button>
        </div>
      ),
    },
    {
      key: 'midao', header: t.columns.midao, width: '160px',
      render: (r) => (
        <div className="flex items-center gap-1.5">
          <Badge tone={MIDAO_TONE[r.midaoListing]}>{t.midaoListing[r.midaoListing]}</Badge>
          {r.midaoListing === 'NONE' || r.midaoListing === 'REJECTED' ? (
            <Button
              variant="ghost" size="sm"
              title={t.actions.requestMidao} aria-label={t.actions.requestMidao}
              onClick={() => setMidaoTarget(r)}
            >
              <Send size={13} className="text-primary" />
            </Button>
          ) : null}
        </div>
      ),
    },
    {
      key: 'actions', header: t.columns.actions, width: '190px',
      render: (r) => (
        <div className="btn-group">
          <Link href={`/tenant/trips/${r.id}`}>
            <Button variant="outline" size="sm" title={t.actions.edit} aria-label={t.actions.edit}>
              <Pencil size={13} />
            </Button>
          </Link>
          <Link href={`/tenant/trips/${r.id}?tab=departures`}>
            <Button
              variant="outline" size="sm"
              title={t.actions.manageDepartures} aria-label={t.actions.manageDepartures}
            >
              <CalendarDays size={13} />
            </Button>
          </Link>
          <Button
            variant="outline" size="sm" title={t.actions.duplicate} aria-label={t.actions.duplicate}
            onClick={() => duplicate(r)}
          >
            <Copy size={13} />
          </Button>
          <Button
            variant="outlineDanger" size="sm" title={t.actions.delete} aria-label={t.actions.delete}
            onClick={() => setDeleteTarget(r)}
          >
            <Trash2 size={13} />
          </Button>
        </div>
      ),
    },
  ];

  const rejected = visible.filter((r) => r.midaoListing === 'REJECTED');

  return (
    <>
      <PageHeader
        eyebrow={navLabel('navOperation', businessType)}
        title={t.title}
        actions={
          <>
            <Link href={publicShopUrl} target="_blank">
              <Button variant="outline">
                <ExternalLink size={15} />{t.actions.viewShop}
              </Button>
            </Link>
            <Button onClick={() => { /* 骨架：新增行程表單 */ }}>
              <Plus size={15} />{t.actions.create}
            </Button>
          </>
        }
      />

      {/* --------------------------------------------- 兩條上架通道的差異說明 */}
      <Alert tone="info" title={t.channelNote.title} className="mb-3">
        {t.channelNote.text}
      </Alert>

      {/* ------------------------------------------------------ 被退回的提醒 */}
      {rejected.map((r) => (
        <Alert key={r.id} tone="danger" title={`${r.title}｜${t.midaoListing.REJECTED}`} className="mb-3">
          <span className="font-semibold">{t.midaoRejectLabel}：</span>
          {r.midaoListingNote}
        </Alert>
      ))}

      {/* -------------------------------------------------------- 使用小提醒 */}
      <Card className="mb-3">
        <CardBody>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-base font-bold text-dark">
              <Sparkles size={15} />{t.tips.title}
            </div>
            <Button
              variant="ghost" size="sm" aria-expanded={tipsOpen} aria-label={t.tips.title}
              onClick={() => setTipsOpen((v) => !v)}
            >
              {tipsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </Button>
          </div>
          {tipsOpen ? (
            <ul className="mt-2 flex list-disc flex-col gap-1 pl-4 text-xs text-neutral-700">
              {t.tips.items.map((item) => (
                <li key={item.term}>
                  <span className="font-semibold text-dark">{item.term}</span>
                  {item.text}
                </li>
              ))}
            </ul>
          ) : null}
        </CardBody>
      </Card>

      <DataTableContainer>
        <DataTableHeader
          title={t.tableTitle}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder={t.filters.keywordPlaceholder}
                className="w-full sm:w-56"
              />
              <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">{t.filters.statusAll}</option>
                {(Object.keys(t.status) as TripStatus[]).map((k) => (
                  <option key={k} value={k}>{t.status[k]}</option>
                ))}
              </Select>
              <Select value={midaoFilter} onChange={(e) => setMidaoFilter(e.target.value)}>
                <option value="">{t.filters.midaoAll}</option>
                {(Object.keys(t.midaoListing) as MidaoListing[]).map((k) => (
                  <option key={k} value={k}>{t.midaoListing[k]}</option>
                ))}
              </Select>
            </div>
          }
        />
        <DataTable
          columns={columns}
          rows={visible}
          loading={loading}
          rowKey={(r) => r.id}
          empty={
            <EmptyState
              icon={Route}
              title={t.empty.title}
              description={t.empty.description}
              action={<Button><Plus size={15} />{t.actions.create}</Button>}
            />
          }
        />
      </DataTableContainer>

      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={doDelete}
        title={t.confirm.deleteTitle}
        message={deleteTarget ? t.confirm.delete(deleteTarget.title) : ''}
        confirmText={t.actions.delete}
        danger
      />

      <ConfirmModal
        open={!!unpublishTarget}
        onClose={() => setUnpublishTarget(null)}
        onConfirm={doUnpublish}
        title={t.confirm.unpublishTitle}
        message={t.confirm.unpublish}
        confirmText={t.actions.unpublish}
        danger
      />

      <ConfirmModal
        open={!!midaoTarget}
        onClose={() => setMidaoTarget(null)}
        onConfirm={doRequestMidao}
        title={t.confirm.requestMidaoTitle}
        message={t.confirm.requestMidao}
        confirmText={t.actions.requestMidao}
      />
    </>
  );
}

function GuideTripsPage() {
  const [trips, setTrips] = React.useState<Trip[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      setTrips(await listTrips());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  return <GuideTripsView trips={trips} loading={loading} error={error} onRetry={() => { void load(); }} />;
}

export default function TripsPage() {
  const businessType = useBusinessType();
  return MODE_PRESETS[businessType].navigationProfile === 'GUIDE_FIVE'
    ? <GuideTripsPage />
    : <LegacyTripsPage />;
}
