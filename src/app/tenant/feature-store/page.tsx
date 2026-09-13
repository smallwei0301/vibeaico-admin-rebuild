'use client';
import * as React from 'react';
import Link from 'next/link';
import { Check, Package, Puzzle, RotateCcw, Wallet, X } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { Card, CardBody } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmModal, Modal } from '@/components/ui/Modal';
import { FormGroup, Label, Select, Switch } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { applyFeature, cancelFeature, listFeatures, restoreFeature, type FeatureRestoreResult } from '@/services/settings';
import { getPointBalance } from '@/services/points';
import { ApiError } from '@/lib/api';
import {
  FEATURE_CATALOG, FEATURE_CODES, type FeatureCode, type FeatureSubscription,
} from '@/config/features';
import { common } from '@/i18n/zh-TW/common';
import { nav } from '@/i18n/zh-TW/nav';
import { featureStorePage as t } from '@/i18n/zh-TW/pages/feature-store';
import { formatDate, formatNumber } from '@/lib/utils';

/* -------------------------------------------------------------------------- */
/* 本頁專用假資料（不寫進 src/mock，避免與其他頁面衝突）                          */
/* -------------------------------------------------------------------------- */

type FeatureKey = keyof typeof t.features;

/**
 * 功能目錄（22 項：key/category/price/paid）已依 09 分冊 §1 移入
 * `src/config/features.ts` 的 `FEATURE_CATALOG`（鐵則 1 的核准例外，只搬常數不動 UI）。
 * 訂閱狀態不放目錄裡 —— 由 listFeatures() 提供（僅 config/features.ts 的 10 個代碼有）。
 * 其餘 8 項付費功能在骨架階段一律視為未訂閱。
 */
type CatalogItem = (typeof FEATURE_CATALOG)[number];

/** 目錄鍵同時是 config/features.ts 的訂閱代碼時，才有真實訂閱狀態 */
const SUBSCRIBABLE_CODES = new Set<string>(FEATURE_CODES);

const isFeatureCode = (key: FeatureKey): key is FeatureKey & FeatureCode =>
  SUBSCRIBABLE_CODES.has(key);

/** 原站以 subscription.cancelledAt 標記「已取消但到期前仍可用」；骨架階段用固定清單 */
const CANCELLED_FEATURE_KEYS = new Set<FeatureKey>(['KEYWORD_REPLY']);

/** 可選訂閱月數 */
const MONTH_OPTIONS = [1, 3, 6, 12];

/** 儲值建議金額以 100 點為單位無條件進位（原站行為） */
const suggestTopup = (short: number) => Math.max(100, Math.ceil(short / 100) * 100);

const CATEGORY_KEYS = Object.keys(t.filters) as (keyof typeof t.filters)[];

/* -------------------------------------------------------------------------- */

type PendingKind = 'cancel' | 'restore';

export default function FeatureStorePage() {
  const toast = useToast();

  const [subs, setSubs] = React.useState<FeatureSubscription[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [balance, setBalance] = React.useState<number | null>(null);
  /** 剩餘天數需要「現在」；render 期不碰 Date，改在 effect 內取一次 */
  const [todayIso, setTodayIso] = React.useState<string | null>(null);

  const [category, setCategory] = React.useState<keyof typeof t.filters>('ALL');
  const [onlyUnsubscribed, setOnlyUnsubscribed] = React.useState(false);

  const [subscribeTarget, setSubscribeTarget] = React.useState<CatalogItem | null>(null);
  const [noticeTarget, setNoticeTarget] = React.useState<CatalogItem | null>(null);
  const [months, setMonths] = React.useState(1);
  const [shortOf, setShortOf] = React.useState<{ item: CatalogItem; months: number } | null>(null);
  const [pending, setPending] = React.useState<{ kind: PendingKind; item: CatalogItem } | null>(null);
  const [working, setWorking] = React.useState(false);

  React.useEffect(() => { setTodayIso(new Date().toISOString()); }, []);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [subs, { balance: bal }] = await Promise.all([listFeatures(), getPointBalance()]);
      setSubs(subs);
      setBalance(bal);
    } catch (e) {
      toast.show(
        `${t.messages.loadFeaturesFailed}${e instanceof Error ? e.message : t.messages.unknownError}`,
        'danger',
      );
      setSubs([]);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  React.useEffect(() => { void load(); }, [load]);

  const subOf = React.useCallback((item: CatalogItem): FeatureSubscription | null => {
    if (!isFeatureCode(item.key)) return null;
    return subs.find((s) => s.code === item.key) ?? null;
  }, [subs]);

  const isActive = React.useCallback(
    (item: CatalogItem) => !item.paid || !!subOf(item)?.active,
    [subOf],
  );

  const daysLeft = React.useCallback((expiresAt: string | null): number | null => {
    if (!expiresAt || !todayIso) return null;
    const diff = new Date(expiresAt).getTime() - new Date(todayIso).getTime();
    return Math.max(0, Math.ceil(diff / 86_400_000));
  }, [todayIso]);

  /** 原站 deep link：/tenant/feature-store?feature=XXX 直接跳出訂閱視窗 */
  React.useEffect(() => {
    if (loading) return;
    try {
      const code = new URLSearchParams(window.location.search).get('feature');
      if (!code) return;
      const item = FEATURE_CATALOG.find((f) => f.key === code);
      if (item && item.paid) { setMonths(1); setSubscribeTarget(item); }
    } catch (e) {
      toast.show(
        `${t.messages.deepLinkFailed}${e instanceof Error ? e.message : t.messages.unknownError}`,
        'warning',
      );
    }
  }, [loading, toast]);

  const visible = React.useMemo(() => FEATURE_CATALOG.filter((item) => {
    if (category !== 'ALL' && item.category !== category) return false;
    if (onlyUnsubscribed && isActive(item)) return false;
    return true;
  }), [category, onlyUnsubscribed, isActive]);

  const allGranted = React.useMemo(
    () => subs.length > 0 && subs.every((s) => s.active && s.expiresAt === null),
    [subs],
  );

  /* -------------------------------------------------------------- 動作 */

  const openSubscribe = (item: CatalogItem) => {
    setMonths(1);
    if (item.key === 'EXTRA_PUSH') { setNoticeTarget(item); return; }
    setSubscribeTarget(item);
  };

  const confirmSubscribe = async () => {
    if (!subscribeTarget) return;
    const item = subscribeTarget;
    const need = item.price * months;
    const current = balance ?? 0;
    if (need > current) {
      setSubscribeTarget(null);
      setShortOf({ item, months });
      return;
    }
    setWorking(true);
    try {
      // POST /api/feature-store/:code/apply（09 §3）；mock 分支模擬成功。
      await applyFeature(item.key, months);
      const active = isActive(item);
      setSubscribeTarget(null);
      setBalance(current - need);
      toast.show(
        active
          ? t.messages.renewed(t.features[item.key].name, months)
          : t.messages.activated(t.features[item.key].name),
      );
      void load();
    } catch (e) {
      // 409 POINTS_001（點數不足）→ 開既有的儲值引導 modal（09 §3 驗收要求）。
      if (e instanceof ApiError && e.code === 'POINTS_001') {
        setSubscribeTarget(null);
        setShortOf({ item, months });
        return;
      }
      toast.show(
        `${t.messages.subscribeFailedFull}${e instanceof Error ? e.message : t.messages.unknownError}`,
        'danger',
      );
    } finally {
      setWorking(false);
    }
  };

  const runPending = async () => {
    if (!pending) return;
    const { kind, item } = pending;
    const name = t.features[item.key].name;
    const sub = subOf(item);
    setWorking(true);
    try {
      // POST /api/feature-store/:code/{cancel,restore}（09 §3）；mock 模擬成功。
      let restoreResult: FeatureRestoreResult | undefined;
      if (kind === 'cancel') await cancelFeature(item.key);
      else restoreResult = await restoreFeature(item.key);
      setPending(null);
      if (kind === 'cancel') {
        toast.show(sub?.expiresAt ? t.messages.cancelledUsable(name) : t.messages.cancelled(name));
      } else {
        toast.show(t.messages.restored(name));
        if (restoreResult?.restoreSideEffectFailed) {
          toast.show(t.messages.restoreSideEffectFailed, 'warning');
        } else {
          if (restoreResult?.restoredCoupons) {
            toast.show(t.messages.couponsRestored(restoreResult.restoredCoupons));
          }
          if (restoreResult?.restoredProducts) {
            toast.show(t.messages.productsRestored(restoreResult.restoredProducts));
          }
        }
      }
      void load();
    } catch (e) {
      const detail = e instanceof Error ? e.message : t.messages.unknownError;
      toast.show(
        kind === 'cancel'
          ? `${t.messages.cancelFailedFull}${detail}`
          : `${t.messages.restoreFailedFull}${detail}`,
        'danger',
      );
    } finally {
      setWorking(false);
    }
  };

  /* -------------------------------------------------------------- 卡片 */

  const renderCard = (item: CatalogItem) => {
    const copy = t.features[item.key];
    const sub = subOf(item);
    const active = isActive(item);
    const cancelled = CANCELLED_FEATURE_KEYS.has(item.key) && active;
    const permanent = active && item.paid && sub?.expiresAt === null;
    const left = daysLeft(sub?.expiresAt ?? null);

    return (
      <Card key={item.key} className="flex flex-col">
        <CardBody className="flex flex-1 flex-col">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-md font-bold text-dark">{copy.name}</div>
              <div className="form-text">{copy.summary || t.card.noDescription}</div>
            </div>
            <Badge tone={item.paid ? 'primary' : 'neutral'}>
              {item.paid ? t.card.paidTag : t.card.freeTag}
            </Badge>
          </div>

          <div className="mb-2 flex flex-wrap items-center gap-2">
            {!item.paid ? (
              <Badge tone="success">{t.card.permanentFree}</Badge>
            ) : permanent ? (
              <>
                <Badge tone="success">{t.card.grantedActive}</Badge>
                <span className="text-xs text-secondary">{t.card.permanentFreeGranted}</span>
              </>
            ) : cancelled ? (
              <Badge tone="warning">{t.card.cancelledUsable}</Badge>
            ) : active ? (
              <Badge tone="success">{t.card.subscribed}</Badge>
            ) : (
              <span className="text-md font-bold text-primary tabular-nums">
                {t.card.priceLabel(item.price)}
              </span>
            )}
            {active && sub?.expiresAt && left !== null ? (
              <span className="text-xs text-secondary tabular-nums">
                {t.card.expiry(formatDate(sub.expiresAt), left)}
              </span>
            ) : null}
          </div>

          {copy.where ? (
            <div className="text-2xs text-secondary">
              {t.card.whereLabel}{copy.where}
            </div>
          ) : null}
          {copy.lineWhere ? (
            <div className="text-2xs text-secondary">
              {t.card.lineWhereLabel}{copy.lineWhere}
            </div>
          ) : null}

          {copy.before.length ? (
            <div className="mt-3">
              <div className="text-xs font-semibold text-secondary">{t.card.beforeLabel}</div>
              <ul className="mt-1 flex flex-col gap-0.5">
                {copy.before.map((line) => (
                  <li key={line} className="flex items-start gap-1.5 text-sm text-secondary">
                    <X size={13} className="mt-0.5 flex-shrink-0" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-3">
            <div className="text-xs font-semibold text-neutral-700">{t.card.afterLabel}</div>
            <ul className="mt-1 flex flex-col gap-0.5">
              {copy.after.map((line) => (
                <li key={line} className="flex items-start gap-1.5 text-sm text-neutral-700">
                  <Check size={13} className="mt-0.5 flex-shrink-0 text-success" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>

          {item.key === 'EXTRA_PUSH' ? (
            <Alert tone="warning" className="mt-3">
              <div>{t.features.EXTRA_PUSH.noticeWarning}</div>
              <div className="form-text">{t.features.EXTRA_PUSH.noticeWhere}</div>
            </Alert>
          ) : null}

          {item.paid ? (
            <div className="btn-group mt-4 pt-1">
              {cancelled ? (
                <Button
                  variant="outline" size="sm"
                  onClick={() => setPending({ kind: 'restore', item })}
                >
                  <RotateCcw size={13} />{t.card.restore}
                </Button>
              ) : active && !permanent ? (
                <>
                  <Button size="sm" onClick={() => openSubscribe(item)}>
                    {t.card.renew}
                  </Button>
                  <Button
                    variant="outlineDanger" size="sm"
                    onClick={() => setPending({ kind: 'cancel', item })}
                  >
                    {t.card.cancel}
                  </Button>
                </>
              ) : permanent ? null : (
                <Button size="sm" onClick={() => openSubscribe(item)}>
                  {t.card.subscribe}
                </Button>
              )}
            </div>
          ) : null}
        </CardBody>
      </Card>
    );
  };

  const subscribeCopy = subscribeTarget ? t.features[subscribeTarget.key] : null;
  const shortCopy = shortOf ? t.features[shortOf.item.key] : null;
  const needPoints = shortOf ? shortOf.item.price * shortOf.months : 0;
  const shortage = Math.max(0, needPoints - (balance ?? 0));

  return (
    <>
      <PageHeader
        eyebrow={nav.navSystem}
        title={t.title}
        actions={
          <Link className="btn btn-outline" href="/tenant/points">
            <Wallet size={15} />
            {balance === null ? t.balance.empty : t.balance.label(formatNumber(balance))}
          </Link>
        }
      />

      <Alert tone="neutral" icon={false} className="mb-4" title={t.howTo.heading}>
        <ul className="ml-4 list-disc">
          {t.howTo.items.map((i) => (
            <li key={i.label}>
              <strong>{i.label}</strong>{i.text}
            </li>
          ))}
        </ul>
        <div className="mt-1">
          {t.howTo.topupLead}
          <Link className="underline" href="/tenant/points">{t.howTo.topupLink}</Link>
          {t.howTo.topupTail}
        </div>
      </Alert>

      {/* ------------------------------------------------------ 套裝方案 */}
      <h2 className="mb-3 flex items-center gap-2 text-md font-bold text-dark">
        <Package size={16} />{t.sections.bundles}
      </h2>

      {allGranted ? (
        <Alert tone="success" className="mb-4">{t.bundles.allFreeNotice}</Alert>
      ) : (
        <div className="mb-5 grid gap-4 md:grid-cols-2">
          {t.bundles.items.map((b) => (
            <Card key={b.key}>
              <CardBody>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-lg font-bold text-dark">{b.name}</span>
                  <Badge tone="warning">{b.saveLabel}</Badge>
                </div>
                <div className="stat-value">{b.priceLabel}</div>
                <p className="form-text">{b.summary}</p>
                {b.audience ? <p className="form-text">{b.audience}</p> : null}
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {/* ------------------------------------------------------ 個別功能 */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-md font-bold text-dark">
          <Puzzle size={16} />{t.sections.individual}
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <div className="btn-group flex-wrap">
            {CATEGORY_KEYS.map((key) => (
              <Button
                key={key}
                size="sm"
                variant={category === key ? 'primary' : 'secondary'}
                onClick={() => setCategory(key)}
              >
                {t.filters[key]}
              </Button>
            ))}
          </div>
          <span className="flex items-center gap-2">
            <Switch
              id="onlyUnsubscribed"
              checked={onlyUnsubscribed}
              onCheckedChange={setOnlyUnsubscribed}
            />
            <Label htmlFor="onlyUnsubscribed" className="mb-0">{t.onlyUnsubscribed}</Label>
          </span>
        </div>
      </div>

      {loading ? (
        <div className="py-10 text-center text-muted">{t.empty.loading}</div>
      ) : visible.length === 0 ? (
        <EmptyState icon={Puzzle} title={t.empty.title} description={t.empty.description} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map(renderCard)}
        </div>
      )}

      {/* ------------------------------------------------ modal：訂閱 */}
      <Modal
        open={!!subscribeTarget}
        onClose={() => setSubscribeTarget(null)}
        title={subscribeCopy ? t.subscribe.title(subscribeCopy.name) : t.sections.individual}
        footer={
          <>
            <Button variant="secondary" onClick={() => setSubscribeTarget(null)}>
              {common.cancel}
            </Button>
            <Button
              loading={working}
              loadingText={common.processing}
              onClick={() => void confirmSubscribe()}
            >
              {t.subscribe.confirm}
            </Button>
          </>
        }
      >
        {subscribeTarget && subscribeCopy ? (
          <>
            <p className="mb-4 text-base">{t.confirm.subscribe(subscribeCopy.name)}</p>
            <FormGroup>
              <Label htmlFor="subscribeMonths">{t.subscribe.monthsLabel}</Label>
              <Select
                id="subscribeMonths"
                value={String(months)}
                onChange={(e) => setMonths(Number(e.target.value))}
              >
                {MONTH_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {t.subscribe.monthsOption(
                      m === 1 ? t.subscribe.oneMonth : t.subscribe.months(m),
                      subscribeTarget.price * m,
                    )}
                  </option>
                ))}
              </Select>
            </FormGroup>
          </>
        ) : null}
      </Modal>

      {/* ------------------------------------------ modal：加購前提醒 */}
      <Modal
        open={!!noticeTarget}
        onClose={() => setNoticeTarget(null)}
        title={t.purchaseNotice.title}
        footer={
          <>
            <Button variant="secondary" onClick={() => setNoticeTarget(null)}>
              {common.cancel}
            </Button>
            <Button
              onClick={() => {
                const item = noticeTarget;
                setNoticeTarget(null);
                if (item) setSubscribeTarget(item);
              }}
            >
              {t.purchaseNotice.ok}
            </Button>
          </>
        }
      >
        <p className="text-base">{t.features.EXTRA_PUSH.noticeWarning}</p>
        <p className="form-text">{t.features.EXTRA_PUSH.noticeWhere}</p>
      </Modal>

      {/* -------------------------------------------- modal：點數不足 */}
      <Modal
        open={!!shortOf}
        onClose={() => setShortOf(null)}
        title={t.insufficient.title}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShortOf(null)}>{common.cancel}</Button>
            <Link className="btn btn-primary" href="/tenant/points">
              {t.insufficient.topupCta(formatNumber(suggestTopup(shortage)))}
            </Link>
          </>
        }
      >
        {shortOf && shortCopy ? (
          <p className="whitespace-pre-wrap text-base">
            {t.insufficient.intro(shortCopy.name, shortOf.months, formatNumber(needPoints))}
            {t.insufficient.enough(formatNumber(balance ?? 0))}
          </p>
        ) : null}
      </Modal>

      {/* ------------------------------------ modal：取消 / 恢復訂閱 */}
      <ConfirmModal
        open={!!pending}
        loading={working}
        danger={pending?.kind === 'cancel'}
        title={pending?.kind === 'cancel' ? t.confirm.cancelTitle : t.confirm.restoreTitle}
        confirmText={pending?.kind === 'cancel' ? t.card.cancel : t.card.restore}
        message={
          !pending ? common.confirm.message
            : pending.kind === 'cancel' ? (
              <span className="whitespace-pre-wrap">
                {t.confirm.cancel(t.features[pending.item.key].name)}
                {subOf(pending.item)?.expiresAt
                  ? t.confirm.cancelKeepUntilExpiry
                  : t.confirm.cancelImmediately}
              </span>
            ) : (
              <span className="whitespace-pre-wrap">
                {t.confirm.restore(t.features[pending.item.key].name)}
              </span>
            )
        }
        onClose={() => setPending(null)}
        onConfirm={() => void runPending()}
      />
    </>
  );
}
