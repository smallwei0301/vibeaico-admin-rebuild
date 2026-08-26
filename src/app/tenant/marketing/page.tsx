'use client';
import * as React from 'react';
import Link from 'next/link';
import { Eye, Pencil, Plus, Radio, Send, Trash2, XCircle } from 'lucide-react';
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
  CharCounter, FormError, FormGroup, FormText, Input, Label, Select, Textarea,
} from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { listMembershipLevels } from '@/services/catalog';
import { getDashboardStats } from '@/services/reports';
import {
  cancelPush, createPush, deletePush, listPushes, sendPush, updatePush,
  type MarketingPush, type PushStatus, type PushTargetType,
} from '@/services/marketing';
import { ApiError } from '@/lib/api';
import { common } from '@/i18n/zh-TW/common';
import { nav } from '@/i18n/zh-TW/nav';
import { marketingPage as t } from '@/i18n/zh-TW/pages/marketing';
import { formatDateTime } from '@/lib/utils';
import type { MembershipLevel } from '@/lib/types';

/* -------------------------------------------------------------------------- */
/* 型別與假資料都搬進 src/services/marketing.ts                                  */
/*                                                                            */
/* 原本這裡有 150 行的三組 mock 陣列，而頁面唯一的「資料來源」就是它們——連           */
/* 送出、取消、刪除都只是 setTimeout + toast。issue #7 (乙) 把它們接到              */
/* `/api/marketing/pushes*`，依「頁面永不 fetch」一律經 src/services/marketing.ts。 */
/* mock 分支的假資料原封搬進該 service，USE_MOCK=true 的畫面完全不變。             */
/* -------------------------------------------------------------------------- */
const STATUS_TONE: Record<PushStatus, 'neutral' | 'info' | 'primary' | 'success' | 'danger'> = {
  DRAFT: 'neutral',
  SCHEDULED: 'info',
  SENDING: 'primary',
  COMPLETED: 'success',
  FAILED: 'danger',
  CANCELLED: 'neutral',
};

const PAGE_SIZE = 20;

type PendingAction = { kind: 'delete' | 'cancel' | 'send'; push: MarketingPush };

/* -------------------------------------------------------------------------- */

export default function MarketingPage() {
  const toast = useToast();

  const [rows, setRows] = React.useState<MarketingPush[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [page, setPage] = React.useState(0);
  const [levels, setLevels] = React.useState<MembershipLevel[]>([]);
  const [quota, setQuota] = React.useState<{ used: number; total: number } | null>(null);

  const [formTarget, setFormTarget] = React.useState<MarketingPush | null | undefined>(undefined);
  const [viewTarget, setViewTarget] = React.useState<MarketingPush | null>(null);
  const [pending, setPending] = React.useState<PendingAction | null>(null);
  const [working, setWorking] = React.useState(false);

  /** GET /api/marketing/pushes（mock 分支＝service 內的三組假資料） */
  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listPushes());
    } catch (e) {
      toast.show(
        `${t.messages.loadPushesFailed}${e instanceof Error ? e.message : t.messages.unknownError}`,
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
        setLevels(await listMembershipLevels());
      } catch {
        toast.show(t.messages.loadLevelsFailed, 'danger');
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

  const targetText = (p: MarketingPush) =>
    p.targetType === 'ALL' || !p.targetLabel
      ? t.targetType[p.targetType]
      : t.labels.targetWithValue(t.targetType[p.targetType], p.targetLabel);

  /**
   * 刪除／取消／立即發送。
   *
   * ⚠️ 成功訊息一律在 `await` 真的回來之後才顯示（CLAUDE.md「成功 toast 是一項
   * 事實主張」）。「立即發送」尤其：`sendPush()` 會真的打 LINE multicast 並扣掉
   * 推播額度，回傳實際送出的人數——所以 toast 報的是後端算出來的那個數字，不是
   * 頁面猜的。額度不足或沒有符合條件的收件人時後端回 409，一則都不會送出，
   * 這裡把後端的原文顯示出來，不會有任何「已開始發送」。
   */
  const runPending = async () => {
    if (!pending) return;
    const { kind, push } = pending;
    setWorking(true);
    try {
      if (kind === 'delete') {
        await deletePush(push.id);
        toast.show(t.messages.deleted);
      } else if (kind === 'cancel') {
        await cancelPush(push.id);
        toast.show(t.messages.cancelled);
      } else {
        const { sentCount } = await sendPush(push.id);
        toast.show(t.messages.sent(sentCount));
      }
      setPending(null);
      await load();
    } catch (e) {
      const detail = e instanceof ApiError ? e.message
        : e instanceof Error ? e.message : t.messages.retryLater;
      toast.show(
        kind === 'delete' ? `${t.messages.deleteFailed}：${detail}`
          : kind === 'cancel' ? `${t.messages.cancelFailed}：${detail}`
            : `${t.messages.sendFailedPrefix}${detail}`,
        'danger',
      );
    } finally {
      setWorking(false);
    }
  };

  const columns: Column<MarketingPush>[] = [
    {
      key: 'title', header: t.columns.title,
      render: (p) => (
        <div className="min-w-0">
          <div className="font-semibold text-dark">{p.title}</div>
          <div className="text-2xs text-secondary">
            {p.sentAt
              ? t.labels.sentAt(formatDateTime(p.sentAt))
              : p.scheduledAt
                ? t.labels.scheduledAt(formatDateTime(p.scheduledAt))
                : formatDateTime(p.createdAt)}
          </div>
        </div>
      ),
    },
    {
      key: 'target', header: t.columns.target, width: '160px',
      render: (p) => <Badge tone="info">{targetText(p)}</Badge>,
    },
    {
      /**
       * 預估人數。真實模式沒有這個數字（沒有「試算受眾」端點，名單是發送當下才
       * 算的），service 回 null → 顯示「--」並附上說明。填 0 會讓「沒有人」與
       * 「我們沒有在算」長得一模一樣，那正是 CLAUDE.md 禁止的捏造已知。
       */
      key: 'estimated', header: t.columns.estimated, numeric: true, width: '110px',
      render: (p) => (p.estimatedCount === null
        ? <span className="text-muted" title={t.labels.estimatedUnknownHint}>{t.labels.unknownValue}</span>
        : t.labels.people(p.estimatedCount)),
    },
    {
      key: 'result', header: t.columns.result, width: '140px',
      render: (p) => (p.sentCount || p.failedCount ? (
        <div className="flex flex-col items-start gap-0.5">
          <span className="text-success">{t.labels.resultSuccess(p.sentCount)}</span>
          {p.failedCount ? (
            <span className="text-danger">{t.labels.resultFailed(p.failedCount)}</span>
          ) : null}
        </div>
      ) : <span className="text-muted">{t.labels.notSent}</span>),
    },
    {
      key: 'status', header: t.columns.status, width: '110px',
      render: (p) => <Badge tone={STATUS_TONE[p.status]}>{t.status[p.status]}</Badge>,
    },
    {
      key: 'actions', header: t.columns.actions, width: '190px',
      render: (p) => (
        <div className="btn-group">
          <Button
            variant="outline" size="sm" title={t.actions.view} aria-label={t.actions.view}
            onClick={() => setViewTarget(p)}
          >
            <Eye size={13} />
          </Button>
          {p.status === 'DRAFT' || p.status === 'SCHEDULED' ? (
            <Button
              variant="outline" size="sm" title={t.actions.edit} aria-label={t.actions.edit}
              onClick={() => setFormTarget(p)}
            >
              <Pencil size={13} />
            </Button>
          ) : null}
          {p.status === 'DRAFT' ? (
            <Button
              variant="outline" size="sm" title={t.actions.send} aria-label={t.actions.send}
              onClick={() => setPending({ kind: 'send', push: p })}
            >
              <Send size={13} />
            </Button>
          ) : null}
          {p.status === 'SCHEDULED' ? (
            <Button
              variant="outline" size="sm" title={t.actions.cancelPush} aria-label={t.actions.cancelPush}
              onClick={() => setPending({ kind: 'cancel', push: p })}
            >
              <XCircle size={13} />
            </Button>
          ) : null}
          <Button
            variant="outlineDanger" size="sm" title={t.actions.delete} aria-label={t.actions.delete}
            onClick={() => setPending({ kind: 'delete', push: p })}
          >
            <Trash2 size={13} />
          </Button>
        </div>
      ),
    },
  ];

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

      <Alert tone="info" className="mb-3" title={t.intro.heading}>
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
          <Link className="underline" href="/tenant/campaigns">{t.intro.crossLink}</Link>
          {t.intro.crossTail}
        </p>
      </Alert>

      <Alert tone="neutral" icon={false} className="mb-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {t.statusLegend.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5">
              <Badge tone={STATUS_TONE[s.key as PushStatus]}>{s.name}</Badge>
              <span className="text-xs text-secondary">{s.desc}</span>
            </span>
          ))}
        </div>
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
          rowKey={(p) => p.id}
          scroll
          empty={
            <EmptyState
              icon={Radio}
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
          * 「共 0 筆」——那是一個「已知的答案」被拿來當「還不知道」用（#34 / #17
          * 同一個坑）。DataTable 自己的 loading 狀態已經蓋掉表身，頁尾也一起等。
          */}
        {loading ? null : (
          <DataTableFooter>
            <Pagination page={page} size={PAGE_SIZE} total={rows.length} onChange={setPage} />
          </DataTableFooter>
        )}
      </DataTableContainer>

      <PushFormModal
        open={formTarget !== undefined}
        push={formTarget ?? null}
        levels={levels}
        onClose={() => setFormTarget(undefined)}
        onSaved={async (edited) => {
          setFormTarget(undefined);
          toast.show(edited ? t.messages.updated : t.messages.created);
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
              <dt className="form-label">{t.form.title}</dt>
              <dd className="text-base text-dark">{viewTarget.title}</dd>
            </div>
            <div>
              <dt className="form-label">{t.columns.status}</dt>
              <dd><Badge tone={STATUS_TONE[viewTarget.status]}>{t.status[viewTarget.status]}</Badge></dd>
            </div>
            <div>
              <dt className="form-label">{t.columns.target}</dt>
              <dd className="text-base text-dark">{targetText(viewTarget)}</dd>
            </div>
            <div>
              <dt className="form-label">{t.columns.estimated}</dt>
              <dd className="text-base tabular-nums text-dark">
                {viewTarget.estimatedCount === null
                  ? <span className="text-muted">{t.labels.estimatedUnknown}</span>
                  : t.labels.people(viewTarget.estimatedCount)}
              </dd>
            </div>
            <div className="md:col-span-2">
              <dt className="form-label">{t.form.content}</dt>
              <dd className="whitespace-pre-wrap text-base text-dark">{viewTarget.content}</dd>
            </div>
            <div className="md:col-span-2">
              <dt className="form-label">{t.form.image}</dt>
              <dd className="text-base text-dark">
                {viewTarget.imageUrl || <span className="text-muted">{t.labels.noImage}</span>}
              </dd>
            </div>
            <div className="md:col-span-2">
              <dt className="form-label">{t.form.note}</dt>
              <dd className="text-base text-dark">
                {viewTarget.note || <span className="text-muted">{common.none}</span>}
              </dd>
            </div>
            <div className="md:col-span-2">
              <dt className="form-label">{t.columns.result}</dt>
              <dd className="text-base tabular-nums text-dark">
                {viewTarget.sentCount
                  ? t.labels.resultSuccess(viewTarget.sentCount)
                  : t.labels.notSent}
                {viewTarget.failedCount
                  ? ` / ${t.labels.resultFailed(viewTarget.failedCount)}`
                  : ''}
              </dd>
            </div>
          </dl>
        ) : null}
      </Modal>

      <ConfirmModal
        open={!!pending}
        loading={working}
        danger={pending?.kind !== 'send'}
        title={
          pending?.kind === 'delete' ? t.confirm.deleteTitle
            : pending?.kind === 'cancel' ? t.confirm.cancelTitle
              : t.confirm.sendTitle
        }
        confirmText={
          pending?.kind === 'delete' ? common.delete
            : pending?.kind === 'cancel' ? common.confirmText
              : t.actions.send
        }
        message={
          pending?.kind === 'delete' ? t.confirm.delete
            : pending?.kind === 'cancel' ? t.confirm.cancelPush
              : t.confirm.send
        }
        onClose={() => setPending(null)}
        onConfirm={() => void runPending()}
      />
    </>
  );
}

/* ========================================================================== */
/* 建立 / 編輯推播                                                             */
/* ========================================================================== */

function PushFormModal({
  open, push, levels, onClose, onSaved,
}: {
  open: boolean;
  push: MarketingPush | null;
  levels: MembershipLevel[];
  onClose: () => void;
  onSaved: (edited: boolean) => void | Promise<void>;
}) {
  const toast = useToast();
  const isEdit = !!push;

  const [title, setTitle] = React.useState('');
  const [content, setContent] = React.useState('');
  const [targetType, setTargetType] = React.useState<PushTargetType>('ALL');
  const [targetValue, setTargetValue] = React.useState('');
  const [customTargets, setCustomTargets] = React.useState('');
  const [imageUrl, setImageUrl] = React.useState('');
  const [scheduledAt, setScheduledAt] = React.useState('');
  const [note, setNote] = React.useState('');
  const [error, setError] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setError('');
    setTitle(push?.title ?? '');
    setContent(push?.content ?? '');
    setTargetType(push?.targetType ?? 'ALL');
    setTargetValue(push?.targetType === 'MEMBERSHIP_LEVEL' ? push.targetValue : '');
    setCustomTargets(push?.targetType === 'CUSTOM' ? push.targetValue : '');
    setImageUrl(push?.imageUrl ?? '');
    setScheduledAt(push?.scheduledAt ? push.scheduledAt.slice(0, 16) : '');
    setNote(push?.note ?? '');
  }, [open, push]);


  const validate = (): string => {
    if (!title.trim()) return t.form.titleRequired;
    if (!content.trim()) return t.form.contentRequired;
    if (content.length > t.form.contentMax) return common.validation.maxLength(t.form.contentMax);
    if (targetType === 'MEMBERSHIP_LEVEL' && !targetValue) return t.form.targetValueRequired;
    if (targetType === 'CUSTOM' && !customTargets.trim()) return t.form.customTargetsRequired;
    return '';
  };

  /**
   * 建立／編輯推播 —— POST 或 PUT `/api/marketing/pushes`。
   * 成功 toast 由 onSaved() 在 await 回來之後才顯示（CLAUDE.md 鐵則）；
   * 失敗時把後端訊息原文帶出來（例如「此推播已發送或取消，無法編輯」）。
   */
  const submit = async () => {
    const err = validate();
    setError(err);
    if (err) { toast.show(err, 'warning'); return; }
    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        content,
        imageUrl,
        note,
        targetType,
        targetValue: targetType === 'MEMBERSHIP_LEVEL' ? targetValue
          : targetType === 'CUSTOM' ? customTargets : '',
        targetLabel: targetType === 'MEMBERSHIP_LEVEL'
          ? (levels.find((l) => l.id === targetValue)?.name ?? '')
          : '',
        // datetime-local 沒有時區，補上台北時區才是後端 zod 收的 ISO 8601 offset 格式
        scheduledAt: scheduledAt ? `${scheduledAt}:00+08:00` : null,
      };
      if (push) await updatePush(push.id, payload);
      else await createPush(payload);
      await onSaved(!!push);
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
      <FormGroup>
        <Label required htmlFor="pushTitle">{t.form.title}</Label>
        <Input
          id="pushTitle" value={title} placeholder={t.form.titlePlaceholder}
          onChange={(e) => setTitle(e.target.value)}
        />
      </FormGroup>

      <FormGroup>
        <Label required htmlFor="pushContent">{t.form.content}</Label>
        <Textarea
          id="pushContent" rows={4} value={content} maxLength={t.form.contentMax}
          placeholder={t.form.contentPlaceholder}
          onChange={(e) => setContent(e.target.value)}
        />
        <div className="flex items-center justify-between">
          <FormText>{t.form.contentHelp}</FormText>
          <CharCounter value={content} max={t.form.contentMax} />
        </div>
      </FormGroup>

      <FormGroup>
        <Label required htmlFor="pushTargetType">{t.form.targetType}</Label>
        <Select
          id="pushTargetType" value={targetType}
          onChange={(e) => setTargetType(e.target.value as PushTargetType)}
        >
          {t.form.targetTypeOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>
      </FormGroup>

      {targetType === 'MEMBERSHIP_LEVEL' ? (
        <FormGroup>
          <Label htmlFor="pushTargetValue">{t.form.targetValue}</Label>
          <Select
            id="pushTargetValue" value={targetValue}
            onChange={(e) => setTargetValue(e.target.value)}
          >
            <option value="">{t.form.targetValuePlaceholder}</option>
            {levels.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </Select>
        </FormGroup>
      ) : null}

      {targetType === 'CUSTOM' ? (
        <FormGroup>
          <Label htmlFor="pushCustomTargets">{t.form.customTargets}</Label>
          <Textarea
            id="pushCustomTargets" rows={3} value={customTargets}
            placeholder={t.form.customTargetsPlaceholder}
            onChange={(e) => setCustomTargets(e.target.value)}
          />
        </FormGroup>
      ) : null}

      {/*
        * ⚠️ 檔案選擇器**停用**（issue #7 (乙) 接線這一輪）。
        * 它原本會把檔名記進 imageName 就沒了——沒有上傳、沒有 service、送出時也
        * 不會帶走，等於使用者選了一張圖、畫面顯示檔名，然後那張圖被靜靜丟掉。
        * 在整頁其餘動作都變成真的之後，這種控制項比先前更危險（旁邊的東西都真的
        * 生效了，只有它沒有）。依 CLAUDE.md「placeholder 必須在使用者讀得到的地方
        * 說明」，這裡是停用＋說明，不是刪除；真正的上傳鏈路由後續 issue 補。
        * 目前唯一會隨推播送出的圖片來源是下面那個網址欄位（後端 content.imageUrl）。
        * 禁止在沒有接上 /api/upload 之前把 disabled 拿掉。
        */}
      <FormGroup>
        <Label htmlFor="pushImageInput">{t.form.image}</Label>
        <Input id="pushImageInput" type="file" accept="image/*" disabled />
        <FormText>{t.form.imageFormatHint}</FormText>
        <Alert tone="warning" className="mt-2">{t.form.imageUploadNotWired}</Alert>
      </FormGroup>

      <FormGroup>
        <Label htmlFor="pushImageUrl">{t.form.imageUrl}</Label>
        <Input
          id="pushImageUrl" type="url" value={imageUrl}
          placeholder={t.form.imageUrlPlaceholder}
          onChange={(e) => setImageUrl(e.target.value)}
        />
        <FormText>{t.form.imageUrlHelp}</FormText>
      </FormGroup>

      <FormGroup>
        <Label htmlFor="pushScheduledAt">{t.form.scheduledAt}</Label>
        <Input
          id="pushScheduledAt" type="datetime-local" value={scheduledAt}
          onChange={(e) => setScheduledAt(e.target.value)}
        />
        <FormText>{t.form.scheduledAtHelp}</FormText>
      </FormGroup>

      <FormGroup>
        <Label htmlFor="pushNote">{t.form.note}</Label>
        <Input
          id="pushNote" value={note} placeholder={t.form.notePlaceholder}
          onChange={(e) => setNote(e.target.value)}
        />
      </FormGroup>

      {error ? <FormError>{error}</FormError> : null}
    </Modal>
  );
}
