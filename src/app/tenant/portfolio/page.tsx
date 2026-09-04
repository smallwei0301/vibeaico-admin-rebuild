'use client';
import * as React from 'react';
import Link from 'next/link';
import {
  ArrowLeftRight, ChevronDown, ChevronUp, Eye, EyeOff, Globe, Image as ImageIcon,
  Images, Pencil, Plus, Sparkles, Trash2,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { Card, CardBody } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmModal, Modal } from '@/components/ui/Modal';
import {
  FormError, FormGroup, FormText, Input, Label, SwitchField, Textarea,
} from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { listFeatures } from '@/services/settings';
import {
  createPortfolio, deletePortfolio, listPortfolios, reorderPortfolios,
  togglePortfolioActive, togglePortfolioLineFeatured, updatePortfolio,
} from '@/services/portfolios';
import type { Portfolio } from '@/lib/types';
import { common } from '@/i18n/zh-TW/common';
import { nav } from '@/i18n/zh-TW/nav';
import { portfolioPage as t } from '@/i18n/zh-TW/pages/portfolio';
import { formatNumber } from '@/lib/utils';

type SortMode = 'line' | 'public';

const EMPTY_DRAFT = {
  id: '',
  title: '',
  description: '',
  imageUrl: '',
  sortOrder: 0,
  active: true,
};

/* -------------------------------------------------------------------------- */

export default function PortfolioPage() {
  const toast = useToast();

  const [items, setItems] = React.useState<Portfolio[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [featureActive, setFeatureActive] = React.useState(true);
  /**
   * 排序模式切換仍保留（原站設計，見 docs/specs/portfolio.json）：後端
   * portfolios 表目前只有單一 sortOrder，沒有獨立的 LINE 排序欄位（services/
   * products 有靠 Issue #128 補上，portfolios 沒有）。因此兩個模式目前顯示
   * 同一份順序，「LINE 顯示順序」模式下的個別調整與「套用排序」一律停用並
   * 顯示真實原因，而不是假裝成功——已列入 ESCALATE_SOL 待補後端。
   */
  const [sortMode, setSortMode] = React.useState<SortMode>('line');

  const [draft, setDraft] = React.useState<typeof EMPTY_DRAFT | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [titleError, setTitleError] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  const [deleteTarget, setDeleteTarget] = React.useState<Portfolio | null>(null);
  const [toggleTarget, setToggleTarget] = React.useState<Portfolio | null>(null);
  const [reordering, setReordering] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      setItems(await listPortfolios());
    } catch (e) {
      toast.show(e instanceof Error ? e.message : t.messages.loadPortfolioFailed, 'danger');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  React.useEffect(() => { void load(); }, [load]);

  React.useEffect(() => {
    void (async () => {
      try {
        const features = await listFeatures();
        setFeatureActive(features.some((f) => f.code === 'PORTFOLIO_SHOWCASE' && f.active));
      } catch {
        toast.show(t.messages.retryLater, 'danger');
      }
    })();
  }, [toast]);

  /* ------------------------------------------------------------ 衍生值 */

  const activeCount = items.filter((i) => i.active).length;
  const inactiveCount = items.length - activeCount;
  const lineFeaturedCount = items.filter((i) => i.lineFeatured).length;
  const overLineLimit = lineFeaturedCount > t.sort.lineMaxFeatured;

  /** 後端只有單一 sortOrder，兩個模式目前顯示同一份順序（見上方註解）。 */
  const ordered = React.useMemo(
    () => [...items].sort((a, b) => a.sortOrder - b.sortOrder),
    [items],
  );

  const fromLabel = sortMode === 'line' ? t.sort.lineMode : t.sort.publicMode;
  const toModeLabel = sortMode === 'line' ? t.sort.publicLabel : t.sort.lineMode;

  /* -------------------------------------------------------------- 動作 */

  const openCreate = () => {
    setEditing(false);
    setTitleError('');
    setDraft({ ...EMPTY_DRAFT, sortOrder: items.length });
  };

  const openEdit = (item: Portfolio) => {
    setEditing(true);
    setTitleError('');
    setDraft({
      id: item.id,
      title: item.title,
      description: item.description,
      imageUrl: item.imageUrl,
      sortOrder: item.sortOrder,
      active: item.active,
    });
  };

  const save = async () => {
    if (!draft) return;
    if (!draft.title.trim()) {
      setTitleError(t.messages.titleRequired);
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await updatePortfolio(draft.id, {
          title: draft.title.trim(),
          description: draft.description,
          imageUrl: draft.imageUrl,
          active: draft.active,
        });
        toast.show(t.messages.updated);
      } else {
        await createPortfolio({
          title: draft.title.trim(),
          description: draft.description,
          imageUrl: draft.imageUrl || draft.title.trim(),
          active: draft.active,
        });
        toast.show(t.messages.created);
      }
      setDraft(null);
      await load();
    } catch (e) {
      toast.show(
        `${t.messages.saveFailedPrefix}${e instanceof Error ? e.message : t.messages.unknownError}`,
        'danger',
      );
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    try {
      await deletePortfolio(deleteTarget.id);
      setDeleteTarget(null);
      toast.show(t.messages.deleted);
      await load();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : t.messages.deleteWorkFailed, 'danger');
    }
  };

  const toggleActive = async () => {
    if (!toggleTarget) return;
    const target = toggleTarget;
    try {
      const { active } = await togglePortfolioActive(target.id);
      setToggleTarget(null);
      toast.show(t.messages.toggled(active ? t.actions.enable : t.actions.disable));
      await load();
    } catch (e) {
      toast.show(`${t.messages.toggleFailedPrefix}${e instanceof Error ? e.message : t.messages.unknownError}`, 'danger');
    }
  };

  const toggleLineFeatured = async (item: Portfolio) => {
    try {
      const { lineFeatured } = await togglePortfolioLineFeatured(item.id);
      setItems((list) => list.map((i) => (i.id === item.id ? { ...i, lineFeatured } : i)));
      toast.show(lineFeatured ? t.messages.lineShown : t.messages.lineHidden);
    } catch (e) {
      toast.show(`${t.messages.toggleFailedPrefix}${e instanceof Error ? e.message : t.messages.unknownError}`, 'danger');
    }
  };

  /**
   * 上／下移：後端只有單一 sortOrder，僅「公開頁順序」模式真的會寫回
   * /api/portfolios/reorder。「LINE 顯示順序」模式下的箭頭本身就停用
   * （見 render），這裡多一層防呆，絕不假裝成功。
   */
  const move = async (item: Portfolio, delta: -1 | 1) => {
    if (sortMode === 'line') {
      toast.show(t.sort.lineOrderUnavailable, 'danger');
      return;
    }
    const index = ordered.findIndex((i) => i.id === item.id);
    const target = index + delta;
    if (target < 0 || target >= ordered.length) return;
    const next = [...ordered];
    [next[index], next[target]] = [next[target], next[index]];
    setReordering(true);
    try {
      await reorderPortfolios(next.map((i) => i.id));
      toast.show(t.sort.publicOrderUpdated);
      await load();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : t.messages.reorderFailed, 'danger');
    } finally {
      setReordering(false);
    }
  };

  /* -------------------------------------------------------------- render */

  return (
    <>
      <PageHeader
        eyebrow={nav.navPublicPage}
        title={t.title}
        subtitle={t.subtitle}
        actions={
          <Button onClick={openCreate} disabled={!featureActive}>
            <Plus size={15} />
            {t.actions.create}
          </Button>
        }
      />

      {!featureActive ? (
        <Alert tone="warning" className="mb-4">
          {t.feature.lockedHtmlLead}
          <strong>{t.feature.lockedStrong}</strong>
          {t.feature.lockedTail}
          <Link href="/tenant/feature-store" className="ml-2 font-semibold">
            {t.feature.goToStore}
          </Link>
        </Alert>
      ) : null}

      {/* --------------------------------------------------------- 統計卡 */}
      <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard label={t.stats.total} value={formatNumber(items.length)} icon={Images} />
        <StatCard label={t.stats.active} value={formatNumber(activeCount)} icon={Eye} tone="success" />
        <StatCard label={t.stats.inactive} value={formatNumber(inactiveCount)} icon={EyeOff} tone="neutral" />
      </div>

      {/* ----------------------------------------------------- 排序模式卡 */}
      <Card className="mb-4">
        <CardBody>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold">{t.sort.modeLabel}</span>
            <div className="btn-group">
              <Button
                variant={sortMode === 'line' ? 'primary' : 'outline'}
                size="sm"
                onClick={() => setSortMode('line')}
              >
                <Sparkles size={13} />
                {t.sort.lineMode}
              </Button>
              <Button
                variant={sortMode === 'public' ? 'primary' : 'outline'}
                size="sm"
                onClick={() => setSortMode('public')}
              >
                <Globe size={13} />
                {t.sort.publicMode}
              </Button>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled
              title={t.sort.syncUnavailable}
              aria-label={t.sort.syncUnavailable}
            >
              <ArrowLeftRight size={13} />
              {sortMode === 'line' ? t.sort.syncToPublic : t.sort.syncToLine}
            </Button>
          </div>

          <FormText className="mt-3">
            {t.sort.introLead}
            <strong>{t.sort.introStrong}</strong>
            {t.sort.introTail}
          </FormText>

          {sortMode === 'line' ? (
            <>
              <FormText>
                {t.sort.lineHintLead}
                <strong>{t.sort.lineHintStrong}</strong>
                {t.sort.lineHintTail}
                {t.sort.lineHintToggle}
                <strong>{t.sort.lineHintToggleStrong}</strong>
                {t.sort.lineHintToggleTail}
                <strong>{t.sort.lineHintOrderStrong}</strong>
              </FormText>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge tone={overLineLimit ? 'warning' : 'primary'}>
                  {t.sort.lineFeaturedCount(lineFeaturedCount)}
                </Badge>
                {overLineLimit ? (
                  <span className="text-xs text-danger">{t.sort.lineOverLimit}</span>
                ) : null}
                <span className="text-xs text-secondary">{t.sort.lineOrderUnavailable}</span>
              </div>
            </>
          ) : (
            <FormText>
              <strong>{t.sort.publicHintLead}</strong>
              {t.sort.publicHintMiddle}
              <strong>{t.sort.publicHintStrong}</strong>
              {t.sort.publicHintTail}
            </FormText>
          )}
        </CardBody>
      </Card>

      {/* --------------------------------------------------------- 作品牆 */}
      {loading ? (
        <Card>
          <CardBody className="py-10 text-center text-muted">{common.loading}</CardBody>
        </Card>
      ) : ordered.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              icon={Images}
              title={t.empty.title}
              description={t.empty.description}
              action={
                <Button onClick={openCreate} disabled={!featureActive}>
                  <Plus size={15} />
                  {t.actions.create}
                </Button>
              }
            />
          </CardBody>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {ordered.map((item, index) => (
            <Card key={item.id}>
              <CardBody>
                <div className="mb-3 flex h-32 items-center justify-center rounded-md bg-neutral-100 text-secondary">
                  <ImageIcon size={26} />
                </div>

                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-base font-semibold text-dark">{item.title}</div>
                    <div className="truncate text-xs text-secondary">
                      {item.description || t.labels.noDescription}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={!featureActive}
                    title={item.lineFeatured ? t.actions.lineShown : t.actions.lineHidden}
                    aria-label={item.lineFeatured ? t.actions.lineShown : t.actions.lineHidden}
                    onClick={() => void toggleLineFeatured(item)}
                  >
                    <Sparkles
                      size={15}
                      className={item.lineFeatured ? 'text-primary' : 'text-neutral-400'}
                    />
                  </Button>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Badge tone={item.active ? 'success' : 'neutral'}>
                    {item.active ? t.labels.active : t.labels.inactive}
                  </Badge>
                  <Badge tone={item.lineFeatured ? 'primary' : 'neutral'}>
                    {item.lineFeatured ? t.labels.lineShown : t.labels.lineHiddenBadge}
                  </Badge>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-1">
                  <Button
                    variant="outline" size="sm"
                    aria-label={common.prev} title={sortMode === 'line' ? t.sort.lineOrderUnavailable : common.prev}
                    disabled={sortMode === 'line' || reordering || index === 0}
                    onClick={() => void move(item, -1)}
                  >
                    <ChevronUp size={13} />
                  </Button>
                  <Button
                    variant="outline" size="sm"
                    aria-label={common.next} title={sortMode === 'line' ? t.sort.lineOrderUnavailable : common.next}
                    disabled={sortMode === 'line' || reordering || index === ordered.length - 1}
                    onClick={() => void move(item, 1)}
                  >
                    <ChevronDown size={13} />
                  </Button>
                  <Button
                    variant="outline" size="sm"
                    disabled={!featureActive}
                    onClick={() => openEdit(item)}
                  >
                    <Pencil size={13} />
                    {common.edit}
                  </Button>
                  <Button
                    variant="outline" size="sm"
                    disabled={!featureActive}
                    onClick={() => setToggleTarget(item)}
                  >
                    {item.active ? t.actions.disable : t.actions.enable}
                  </Button>
                  <Button
                    variant="outlineDanger" size="sm"
                    aria-label={t.actions.delete} title={t.actions.delete}
                    disabled={!featureActive}
                    onClick={() => setDeleteTarget(item)}
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {/* -------------------------------------------------- modal：新增/編輯 */}
      <Modal
        open={!!draft}
        onClose={() => setDraft(null)}
        size="lg"
        title={editing ? t.form.editTitle : t.form.createTitle}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDraft(null)}>{common.cancel}</Button>
            <Button loading={saving} loadingText={common.saving} onClick={() => void save()}>
              {common.save}
            </Button>
          </>
        }
      >
        {draft ? (
          <>
            <FormGroup>
              <Label htmlFor="titleInput" required>{t.form.titleLabel}</Label>
              <Input
                id="titleInput"
                placeholder={t.form.titlePlaceholder}
                value={draft.title}
                onChange={(e) => {
                  setDraft({ ...draft, title: e.target.value });
                  setTitleError('');
                }}
              />
              {titleError ? <FormError>{titleError}</FormError> : null}
            </FormGroup>

            <FormGroup>
              <Label htmlFor="descriptionInput">{t.form.description}</Label>
              <Textarea
                id="descriptionInput"
                rows={3}
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </FormGroup>

            <FormGroup>
              <Label>{t.form.coverImage}</Label>
              <Input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  setDraft({ ...draft, imageUrl: file ? file.name : draft.imageUrl });
                }}
              />
              <FormText>{t.form.coverImageHelp}</FormText>
            </FormGroup>

            <FormGroup>
              <Label>{t.form.extraImages}</Label>
              <Input type="file" accept="image/*" multiple />
              <FormText>{t.form.extraImagesHelp}</FormText>
            </FormGroup>

            <FormGroup>
              <Label htmlFor="sortOrderInput">{t.form.sortOrder}</Label>
              <Input id="sortOrderInput" type="number" value={draft.sortOrder} readOnly disabled />
              <FormText>{t.form.sortOrderHelp}</FormText>
            </FormGroup>

            <SwitchField
              label={t.form.enabled}
              checked={draft.active}
              onCheckedChange={(v) => setDraft({ ...draft, active: v })}
            />
          </>
        ) : null}
      </Modal>

      {/* ------------------------------------------------------- 確認彈窗 */}
      <ConfirmModal
        open={!!deleteTarget}
        title={t.confirm.deleteTitle}
        message={t.confirm.delete}
        danger
        confirmText={common.delete}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void remove()}
      />

      <ConfirmModal
        open={!!toggleTarget}
        title={t.confirm.toggleTitle}
        message={t.confirm.toggle(
          toggleTarget?.active ? t.actions.disable : t.actions.enable,
        )}
        onClose={() => setToggleTarget(null)}
        onConfirm={() => void toggleActive()}
      />
    </>
  );
}
