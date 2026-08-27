'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  CalendarDays, ChevronDown, ChevronUp, Copy, ExternalLink, Eye, EyeOff,
  Layers, MapPin, Pencil, Plus, Route, Send, Sparkles, Trash2, Upload,
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
import { ConfirmModal, Modal } from '@/components/ui/Modal';
import { FormGroup, FormText, Input, Label, Select } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import {
  createTrip, deleteTrip, duplicateTrip, importTripsJson, listTrips, publishTrip, requestMidaoListing,
} from '@/services/tours';
import { common } from '@/i18n/zh-TW/common';
import { navLabel } from '@/i18n/zh-TW/nav';
import { useBusinessType, useCurrentTenant } from '@/components/layout/BusinessTypeContext';
import { tripsPage as t } from '@/i18n/zh-TW/pages/trips';
import { APP_URL } from '@/config/env';
import { buildPublicBookingUrl } from '@/config/tenant-settings';
import { formatCurrency, formatNumber } from '@/lib/utils';
import type { MidaoListing, Trip, TripStatus } from '@/lib/types';

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

export default function TripsPage() {
  const toast = useToast();
  const router = useRouter();
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

  /** 有寫入請求在飛：確認鈕轉圈並鎖住，避免重複送出 */
  const [busy, setBusy] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const importInputRef = React.useRef<HTMLInputElement>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [draft, setDraft] = React.useState({ title: '', slug: '', region: '', category: '' });

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

  /**
   * 以下每一個寫入動作都是 **await 成功之後**才更新畫面與 toast
   * （00 鐵則 12）：修改前它們只改本地 state，重新整理就會打回原形，
   * 而使用者已經看到「行程已發布」了。
   * 一律用端點回傳的那一份資料回填，不是自己手上的草稿——後端可能重算
   * 欄位（slug、狀態），用草稿回填會讓畫面與資料庫短暫不一致。
   */
  const failMessage = (e: unknown) =>
    (e instanceof Error && e.message ? e.message : t.messages.actionFailed);

  const replaceRow = (next: Trip) =>
    setRows((prev) => prev.map((r) => (r.id === next.id ? { ...r, ...next } : r)));

  /** 只切換商店頁可見性；Midao 前台不受影響 */
  const togglePublish = async (trip: Trip) => {
    if (trip.status === 'PUBLISHED') { setUnpublishTarget(trip); return; }
    setBusy(true);
    try {
      replaceRow(await publishTrip(trip.id, true));
      toast.show(t.messages.published);
    } catch (e) {
      toast.show(failMessage(e), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const doUnpublish = async () => {
    if (!unpublishTarget) return;
    setBusy(true);
    try {
      replaceRow(await publishTrip(unpublishTarget.id, false));
      setUnpublishTarget(null);
      toast.show(t.messages.unpublished);
    } catch (e) {
      toast.show(failMessage(e), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const doRequestMidao = async () => {
    if (!midaoTarget) return;
    setBusy(true);
    try {
      replaceRow(await requestMidaoListing(midaoTarget.id));
      setMidaoTarget(null);
      toast.show(t.messages.midaoRequested);
    } catch (e) {
      toast.show(failMessage(e), 'danger');
    } finally {
      setBusy(false);
    }
  };

  /**
   * 刪除：後端對「已有訂單的行程」會改為封存而不是刪除，回傳 `archived: true`
   * 與一句說明。畫面必須照著分：封存的行程**留在清單上並改狀態**，
   * 訊息也用後端那一句，否則會出現「顯示已刪除、重整後它還在」。
   */
  const doDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      const res = await deleteTrip(deleteTarget.id);
      if (res.archived) {
        setRows((prev) => prev.map((r) => (
          r.id === deleteTarget.id ? { ...r, ...(res.trip ?? {}), status: 'ARCHIVED' } : r
        )));
        toast.show(res.message ?? t.messages.archived, 'warning');
      } else {
        setRows((prev) => prev.filter((r) => r.id !== deleteTarget.id));
        toast.show(t.messages.deleted);
      }
      setDeleteTarget(null);
    } catch (e) {
      toast.show(failMessage(e), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const duplicate = async (trip: Trip) => {
    setBusy(true);
    try {
      const copy = await duplicateTrip(trip.id);
      setRows((prev) => [copy, ...prev]);
      toast.show(t.messages.duplicated);
    } catch (e) {
      toast.show(failMessage(e), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const submitCreate = async () => {
    if (!draft.title.trim()) return;
    setBusy(true);
    try {
      const created = await createTrip({
        title: draft.title.trim(),
        slug: draft.slug.trim() || undefined,
        region: draft.region.trim(),
        category: draft.category.trim(),
      });
      toast.show(t.messages.created);
      setCreateOpen(false);
      setDraft({ title: '', slug: '', region: '', category: '' });
      // 建立後直接進編輯頁補齊其餘欄位（列表頁沒有那些欄位的表單）
      router.push(`/tenant/trips/${created.id}`);
    } catch (e) {
      toast.show(failMessage(e), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const importJson = async (file: File) => {
    setImporting(true);
    try {
      const payload = JSON.parse(await file.text()) as unknown;
      const result = await importTripsJson(payload);
      if (!result) toast.show(t.messages.importNotDownloaded, 'warning');
      else {
        toast.show(t.messages.imported);
        await load();
      }
    } catch (e) {
      toast.show(e instanceof SyntaxError ? t.messages.importInvalid : failMessage(e), 'danger');
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = '';
    }
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
            disabled={busy}
            onClick={() => { void togglePublish(r); }}
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
            disabled={busy}
            onClick={() => { void duplicate(r); }}
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
            <input ref={importInputRef} type="file" accept="application/json,.json" className="hidden"
              aria-label={t.actions.importJson} onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void importJson(file);
              }} />
            <Button variant="outline" loading={importing} onClick={() => importInputRef.current?.click()}>
              <Upload size={15} />{t.actions.importJson}
            </Button>
            <Link href={publicShopUrl} target="_blank">
              <Button variant="outline">
                <ExternalLink size={15} />{t.actions.viewShop}
              </Button>
            </Link>
            <Button onClick={() => setCreateOpen(true)}>
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
              action={(
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus size={15} />{t.actions.create}
                </Button>
              )}
            />
          }
        />
      </DataTableContainer>

      <ConfirmModal
        open={!!deleteTarget}
        loading={busy}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => { void doDelete(); }}
        title={t.confirm.deleteTitle}
        message={deleteTarget ? t.confirm.delete(deleteTarget.title) : ''}
        confirmText={t.actions.delete}
        danger
      />

      <ConfirmModal
        open={!!unpublishTarget}
        loading={busy}
        onClose={() => setUnpublishTarget(null)}
        onConfirm={() => { void doUnpublish(); }}
        title={t.confirm.unpublishTitle}
        message={t.confirm.unpublish}
        confirmText={t.actions.unpublish}
        danger
      />

      <ConfirmModal
        open={!!midaoTarget}
        loading={busy}
        onClose={() => setMidaoTarget(null)}
        onConfirm={() => { void doRequestMidao(); }}
        title={t.confirm.requestMidaoTitle}
        message={t.confirm.requestMidao}
        confirmText={t.actions.requestMidao}
      />

      {/* ================================================== 新增行程 */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={t.createForm.title}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>{common.cancel}</Button>
            <Button
              loading={busy}
              disabled={!draft.title.trim()}
              onClick={() => { void submitCreate(); }}
            >
              {t.createForm.submit}
            </Button>
          </>
        )}
      >
        <div className="flex flex-col gap-3">
          <FormText>{t.createForm.hint}</FormText>

          <FormGroup>
            <Label required>{t.form.titleLabel}</Label>
            <Input
              value={draft.title}
              placeholder={t.form.titlePlaceholder}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </FormGroup>

          <FormGroup>
            <Label>{t.form.slugLabel}</Label>
            <Input
              value={draft.slug}
              placeholder={t.form.slugPlaceholder}
              onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
            />
            <FormText>{t.form.slugHelp}</FormText>
          </FormGroup>

          <div className="grid gap-3 sm:grid-cols-2">
            <FormGroup>
              <Label>{t.form.regionLabel}</Label>
              <Input
                value={draft.region}
                placeholder={t.form.regionPlaceholder}
                onChange={(e) => setDraft({ ...draft, region: e.target.value })}
              />
            </FormGroup>
            <FormGroup>
              <Label>{t.form.categoryLabel}</Label>
              <Input
                value={draft.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value })}
              />
            </FormGroup>
          </div>
        </div>
      </Modal>
    </>
  );
}
