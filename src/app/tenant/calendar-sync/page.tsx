'use client';
import * as React from 'react';
import {
  CalendarPlus, ClipboardCopy, Clock, Info, KeyRound, Plus, RotateCcw, Trash2, UserCog,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { Card, CardBody } from '@/components/ui/Card';
import { ConfirmModal } from '@/components/ui/Modal';
import { FormGroup, FormText, Input, Label } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { common } from '@/i18n/zh-TW/common';
import { nav } from '@/i18n/zh-TW/nav';
import { calendarSyncPage as t } from '@/i18n/zh-TW/pages/calendar-sync';
import { APP_URL } from '@/config/env';
import { useCurrentTenant } from '@/components/layout/BusinessTypeContext';
import { formatDateTime } from '@/lib/utils';
import {
  listExternalCalendars, createExternalCalendar, deleteExternalCalendar,
  type ExternalCalendarSubscription,
} from '@/services/external-calendars';
import { ApiError } from '@/lib/api';



/** 訂閱網址：原站由 /api/settings/calendar 取得（含密鑰 token） */
const INITIAL_ICS_TOKEN = 'a1b2c3d4e5f6a7b8';
const buildIcsUrl = (shopCode: string, token: string) =>
  `${APP_URL.replace(/\/$/, '')}/ics/${shopCode}/${token}.ics`;

/** 重新產生時使用（避免 render 期呼叫 Math.random 造成 hydration 不一致） */
const REGENERATED_TOKENS = ['b7c8d9e0f1a2b3c4', 'c9d0e1f2a3b4c5d6', 'd1e2f3a4b5c6d7e8'];

const LAST_SYNC_AT = '2026-08-20T09:15:00+08:00';

/* -------------------------------------------------------------------------- */

export default function CalendarSyncPage() {
  const toast = useToast();

  const [icsToken, setIcsToken] = React.useState(INITIAL_ICS_TOKEN);
  const [regenCount, setRegenCount] = React.useState(0);
  const [lastSyncAt, setLastSyncAt] = React.useState<string | null>(LAST_SYNC_AT);
  const [confirmRegen, setConfirmRegen] = React.useState(false);
  const [regenBusy, setRegenBusy] = React.useState(false);

  const [externals, setExternals] = React.useState<ExternalCalendarSubscription[]>([]);
  const [loadingExternals, setLoadingExternals] = React.useState(true);
  const [name, setName] = React.useState('');
  const [url, setUrl] = React.useState('');
  const [adding, setAdding] = React.useState(false);
  const [deleting, setDeleting] = React.useState<ExternalCalendarSubscription | null>(null);
  const [deletingBusy, setDeletingBusy] = React.useState(false);

  const currentTenant = useCurrentTenant();
  const icsUrl = buildIcsUrl(currentTenant.shopCode, icsToken);
  const googleUrl = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(icsUrl)}`;

  const reloadExternals = React.useCallback(async () => {
    setLoadingExternals(true);
    try {
      setExternals(await listExternalCalendars());
    } catch {
      toast.show(t.messages.loadFailed, 'danger');
    } finally {
      setLoadingExternals(false);
    }
  }, [toast]);

  React.useEffect(() => {
    void reloadExternals();
  }, [reloadExternals]);

  const copy = async (text: string, message: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.show(message);
    } catch {
      toast.show(t.messages.networkError, 'warning');
    }
  };

  const addExternal = async () => {
    if (!name.trim()) { toast.show(t.external.nameRequired, 'warning'); return; }
    if (!url.trim()) { toast.show(t.external.urlRequired, 'warning'); return; }
    setAdding(true);
    try {
      await createExternalCalendar({ name: name.trim(), icsUrl: url.trim() });
      setName(''); setUrl('');
      toast.show(t.external.added);
      await reloadExternals();
    } catch (e) {
      toast.show(`${t.external.addFailed}：${e instanceof ApiError ? e.message : t.messages.unknownError}`, 'danger');
    } finally {
      setAdding(false);
    }
  };

  return (
    <>
      <PageHeader eyebrow={nav.navBooking} title={t.title} />

      {/* ------------------------------------------------------------ 訂閱網址 */}
      <Card className="mb-4">
        <CardBody>
          <FormGroup>
            <Label htmlFor="calIcsUrl">{t.subscribe.urlLabel}</Label>
            <div className="input-group">
              <Input id="calIcsUrl" readOnly value={icsUrl} className="font-mono" />
              <Button
                variant="outline" aria-label={t.subscribe.copy}
                onClick={() => void copy(icsUrl, t.subscribe.copied)}
              >
                <ClipboardCopy size={14} />
              </Button>
            </div>
          </FormGroup>

          <div className="flex flex-wrap items-center gap-2">
            <a href={googleUrl} target="_blank" rel="noreferrer" className="btn btn-primary btn-lg">
              <CalendarPlus size={18} />
              {t.subscribe.google}
            </a>
            <Button variant="outlineDanger" size="sm" onClick={() => setConfirmRegen(true)}>
              <RotateCcw size={13} />
              {t.subscribe.regenerate}
            </Button>
            <span className="text-xs text-secondary">
              {t.subscribe.lastSync}：
              {lastSyncAt ? formatDateTime(lastSyncAt) : t.subscribe.neverSynced}
            </span>
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* -------------------------------------------- 如何加入 Google Calendar */}
        <Card>
          <CardBody>
            <h6 className="mb-3 flex items-center gap-2 text-md font-bold">
              <Info size={16} className="text-primary" />
              {t.howTo.title}
            </h6>
            <ol className="ml-4 list-decimal text-base text-neutral-700">
              {t.howTo.steps.map((s) => <li key={s} className="mb-1">{s}</li>)}
            </ol>

            <h6 className="mb-2 mt-4 flex items-center gap-2 text-md font-bold">
              <Clock size={16} className="text-primary" />
              {t.howTo.frequencyTitle}
            </h6>
            <p className="text-base text-neutral-700">{t.howTo.frequencyBody}</p>

            <h6 className="mb-2 mt-4 flex items-center gap-2 text-md font-bold">
              <UserCog size={16} className="text-primary" />
              {t.howTo.staffTitle}
            </h6>
            <p className="text-base text-neutral-700">{t.howTo.staffBody}</p>
          </CardBody>
        </Card>

        {/* ---------------------------------------------------- 匯入外部行事曆 */}
        <Card>
          <CardBody>
            <h5 className="mb-1 flex items-center gap-2 text-lg font-bold">
              <CalendarPlus size={18} className="text-primary" />
              {t.external.title}
            </h5>
            <FormText className="mb-3">{t.external.description}</FormText>

            <FormGroup>
              <Label htmlFor="extName">{t.external.name}</Label>
              <Input
                id="extName" className="form-control-sm" value={name}
                placeholder={t.external.namePlaceholder}
                onChange={(e) => setName(e.target.value)}
              />
            </FormGroup>
            <FormGroup>
              <Label htmlFor="extUrl">{t.external.url}</Label>
              <Input
                id="extUrl" type="url" className="form-control-sm" value={url}
                placeholder={t.external.urlPlaceholder}
                onChange={(e) => setUrl(e.target.value)}
              />
            </FormGroup>
            <Button size="sm" loading={adding} loadingText={common.processing} onClick={() => void addExternal()}>
              <Plus size={13} />{t.external.add}
            </Button>

            <div className="mt-4 border-t border-neutral-200 pt-3">
              {loadingExternals ? (
                <div className="py-8 text-center text-secondary">{common.loading}</div>
              ) : externals.length === 0 ? (
                <div className="py-8 text-center text-secondary">{t.external.empty}</div>
              ) : (
                <ul className="flex flex-col gap-2">
                  {externals.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-neutral-50 p-3">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-base font-semibold text-dark">{c.name}</div>
                        <div className="truncate text-xs text-secondary">{c.icsUrl}</div>
                      </div>
                      {c.lastSyncStatus === 'ERROR' ? (
                        <Badge tone="danger">{t.external.syncStatus.error(c.lastSyncError ?? '')}</Badge>
                      ) : c.lastSyncStatus === 'OK' && c.lastSyncedAt ? (
                        <Badge tone="success">{t.external.syncStatus.ok(formatDateTime(c.lastSyncedAt))}</Badge>
                      ) : (
                        <Badge tone="neutral">{t.external.syncStatus.neverSynced}</Badge>
                      )}
                      <Button
                        size="sm" variant="outlineDanger" aria-label={common.delete}
                        onClick={() => setDeleting(c)}
                      >
                        <Trash2 size={13} />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardBody>
        </Card>
      </div>

      {/* ------------------------------------------- 怎麼拿 Google 的 ICS 網址 */}
      <Card className="mt-4">
        <CardBody>
          <h6 className="mb-2 flex items-center gap-2 text-md font-bold">
            <KeyRound size={16} className="text-primary" />
            {t.icsHowTo.title}
          </h6>
          <ol className="ml-4 list-decimal text-base text-neutral-700">
            {t.icsHowTo.steps.map((s) => <li key={s} className="mb-1">{s}</li>)}
          </ol>
          <Alert tone="warning" className="mt-3">{t.icsHowTo.warning}</Alert>
        </CardBody>
      </Card>

      <ConfirmModal
        open={confirmRegen}
        danger
        loading={regenBusy}
        title={t.subscribe.regenerate}
        message={<span className="whitespace-pre-line">{t.subscribe.regenerateConfirm}</span>}
        onClose={() => setConfirmRegen(false)}
        onConfirm={async () => {
          setRegenBusy(true);
          try {
            await new Promise((r) => setTimeout(r, 400));
            setIcsToken(REGENERATED_TOKENS[regenCount % REGENERATED_TOKENS.length]);
            setRegenCount((n) => n + 1);
            setLastSyncAt(null);
            toast.show(t.subscribe.regenerated);
          } catch {
            toast.show(t.subscribe.regenerateFailed, 'danger');
          } finally {
            setRegenBusy(false);
            setConfirmRegen(false);
          }
        }}
      />

      <ConfirmModal
        open={!!deleting}
        danger
        loading={deletingBusy}
        title={common.delete}
        confirmText={common.delete}
        message={
          <span className="whitespace-pre-line">
            {deleting ? t.external.deleteConfirm(deleting.name) : ''}
          </span>
        }
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          setDeletingBusy(true);
          try {
            await deleteExternalCalendar(deleting.id);
            toast.show(t.external.deleted);
            setDeleting(null);
            await reloadExternals();
          } catch (e) {
            toast.show(`${t.external.deleteFailed}：${e instanceof ApiError ? e.message : t.messages.unknownError}`, 'danger');
          } finally {
            setDeletingBusy(false);
          }
        }}
      />
    </>
  );
}
